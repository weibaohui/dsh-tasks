'use strict'

/**
 * dsh-tasks — Client half
 *
 * Registers a `settings.section` management page. The same surface renders
 * inside the harness settings panel; data arrives from the Host half through
 * plain `fetch` on `/dsh-tasks/api` (the bundle runs in the real page, not a
 * sandbox). Workspace options are fetched from the Host's
 * `/dsh-tasks/api/workspaces` route.
 *
 * Components are zero-argument closures — they never read renderer-bound
 * props hooks — so the bundle works in any harness client runtime that
 * serves the `slots` service. UI text is localized through the harness
 * `locale` service (namespace `settings.dshTasks`) when present,
 * falling back to raw keys otherwise.
 *
 * This file is the dynamic-plugin source of truth; `client/bundle.js` is
 * the static-install artifact regenerated from it via `npm run build:client`.
 */

const LOCALE_NS = 'settings.dshTasks'

const ZH = {
  nav: '定时事项',
  title: '定时事项',
  intro: '按 cron 定时器把提示词交给全新的 agent 会话执行——也可以立即执行。',
  loading: '正在加载定时事项…',
  error: '无法连接定时事项服务。',
  empty: '还没有定时事项，先创建一个吧。',
  retry: '重试',
  newItem: '新建定时事项',
  editItem: '编辑定时事项',
  save: '保存',
  saving: '保存中…',
  cancel: '取消',
  delete: '删除',
  running: '执行中…',
  runNow: '立即执行',
      lastRun: '上次执行',
      neverRun: '从未执行',
      failed: '失败',
      runHistory: '执行记录',
      runOk: '成功',
      runFail: '失败',
      cronLabel: 'cron 定时器',
      cronHint: '五段 croner 表达式（分 时 日 月 周），例如 "0 9 * * *" 表示每天 09:00。',
      cronPresets: '快捷模板',
      cronHourly: '每小时',
      cronDaily: '每天',
      cronWeekly: '每周',
      cronCustom: '自定义',
      cronAtMinute: '小时的第',
      cronMinuteUnit: '分',
      cronEvery: '每隔',
      cronMinutesUnit: '分钟',
      hourField: '小时',
      minuteField: '分钟',
      presetHourly: '每小时整点',
      presetMin30: '每 30 分钟',
      presetDaily9: '每天 9:00',
      presetWeekday830: '工作日 8:30',
      presetMon10: '每周一 10:00',
      wd1: '一', wd2: '二', wd3: '三', wd4: '四', wd5: '五', wd6: '六', wd0: '日',
      wdWorkday: '工作日',
      listSep: '、',
      sumMin: '每 {n} 分钟执行一次',
      sumHour: '每小时第 {m} 分执行',
      sumDaily: '每天 {t} 执行',
      sumWeekly: '每周{w} {t} 执行',
      sumWeeklyWorkday: '工作日 {t} 执行',
      sumCustom: '自定义表达式：{raw}',
      sumEmpty: '选择或填写一个执行时间',
      nextRuns: '最近 {n} 次执行',
  titleLabel: '标题',
  titlePlaceholder: '例如：晨会纪要',
  promptLabel: '提示词',
  promptPlaceholder: '该事项执行时，让 agent 做什么？',
  enabledLabel: '启用',
  enabledHint: '停用的事项保留数据，但不会定时触发。',
  invalidForm: '标题、提示词和 cron 定时器都是必填项。',
  deleteConfirm: '确定删除这个定时事项？',
  close: '关闭',
  workspace: '工作区',
  workspaceLabel: '工作区',
  workspaceNone: '不绑定工作区（默认目录）',
  workspaceHint: '执行时会在此工作区下新建会话，并显示在工作区分组中。',
}

const EN = {
  nav: 'Scheduled Tasks',
  title: 'Scheduled Tasks',
  intro: 'Send a prompt to a fresh agent session on a cron schedule — or run it right now.',
  loading: 'Loading scheduled tasks…',
  error: 'Could not reach the scheduled tasks service.',
  empty: 'No scheduled tasks yet. Create your first one to get started.',
  retry: 'Retry',
  newItem: 'New scheduled task',
  editItem: 'Edit scheduled task',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  delete: 'Delete',
  running: 'Running…',
  runNow: 'Run now',
  lastRun: 'Last run',
  neverRun: 'Never',
  failed: 'failed',
  runHistory: 'Run history',
  runOk: 'OK',
  runFail: 'Failed',
  cronLabel: 'Cron schedule',
  cronHint: 'Five-field cron expression (minute hour day month weekday), e.g. "0 9 * * *" runs daily at 09:00.',
  cronPresets: 'Quick presets',
  cronHourly: 'Hourly',
  cronDaily: 'Daily',
  cronWeekly: 'Weekly',
  cronCustom: 'Custom',
  // Hourly row concatenates as: Every [1] hour at minute [09] — or Every [30] minutes.
  cronEvery: 'Every',
  cronAtMinute: 'hour at minute',
  cronMinuteUnit: '',
  cronMinutesUnit: 'minutes',
  // aria-labels for the hour/minute selects in the daily & weekly pickers.
  hourField: 'Hour',
  minuteField: 'Minute',
  presetHourly: 'Every hour',
  presetMin30: 'Every 30 min',
  presetDaily9: 'Daily at 9:00',
  presetWeekday830: 'Weekdays at 8:30',
  presetMon10: 'Mondays at 10:00',
  wd1: 'Mon', wd2: 'Tue', wd3: 'Wed', wd4: 'Thu', wd5: 'Fri', wd6: 'Sat', wd0: 'Sun',
  wdWorkday: 'weekday',
  listSep: ', ',
  sumMin: 'Every {n} minutes',
  sumHour: 'Every hour at minute {m}',
  sumDaily: 'Daily at {t}',
  sumWeekly: 'Weekly on {w} at {t}',
  sumWeeklyWorkday: 'Weekdays at {t}',
  sumCustom: 'Custom: {raw}',
  sumEmpty: 'Pick or type a schedule',
  nextRuns: 'Next {n} runs',
  titleLabel: 'Title',
  titlePlaceholder: 'e.g. Morning standup notes',
  promptLabel: 'Prompt',
  promptPlaceholder: 'What should the agent do when this task runs?',
  enabledLabel: 'Enabled',
  enabledHint: 'Disabled tasks keep their data but never run on schedule.',
  invalidForm: 'Title, prompt, and cron schedule are required.',
  deleteConfirm: 'Delete this scheduled task?',
  close: 'Close',
  workspace: 'Workspace',
  workspaceLabel: 'Workspace',
  workspaceNone: 'None (default directory)',
  workspaceHint: 'Each run starts a new session in this workspace; sessions appear grouped under it in the sidebar.',
}

const LOCALE_DICT = { zh: ZH, en: EN }

const API = '/dsh-tasks/api'

const styles = {
  _head: null,
  insert(css) {
    if (typeof document === 'undefined') return
    if (!this._head) {
      const style = document.createElement('style')
      style.setAttribute('data-plugin', 'dsh-tasks')
      document.head.appendChild(style)
      this._head = style
    }
    this._head.textContent = css
  },
}

styles.insert(`
/*
 * Theme-aware styles for dsh-tasks.
 *
 * Every color comes from the harness theme tokens (Theme.listTokens). Tokens
 * that do not exist there (button-primary-fill / interactive-bg-hover /
 * label-tertiary / bg-layer-3 / label-dimmed / font-mono / etc.) are derived
 * from real tokens through CSS color-mix(), so buttons follow light/dark
 * switching automatically without any local fallback palette.
 *
 * Buttons by role:
 *   .si-btn            — secondary / outline / ghost, all uses color-mix
 *   .si-btn-primary    — "新建定时任务" / "保存" / form submit; brand accent
 *   .si-btn-danger     — "删除"; error-state tint
 *   .si-form input, select, textarea — surface-2 surface, label-primary text
 *
 * Hover / active overlays are always color-mixed from the base token, so
 * they stay consistent in light, dark, and any custom theme.
 */
.si-root{display:flex;flex-direction:column;gap:14px;width:100%;max-width:760px;color:var(--dsw-alias-label-primary)}
.si-title{font-size:20px;font-weight:600;margin:0}
.si-intro{font-size:13px;color:var(--dsw-alias-label-secondary);margin:0}
.si-muted{font-size:13px;color:var(--dsw-alias-label-secondary);margin:0}
.si-error{font-size:13px;color:var(--dsw-alias-state-error-primary);display:flex;align-items:center;gap:8px;margin:0}
.si-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.si-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);transition:border-color .16s,background .16s}
.si-row:hover{border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.si-rowMain{display:flex;flex-direction:column;gap:3px;min-width:0}
.si-rowTitle{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.si-rowCron{font-size:12px;color:var(--dsw-alias-label-secondary);font-feature-settings:"tnum" 1}
.si-rowMeta{font-size:12px;color:var(--dsw-alias-label-secondary)}
    .si-rowActions{display:flex;gap:8px;flex-shrink:0}
    .si-runsToggle{align-self:flex-start;margin-top:2px;padding:0;border:none;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;cursor:pointer}
    .si-runsToggle:hover{text-decoration:underline}
    .si-runs{list-style:none;margin:6px 0 0;padding:8px 0 0;border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:3px}
    .si-run{display:flex;gap:8px;align-items:baseline;font-size:12px;color:var(--dsw-alias-label-secondary);font-feature-settings:"tnum" 1}
    .si-runTime{color:var(--dsw-alias-label-secondary)}
    .si-runOk{color:var(--dsw-alias-label-secondary)}
    .si-runFail{color:var(--dsw-alias-state-error-primary);word-break:break-word}
    .si-runSession{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px}

    /* Cron picker: preset chips, frequency segment, per-mode fields, summary. */
    .si-cron{display:flex;flex-direction:column;gap:9px;width:100%}
    .si-chips{display:flex;flex-wrap:wrap;gap:6px}
    .si-chip{font-size:12px;padding:4px 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .14s,border-color .14s,color .14s}
    .si-chip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
    .si-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;align-self:flex-start}
    .si-seg button{border:none;background:transparent;color:var(--dsw-alias-label-secondary);padding:5px 14px;font-size:12px;cursor:pointer;border-right:1px solid var(--dsw-alias-border-l2);transition:background .14s,color .14s}
    .si-seg button:last-child{border-right:none}
    .si-seg button.on{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}
    .si-cronRow{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:13px;color:var(--dsw-alias-label-secondary)}
    .si-cronRow select{padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;font-feature-settings:"tnum" 1}
    .si-days{display:flex;gap:5px}
    .si-day{min-width:32px;height:30px;padding:0 6px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;transition:background .14s,border-color .14s,color .14s}
    .si-day:hover{border-color:var(--dsw-alias-brand-primary)}
    .si-day.on{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent}
    .si-sum{font-size:12px;color:var(--dsw-alias-brand-primary)}
    .si-next{display:flex;flex-direction:column;gap:4px}
    .si-nextLabel{font-size:12px;color:var(--dsw-alias-label-secondary)}
    .si-nextList{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
    .si-nextList li{font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:2px 8px;font-feature-settings:"tnum" 1}

/* Base button: secondary outline. Hover overlay mixes from label-primary so
   light/dark themes both produce a visible but subtle state change. */
.si-btn{font-size:13px;padding:5px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;transition:background .16s,border-color .16s,color .16s}
.si-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 24%,var(--dsw-alias-border-l2))}
.si-btn:active:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}
.si-btn:disabled{opacity:.5;cursor:default}

/* Primary button: the only color pair we can guarantee has contrast in any
   theme is foreground text ('label-primary') vs. background surface
   ('bg-base'). 'brand-primary' is theme-dependent — in some themes it is
   itself very light, which would collapse button foreground and background
   to the same color and make the label invisible. So the primary button is
   a solid 'label-primary' fill with 'bg-base' text — guaranteed readable
   in light, dark, and any custom theme. */
.si-btn-primary{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-weight:600}
.si-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-bg-base) 14%,var(--dsw-alias-label-primary));border-color:transparent}
.si-btn-primary:active:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-bg-base) 24%,var(--dsw-alias-label-primary))}

/* Danger button: error-state tint for text + a derived hover surface. */
.si-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 32%,var(--dsw-alias-border-l2))}
.si-btn-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.si-btn-danger:active:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 20%,transparent)}

.si-form{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.si-formTitle{font-size:15px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary)}
.si-field{display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.si-field input,.si-field textarea,.si-field select{padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;transition:border-color .16s,background .16s}
.si-field input:focus,.si-field textarea:focus,.si-field select:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.si-field textarea{resize:vertical;min-height:72px}
.si-hint{font-size:12px;color:var(--dsw-alias-label-secondary)}
.si-checkbox{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.si-formActions{display:flex;gap:8px}
`)

async function readJson(response) {
  const payload = await response.json()
  if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`)
  return payload
}

function lastRunText(t, item) {
  if (!item.lastRunAt) return t('neverRun')
  const time = new Date(item.lastRunAt).toLocaleString()
  return item.lastRunError === undefined ? time : `${time} (${t('failed')}: ${item.lastRunError})`
}

module.exports = {
  name: '@weibaohui/dsh-tasks',
  // `locale` must be declared: the host provides it from a client plugin that
  // activates after this one, so a bare ctx.get('locale') at apply time misses
  // it and every string renders as its raw key (observed on dsh 0.1.2-rc.1).
  // The runtime guard keeps the failure mode "raw keys", never a boot failure.
  inject: ['slots', 'locale'],

  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const locale = ctx.get('locale')
    const t = locale ? locale.bind(LOCALE_NS) : (key) => key
    if (locale && typeof locale.register === 'function') {
      ctx.effect(() => locale.register(LOCALE_NS, LOCALE_DICT))
    }

        const emptyForm = () => ({ editingId: null, title: '', prompt: '', cron: '', enabled: true })

        // CronPicker's pure helpers (parseCron / buildCron / CRON_PRESETS /
        // HOURLY_STEPS / WEEKDAY_KEYS) live in client/cron.js; build-client.mjs
        // inlines them into the static bundle, so this source reads them from
        // the enclosing factory scope and stays dependency-free.
        const MODES = [['hourly', 'cronHourly'], ['daily', 'cronDaily'], ['weekly', 'cronWeekly'], ['custom', 'cronCustom']]
        const HOURS = Array.from({ length: 24 }, (_, i) => i)
        const MINUTES = Array.from({ length: 60 }, (_, i) => i)
        const pad2 = (n) => String(n).padStart(2, '0')

        /**
         * Structured cron editor. Controlled (value/onChange are the cron
         * string); offers one-click presets, a frequency segment with
         * mode-specific fields, and a raw custom mode. Renders a live
         * human-readable summary. Expressions the model cannot represent round
         * trip through custom mode without data loss.
         */
        function CronPicker({ value, onChange, disabled }) {
          const h = React.createElement
          const [model, setModel] = React.useState(() => parseCron(value))
          const [fires, setFires] = React.useState([])
          React.useEffect(() => { setModel(parseCron(value)) }, [value])
          // Preview the next few fire times (computed by croner on the host) so
          // the chosen schedule can be confirmed before saving. Debounced so
          // typing in custom mode doesn't fire a request per keystroke.
          React.useEffect(() => {
            const cron = String(value || '').trim()
            if (!cron) { setFires([]); return undefined }
            let cancelled = false
            const timer = setTimeout(() => {
              fetch(`${API}/next?cron=${encodeURIComponent(cron)}`)
                .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad cron'))))
                .then((p) => { if (!cancelled) setFires(p.fires || []) })
                .catch(() => { if (!cancelled) setFires([]) })
            }, 250)
            return () => { cancelled = true; clearTimeout(timer) }
          }, [value])
          // New-item forms mount with an empty cron: seed a sensible default so
          // the form is immediately valid and the picker never shows nothing.
          React.useEffect(() => {
            if (!value || !String(value).trim()) onChange(buildCron(parseCron('')))
            // eslint-disable-next-line react-hooks/exhaustive-deps
          }, [])

          const emit = (next) => {
            setModel(next)
            const cron = buildCron(next)
            if (cron) onChange(cron)
          }
          const setMode = (mode) => {
            if (mode === model.mode) return
            if (mode === 'hourly') emit({ mode, step: 60, minute: model.minute ?? 0 })
            else if (mode === 'daily') emit({ mode, hour: model.hour ?? 9, minute: model.minute ?? 0 })
            else if (mode === 'weekly') emit({ mode, hour: model.hour ?? 9, minute: model.minute ?? 0, days: model.days && model.days.length ? model.days : [1, 2, 3, 4, 5] })
            else { const raw = buildCron(model) || '0 9 * * *'; setModel({ mode, raw }); onChange(raw) }
          }
          const toggleDay = (day) => {
            const current = model.days || []
            const next = current.includes(day)
              ? current.filter((d) => d !== day)
              : WEEKDAY_KEYS.filter((d) => current.includes(d) || d === day)
            if (next.length === 0) return // keep at least one weekday
            emit({ ...model, days: next })
          }

          const time = `${pad2(model.hour ?? 9)}:${pad2(model.minute ?? 0)}`
          let summary
          if (model.mode === 'hourly') {
            summary = (model.step && model.step < 60)
              ? t('sumMin').replace('{n}', model.step)
              : t('sumHour').replace('{m}', pad2(model.minute ?? 0))
          } else if (model.mode === 'daily') {
            summary = t('sumDaily').replace('{t}', time)
          } else if (model.mode === 'weekly') {
            const days = model.days || []
            const isWorkday = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))
            const w = isWorkday ? '' : days.map((d) => t('wd' + d)).join(t('listSep'))
            summary = t(isWorkday ? 'sumWeeklyWorkday' : 'sumWeekly')
              .replace('{w}', w)
              .replace('{t}', time)
          } else {
            summary = model.raw ? t('sumCustom').replace('{raw}', model.raw) : t('sumEmpty')
          }

          const timeSelects = h(React.Fragment, null,
            h('select', {
              'aria-label': t('hourField'), value: model.hour ?? 9, disabled,
              onChange: (e) => emit({ ...model, hour: Number(e.target.value) }),
            }, HOURS.map((n) => h('option', { key: n, value: n }, pad2(n)))),
            h('span', null, ':'),
            h('select', {
              'aria-label': t('minuteField'), value: model.minute ?? 0, disabled,
              onChange: (e) => emit({ ...model, minute: Number(e.target.value) }),
            }, MINUTES.map((n) => h('option', { key: n, value: n }, pad2(n))))
          )

          return h('div', { className: 'si-cron' },
            h('div', { className: 'si-chips' },
              CRON_PRESETS.map((preset) => h('button', {
                key: preset.id, type: 'button', className: 'si-chip', disabled,
                onClick: () => onChange(preset.cron),
              }, t('preset' + preset.id.charAt(0).toUpperCase() + preset.id.slice(1))))
            ),
            h('div', { className: 'si-seg', role: 'tablist' },
              MODES.map(([mode, key]) => h('button', {
                key: mode, type: 'button', role: 'tab',
                'aria-pressed': model.mode === mode, disabled,
                className: model.mode === mode ? 'on' : '',
                onClick: () => setMode(mode),
              }, t(key)))
            ),
            model.mode === 'hourly' && h('div', { className: 'si-cronRow' },
              h('span', null, t('cronEvery')),
              h('select', {
                value: model.step ?? 60, disabled,
                onChange: (e) => emit({ mode: 'hourly', step: Number(e.target.value), ...(Number(e.target.value) === 60 ? { minute: model.minute ?? 0 } : {}) }),
              }, HOURLY_STEPS.map((s) => h('option', { key: s, value: s }, s === 60 ? '1' : String(s)))),
              (model.step ?? 60) === 60 && h(React.Fragment, null,
                h('span', null, t('cronAtMinute')),
                h('select', {
                  value: model.minute ?? 0, disabled,
                  onChange: (e) => emit({ ...model, minute: Number(e.target.value) }),
                }, MINUTES.map((n) => h('option', { key: n, value: n }, pad2(n)))),
                h('span', null, t('cronMinuteUnit'))
              ),
              (model.step ?? 60) !== 60 && h('span', null, t('cronMinutesUnit'))
            ),
            (model.mode === 'daily' || model.mode === 'weekly') && h('div', { className: 'si-cronRow' },
              model.mode === 'weekly' && h('div', { className: 'si-days' },
                WEEKDAY_KEYS.map((day) => h('button', {
                  key: day, type: 'button', className: (model.days || []).includes(day) ? 'si-day on' : 'si-day',
                  'aria-pressed': (model.days || []).includes(day), disabled,
                  onClick: () => toggleDay(day),
                }, t('wd' + day)))
              ),
              timeSelects
            ),
            model.mode === 'custom' && h('input', {
              value: model.raw || '', disabled, placeholder: '0 9 * * *', spellCheck: false,
              onChange: (e) => { const raw = e.target.value; setModel({ mode: 'custom', raw }); onChange(raw) },
            }),
            h('div', { className: 'si-sum' }, summary),
            fires.length > 0 && h('div', { className: 'si-next' },
              h('span', { className: 'si-nextLabel' }, t('nextRuns').replace('{n}', fires.length)),
              h('ul', { className: 'si-nextList' },
                fires.map((iso, i) => h('li', { key: i },
                  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                ))
              )
            )
          )
        }


    /**
     * The management surface. Component-local state, zero renderer-bound
     * props hooks: everything (list, form, workspace options, actions) is
     * reached through the apply closure, so the bundle renders in any client
     * runtime that serves `slots`.
     */
    function ScheduledItemsPanel() {
      const [items, setItems] = React.useState([])
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [form, setForm] = React.useState(null)
          const [saving, setSaving] = React.useState(false)
          const [runningId, setRunningId] = React.useState(null)
          const [historyId, setHistoryId] = React.useState(null)
          const [workspaces, setWorkspaces] = React.useState([])

      const load = async () => {
        setLoading(true)
        setError(null)
        try {
          const payload = await readJson(await fetch(API))
          setItems(payload.items || [])
        } catch (err) {
          setError(String((err && err.message) || err))
        }
        setLoading(false)
      }

      React.useEffect(() => {
        void load()
        // Workspace options are optional; failure never blocks the page.
        fetch(`${API}/workspaces`)
          .then((response) => readJson(response))
          .then((payload) => { setWorkspaces(payload.workspaces || []) })
          .catch(() => {})
      }, [])

      const saveForm = async () => {
        if (!form || saving) return
        setSaving(true)
        setError(null)
        try {
          const payload = {
            title: form.title,
            prompt: form.prompt,
            cron: form.cron,
            enabled: form.enabled,
            ...(form.workspaceId === undefined ? {} : { workspaceId: form.workspaceId }),
          }
          const response = form.editingId === null
            ? await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
            : await fetch(API, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: form.editingId, ...payload }) })
          await readJson(response)
          setForm(null)
          await load()
        } catch (err) {
          setError(String((err && err.message) || err))
        }
        setSaving(false)
      }

      const remove = async (id) => {
        try {
          const response = await fetch(API, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
          await readJson(response)
          await load()
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }

      const runNow = async (id) => {
        setRunningId(id)
        try {
          const response = await fetch(`${API}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
          await readJson(response)
          await load()
        } catch (err) {
          setError(String((err && err.message) || err))
        }
        setRunningId(null)
      }

      const workspaceOptions = workspaces.map((workspace) => ({
        id: workspace.id,
        title: workspace.title,
      }))
      const workspaceTitle = (id) => {
        const option = workspaceOptions.find((o) => o.id === id)
        return option ? option.title : id
      }
      const rowMeta = (item) => {
        const parts = []
        if (item.workspaceId !== undefined) {
          parts.push(`${t('workspace')}: ${workspaceTitle(item.workspaceId)}`)
        }
        if (!item.enabled) parts.push(`${t('enabledLabel')}: ✕`)
        parts.push(`${t('lastRun')}: ${lastRunText(t, item)}`)
        return parts.join(' · ')
      }
      const disabled = loading || saving

      return React.createElement('div', { className: 'si-root' },
        error && React.createElement('p', { className: 'si-error', role: 'alert' },
          error,
          React.createElement('button', { type: 'button', className: 'si-btn', onClick: () => void load() }, t('retry'))
        ),
        loading && React.createElement('p', { className: 'si-muted' }, t('loading')),
        !loading && items.length === 0 && !error && React.createElement('p', { className: 'si-muted' }, t('empty')),
        React.createElement('ul', { className: 'si-list' },
          items.map((item) =>
            React.createElement('li', { key: item.id, className: 'si-row' },
                  React.createElement('div', { className: 'si-rowMain' },
                    React.createElement('span', { className: 'si-rowTitle' }, item.title),
                    React.createElement('span', { className: 'si-rowCron' }, item.cron),
                    React.createElement('span', { className: 'si-rowMeta' }, rowMeta(item)),
                    (item.runs && item.runs.length > 0) && React.createElement(React.Fragment, null,
                      React.createElement('button', {
                        type: 'button',
                        className: 'si-runsToggle',
                        onClick: () => setHistoryId(historyId === item.id ? null : item.id),
                        'aria-expanded': historyId === item.id,
                      }, `${t('runHistory')} (${item.runs.length})`),
                      historyId === item.id && React.createElement('ul', { className: 'si-runs' },
                        [...item.runs].reverse().map((run, idx) =>
                          React.createElement('li', { key: idx, className: 'si-run' },
                            React.createElement('span', { className: 'si-runTime' }, new Date(run.at).toLocaleString()),
                            run.ok
                              ? React.createElement('span', { className: 'si-runOk' }, t('runOk'))
                              : React.createElement('span', { className: 'si-runFail' }, `${t('runFail')}: ${run.error || ''}`)
                          )
                        )
                      )
                    )
                  ),
              React.createElement('div', { className: 'si-rowActions' },
                React.createElement('button', {
                  type: 'button',
                  className: 'si-btn',
                  disabled: runningId === item.id,
                  onClick: () => void runNow(item.id),
                }, runningId === item.id ? t('running') : t('runNow')),
                React.createElement('button', {
                  type: 'button',
                  className: 'si-btn',
                  onClick: () => setForm({
                    editingId: item.id,
                    title: item.title,
                    prompt: item.prompt,
                    cron: item.cron,
                    enabled: item.enabled,
                    ...(item.workspaceId === undefined ? {} : { workspaceId: item.workspaceId }),
                  }),
                }, t('editItem')),
                React.createElement('button', {
                  type: 'button',
                  className: 'si-btn si-btn-danger',
                  onClick: () => { if (window.confirm(t('deleteConfirm'))) void remove(item.id) },
                }, t('delete'))
              )
            )
          )
        ),
        form === null
          ? React.createElement('button', { type: 'button', className: 'si-btn si-btn-primary', onClick: () => setForm(emptyForm()) }, t('newItem'))
          : React.createElement('form', {
            className: 'si-form',
            onSubmit: (event) => {
              event.preventDefault()
              if (!form.title.trim() || !form.prompt.trim() || !form.cron.trim()) {
                window.alert(t('invalidForm'))
                return
              }
              void saveForm()
            },
          },
            React.createElement('h3', { className: 'si-formTitle' }, form.editingId === null ? t('newItem') : t('editItem')),
            React.createElement('label', { className: 'si-field' },
              React.createElement('span', null, t('titleLabel')),
              React.createElement('input', {
                value: form.title,
                disabled,
                placeholder: t('titlePlaceholder'),
                onChange: (e) => setForm({ ...form, title: e.target.value }),
              })
            ),
            React.createElement('label', { className: 'si-field' },
              React.createElement('span', null, t('promptLabel')),
              React.createElement('textarea', {
                value: form.prompt,
                disabled,
                rows: 4,
                placeholder: t('promptPlaceholder'),
                onChange: (e) => setForm({ ...form, prompt: e.target.value }),
              })
            ),
                React.createElement('div', { className: 'si-field' },
                  React.createElement('span', null, t('cronLabel')),
                  React.createElement(CronPicker, {
                    value: form.cron,
                    disabled,
                    onChange: (cron) => setForm({ ...form, cron }),
                  }),
                  React.createElement('small', { className: 'si-hint' }, t('cronHint'))
                ),
            workspaceOptions.length > 0 && React.createElement('label', { className: 'si-field' },
              React.createElement('span', null, t('workspaceLabel')),
              React.createElement('select', {
                value: form.workspaceId || '',
                disabled,
                onChange: (e) => setForm({ ...form, workspaceId: e.target.value === '' ? undefined : e.target.value }),
              },
                React.createElement('option', { value: '' }, t('workspaceNone')),
                workspaceOptions.map((option) =>
                  React.createElement('option', { key: option.id, value: option.id }, option.title))
              ),
              React.createElement('small', { className: 'si-hint' }, t('workspaceHint'))
            ),
            React.createElement('label', { className: 'si-checkbox' },
              React.createElement('input', {
                type: 'checkbox',
                checked: form.enabled,
                disabled,
                onChange: (e) => setForm({ ...form, enabled: e.target.checked }),
              }),
              React.createElement('span', null, t('enabledLabel')),
              React.createElement('small', { className: 'si-hint' }, t('enabledHint'))
            ),
            React.createElement('div', { className: 'si-formActions' },
              React.createElement('button', { type: 'submit', className: 'si-btn si-btn-primary', disabled }, saving ? t('saving') : t('save')),
              React.createElement('button', { type: 'button', className: 'si-btn', disabled, onClick: () => setForm(null) }, t('cancel'))
            )
          )
      )
    }

    // Settings page.
    slots.inject('settings.section', () => slots.register(
      {
        name: 'settings.section',
        id: '@weibaohui/dsh-tasks',
        order: 30,
        label: () => t('nav'),
        locale: LOCALE_NS,
      },
      () => React.createElement(ScheduledItemsPanel, null)
    ))
  },
}
