'use strict'

/**
 * dsh-tasks — Host half
 *
 * Durable cron-driven prompts. Each item carries a title, a prompt, and a
 * croner expression; an enabled item spawns a fresh agent session and
 * submits the prompt on schedule (or on demand). The store is durable
 * through the host `storageDomain` service (domain `scheduled_items`), the
 * schedule runs on croner, and an HTTP API under `/dsh-tasks/api`
 * serves the management pages in the web client.
 *
 * Zero `@deepseek-ai/dsh-*` imports: every harness capability is reached
 * through `ctx.*` runtime services (`storageDomain`, `workspaceRegistry`,
 * `agents`, `agentDefaultModel`, `webServer`). The only runtime
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

/** The dsh-tasks domain: one `items` table keyed by item id. */
const domainSpec = {
  name: 'dsh_tasks',
  version: 1,
  tables: { items: { valueSchema: itemSchema } },
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
  inject: ['storageDomain', 'agents', 'agentDefaultModel', 'webServer', 'workspaceRegistry', 'sessionTitle'],

  // Exposed for the offline test suite only (test/*.test.mjs); Cordis
  // ignores unknown export properties.
  __test: { itemSchema, runSchema, domainSpec, validateCron, buildRecord, runStamp, withRun, normalizeModelSelection, MAX_RUNS },

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
    const jobs = new Map()

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
        return withRun(record, { at: startedAt, ok: true, sessionId })
      } catch (error) {
        return withRun(record, { at: startedAt, ok: false, error: String((error && error.message) || error) })
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
      rescheduleAll()
    })

    // ── HTTP API under the registered prefix ─────────────────────────────────
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-tasks/api',
      handler: async (req, res) => {
        try {
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
