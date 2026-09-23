/**
 * Offline integration suite: drives the real `apply()` against a fake harness
 * context (storage domain, web server, agents, session events) to verify the
 * notification flow end to end — provider discovery, config round trip, the
 * start/complete/error dispatch chain, silence rules, and graceful degrade
 * when no delivery provider is installed. No harness services required.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const plugin = require('../src/index.js')

/** Two event-loop turns so fire-and-forget dispatches settle. */
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

/**
 * A minimal harness context: services resolve from a map (like cordis soft
 * `ctx.get`), `session/event` listeners are captured, webServer routes are
 * collected in order, and the storage domain is an in-memory map.
 */
const harnesses = []
after(() => {
  // Stop every croner timer armed by the real apply() so the test runner's
  // event loop can drain — enabled items arm real schedules.
  for (const harness of harnesses) {
    for (const dispose of harness.disposes) {
      try { if (typeof dispose === 'function') dispose() } catch {}
    }
  }
})

function createHarness() {
  const harness = {
    services: new Map(),
    listeners: new Map(),
    routes: [],
    sent: [],
    warnings: [],
    created: [],
    followups: [],
    disposes: [],
  }
  const tables = new Map()
  const domain = {
    // Mirrors the storageDomain table API the host half uses: get/put/delete
    // plus entries(), which list()/rescheduleAll() iterate.
    table(name) {
      if (!tables.has(name)) tables.set(name, new Map())
      const map = tables.get(name)
      return {
        get: (key) => map.get(key),
        put: async (key, value) => { map.set(key, value) },
        delete: async (key) => { map.delete(key) },
        entries: () => map.entries(),
      }
    },
    close: async () => {},
  }
  harness.ctx = {
    get: (name) => harness.services.get(name),
    on: (event, handler) => { harness.listeners.set(event, handler); return () => harness.listeners.delete(event) },
    effect: (factory) => { const dispose = factory(); harness.disposes.push(dispose); return dispose },
    logger: { warn: (message) => harness.warnings.push(String(message)) },
    storageDomain: { open: async () => domain },
    webServer: { register: (route) => harness.routes.push(route) },
    agents: {
      create: async (options) => {
        harness.created.push(options)
        return {
          agent: {
            session: { append: () => {} },
            followup: (message) => { harness.followups.push(message) },
          },
        }
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    workspaceRegistry: { get: () => undefined, list: () => [] },
  }
  /** Install a fake IM delivery provider, mirroring dsh-im's documented API. */
  harness.installProvider = () => {
    harness.services.set('dshIm', {
      send: async (botId, targetId, text) => { harness.sent.push({ botId, targetId, text }); return { sent: true } },
      listBots: async () => [{ botId: 'bot_1', channel: 'wechat' }],
      listTargets: async () => [{ targetId: 'me', name: '我', kind: 'dm' }],
    })
  }
  return harness
}

const fakeReq = (method, url, body) => ({
  method,
  url,
  async *[Symbol.asyncIterator]() {
    if (body !== undefined) yield Buffer.from(JSON.stringify(body))
  },
})

const call = async (handler, method, url, body) => {
  const res = { status: null, body: null }
  res.writeHead = (status) => { res.status = status }
  res.end = (payload) => { res.body = payload ? JSON.parse(payload) : null }
  await handler(fakeReq(method, url, body), res)
  return { status: res.status, body: res.body }
}

/** Boot the plugin, wait for the domain, and return { harness, api }. */
async function boot({ provider = true } = {}) {
  const harness = createHarness()
  harnesses.push(harness)
  if (provider) harness.installProvider()
  plugin.apply(harness.ctx, {})
  await flush()
  const api = harness.routes[0].handler
  return { harness, api }
}

const createItem = async (api) => {
  const response = await call(api, 'POST', '/dsh-tasks/api', {
    title: '晨报',
    prompt: '汇总今日待办',
    cron: '0 9 * * *',
    enabled: true,
  })
  assert.equal(response.status, 201)
  return response.body.item.id
}

const enableNotify = async (api) => {
  const response = await call(api, 'PUT', '/dsh-tasks/api/notify', {
    enabled: true,
    onStart: true,
    onComplete: true,
    onError: true,
    channels: [{ id: 'chan-1', service: 'dshIm', botId: 'bot_1', targetId: 'me', label: 'wechat · 我' }],
  })
  assert.equal(response.status, 200)
}

test('discovery exposes the provider, its bot, and saved targets', async () => {
  const { harness, api } = await boot()
  const probe = await call(api, 'GET', '/dsh-tasks/api/notify')
  assert.equal(probe.status, 200)
  assert.equal(probe.body.config.enabled, false)
  assert.equal(probe.body.providers.length, 1)
  const provider = probe.body.providers[0]
  assert.equal(provider.service, 'dshIm')
  assert.equal(provider.bots[0].botId, 'bot_1')
  assert.equal(provider.bots[0].channel, 'wechat')
  assert.equal(provider.bots[0].targets[0].targetId, 'me')
  assert.equal(provider.bots[0].targets[0].name, '我')

  // Without any provider installed the probe degrades to an empty list.
  const bare = createHarness()
  plugin.apply(bare.ctx, {})
  await flush()
  const empty = await call(bare.routes[0].handler, 'GET', '/dsh-tasks/api/notify')
  assert.deepEqual(empty.body.providers, [])
  assert.equal(harness.sent.length, 0)
})

test('a run notifies start then complete on the spawned session', async () => {
  const { harness, api } = await boot()
  await enableNotify(api)
  const id = await createItem(api)

  const run = await call(api, 'POST', '/dsh-tasks/api/run', { id })
  assert.equal(run.status, 200)
  assert.equal(run.body.item.lastRunError, undefined)
  await flush()

  // Start notification went out; exactly one session was spawned with the prompt.
  assert.equal(harness.sent.length, 1)
  assert.equal(harness.sent[0].botId, 'bot_1')
  assert.equal(harness.sent[0].targetId, 'me')
  assert.ok(harness.sent[0].text.includes('已开始'))
  assert.equal(harness.created.length, 1)
  assert.equal(harness.followups.length, 1)
  const sessionId = harness.created[0].sessionId

  // First turn/end on that session settles the run with a success push.
  harness.listeners.get('session/event')(
    { id: sessionId },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  )
  await flush()
  assert.equal(harness.sent.length, 2)
  assert.ok(harness.sent[1].text.includes('已完成'))
  // includeResult 默认关闭：完成推送不携带执行结论。
  assert.ok(!harness.sent[1].text.includes('结论'))

  // Foreign sessions and later events on the same session are ignored.
  harness.listeners.get('session/event')(
    { id: 'session-foreign' },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  )
  harness.listeners.get('session/event')(
    { id: sessionId },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  )
  await flush()
  assert.equal(harness.sent.length, 2)
})

test('an error reason notifies with the failure detail and interrupted stays silent', async () => {
  const { harness, api } = await boot()
  await enableNotify(api)
  const id = await createItem(api)

  await call(api, 'POST', '/dsh-tasks/api/run', { id })
  await flush()
  const sessionId = harness.created[0].sessionId

  // User abort: no notification beyond the start push.
  harness.listeners.get('session/event')(
    { id: sessionId },
    { type: 'turn/end', data: { reason: { kind: 'interrupted' } } },
  )
  await flush()
  assert.equal(harness.sent.length, 1)

  // Second run fails mid-conversation: the ❌ push carries the message.
  await call(api, 'POST', '/dsh-tasks/api/run', { id })
  await flush()
  const failedSessionId = harness.created[1].sessionId
  harness.listeners.get('session/event')(
    { id: failedSessionId },
    { type: 'turn/end', data: { reason: { kind: 'error', error: { message: '模型超时' } } } },
  )
  await flush()
  assert.equal(harness.sent.length, 3)
  assert.ok(harness.sent[2].text.includes('❌'))
  assert.ok(harness.sent[2].text.includes('模型超时'))
})

test('a spawn failure marks the run failed and pushes the error', async () => {
  const { harness, api } = await boot()
  await enableNotify(api)
  const id = await createItem(api)
  harness.ctx.agents.create = async () => { throw new Error('workspace vanished') }

  const run = await call(api, 'POST', '/dsh-tasks/api/run', { id })
  assert.equal(run.status, 200)
  assert.ok(run.body.item.lastRunError.includes('workspace vanished'))
  await flush()

  assert.equal(harness.sent.length, 1)
  assert.ok(harness.sent[0].text.includes('❌'))
  assert.ok(harness.sent[0].text.includes('workspace vanished'))
})

test('completion pushes carry the final reply when includeResult is enabled', async () => {
  const { harness, api } = await boot()
  await call(api, 'PUT', '/dsh-tasks/api/notify', {
    enabled: true,
    onStart: false,
    onComplete: true,
    onError: true,
    includeResult: true,
    channels: [{ id: 'chan-1', service: 'dshIm', botId: 'bot_1', targetId: 'me' }],
  })
  const id = await createItem(api)
  await call(api, 'POST', '/dsh-tasks/api/run', { id })
  await flush()
  const sessionId = harness.created[0].sessionId

  // The session log holds the final assistant reply at settle time; the
  // handler reads it through the session passed to the event.
  const log = [
    { type: 'user/message', data: { content: [{ type: 'text', text: 'prompt' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '今日待办已整理完毕' }] } } },
  ]
  harness.listeners.get('session/event')(
    { id: sessionId, snapshotEvents: () => log },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  )
  await flush()
  assert.equal(harness.sent.length, 1)
  assert.ok(harness.sent[0].text.includes('已完成'))
  assert.ok(harness.sent[0].text.includes('结论：今日待办已整理完毕'))
})

test('a disabled config or uninstalled provider never sends anything', async () => {
  const { harness, api } = await boot({ provider: false })
  // Config enabled but the channel references a service that is not installed.
  await call(api, 'PUT', '/dsh-tasks/api/notify', {
    enabled: true,
    onStart: true,
    onComplete: true,
    onError: true,
    channels: [{ id: 'chan-1', service: 'dshIm', botId: 'bot_1', targetId: 'me' }],
  })
  const id = await createItem(api)
  await call(api, 'POST', '/dsh-tasks/api/run', { id })
  await flush()
  assert.equal(harness.sent.length, 0)
  assert.ok(harness.warnings.some((entry) => entry.includes("delivery service 'dshIm' is not available")))

  // A disabled config gates dispatch even with the provider present.
  harness.installProvider()
  await call(api, 'PUT', '/dsh-tasks/api/notify', { enabled: false, channels: [] })
  const second = await call(api, 'POST', '/dsh-tasks/api/run', { id })
  assert.equal(second.status, 200)
  await flush()
  assert.equal(harness.sent.length, 0)
})
