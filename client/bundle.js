/* Generated from client/index.js by scripts/build-client.mjs — do not edit by hand.
 * Regenerate with: npm run build:client
 */
window.__ModuleLoader__.load({
  id: "@weibaohui/dsh-tasks",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")
    'use strict'

    /**
     * dsh-tasks — cron model <-> expression helpers (pure, no DOM / React).
     *
     * The structured cron picker edits a small model and emits a five-field cron
     * string (as consumed by croner): `minute hour day-of-month month day-of-week`.
     * Anything the model can't represent round-trips through mode `custom` with the
     * raw expression preserved, so opening an exotic schedule never loses data.
     */

    /** Weekday chips in UI order (Monday → Sunday). Cron dow: Mon=1 … Sat=6, Sun=0. */
    const WEEKDAY_KEYS = [1, 2, 3, 4, 5, 6, 0]

    /** One-click presets. Each parses back into a structured mode (not custom). */
    const CRON_PRESETS = [
      { id: 'hourly', cron: '0 * * * *' },
      { id: 'min30', cron: '*/30 * * * *' },
      { id: 'daily9', cron: '0 9 * * *' },
      { id: 'weekday830', cron: '30 8 * * 1-5' },
      { id: 'mon10', cron: '0 10 * * 1' },
    ]

    /** Minute steps offered by the hourly mode (60 = once an hour). */
    const HOURLY_STEPS = [60, 30, 15, 10, 5]

    const int = (value, min, max) => {
      if (!/^\d+$/.test(value)) return null
      const n = Number(value)
      return n >= min && n <= max ? n : null
    }

    /**
     * Parse a day-of-week field (`*`, `1-5`, `1,3,5`, `0`/`7` for Sunday…) into a
     * sorted array of weekday keys, or null when it is not a plain list/range of
     * weekday numbers (steps, names, etc. — those fall back to custom mode).
     */
    function parseDow(field) {
      if (field === '*') return null
      const days = new Set()
      for (const token of field.split(',')) {
        const range = token.match(/^(\d+)-(\d+)$/)
        let lo
        let hi
        if (range) {
          lo = Number(range[1])
          hi = Number(range[2])
          if (lo > hi) return null
        } else {
          lo = hi = Number(token)
        }
        for (let atom = lo; atom <= hi; atom++) {
          if (!Number.isInteger(atom)) return null
          if (atom < 0 || atom > 7) return null
          days.add(atom === 7 ? 0 : atom) // cron also accepts 7 for Sunday
        }
      }
      if (days.size === 0) return null
      return WEEKDAY_KEYS.filter((key) => days.has(key))
    }

    /**
     * Parse a cron expression into a picker model.
     * model.mode ∈ hourly | daily | weekly | custom.
     */
    function parseCron(str) {
      const raw = typeof str === 'string' ? str.trim() : ''
      const custom = { mode: 'custom', raw }
      const fields = raw.split(/\s+/)
      if (fields.length !== 5) return raw ? custom : { mode: 'daily', minute: 0, hour: 9 }
      const [mf, hf, domf, monf, dowf] = fields
      if (domf !== '*' || monf !== '*') return custom

      // Hourly: hour field is `*`. Accept `M * * * *` (once an hour at :M) and
      // `*/N * * * *` for the quick sub-hour steps.
      if (hf === '*' && dowf === '*') {
        const step = mf.match(/^\*\/(\d+)$/)
        if (step) {
          const n = Number(step[1])
          if (HOURLY_STEPS.includes(n)) return { mode: 'hourly', step: n }
          return custom
        }
        const minute = int(mf, 0, 59)
        if (minute !== null) return { mode: 'hourly', step: 60, minute }
        return custom
      }

      // Daily / weekly need a single hour and minute.
      const hour = int(hf, 0, 23)
      const minute = int(mf, 0, 59)
      if (hour === null || minute === null) return custom
      const days = parseDow(dowf)
      if (days === null) {
        return dowf === '*' ? { mode: 'daily', hour, minute } : custom
      }
      return { mode: 'weekly', hour, minute, days }
    }

    /** Collapse an array of weekday keys (Mon=1 … Sat=6, Sun=0) into cron tokens, e.g. [1..5] → `1-5`. */
    function formatDow(days) {
      const week = days.filter((d) => d >= 1 && d <= 6).sort((a, b) => a - b)
      const tokens = []
      let start = null
      let prev = null
      const flush = () => {
        if (start === null) return
        tokens.push(start === prev ? String(start) : `${start}-${prev}`)
        start = null
      }
      for (const d of week) {
        if (start === null) { start = d; prev = d }
        else if (d === prev + 1) { prev = d }
        else { flush(); start = d; prev = d }
      }
      flush()
      if (days.includes(0)) tokens.push('0') // Sunday: croner accepts 0 (and 7); keep 0 standalone
      return tokens.join(',')
    }

    /** Build a cron expression from a picker model. */
    function buildCron(model) {
      if (!model || model.mode === 'custom') return (model?.raw || '').trim()
      const minute = model.minute ?? 0
      if (model.mode === 'hourly') {
        return model.step && model.step < 60
          ? `*/${model.step} * * * *`
          : `${minute} * * * *`
      }
      const hour = model.hour ?? 9
      if (model.mode === 'daily') return `${minute} ${hour} * * *`
      if (model.mode === 'weekly') {
        const days = (model.days && model.days.length ? model.days : [1])
        return `${minute} ${hour} * * ${formatDow(days)}`
      }
      return ''
    }

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
          openSession: '打开对话',
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
      disabledTag: '已停用',
      invalidForm: '标题、提示词和 cron 定时器都是必填项。',
      deleteConfirm: '确定删除这个定时事项？',
      close: '关闭',
      workspace: '工作区',
      workspaceLabel: '工作区',
      workspaceNone: '不绑定工作区（默认目录）',
      workspaceHint: '执行时会在此工作区下新建会话，并显示在工作区分组中。',
      model: '模型',
      modelLabel: '模型',
      modelDefault: '跟随默认模型（当前：{m}）',
      modelHint: '该事项执行时新会话使用的模型；不选则跟随全局默认模型。',
      notify: '通知推送',
      notifyHint: '把每次执行的结果推送到已接入的 IM 投递插件（如 dsh-im）绑定的聊天渠道。插件未安装或未连接时通知不可用。',
      notifyEnabled: '启用通知推送',
      notifyEventStart: '开始执行时',
      notifyEventComplete: '执行完成时',
      notifyEventError: '执行失败时',
      notifyIncludeResult: '完成通知附带执行结论',
      notifyIncludeResultHint: '勾选后，完成推送会带上 agent 的最终回复内容（截取末尾 1000 字）。',
      notifyDnd: '免打扰',
      notifyDndEnabled: '开启免打扰时段',
      notifyDndStart: '开始',
      notifyDndEnd: '结束',
      notifyDndHint: '该时段内的推送会被跳过（支持跨零点，如 22:00–08:00）；执行记录仍可在本页查看。',
      notifyChannels: '推送渠道',
      notifyChannelsEmpty: '尚未添加任何渠道。',
      notifyNoProvider: '未检测到可用的 IM 投递插件（如 dsh-im）。请先安装并完成机器人配置，再刷新本页。',
      notifyNoTargets: '该机器人还没有已保存的投递目标，请先在对应插件设置中保存。',
      notifyAdd: '添加渠道',
      notifyProviderLabel: '插件',
      notifyBotLabel: '机器人',
      notifyTargetLabel: '目标',
      notifySelectProvider: '选择插件',
      notifySelectBot: '选择机器人',
      notifySelectTarget: '选择目标',
      notifyRemove: '移除',
      notifyUnavailable: '不可用',
      notifySave: '保存通知设置',
      notifySaved: '已保存 ✓',
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
      openSession: 'Open chat',
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
      disabledTag: 'Disabled',
      invalidForm: 'Title, prompt, and cron schedule are required.',
      deleteConfirm: 'Delete this scheduled task?',
      close: 'Close',
      workspace: 'Workspace',
      workspaceLabel: 'Workspace',
      workspaceNone: 'None (default directory)',
      workspaceHint: 'Each run starts a new session in this workspace; sessions appear grouped under it in the sidebar.',
      model: 'Model',
      modelLabel: 'Model',
      modelDefault: 'Follow default model (currently: {m})',
      modelHint: 'The model used by the fresh session when this task runs; leave unset to follow the global default.',
      notify: 'Notifications',
      notifyHint: 'Push each run\'s result to a chat channel bound in an installed IM delivery plugin (e.g. dsh-im). Unavailable while the plugin is missing or disconnected.',
      notifyEnabled: 'Enable notifications',
      notifyEventStart: 'On start',
      notifyEventComplete: 'On completion',
      notifyEventError: 'On failure',
      notifyIncludeResult: 'Include the final reply in completion pushes',
      notifyIncludeResultHint: 'When checked, the completion push carries the agent\'s final reply (last 1000 characters).',
      notifyDnd: 'Do not disturb',
      notifyDndEnabled: 'Enable do-not-disturb window',
      notifyDndStart: 'From',
      notifyDndEnd: 'Until',
      notifyDndHint: 'Pushes inside the window are skipped (overnight windows like 22:00–08:00 are supported); run history stays available on this page.',
      notifyChannels: 'Channels',
      notifyChannelsEmpty: 'No channels added yet.',
      notifyNoProvider: 'No IM delivery provider detected (e.g. dsh-im). Install and configure one, then reload this page.',
      notifyNoTargets: 'This bot has no saved delivery targets yet — save one in the provider plugin settings first.',
      notifyAdd: 'Add channel',
      notifyProviderLabel: 'Provider',
      notifyBotLabel: 'Bot',
      notifyTargetLabel: 'Target',
      notifySelectProvider: 'Select provider',
      notifySelectBot: 'Select bot',
      notifySelectTarget: 'Select target',
      notifyRemove: 'Remove',
      notifyUnavailable: 'unavailable',
      notifySave: 'Save notification settings',
      notifySaved: 'Saved ✓',
    }

    const LOCALE_DICT = { zh: ZH, en: EN }

    const API = '/dsh-tasks/api'

    // Host sessions service for 打开对话, captured through dynamic ctx.inject
    // (dsh-sync / skills-management precedent: listing `sessions` in the static
    // inject array stalls activation). Absence degrades the button to hidden.
    let sessionsApi = null

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
        .si-runSession{padding:0;border:none;background:transparent;color:var(--dsw-alias-brand-primary);font-size:11px;cursor:pointer}
        .si-runSession:hover{text-decoration:underline}

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
    /* Notification settings block. */
    .si-events{display:flex;flex-wrap:wrap;gap:14px}
    .si-chanList{display:flex;flex-direction:column;gap:6px;width:100%}
    .si-chan{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1);font-size:12px;color:var(--dsw-alias-label-primary)}
    .si-chanLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .si-chanOff{color:var(--dsw-alias-state-error-primary);flex-shrink:0}
    .si-btn-sm{font-size:12px;padding:2px 9px;border-radius:6px;flex-shrink:0}
    .si-cronRow input[type="time"]{padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit}
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

        // 「打开对话」：动态 inject 捕获宿主 sessions 服务（dsh-sync /
        // skills-management 同款）。服务缺席时按钮整体隐藏，不影响其余功能。
        try {
          if (typeof ctx.inject === 'function') {
            ctx.inject(['sessions'], (scope) => {
              const svc = scope && scope.sessions
              if (svc && typeof svc.open === 'function') sessionsApi = svc
            })
          }
        } catch {}

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
         * runtime that serves `slots`. The one renderer-bound prop is
         * `closeSettings` — the settings.section slot owner hands every section
         * its `close` callback; the panel uses it to dismiss the settings window
         * after jumping to a run's conversation (absent on other hosts: no-op).
         */
        function ScheduledItemsPanel({ closeSettings }) {
          const [items, setItems] = React.useState([])
          const [loading, setLoading] = React.useState(false)
          const [error, setError] = React.useState(null)
          const [form, setForm] = React.useState(null)
              const [saving, setSaving] = React.useState(false)
              const [runningId, setRunningId] = React.useState(null)
              const [historyId, setHistoryId] = React.useState(null)
              const [workspaces, setWorkspaces] = React.useState([])
              const [modelCatalog, setModelCatalog] = React.useState(null)
              const [notifyCfg, setNotifyCfg] = React.useState(null)
              const [notifyProviders, setNotifyProviders] = React.useState([])
              const [notifyPick, setNotifyPick] = React.useState({ service: '', botId: '', targetId: '' })
              const [notifySaving, setNotifySaving] = React.useState(false)
              const [notifySavedTick, setNotifySavedTick] = React.useState(false)

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
            // Model options are optional too; without them the form simply
            // hides the model select and every task follows the default model.
            fetch(`${API}/models`)
              .then((response) => readJson(response))
              .then((payload) => { setModelCatalog(payload) })
              .catch(() => {})
            // Notification settings + live delivery-provider probe; absence of
            // providers only disables the notification block, never the page.
            fetch(`${API}/notify`)
              .then((response) => readJson(response))
              .then((payload) => {
                setNotifyCfg(payload.config || null)
                setNotifyProviders(payload.providers || [])
              })
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
              const hasModel = form.provider !== undefined && form.model !== undefined
              const response = form.editingId === null
                ? await fetch(API, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ ...payload, ...(hasModel ? { provider: form.provider, model: form.model } : {}) }),
                })
                // PATCH always carries the model fields: the pair when one is
                // selected, or explicit nulls to clear a previously stored route.
                : await fetch(API, {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    id: form.editingId,
                    ...payload,
                    provider: hasModel ? form.provider : null,
                    model: hasModel ? form.model : null,
                  }),
                })
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

          // ── 通知推送设置 ──────────────────────────────────────────────────────
          const saveNotify = async () => {
            if (!notifyCfg || notifySaving) return
            setNotifySaving(true)
            try {
              const payload = await readJson(await fetch(`${API}/notify`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(notifyCfg),
              }))
              setNotifyCfg(payload.config)
              setNotifyProviders(payload.providers || [])
              setNotifySavedTick(true)
              setTimeout(() => setNotifySavedTick(false), 1600)
            } catch (err) {
              setError(String((err && err.message) || err))
            }
            setNotifySaving(false)
          }

          const pickProvider = notifyProviders.find((p) => p.service === notifyPick.service)
          const pickBots = pickProvider ? pickProvider.bots : []
          const pickBot = pickBots.find((b) => b.botId === notifyPick.botId)
          const pickTargets = pickBot ? pickBot.targets : []
          const pickTarget = pickTargets.find((target) => target.targetId === notifyPick.targetId)
          const pickComplete = !!(pickProvider && pickBot && pickTarget)
          const pickDuplicate = pickComplete && notifyCfg !== null && notifyCfg.channels.some((ch) =>
            ch.service === notifyPick.service && ch.botId === notifyPick.botId && ch.targetId === notifyPick.targetId)

          const addChannel = () => {
            if (!pickComplete || pickDuplicate) return
            const botLabel = pickBot.channel || `${notifyPick.botId.slice(0, 10)}…`
            const targetLabel = pickTarget.name || pickTarget.targetId
            const id = `chan-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
            setNotifyCfg({
              ...notifyCfg,
              channels: [...notifyCfg.channels, {
                id,
                service: notifyPick.service,
                botId: notifyPick.botId,
                targetId: pickTarget.targetId,
                label: `${botLabel} · ${targetLabel}`,
              }],
            })
            setNotifyPick({ service: '', botId: '', targetId: '' })
          }

          // 打开某次执行对应的会话：open() 尽力而为（落地选择后可能 reject），
          // 服务缺席时按钮根本不渲染。打开成功后顺手关掉设置窗口——本面板是
          // settings.section slot，宿主渲染时会在 slot props 里下发 close
          // （dsh-client-ui-settings-general 同款，官方 agent-preset section 也这么用），
          // 不关的话用户还停在设置页，得再按一次 Esc 才能看到切过去的会话。
          const canOpenSession = !!(sessionsApi && typeof sessionsApi.open === 'function')
          const openRunSession = (sessionId) => {
            try {
              const result = sessionsApi.open(sessionId)
              if (result && typeof result.catch === 'function') result.catch(() => {})
              if (typeof closeSettings === 'function') closeSettings()
            } catch {}
          }
          const workspaceTitle = (id) => {
            const option = workspaceOptions.find((o) => o.id === id)
            return option ? option.title : id
          }
          const modelName = (provider, model) => {
            const groups = (modelCatalog && modelCatalog.groups) || []
            const group = groups.find((g) => g.id === provider)
            const entry = group && group.models.find((m) => m.id === model)
            return entry ? entry.name : `${provider}/${model}`
          }
          const rowMeta = (item) => {
            const parts = []
            if (item.workspaceId !== undefined) {
              parts.push(`${t('workspace')}: ${workspaceTitle(item.workspaceId)}`)
            }
            if (item.provider !== undefined && item.model !== undefined) {
              parts.push(`${t('model')}: ${modelName(item.provider, item.model)}`)
            }
            if (!item.enabled) parts.push(t('disabledTag'))
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
                                  : React.createElement('span', { className: 'si-runFail' }, `${t('runFail')}: ${run.error || ''}`),
                                run.sessionId && canOpenSession && React.createElement('button', {
                                  type: 'button',
                                  className: 'si-runSession',
                                  title: run.sessionId,
                                  onClick: () => openRunSession(run.sessionId),
                                }, t('openSession'))
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
                        ...(item.provider === undefined || item.model === undefined
                          ? {}
                          : { provider: item.provider, model: item.model }),
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
                modelCatalog && modelCatalog.groups && modelCatalog.groups.length > 0 && React.createElement('label', { className: 'si-field' },
                  React.createElement('span', null, t('modelLabel')),
                  React.createElement('select', {
                    // Option values encode the route pair as JSON so ids may
                    // contain any separator character; '' means "follow default".
                    value: form.provider !== undefined && form.model !== undefined
                      ? JSON.stringify([form.provider, form.model])
                      : '',
                    disabled,
                    onChange: (e) => {
                      if (e.target.value === '') {
                        const next = { ...form }
                        delete next.provider
                        delete next.model
                        setForm(next)
                      } else {
                        const [provider, model] = JSON.parse(e.target.value)
                        setForm({ ...form, provider, model })
                      }
                    },
                  },
                    React.createElement('option', { value: '' },
                      t('modelDefault').replace('{m}', modelCatalog.default
                        ? modelName(modelCatalog.default.provider, modelCatalog.default.model)
                        : '')),
                    modelCatalog.groups.map((group) =>
                      React.createElement('optgroup', { key: group.id, label: group.name },
                        group.models.map((model) =>
                          React.createElement('option', {
                            key: model.id,
                            value: JSON.stringify([group.id, model.id]),
                          }, model.name)))),
                    // A stored route that vanished from the catalog still renders
                    // as a selectable (labeled) option instead of silently
                    // snapping the select back to the default entry.
                    form.provider !== undefined && form.model !== undefined
                      && !((modelCatalog.groups.find((g) => g.id === form.provider) || { models: [] }).models.some((m) => m.id === form.model))
                      && React.createElement('option', {
                        value: JSON.stringify([form.provider, form.model]),
                      }, `${form.provider}/${form.model}`)
                  ),
                  React.createElement('small', { className: 'si-hint' }, t('modelHint'))
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
              ),
            notifyCfg !== null && React.createElement('div', { className: 'si-form' },
              React.createElement('h3', { className: 'si-formTitle' }, t('notify')),
              React.createElement('p', { className: 'si-hint' }, t('notifyHint')),
              React.createElement('label', { className: 'si-checkbox' },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: notifyCfg.enabled,
                  onChange: (e) => setNotifyCfg({ ...notifyCfg, enabled: e.target.checked }),
                }),
                React.createElement('span', null, t('notifyEnabled'))
              ),
              notifyCfg.enabled && React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'si-events' },
                  [
                    ['onStart', 'notifyEventStart'],
                    ['onComplete', 'notifyEventComplete'],
                    ['onError', 'notifyEventError'],
                  ].map(([key, localeKey]) =>
                    React.createElement('label', { key, className: 'si-checkbox' },
                      React.createElement('input', {
                        type: 'checkbox',
                        checked: notifyCfg[key],
                        onChange: (e) => setNotifyCfg({ ...notifyCfg, [key]: e.target.checked }),
                      }),
                      React.createElement('span', null, t(localeKey))
                    )
                  )
                ),
                React.createElement('label', { className: 'si-checkbox' },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: !!notifyCfg.includeResult,
                    onChange: (e) => setNotifyCfg({ ...notifyCfg, includeResult: e.target.checked }),
                  }),
                  React.createElement('span', null, t('notifyIncludeResult')),
                  React.createElement('small', { className: 'si-hint' }, t('notifyIncludeResultHint'))
                ),
                React.createElement('label', { className: 'si-checkbox' },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: !!notifyCfg.dnd.enabled,
                    onChange: (e) => setNotifyCfg({ ...notifyCfg, dnd: { ...notifyCfg.dnd, enabled: e.target.checked } }),
                  }),
                  React.createElement('span', null, t('notifyDndEnabled'))
                ),
                notifyCfg.dnd.enabled && React.createElement('div', { className: 'si-cronRow' },
                  React.createElement('span', null, t('notifyDndStart')),
                  React.createElement('input', {
                    type: 'time',
                    value: notifyCfg.dnd.start,
                    onChange: (e) => setNotifyCfg({ ...notifyCfg, dnd: { ...notifyCfg.dnd, start: e.target.value } }),
                  }),
                  React.createElement('span', null, t('notifyDndEnd')),
                  React.createElement('input', {
                    type: 'time',
                    value: notifyCfg.dnd.end,
                    onChange: (e) => setNotifyCfg({ ...notifyCfg, dnd: { ...notifyCfg.dnd, end: e.target.value } }),
                  }),
                  React.createElement('small', { className: 'si-hint' }, t('notifyDndHint'))
                ),
                React.createElement('div', { className: 'si-field' },
                  React.createElement('span', null, t('notifyChannels')),
                  notifyCfg.channels.length === 0
                    ? React.createElement('span', { className: 'si-hint' }, t('notifyChannelsEmpty'))
                    : React.createElement('div', { className: 'si-chanList' },
                      notifyCfg.channels.map((channel) =>
                        React.createElement('div', { key: channel.id, className: 'si-chan' },
                          React.createElement('span', { className: 'si-chanLabel' },
                            channel.label || `${channel.service} → ${channel.targetId}`,
                            !notifyProviders.some((p) => p.service === channel.service)
                              && React.createElement('span', { className: 'si-chanOff' }, `（${t('notifyUnavailable')}）`)
                          ),
                          React.createElement('button', {
                            type: 'button',
                            className: 'si-btn si-btn-sm',
                            onClick: () => setNotifyCfg({
                              ...notifyCfg,
                              channels: notifyCfg.channels.filter((c) => c.id !== channel.id),
                            }),
                          }, t('notifyRemove'))
                        )
                      )
                    )
                ),
                notifyProviders.length > 0
                  ? React.createElement('div', { className: 'si-cronRow' },
                    React.createElement('select', {
                      'aria-label': t('notifyProviderLabel'),
                      value: notifyPick.service,
                      onChange: (e) => setNotifyPick({ service: e.target.value, botId: '', targetId: '' }),
                    },
                      React.createElement('option', { value: '' }, t('notifySelectProvider')),
                      notifyProviders.map((provider) =>
                        React.createElement('option', { key: provider.service, value: provider.service }, provider.service))
                    ),
                    notifyPick.service !== '' && React.createElement('select', {
                      'aria-label': t('notifyBotLabel'),
                      value: notifyPick.botId,
                      onChange: (e) => setNotifyPick({ ...notifyPick, botId: e.target.value, targetId: '' }),
                    },
                      React.createElement('option', { value: '' }, t('notifySelectBot')),
                      pickBots.map((bot) =>
                        React.createElement('option', { key: bot.botId, value: bot.botId },
                          bot.channel ? `[${bot.channel}] ${bot.botId.slice(0, 12)}…` : bot.botId))
                    ),
                    pickBot && React.createElement('select', {
                      'aria-label': t('notifyTargetLabel'),
                      value: notifyPick.targetId,
                      onChange: (e) => setNotifyPick({ ...notifyPick, targetId: e.target.value }),
                    },
                      React.createElement('option', { value: '' }, t('notifySelectTarget')),
                      pickTargets.length === 0
                        ? React.createElement('option', { value: '__none__', disabled: true }, t('notifyNoTargets'))
                        : pickTargets.map((target) =>
                          React.createElement('option', { key: target.targetId, value: target.targetId },
                            target.name || target.targetId))
                    ),
                    React.createElement('button', {
                      type: 'button',
                      className: 'si-btn',
                      disabled: !pickComplete || pickDuplicate,
                      onClick: addChannel,
                    }, t('notifyAdd'))
                  )
                  : React.createElement('p', { className: 'si-hint' }, t('notifyNoProvider'))
              ),
              React.createElement('div', { className: 'si-formActions' },
                React.createElement('button', {
                  type: 'button',
                  className: 'si-btn si-btn-primary',
                  disabled: notifySaving,
                  onClick: () => void saveNotify(),
                }, notifySavedTick ? t('notifySaved') : t('notifySave'))
              )
            )
          )
        }

        // Settings page. The slot render callback receives the owner props the
        // settings shell hands every section — including `close` — and forwards
        // it so the panel can dismiss the window after opening a conversation.
        slots.inject('settings.section', () => slots.register(
          {
            name: 'settings.section',
            id: '@weibaohui/dsh-tasks',
            order: 30,
            label: () => t('nav'),
            locale: LOCALE_NS,
          },
          (slotProps) => React.createElement(ScheduledItemsPanel, {
            closeSettings: slotProps && typeof slotProps.close === 'function' ? slotProps.close : undefined,
          })
        ))
      },
    }

    return module.exports
  }
})
