/**
 * Offline test suite for the Host half's pure logic: record schema, domain
 * spec, cron validation, and record building. Requires no harness services.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { __test } = require('../src/index.js')

const { itemSchema, domainSpec, validateCron, buildRecord, withRun, runStamp, normalizeModelSelection, MAX_RUNS } = __test

test('item schema accepts a complete record', () => {
  const record = {
    id: 'item-1',
    title: 'Morning brief',
    prompt: 'Summarize the day ahead.',
    cron: '0 9 * * *',
    enabled: true,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  }
  assert.equal(itemSchema.safeParse(record).success, true)
})

test('item schema accepts an optional workspaceId and last-run metadata', () => {
  const record = {
    id: 'item-2',
    title: 'Evening recap',
    prompt: 'Recap the day.',
    cron: '0 18 * * *',
    enabled: false,
    workspaceId: 'ws-1',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    lastRunAt: '2026-08-18T18:00:00.000Z',
    lastRunError: 'boom',
  }
  const parsed = itemSchema.safeParse(record)
  assert.equal(parsed.success, true)
  assert.equal(parsed.data.workspaceId, 'ws-1')
  assert.equal(parsed.data.lastRunError, 'boom')
})

test('item schema rejects a record missing required fields', () => {
  const broken = {
    id: 'item-3',
    title: 'no cron',
    enabled: true,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  }
  assert.equal(itemSchema.safeParse(broken).success, false)
})

test('domain spec declares the items table under the dsh_tasks unit', () => {
  assert.equal(domainSpec.name, 'dsh_tasks')
  assert.equal(domainSpec.version, 1)
  assert.equal(typeof domainSpec.tables.items.valueSchema, 'object')
  assert.equal(domainSpec.tables.items.valueSchema, itemSchema)
})

test('validateCron accepts a valid expression', () => {
  assert.doesNotThrow(() => validateCron('0 9 * * *'))
  assert.doesNotThrow(() => validateCron('*/5 * * * * *'))
})

test('validateCron rejects an empty expression', () => {
  assert.throws(() => validateCron(''), /must not be empty/)
})

test('validateCron rejects a malformed expression', () => {
  assert.throws(() => validateCron('not a cron'), /invalid cron expression/)
})

test('buildRecord creates a stamped record from valid input', () => {
  const record = buildRecord({ title: 'T', prompt: 'P', cron: '0 9 * * *', enabled: true })
  assert.match(record.id, /^item-/)
  assert.equal(record.title, 'T')
  assert.equal(record.prompt, 'P')
  assert.equal(record.cron, '0 9 * * *')
  assert.equal(record.enabled, true)
  assert.equal(record.workspaceId, undefined)
  assert.ok(record.createdAt)
  assert.ok(record.updatedAt)
})

test('buildRecord carries an optional workspaceId', () => {
  const record = buildRecord({
    title: 'T', prompt: 'P', cron: '0 9 * * *', enabled: true, workspaceId: 'ws-9',
  })
  assert.equal(record.workspaceId, 'ws-9')
})

test('item schema accepts an optional per-item model route', () => {
  const record = {
    ...buildRecord({ title: 'T', prompt: 'P', cron: '0 9 * * *', enabled: true }),
    provider: 'deepseek-official',
    model: 'deepseek-flash',
  }
  const parsed = itemSchema.safeParse(record)
  assert.equal(parsed.success, true)
  assert.equal(parsed.data.provider, 'deepseek-official')
  assert.equal(parsed.data.model, 'deepseek-flash')
})

test('buildRecord carries an optional model route', () => {
  const record = buildRecord({
    title: 'T', prompt: 'P', cron: '0 9 * * *', enabled: true,
    provider: 'deepseek-official', model: 'deepseek-flash',
  })
  assert.equal(record.provider, 'deepseek-official')
  assert.equal(record.model, 'deepseek-flash')
})

test('buildRecord omits the model route when not provided', () => {
  const record = buildRecord({ title: 'T', prompt: 'P', cron: '0 9 * * *', enabled: true })
  assert.equal('provider' in record, false)
  assert.equal('model' in record, false)
})

test('buildRecord rejects a provider without a model (and vice versa)', () => {
  assert.throws(
    () => buildRecord({ title: 'T', prompt: 'P', cron: '0 9 * * *', enabled: true, provider: 'p' }),
    /provider and model must both/,
  )
  assert.throws(
    () => buildRecord({ title: 'T', prompt: 'P', cron: '0 9 * * *', enabled: true, model: 'm' }),
    /provider and model must both/,
  )
})

test('normalizeModelSelection trims a valid pair', () => {
  assert.deepEqual(
    normalizeModelSelection({ provider: ' p ', model: ' m ' }),
    { provider: 'p', model: 'm' },
  )
})

test('normalizeModelSelection treats null and absent as unset', () => {
  assert.equal(normalizeModelSelection({}), undefined)
  assert.equal(normalizeModelSelection({ provider: null, model: null }), undefined)
})

test('normalizeModelSelection rejects empty strings and half pairs', () => {
  assert.throws(() => normalizeModelSelection({ provider: '', model: 'm' }), /provider and model must both/)
  assert.throws(() => normalizeModelSelection({ provider: 'p', model: '  ' }), /provider and model must both/)
  assert.throws(() => normalizeModelSelection({ provider: 'p' }), /provider and model must both/)
})

test('buildRecord rejects missing required fields', () => {
  assert.throws(() => buildRecord({ title: 'T' }), /must provide/)
})

test('buildRecord rejects an invalid cron before stamping', () => {
  assert.throws(() => buildRecord({ title: 'T', prompt: 'P', cron: 'nope', enabled: true }), /invalid cron/)
})

test('buildRecord starts with an empty run history', () => {
  const record = buildRecord({ title: 'T', prompt: 'P', cron: '0 9 * * *', enabled: true })
  assert.deepEqual(record.runs, [])
})

test('item schema accepts a run history with session ids', () => {
  const record = {
    ...buildRecord({ title: 'T', prompt: 'P', cron: '0 9 * * *', enabled: true }),
    runs: [
      { at: '2026-08-31T01:00:00.000Z', ok: true, sessionId: 'session-abc' },
      { at: '2026-08-31T02:00:00.000Z', ok: false, error: 'boom' },
    ],
  }
  const parsed = itemSchema.safeParse(record)
  assert.equal(parsed.success, true)
  assert.equal(parsed.data.runs[0].sessionId, 'session-abc')
  assert.equal(parsed.data.runs[1].error, 'boom')
})

test('withRun appends an entry and refreshes the last-run summary', () => {
  const record = buildRecord({ title: 'T', prompt: 'P', cron: '0 9 * * *', enabled: true })
  const ok = withRun(record, { at: '2026-08-31T01:00:00.000Z', ok: true, sessionId: 's1' })
  assert.equal(ok.runs.length, 1)
  assert.equal(ok.lastRunAt, '2026-08-31T01:00:00.000Z')
  assert.equal(ok.lastRunError, undefined)
  const failed = withRun(ok, { at: '2026-08-31T02:00:00.000Z', ok: false, error: 'boom' })
  assert.equal(failed.runs.length, 2)
  assert.equal(failed.lastRunError, 'boom')
  assert.equal(failed.runs[1].ok, false)
})

test('withRun caps history at MAX_RUNS, keeping the newest entries', () => {
  let record = buildRecord({ title: 'T', prompt: 'P', cron: '0 9 * * *', enabled: true })
  for (let i = 0; i < MAX_RUNS + 5; i++) {
    record = withRun(record, { at: new Date(2026, 7, 1, 9, i).toISOString(), ok: true, sessionId: `s${i}` })
  }
  assert.equal(record.runs.length, MAX_RUNS)
  assert.equal(record.runs[0].sessionId, 's5')
  assert.equal(record.runs[MAX_RUNS - 1].sessionId, `s${MAX_RUNS + 4}`)
})

test('runStamp produces a compact MM-DD HH:mm stamp', () => {
  assert.match(runStamp('2026-08-31T01:05:00.000Z'), /^\d{2}-\d{2} \d{2}:\d{2}$/)
})
