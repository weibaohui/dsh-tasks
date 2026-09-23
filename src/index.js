'use strict'

/**
 * dsh-tasks — Host half
 *
 * Durable cron-driven prompts. Each item carries a title, a prompt, and a
 * croner expression; an enabled item spawns a fresh agent session and
 * submits the prompt on schedule (or on demand). The store is durable
 * through the host `storageDomain` service (domain `dsh_tasks`), the
 * schedule runs on croner, and an HTTP API under `/dsh-tasks/api`
 * serves the management pages in the web client.
 *
 * Runs push notifications through other plugins' delivery services
 * (`ctx.get(service)` — e.g. `dshIm` from @xmanrui/dsh-im): the spawned
 * session's first `turn/end` settles the run, and the result goes to every
 * channel configured in the settings UI. Providers are soft dependencies —
 * absent services disable notification delivery without blocking the plugin.
 * The only runtime
 * dependencies are plain npm packages (croner, zod).
 */

const { randomUUID } = require('node:crypto')
const { Cron } = require('croner')
const { z } = require('zod')

/** Most recent runs kept per item, oldest entries trimmed beyond this. */
const MAX_RUNS = 20

/** One execution attempt: when it ran, the session it spawned, and the outcome. */
const runSchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  sessionId: z.string().optional(),
  error: z.string().optional(),
})

/** Durable shape of one scheduled item. */
const itemSchema = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  cron: z.string(),
  enabled: z.boolean(),
  workspaceId: z.string().optional(),
  /** Optional per-item model route; both present or both absent. */
  provider: z.string().optional(),
  model: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().optional(),
  lastRunError: z.string().optional(),
  runs: z.array(runSchema).optional(),
})

// ── Notification settings ─────────────────────────────────────────────────────
// Delivery providers are OTHER plugins (e.g. @xmanrui/dsh-im) that expose a
// cordis service shaped like `{ send(botId, targetId, text), listBots(),
// listTargets(botId) }`. They are reached through a soft `ctx.get(service)`
// lookup — never through `inject`, which would turn dsh-im into a hard
// dependency and keep this plugin from activating without it.

/** cordis service names probed by the provider discovery endpoint. */
const NOTIFY_SERVICE_CANDIDATES = ['dshIm']

/** Stable key of the single notify-settings record in the `notify` table. */
const NOTIFY_CONFIG_KEY = 'config'

/** Maximum tail of the agent's final reply included in a completion push. */
const MAX_RESULT_CHARS = 1000

/** Default do-not-disturb window (23:00–08:00) used when times are absent/invalid. */
const DEFAULT_DND_START = '23:00'
const DEFAULT_DND_END = '08:00'
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** One configured push target: a delivery service plus its routing ids. */
const notifyChannelSchema = z.object({
  id: z.string().min(1),
  service: z.string().min(1),
  botId: z.string().min(1),
  targetId: z.string().min(1),
  label: z.string().optional(),
})

/** Validated shape of the stored notify settings record. */
const notifyConfigSchema = z.object({
  enabled: z.boolean(),
  onStart: z.boolean(),
  onComplete: z.boolean(),
  onError: z.boolean(),
  includeResult: z.boolean(),
  dnd: z.object({
    enabled: z.boolean(),
    start: z.string(),
    end: z.string(),
  }),
  channels: z.array(notifyChannelSchema),
})

/**
 * Coerce arbitrary (client-supplied or stored) input into a valid notify
 * config: missing booleans fall back to their defaults, channels lacking an
 * id get one generated, and invalid channel fields throw a readable error.
 */
function normalizeNotifyConfig(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const channels = Array.isArray(raw.channels) ? raw.channels : []
  return {
    enabled: raw.enabled === true,
    onStart: raw.onStart === true,
    onComplete: raw.onComplete !== false,
    onError: raw.onError !== false,
    includeResult: raw.includeResult === true,
    dnd: sanitizeDnd(raw.dnd),
    channels: channels.map((channel) => notifyChannelSchema.parse({
      id: typeof channel.id === 'string' && channel.id !== '' ? channel.id : `chan-${randomUUID()}`,
      service: channel.service,
      botId: channel.botId,
      targetId: channel.targetId,
      ...(typeof channel.label === 'string' && channel.label !== '' ? { label: channel.label } : {}),
    })),
  }
}

/** Extract the reason kind from a `turn/end` event payload (tolerates bare strings). */
function turnEndKind(reason) {
  if (typeof reason === 'string') return reason
  if (reason && typeof reason === 'object' && typeof reason.kind === 'string') return reason.kind
  return undefined
}

/** Map a turn-end kind onto a notification kind; `undefined` means stay silent. */
function classifyTurnEnd(kind) {
  if (kind === 'completed' || kind === 'max-tokens') return 'complete'
  if (kind === 'error') return 'error'
  return undefined
}

/** Pull a human-readable message out of a `turn/end` error reason. */
function errorSummaryFrom(reason) {
  const failure = reason && typeof reason === 'object' ? (reason.error || reason.failure) : undefined
  if (failure === undefined || failure === null) return undefined
  const text = typeof failure === 'string' ? failure : (typeof failure.message === 'string' ? failure.message : String(failure))
  return text.slice(0, 200)
}

/** Extract the plain text from one message's content blocks (text blocks only). */
function messageText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

/**
 * The final assistant reply from a session event log: scan backwards for the
 * last `assistant/message` entry (tool-call turns write their reply after the
 * tools finish, so the last one is the conclusion). Missing entries (reasoning
 * blocks etc.) yield ''.
 */
function lastAssistantText(events) {
  if (!Array.isArray(events)) return ''
  for (let i = events.length - 1; i >= 0; i--) {
    const entry = events[i]
    if (entry && entry.type === 'assistant/message') {
      const message = entry.data && entry.data.message
      const text = messageText(message && message.content)
      if (text) return text
    }
  }
  return ''
}

/**
 * Defensive read of a live session's event log. `snapshotEvents()` is the
 * sanctioned entry (works while events spill to disk); bare `session.events`
 * is the fallback and may be absent.
 */
function sessionEventsOf(session) {
  if (!session) return undefined
  try {
    const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events
    if (Array.isArray(events)) return events
  } catch {}
  return undefined
}

/** The tail of `text`, capped at `max` chars with a leading ellipsis when trimmed. */
function takeTail(text, max) {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed || typeof max !== 'number' || !Number.isFinite(max) || max <= 0) return ''
  return trimmed.length > max ? `…${trimmed.slice(-max)}` : trimmed
}

/** Minutes since midnight for a `HH:mm` string, or `null` when malformed. */
function parseHm(value) {
  const m = typeof value === 'string' ? HM_RE.exec(value) : null
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/**
 * Coerce a do-not-disturb block into a safe shape. Invalid or missing times
 * fall back to the defaults instead of throwing — this runs on stored
 * records at domain-open time too, where failing loud would kill the host.
 */
function sanitizeDnd(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: r.enabled === true,
    start: typeof r.start === 'string' && HM_RE.test(r.start) ? r.start : DEFAULT_DND_START,
    end: typeof r.end === 'string' && HM_RE.test(r.end) ? r.end : DEFAULT_DND_END,
  }
}

/**
 * True when `now` (default: host local time) falls inside the DND window.
 * `start > end` means an overnight window (e.g. 22:00–08:00); a missing,
 * malformed, or zero-length window (`start === end`) is never active.
 */
function isDndActive(dnd, now = new Date()) {
  if (!dnd || dnd.enabled !== true) return false
  const start = parseHm(dnd.start)
  const end = parseHm(dnd.end)
  if (start === null || end === null || start === end) return false
  const current = now.getHours() * 60 + now.getMinutes()
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}

/** Format a millisecond duration as a compact `42s` / `3m12s` / `1h4m` string. */
function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const rest = seconds % 60
    return rest ? `${minutes}m${rest}s` : `${minutes}m`
  }
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

/** Compose the push text for one notification kind. */
function formatNotifyText(kind, info) {
  const title = info && typeof info.title === 'string' && info.title !== '' ? info.title : '未命名任务'
  const duration = formatDuration(info && info.durationMs)
  const suffix = duration ? ` · 耗时 ${duration}` : ''
  if (kind === 'start') return `▶️ 定时任务「${title}」已开始`
  if (kind === 'error') {
    const detail = info && info.error ? `：${info.error}` : ''
    return `❌ 定时任务「${title}」失败${detail}${suffix}`
  }
  const result = takeTail(info && info.resultText, MAX_RESULT_CHARS)
  return `✅ 定时任务「${title}」已完成${suffix}` + (result ? `\n结论：${result}` : '')
}

/** The dsh-tasks domain: durable `items` plus the notify settings record.
 *  Version stays 1 on purpose — the storage backend has no migration path
 *  (a version change rejects the open outright), and adding an empty table
 *  needs none: existing items records validate against the unchanged schema.
 *
 *  The notify table's stored-record schema is deliberately LOOSE: open
 *  validates every stored record against it, so a strict schema would turn
 *  any future field addition into a boot-killing change for deployments
 *  holding records written by older versions (adding a required
 *  `includeResult` did exactly that on the live host). Strict shaping and
 *  defaults happen in normalizeNotifyConfig at read time instead. */
const storedNotifyRecordSchema = z.looseObject({
  enabled: z.boolean().optional(),
  onStart: z.boolean().optional(),
  onComplete: z.boolean().optional(),
  onError: z.boolean().optional(),
  includeResult: z.boolean().optional(),
  channels: z.array(z.looseObject({ id: z.string() })).optional(),
})

const domainSpec = {
  name: 'dsh_tasks',
  version: 1,
  tables: {
    items: { valueSchema: itemSchema },
    notify: { valueSchema: storedNotifyRecordSchema },
  },
}

/** Maximum request body the item API accepts (create/update payloads). */
const MAX_BODY_BYTES = 64 * 1024

/** Validate a cron expression eagerly so bad input fails at write time. */
function validateCron(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new Error('cron expression must not be empty')
  }
  try {
    // Constructing parses the expression; a malformed one throws. `paused`
    // keeps the validation-only job from arming a real timer, and stop()
    // releases it, so a probe never keeps the event loop alive.
    const probe = new Cron(expression, { paused: true }, () => {})
    probe.stop()
  } catch (error) {
    throw new Error(`invalid cron expression '${expression}': ${String((error && error.message) || error)}`)
  }
}

/**
 * Validate the optional per-item model route: `provider` and `model` are
 * either both non-empty strings or both absent. Returns the normalized pair
 * (or `undefined` when unset) so callers can spread it into a record.
 */
function normalizeModelSelection(input) {
  // JSON bodies express "unset" as null; treat it the same as absent.
  const provider = input.provider === null ? undefined : input.provider
  const model = input.model === null ? undefined : input.model
  if (provider === undefined && model === undefined) return undefined
  if (typeof provider !== 'string' || provider.trim() === ''
    || typeof model !== 'string' || model.trim() === '') {
    throw new Error('provider and model must both be non-empty strings, or both be omitted')
  }
  return { provider: provider.trim(), model: model.trim() }
}

/** Short local timestamp (`MM-DD HH:mm`) used to distinguish repeated runs in the sidebar. */
function runStamp(iso) {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Append one run to the history (capped) and refresh the last-run summary fields. */
function withRun(record, entry) {
  const runs = [...(record.runs || []), entry].slice(-MAX_RUNS)
  return {
    ...record,
    runs,
    lastRunAt: entry.at,
    lastRunError: entry.ok ? undefined : (entry.error || 'failed'),
  }
}

/** Build one fresh item record from validated input. */
function buildRecord(input) {
  if (!input || typeof input.title !== 'string' || typeof input.prompt !== 'string'
    || typeof input.cron !== 'string' || typeof input.enabled !== 'boolean') {
    throw new Error('input must provide title, prompt, cron, and enabled')
  }
  validateCron(input.cron)
  const selection = normalizeModelSelection(input)
  const now = new Date().toISOString()
  const id = `item-${randomUUID()}`
  return {
    id,
    title: input.title,
    prompt: input.prompt,
    cron: input.cron,
    enabled: input.enabled,
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    ...(selection === undefined ? {} : selection),
    createdAt: now,
    updatedAt: now,
    runs: [],
  }
}

module.exports = {
  name: 'dsh-tasks',
  inject: ['storageDomain', 'agents', 'agentDefaultModel', 'webServer', 'workspaceRegistry', 'sessionTitle', 'connection'],

  // Exposed for the offline test suite only (test/*.test.mjs); Cordis
  // ignores unknown export properties.
  __test: {
    itemSchema,
    runSchema,
    domainSpec,
    validateCron,
    buildRecord,
    runStamp,
    withRun,
    normalizeModelSelection,
    normalizeNotifyConfig,
    turnEndKind,
    classifyTurnEnd,
    errorSummaryFrom,
    messageText,
    lastAssistantText,
    sessionEventsOf,
    takeTail,
    parseHm,
    sanitizeDnd,
    isDndActive,
    formatDuration,
    formatNotifyText,
    NOTIFY_CONFIG_KEY,
    NOTIFY_SERVICE_CANDIDATES,
    MAX_RESULT_CHARS,
    MAX_RUNS,
  },

  /**
   * Mount the store, the croner schedule, and the HTTP API.
   * @param ctx - harness context carrying the injected services.
   * @param rawConfig - plugin config (`{ cwd?: string }`); validated by Cordis
   *   when present, otherwise defaulted here.
   */
  apply(ctx, rawConfig) {
    const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}
    const defaultCwd = config.cwd || process.cwd()

    let table
    let notifyTable
    let notifyConfig = normalizeNotifyConfig()
    const jobs = new Map()
    // In-memory run tracking for completion notifications, keyed by the
    // sessionId this plugin spawned. A host restart drops pending entries —
    // the run still happened, it just cannot be notified about afterwards.
    const trackedRuns = new Map()

    const requireTable = () => {
      if (!table) throw new Error('scheduled items are not started yet')
      return table
    }

    const sendJson = (res, status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(payload))
    }

    const readJsonBody = async (req) => {
      const chunks = []
      let received = 0
      for await (const chunk of req) {
        received += chunk.length
        if (received > MAX_BODY_BYTES) throw new Error('request body too large')
        chunks.push(chunk)
      }
      if (chunks.length === 0) return {}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }

    /**
     * Execute one item: spawn a fresh agent session and submit the prompt.
     * A bound workspace supplies the session cwd and gets the session
     * attached, so the run appears under the workspace in the sidebar.
     * @param record - the stored item.
     * @returns the updated record with last-run metadata.
     */
    async function execute(record) {
      const startedAt = new Date().toISOString()
      try {
        const sessionId = `session-${randomUUID()}`
        // A per-item model route wins; otherwise fall back to the deployment
        // default selection, exactly like a session created without a model.
        const selection = record.provider !== undefined && record.model !== undefined
          ? { provider: record.provider, model: record.model }
          : ctx.agentDefaultModel.currentSelection()
        const workspace = record.workspaceId === undefined
          ? undefined
          : ctx.workspaceRegistry.get(record.workspaceId)
        if (record.workspaceId !== undefined && workspace === undefined) {
          throw new Error(`workspace '${record.workspaceId}' not found`)
        }
        const handle = await ctx.agents.create({
          sessionId,
          meta: { cwd: workspace ? workspace.path : defaultCwd },
          agentOptions: { provider: selection.provider, model: selection.model },
          // Without a preset mount the fresh session runs with NO tools, so
          // the model can only answer verbally ("I cannot run shell
          // commands"). Resolve the deployment's default agent preset and
          // mount it in setup, exactly like the web gateway does when it
          // creates a session — this brings in bash/files/web and every
          // other tool the preset composes.
          setup: async (agentCtx) => {
            const presets = ctx.get('agentPresets')
            if (!presets || typeof presets.resolve !== 'function' || typeof presets.mount !== 'function') {
              return
            }
            const resolved = await presets.resolve(undefined)
            if (resolved && resolved.id) {
              await presets.mount(agentCtx, resolved.id)
            }
          },
        })
        if (workspace !== undefined) {
          await workspace.attachSession(sessionId)
        }
        // Pin the session title to the item's title plus a run timestamp, so
        // repeated runs of one item stay distinguishable in the sidebar. Append
        // directly to the session log with a 'user' source to prevent automatic
        // title generation from overwriting it.
        const sessionTitle = `${record.title} · ${runStamp(startedAt)}`
        try {
          handle.agent.session.append('session/title', {
            title: sessionTitle,
            messageSeqs: [],
            source: { kind: 'user' },
          })
        } catch {
          // A failed append is non-fatal; the session still runs with a
          // fallback title derived from the first prompt.
        }
        const message = {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: record.prompt }],
          source: { kind: 'plugin', plugin: 'dsh-tasks' },
        }
        handle.agent.followup(message)
        trackedRuns.set(sessionId, { itemId: record.id, title: record.title, startedAt })
        void dispatchNotify('start', { title: record.title, startedAt })
        return withRun(record, { at: startedAt, ok: true, sessionId })
      } catch (error) {
        const message = String((error && error.message) || error)
        void dispatchNotify('error', {
          title: record.title,
          startedAt,
          durationMs: Date.now() - new Date(startedAt).getTime(),
          error: message,
        })
        return withRun(record, { at: startedAt, ok: false, error: message })
      }
    }

    /** Schedule one enabled item, or stop an existing job when disabled. */
    function rescheduleOne(id, record) {
      const existing = jobs.get(id)
      if (existing) {
        existing.stop()
        jobs.delete(id)
      }
      if (!record.enabled) return
      const job = new Cron(record.cron, () => {
        const current = requireTable().get(id)
        if (current !== undefined) runNow(id).catch(() => {})
      })
      jobs.set(id, job)
    }

    /** Rebuild the croner job table from the stored items. */
    function rescheduleAll() {
      for (const job of jobs.values()) job.stop()
      jobs.clear()
      for (const [id, record] of requireTable().entries()) rescheduleOne(id, record)
    }

    /** List every item in insertion order. */
    function list() {
      return [...requireTable().entries()].map(([, record]) => record)
    }

    /** Create one item, schedule it when enabled, and persist it. */
    async function create(input) {
      if (!input || typeof input.title !== 'string' || typeof input.prompt !== 'string'
        || typeof input.cron !== 'string' || typeof input.enabled !== 'boolean') {
        throw new Error('input must provide title, prompt, cron, and enabled')
      }
      const record = buildRecord(input)
      const id = record.id
      await requireTable().put(id, record)
      rescheduleOne(id, record)
      return record
    }

    /** Update one item and reschedule its job when schedule or state changed. */
    async function update(id, patch) {
      const current = requireTable().get(id)
      if (current === undefined) throw new Error(`scheduled item '${id}' not found`)
      if (patch.cron !== undefined && patch.cron !== current.cron) validateCron(patch.cron)
      // Model route in a PATCH: `null` (either field) clears the per-item
      // selection back to the deployment default; present strings replace it
      // as a validated pair; absent fields keep the stored route.
      const { provider: patchProvider, model: patchModel, ...rest } = patch
      let modelFields = {}
      if (patchProvider === null || patchModel === null) {
        modelFields = { provider: undefined, model: undefined }
      } else if (patchProvider !== undefined || patchModel !== undefined) {
        modelFields = normalizeModelSelection({
          provider: patchProvider !== undefined ? patchProvider : current.provider,
          model: patchModel !== undefined ? patchModel : current.model,
        })
      }
      const next = {
        ...current,
        ...rest,
        ...modelFields,
        id: current.id,
        updatedAt: new Date().toISOString(),
      }
      if (next.provider === undefined) delete next.provider
      if (next.model === undefined) delete next.model
      await requireTable().put(id, next)
      rescheduleOne(id, next)
      return next
    }

    /** Remove one item and stop its job. */
    async function remove(id) {
      const current = requireTable().get(id)
      if (current === undefined) throw new Error(`scheduled item '${id}' not found`)
      const existing = jobs.get(id)
      if (existing) {
        existing.stop()
        jobs.delete(id)
      }
      await requireTable().delete(id)
    }

    /** Execute one item immediately, recording the attempt on the record. */
    async function runNow(id) {
      const current = requireTable().get(id)
      if (current === undefined) throw new Error(`scheduled item '${id}' not found`)
      const updated = await execute(current)
      await requireTable().put(id, updated)
      return updated
    }

    // ── notifications ────────────────────────────────────────────────────────
    // console.error (stderr) is the only sink guaranteed visible in the web
    // logs on this host — the named logger service filters warns by level.
    const warnLog = (message) => {
      try { console.error(`[dsh-tasks] ${message}`) } catch {}
    }

    /** Normalize one entry of `listBots()` output; `undefined` when unusable. */
    function normalizeBot(bot) {
      if (!bot || typeof bot !== 'object') return undefined
      const botId = typeof bot.botId === 'string' ? bot.botId : (typeof bot.id === 'string' ? bot.id : undefined)
      if (botId === undefined) return undefined
      return { botId, ...(typeof bot.channel === 'string' ? { channel: bot.channel } : {}) }
    }

    /** Normalize one entry of `listTargets(botId)` output; `undefined` when unusable. */
    function normalizeTarget(target) {
      if (!target || typeof target !== 'object') return undefined
      const targetId = typeof target.targetId === 'string' ? target.targetId : (typeof target.id === 'string' ? target.id : undefined)
      if (targetId === undefined) return undefined
      return {
        targetId,
        ...(typeof target.name === 'string' && target.name !== '' ? { name: target.name } : {}),
        ...(typeof target.kind === 'string' ? { kind: target.kind } : {}),
      }
    }

    /**
     * Probe every candidate delivery service (plus any service already
     * referenced by a configured channel) and describe its bots and saved
     * targets for the settings UI. A provider missing, inactive, or failing
     * to enumerate simply drops out — discovery is best-effort by design.
     */
    async function listProviders() {
      const configured = new Set(notifyConfig.channels.map((channel) => channel.service))
      const providers = []
      for (const service of new Set([...NOTIFY_SERVICE_CANDIDATES, ...configured])) {
        const svc = ctx.get(service)
        if (!svc || typeof svc.send !== 'function') continue
        const provider = { service, bots: [] }
        try {
          if (typeof svc.listBots === 'function') {
            const bots = await svc.listBots()
            for (const raw of Array.isArray(bots) ? bots : []) {
              const bot = normalizeBot(raw)
              if (bot === undefined) continue
              const entry = { botId: bot.botId, ...(bot.channel !== undefined ? { channel: bot.channel } : {}), targets: [] }
              try {
                if (typeof svc.listTargets === 'function') {
                  const targets = await svc.listTargets(bot.botId)
                  entry.targets = (Array.isArray(targets) ? targets : []).map(normalizeTarget).filter((t) => t !== undefined)
                }
              } catch {}
              provider.bots.push(entry)
            }
          }
        } catch {}
        providers.push(provider)
      }
      return providers
    }

    /** Push one notification to every configured channel (best-effort, allSettled). */
    async function dispatchNotify(kind, info) {
      try {
        const config = notifyConfig
        if (!config.enabled || config.channels.length === 0) return
        // 免打扰时段内的推送直接跳过（执行记录仍保留在本页可查）。
        if (isDndActive(config.dnd)) {
          warnLog(`dsh-tasks: '${kind}' push suppressed by do-not-disturb window ${config.dnd.start}–${config.dnd.end}`)
          return
        }
        const wanted = kind === 'start' ? config.onStart
          : kind === 'complete' ? config.onComplete
            : kind === 'error' ? config.onError
              : false
        if (!wanted) return
        const text = formatNotifyText(kind, {
          ...info,
          // The agent's reply only rides along when the user opted in.
          resultText: config.includeResult ? info.resultText : undefined,
        })
        const results = await Promise.allSettled(config.channels.map(async (channel) => {
          const svc = ctx.get(channel.service)
          if (!svc || typeof svc.send !== 'function') {
            throw new Error(`delivery service '${channel.service}' is not available`)
          }
          await svc.send(channel.botId, channel.targetId, text)
        }))
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            const channel = config.channels[index]
            warnLog(`dsh-tasks: notify '${kind}' via ${channel.service}/${channel.targetId} failed: ${String((result.reason && result.reason.message) || result.reason)}`)
          }
        })
      } catch (error) {
        warnLog(`dsh-tasks: dispatchNotify failed: ${String((error && error.message) || error)}`)
      }
    }

    // ── lifecycle: open the domain and reschedule every enabled item ─────────
    // The cleanup effect must be registered synchronously while the plugin's
    // cordis fiber is still active: calling ctx.effect() after an await (inside
    // an async IIFE) throws "cannot create effect on inactive context" and
    // takes the whole host boot down with it.
    const domainPromise = ctx.storageDomain.open(domainSpec)
    ctx.effect(() => () => {
      for (const job of jobs.values()) job.stop()
      jobs.clear()
      domainPromise.then((domain) => domain.close()).catch(() => {})
    }, 'dsh-tasks: domain close')
    void domainPromise.then((domain) => {
      table = domain.table('items')
      notifyTable = domain.table('notify')
      const stored = notifyTable.get(NOTIFY_CONFIG_KEY)
      if (stored !== undefined) {
        try {
          notifyConfig = normalizeNotifyConfig(stored)
        } catch (error) {
          // A stored record that no longer validates keeps the defaults; the
          // next save from the settings page overwrites it.
          warnLog(`dsh-tasks: stored notify config ignored: ${String((error && error.message) || error)}`)
        }
      }
      rescheduleAll()
    })

    // ── run completion tracking ──────────────────────────────────────────────
    // A dsh-tasks run submits exactly one prompt, so the session's first
    // `turn/end` settles it: completed/max-tokens notify success, error
    // notifies failure, anything else (user abort) stays silent. The handler
    // never throws — event dispatch must not take the host down.
    ctx.effect(() => {
      const dispose = ctx.on('session/event', (session, event) => {
        try {
          if (!event || event.type !== 'turn/end') return
          const sessionId = session && session.id
          if (typeof sessionId !== 'string' || !trackedRuns.has(sessionId)) return
          const run = trackedRuns.get(sessionId)
          trackedRuns.delete(sessionId)
          const kind = classifyTurnEnd(turnEndKind(event.data && event.data.reason))
          if (kind === undefined) return
          void dispatchNotify(kind, {
            title: run.title,
            startedAt: run.startedAt,
            durationMs: Date.now() - new Date(run.startedAt).getTime(),
            error: kind === 'error' ? errorSummaryFrom(event.data && event.data.reason) : undefined,
            // Read at settle time: the final reply is already in the log by
            // the time turn/end fires. Empty when extraction fails — the
            // push goes out without a conclusion instead of not at all.
            resultText: kind === 'complete' ? lastAssistantText(sessionEventsOf(session)) : undefined,
          })
        } catch {}
      })
      return () => { try { dispose() } catch {} }
    }, 'dsh-tasks: run completion tracking')

    // ── HTTP API under the registered prefix ─────────────────────────────────
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-tasks/api',
      handler: async (req, res) => {
        try {
          // 与其它 host 路由一致的信任栅栏：connection 服务的 Host/Origin 检查
          // 加浏览器认证。缺了它，下面每个路由都能被任意网页跨站调用
          // （增删定时事项、立即执行等于代用户提交任意提示词）。
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end()
            return
          }
          const url = new URL(req.url || '/', 'http://dsh.local')
          const apiPath = url.pathname.replace(/\/+$/, '')
          if (req.method === 'GET' && apiPath.endsWith('/dsh-tasks/api/next')) {
            // Next upcoming fire times for a cron expression, so the editor can
            // preview the schedule before saving. Uses croner (the same parser
            // the schedule runs on); a paused probe never arms a real timer.
            const cron = (url.searchParams.get('cron') || '').trim()
            try {
              validateCron(cron)
              const probe = new Cron(cron, { paused: true })
              const fires = probe.nextRuns(5).map((date) => date.toISOString())
              probe.stop()
              sendJson(res, 200, { fires })
            } catch (error) {
              sendJson(res, 400, { error: String((error && error.message) || error) })
            }
            return
          }
          if (req.method === 'GET' && apiPath.endsWith('/dsh-tasks/api/models')) {
            // Model options for the client form: every routable provider with
            // its models, plus the current deployment default so the client
            // can label the fallback option. Provider failures are isolated —
            // a provider that cannot list models is simply skipped.
            const llm = ctx.get('llm')
            const defaultSelection = ctx.agentDefaultModel.currentSelection()
            let groups = []
            if (llm && typeof llm.listProviders === 'function') {
              const providers = llm.listProviders()
              groups = (await Promise.all(providers.map(async (provider) => {
                try {
                  const models = await llm.listModels(provider.id)
                  if (models.length === 0) return undefined
                  return {
                    id: provider.id,
                    name: provider.name,
                    models: models.map((model) => ({ id: model.id, name: model.name })),
                  }
                } catch {
                  // Skip providers whose model listing fails; the form still
                  // offers the remaining providers and the default option.
                  return undefined
                }
              }))).filter((group) => group !== undefined)
            }
            sendJson(res, 200, {
              default: { provider: defaultSelection.provider, model: defaultSelection.model },
              groups,
            })
            return
          }
          if (req.method === 'GET' && apiPath.endsWith('/dsh-tasks/api/workspaces')) {
            // Workspace options for the client form, served over HTTP so the
            // client half never depends on renderer-bound props hooks.
            const registry = ctx.get('workspaceRegistry')
            const workspaces = registry && typeof registry.list === 'function'
              ? registry.list().map((workspace) => ({ id: workspace.id, title: workspace.title }))
              : []
            sendJson(res, 200, { workspaces })
            return
          }
          if (req.method === 'GET' && apiPath.endsWith('/dsh-tasks/api')) {
            sendJson(res, 200, { items: list() })
            return
          }
          if (req.method === 'POST' && apiPath.endsWith('/dsh-tasks/api')) {
            const item = await create(await readJsonBody(req))
            sendJson(res, 201, { item })
            return
          }
          if (req.method === 'PATCH' && apiPath.endsWith('/dsh-tasks/api')) {
            const body = await readJsonBody(req)
            if (typeof body.id !== 'string') {
              sendJson(res, 400, { error: 'body must provide id' })
              return
            }
            const { id, ...patch } = body
            const item = await update(id, patch)
            sendJson(res, 200, { item })
            return
          }
          if (req.method === 'DELETE' && apiPath.endsWith('/dsh-tasks/api')) {
            const body = await readJsonBody(req)
            if (typeof body.id !== 'string') {
              sendJson(res, 400, { error: 'body must provide id' })
              return
            }
            await remove(body.id)
            sendJson(res, 200, { removed: true })
            return
          }
          if (req.method === 'GET' && apiPath.endsWith('/dsh-tasks/api/notify')) {
            // Settings plus a live provider probe so the client can render
            // channel pickers; discovery failures degrade to fewer providers.
            sendJson(res, 200, { config: notifyConfig, providers: await listProviders() })
            return
          }
          if (req.method === 'PUT' && apiPath.endsWith('/dsh-tasks/api/notify')) {
            const next = normalizeNotifyConfig(await readJsonBody(req))
            if (notifyTable === undefined) throw new Error('notify settings are not ready yet')
            await notifyTable.put(NOTIFY_CONFIG_KEY, next)
            notifyConfig = next
            sendJson(res, 200, { config: notifyConfig })
            return
          }
          if (req.method === 'POST' && apiPath.endsWith('/dsh-tasks/api/run')) {
            const body = await readJsonBody(req)
            if (typeof body.id !== 'string') {
              sendJson(res, 400, { error: 'body must provide id' })
              return
            }
            const item = await runNow(body.id)
            sendJson(res, 200, { item })
            return
          }
          sendJson(res, 404, { error: 'not found' })
        } catch (error) {
          sendJson(res, 400, { error: String((error && error.message) || error) })
        }
      },
    }), 'dsh-tasks: api route')
  },
}
