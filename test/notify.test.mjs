/**
 * Offline test suite for the notification subsystem's pure logic: config
 * normalization, turn-end classification, and push text formatting.
 * Requires no harness services.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { __test } = require('../src/index.js')

const {
  normalizeNotifyConfig,
  turnEndKind,
  classifyTurnEnd,
  errorSummaryFrom,
  messageText,
  lastAssistantText,
  sessionEventsOf,
  takeTail,
  formatDuration,
  formatNotifyText,
  domainSpec,
  NOTIFY_CONFIG_KEY,
  NOTIFY_SERVICE_CANDIDATES,
  MAX_RESULT_CHARS,
} = __test

test('notify config falls back to defaults for empty input', () => {
  const config = normalizeNotifyConfig()
  assert.equal(config.enabled, false)
  assert.equal(config.onStart, false)
  assert.equal(config.onComplete, true)
  assert.equal(config.onError, true)
  assert.deepEqual(config.channels, [])
})

test('notify config keeps valid channels and generates missing ids', () => {
  const config = normalizeNotifyConfig({
    enabled: true,
    onStart: true,
    channels: [
      { service: 'dshIm', botId: 'bot_1', targetId: 'me', label: '微信 · 我' },
      { id: 'chan-fixed', service: 'dshIm', botId: 'bot_1', targetId: 'release-alerts' },
    ],
  })
  assert.equal(config.channels.length, 2)
  assert.ok(config.channels[0].id.startsWith('chan-'))
  assert.equal(config.channels[1].id, 'chan-fixed')
  assert.equal(config.channels[0].label, '微信 · 我')
  assert.ok(!('label' in config.channels[1]))
})

test('notify config rejects a channel missing routing fields', () => {
  assert.throws(() => normalizeNotifyConfig({ channels: [{ service: 'dshIm', botId: 'bot_1' }] }))
  assert.throws(() => normalizeNotifyConfig({ channels: [{ service: '', botId: 'b', targetId: 't', id: 'x' }] }))
})

test('includeResult defaults to false and round-trips', () => {
  assert.equal(normalizeNotifyConfig().includeResult, false)
  assert.equal(normalizeNotifyConfig({ includeResult: true }).includeResult, true)
  assert.equal(normalizeNotifyConfig({ includeResult: 'yes' }).includeResult, false)
})

test('messageText joins only text blocks', () => {
  const content = [
    { type: 'thinking', thinking: 'hidden' },
    { type: 'text', text: '第一段' },
    { type: 'tool_use', id: 't1' },
    { type: 'text', text: '第二段' },
  ]
  assert.equal(messageText(content), '第一段\n第二段')
  assert.equal(messageText(undefined), '')
  assert.equal(messageText([{ type: 'text' }]), '')
})

test('lastAssistantText scans backwards for the final assistant/message entry', () => {
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: '问题' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '过程说明' }] } } },
    { type: 'tool/call', data: {} },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '最终结论' }] } } },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  ]
  assert.equal(lastAssistantText(events), '最终结论')
  assert.equal(lastAssistantText([]), '')
  assert.equal(lastAssistantText(undefined), '')
  assert.equal(lastAssistantText([{ type: 'assistant/message', data: {} }]), '')
})

test('sessionEventsOf prefers snapshotEvents and tolerates absence', () => {
  const events = [{ type: 'assistant/message' }]
  assert.deepEqual(sessionEventsOf({ snapshotEvents: () => events }), events)
  assert.deepEqual(sessionEventsOf({ events }), events)
  assert.equal(sessionEventsOf({}), undefined)
  assert.equal(sessionEventsOf(null), undefined)
})

test('takeTail caps long text with a leading ellipsis', () => {
  assert.equal(takeTail('hello', 10), 'hello')
  assert.equal(takeTail('x'.repeat(30), 10), `…${'x'.repeat(10)}`)
  assert.equal(takeTail('  ', 10), '')
  assert.equal(takeTail(undefined, 10), '')
  assert.equal(takeTail('hello', 0), '')
})

test('formatNotifyText appends the conclusion only when resultText is present', () => {
  const base = formatNotifyText('complete', { title: '晨报', durationMs: 8000 })
  assert.equal(base, '✅ 定时任务「晨报」已完成 · 耗时 8s')
  const withResult = formatNotifyText('complete', { title: '晨报', durationMs: 8000, resultText: 'notify-ok' })
  assert.equal(withResult, '✅ 定时任务「晨报」已完成 · 耗时 8s\n结论：notify-ok')
  const long = formatNotifyText('complete', { title: '晨报', resultText: 'x'.repeat(MAX_RESULT_CHARS + 50) })
  assert.ok(long.includes('结论：…'))
  assert.equal(long.length, '✅ 定时任务「晨报」已完成\n结论：…'.length + MAX_RESULT_CHARS)
})

test('turnEndKind tolerates object and bare-string reasons', () => {
  assert.equal(turnEndKind({ kind: 'completed' }), 'completed')
  assert.equal(turnEndKind('error'), 'error')
  assert.equal(turnEndKind(undefined), undefined)
  assert.equal(turnEndKind({ nope: 1 }), undefined)
})

test('classifyTurnEnd maps kinds onto notification kinds', () => {
  assert.equal(classifyTurnEnd('completed'), 'complete')
  assert.equal(classifyTurnEnd('max-tokens'), 'complete')
  assert.equal(classifyTurnEnd('error'), 'error')
  assert.equal(classifyTurnEnd('interrupted'), undefined)
  assert.equal(classifyTurnEnd('aborted'), undefined)
  assert.equal(classifyTurnEnd(undefined), undefined)
})

test('errorSummaryFrom extracts and truncates the failure message', () => {
  assert.equal(errorSummaryFrom({ kind: 'error', error: { message: 'boom' } }), 'boom')
  assert.equal(errorSummaryFrom({ kind: 'error', failure: 'plain text' }), 'plain text')
  assert.equal(errorSummaryFrom('error'), undefined)
  assert.equal(errorSummaryFrom({ kind: 'error', error: 'x'.repeat(500) }).length, 200)
})

test('formatDuration renders compact human strings', () => {
  assert.equal(formatDuration(42000), '42s')
  assert.equal(formatDuration(192000), '3m12s')
  assert.equal(formatDuration(180000), '3m')
  assert.equal(formatDuration(3_840_000), '1h4m')
  assert.equal(formatDuration(undefined), '')
  assert.equal(formatDuration(-5), '')
})

test('formatNotifyText covers the three notification kinds', () => {
  assert.equal(formatNotifyText('start', { title: '晨报' }), '▶️ 定时任务「晨报」已开始')
  const done = formatNotifyText('complete', { title: '晨报', durationMs: 192000 })
  assert.ok(done.includes('✅') && done.includes('晨报') && done.includes('3m12s'))
  const failed = formatNotifyText('error', { title: '晨报', durationMs: 1000, error: 'boom' })
  assert.ok(failed.includes('❌') && failed.includes('boom'))
  assert.equal(formatNotifyText('start', {}), '▶️ 定时任务「未命名任务」已开始')
})

test('domain spec gains the notify table without a version bump', () => {
  assert.equal(domainSpec.name, 'dsh_tasks')
  // The storage backend has no migration path: a version change would make
  // existing deployments fail to open their domain outright.
  assert.equal(domainSpec.version, 1)
  assert.equal(typeof domainSpec.tables.notify.valueSchema, 'object')
  assert.equal(typeof domainSpec.tables.items.valueSchema, 'object')
})

test('the notify table schema accepts records written by older versions', () => {
  // v0.5.0 wrote configs without includeResult; the stored-record schema must
  // stay loose or the domain open rejects and takes the host boot down.
  const oldRecord = {
    enabled: true,
    onStart: false,
    onComplete: true,
    onError: true,
    channels: [{ id: 'chan-1', service: 'dshIm', botId: 'bot_1', targetId: 'me' }],
  }
  const parsed = domainSpec.tables.notify.valueSchema.safeParse(oldRecord)
  assert.equal(parsed.success, true)
  // normalizeNotifyConfig fills the missing field at read time.
  assert.equal(normalizeNotifyConfig(oldRecord).includeResult, false)
})

test('notify config key and provider candidates are stable', () => {
  assert.equal(NOTIFY_CONFIG_KEY, 'config')
  assert.ok(NOTIFY_SERVICE_CANDIDATES.includes('dshIm'))
})
