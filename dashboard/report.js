/* The weekly report: one sentence, a few suggestions, four sections, the seven days themselves. */
(function () {
  'use strict';
  const HD = window.HD;
  if (!HD || !HD.H) return;
  const { H, DAYS, D, el, num, clock, hm, mins, WEEKDAY, DOW, xAxis, yAxis, ttDom, tooltip, endPoint, baseOption } = HD;
  const REPORTS = H.reports || [];
  const A = (H.analysis || {}).daily || {};
  const REF = H.reference || {};
  const INDICATOR = new Map((REF.indicators || []).map((x) => [x.id, x]));
  const NOTES = new Map((H.annotations || []).map((e) => [e.d, e]));
  const W = H.workouts || [];
  const HISTORY = 12;                                    // how many reports the trends look back
  const LEVEL = { 3: '值得留意', 2: '建议', 1: '小提示' };
  const SIGNAL = { sleepHr: '睡眠心率', sleepHrv: 'HRV', resp: '呼吸', wristTemp: '腕温', sleepSpo2: '血氧' };

  const VITALS = (INDICATOR.get('night_vitals') || {}).params || { signals: {}, outlier_sd: 2 };
  const HR_RISE = ((INDICATOR.get('night_hr_rise') || {}).params || {}).rise_bpm || 4;
  /** the second overnight rule on night d: sleeping heart rate above its usual level, and for how many nights */
  HD.nightHr = (d) => {
    const rise = (A.hrRise || [])[d], run = (A.hrRun || [])[d];
    if (rise == null || rise < HR_RISE) return '';
    return `睡眠心率 +${num(rise, 0)}` + (run >= 2 ? `，连续第 ${run} 晚` : '');
  };
  /** which overnight signals sat outside the wearer's usual range on the night recorded on day d */
  HD.nightSignals = (d) => Object.keys(VITALS.signals).map((key) => {
    const z = (A['z' + key[0].toUpperCase() + key.slice(1)] || [])[d];
    const off = z != null && (VITALS.signals[key].worse === 'high' ? z : -z) >= VITALS.outlier_sd;
    return off ? SIGNAL[key] + (z > 0 ? ' 偏高' : ' 偏低') : null;
  }).filter(Boolean);
  const LONG = { note: ['●', '值得留意'], ok: ['✓', '没有发现持续变化'], none: ['–', '数据不足'] };
  /** the long-window checks of a report, as rows: state, name, the numbers, and the wording when flagged */
  HD.longRows = (r, ui) => (r.long || []).map((x) => el('div', { class: 'long ' + x.state },
    el('span', { class: 'st' }, el('i', { text: LONG[x.state][0] }), LONG[x.state][1]),
    el('div', null, el('b', { text: x.name }), el('span', { class: 'fact', text: x.fact }),
      x.text ? el('p', { text: x.text }) : null,
      x.state === 'note' && ui ? el('button', { class: 'link', type: 'button', text: '看依据', onclick: () => ui.gotoRef(x.id) }) : null)));

  const md = (i) => +DAYS[i].slice(5, 7) + ' 月 ' + +DAYS[i].slice(8, 10) + ' 日';
  const span = (r) => md(r.start) + ' – ' + md(r.end);
  HD.reportIndex = (date) => {                            // the report ending on, or last before, a date
    let k = -1;
    REPORTS.forEach((r, i) => { if (DAYS[r.end] <= date) k = i; });
    return k < 0 ? 0 : k;
  };

  // ------------------------------------------------------------------ pieces
  function tile(label, value, unit, note, spark) {
    const v = el('div', { class: 'v', text: value });
    if (unit) v.append(el('small', { text: unit }));
    const t = el('div', { class: 'tile' }, el('div', { class: 'k', text: label }), v, el('div', { class: 'd' }, note));
    if (spark) t.append(spark);
    return t;
  }
  /**
   * Change against the report before it, in plain ink: a lower score is information, not an alarm.
   * A change no bigger than the usual week-to-week wobble (`band`, from earlier weeks) reads "持平".
   */
  function delta(cur, prev, prevRep, band) {
    if (cur == null || prev == null) return '';
    const d = cur - prev, calm = d !== 0 && band != null && Math.abs(d) <= band;
    const text = d === 0 || calm ? '持平' : (d > 0 ? '▲ ' : '▼ ') + num(Math.abs(d)) + ' 分';
    const title = band == null ? null : `比上一期${d >= 0 ? '高' : '低'} ${num(Math.abs(d))} 分；此前相邻两期常见的差别在 ${num(band)} 分以内`;
    return [el('b', { class: 'flat', text, title }), ' 较上一期（截至 ' + DAYS[prevRep.end].slice(5) + '）' + (calm ? ' · 在平时的起伏内' : '')];
  }
  function trail(k, pick) {                               // sparkline: earlier reports in grey, this one in the accent
    const from = Math.max(0, k - HISTORY + 1);
    const vals = REPORTS.slice(from, k + 1).map(pick);
    return HD.sparkline(vals.slice(0, -1), vals.slice(-1));
  }
  function meter(name, points, max, fact) {
    const pct = points == null ? 0 : (100 * points) / max;
    return el('div', { class: 'meter' },
      el('div', { class: 'row' }, el('span', { text: name }),
        el('span', null, el('b', { text: points == null ? '–' : String(points) }), el('span', { class: 'n', text: ' / ' + max + ' 分' }))),
      el('div', { class: 'bar', role: 'img', 'aria-label': `${name} ${points == null ? '没有数据' : points + ' / ' + max + ' 分'}` },
        el('i', { style: `width:${pct}%` })),
      el('div', { class: 'fact', text: fact }));
  }
  const facts = (rows) => el('dl', { class: 'facts' }, rows.filter(Boolean).map(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
  function sectionCard(title, desc, head, ...body) {
    return el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('div', null, el('h3', { text: title }), el('p', { class: 'desc', text: desc })),
        head && el('div', { class: 'figure' }, head)),
      ...body);
  }
  const scoreFigure = (s) => (s.score == null ? el('span', { class: 'word', text: '数据不足' })
    : [el('b', { text: String(s.score) }), el('small', { text: ' 分' + (s.partial ? '（部分数据）' : '') })]);

  // ------------------------------------------------------------------ suggestions
  function tipNode(t, ui) {
    const basis = t.basis.map((id) => INDICATOR.get(id)).filter(Boolean);
    return el('details', { class: 'tip' },
      el('summary', null,
        el('span', { class: 'lvl l' + t.level }, el('i', { text: t.level === 3 ? '●' : '○' }), LEVEL[t.level]),
        // the quip is the line people remember; the plain advice sits right next to it
        el('b', { text: t.quip || t.title }), t.quip ? el('span', { class: 'plain', text: t.title }) : null),
      el('div', { class: 'tip-body' },
        el('p', { text: t.text }),
        basis.length ? el('div', { class: 'basis' }, el('div', { class: 'lbl', text: '依据' }),
          basis.map((x) => el('p', null, el('b', { text: x.name }), ' ',
            el('span', { class: 'pill', title: (REF.grades || {})[x.grade] || '', text: '证据 ' + x.grade }), ' ', x.range, ' ',
            el('button', { class: 'link', type: 'button', text: '看出处', onclick: () => ui.gotoRef(x.id) })))) : null));
  }
  function tipsNode(r, ui) {
    if (!r.tips.length) return null;
    const first = r.tips.slice(0, 3), rest = r.tips.slice(3);
    const box = el('div', { class: 'tips' }, first.map((t) => tipNode(t, ui)));
    if (rest.length) {
      box.append(el('details', { class: 'more' }, el('summary', { text: `还有 ${rest.length} 条` }), rest.map((t) => tipNode(t, ui))));
    }
    return box;
  }

  // ------------------------------------------------------------------ the seven days
  function dayTable(r, ui) {
    const P = (INDICATOR.get('sleep_duration') || {}).params || {};
    let hp = false;                                       // a headphone column only for weeks with listening
    for (let d = r.start; d <= r.end; d++) if (D.listenMin && D.listenMin[d]) hp = true;
    const rows = [];
    for (let d = r.end; d >= r.start; d--) {
      const ws = W.filter((w) => w.d === d);
      const out = A.vitalsOut ? A.vitalsOut[d] : null;
      const off = [out != null && out >= (VITALS.min_outliers || 2) ? HD.nightSignals(d).join('、') : '', HD.nightHr(d)]
        .filter(Boolean).join('；');
      const judged = out != null || (A.hrRun && A.hrRun[d] != null);
      const note = NOTES.get(d);
      const cut = D.sleepCut && D.sleepCut[d];
      const apart = D.sleepNap && D.sleepNap[d] >= 0.5 ? `（其中 ${hm(D.sleepNap[d])} 在另一段）` : '';
      const sleep = D.sleepTotal[d] == null ? '–' : hm(D.sleepTotal[d]) + (cut ? '（记录可能不完整）' : apart);
      rows.push(el('tr', { class: 'go', tabindex: '0', title: '查看这一天', onclick: () => ui.gotoDay(DAYS[d]),
        onkeydown: (e) => { if (e.key === 'Enter') ui.gotoDay(DAYS[d]); } },
        el('td', { text: DAYS[d].slice(5) + ' ' + WEEKDAY[DOW[d]] }),
        el('td', { class: D.sleepTotal[d] != null && !cut && D.sleepTotal[d] < (P.short_night_hours || 6) ? 'mark' : '', text: sleep }),
        el('td', { text: D.bedtime[d] == null ? '–' : clock(D.bedtime[d]) + ' – ' + clock(D.waketime[d]) }),
        el('td', { text: D.steps[d] == null ? '–' : num(D.steps[d]) }),
        el('td', { text: D.exerciseMin[d] == null ? '–' : num(D.exerciseMin[d]) }),
        hp ? el('td', { text: D.listenMin[d] ? mins(D.listenMin[d]) : '–' }) : null,
        el('td', { class: 'l', text: ws.length ? ws.map((w) => w.type + ' ' + mins(w.min)).join('、') : '–' }),
        el('td', { class: 'l' + (off ? ' mark' : ''), style: 'white-space:normal;min-width:13em', text: off || (judged ? '和平时一样' : '–') }),
        el('td', { class: 'l' }, note ? [note.tags.map((t) => el('span', { class: 'pill', text: t })), note.note ? ' ' + note.note : ''] : '')));
    }
    return el('div', { class: 'tablewrap', style: 'border-top:0;margin-top:6px;max-height:none' },
      el('table', null,
        el('thead', null, el('tr', null, ['日期', '睡眠', '入睡 – 醒来', '步数', '锻炼分钟'].concat(hp ? ['耳机'] : []).map((c) => el('th', { text: c })),
          ['训练', '夜间体征', '你的标注'].map((c) => el('th', { class: 'l', text: c })))),
        el('tbody', null, rows)));
  }

  // ------------------------------------------------------------------ charts
  /** night-time HRV: each night, its 7-day mean, and the personal band that mean is judged against */
  const hrvChart = (r) => (ctx) => {
    const T = ctx.T, a = Math.max(0, r.end - HISTORY * 7 + 1), b = r.end;
    const cut = (arr) => (arr || []).slice(a, b + 1);
    const labels = DAYS.slice(a, b + 1), night = cut(D.sleepHrv), mean = cut(A.hrv7), lo = cut(A.hrvLo), hi = cut(A.hrvHi);
    if (!mean.some((v) => v != null)) return { empty: true };
    const c = { T, a, b };
    const wash = { type: 'line', stack: 'band', showSymbol: false, silent: true, z: 1, lineStyle: { opacity: 0 }, emphasis: { disabled: true } };
    const option = Object.assign(baseOption(c), {
      xAxis: xAxis(labels, c, false),
      yAxis: yAxis(c, {}),
      tooltip: tooltip(c, (i) => ttDom(labels[i] + ' ' + WEEKDAY[DOW[a + i]], [
        { name: '7 日均值', value: mean[i] == null ? null : num(mean[i], 1) + ' ms', color: T.s[0] },
        { name: '个人平稳带', value: lo[i] == null ? null : num(lo[i], 1) + ' – ' + num(hi[i], 1) + ' ms', color: T.s[0], box: true },
        { name: '当晚读数', value: night[i] == null ? null : num(night[i], 1) + ' ms', color: T.n1 },
      ], mean[i] != null && lo[i] != null ? (mean[i] < lo[i] ? '7 日均值低于平稳带' : mean[i] > hi[i] ? '7 日均值高于平稳带' : '7 日均值在平稳带内') : null)),
      series: [
        Object.assign({ name: '个人平稳带', data: lo, itemStyle: { color: T.s[0] } }, wash),
        Object.assign({ name: '个人平稳带', data: hi.map((v, i) => (v == null || lo[i] == null ? null : v - lo[i])), areaStyle: { color: T.s[0], opacity: 0.13 }, itemStyle: { color: T.s[0] } }, wash),
        {
          name: '当晚读数', type: 'line', data: night, showSymbol: false, z: 3,
          lineStyle: { width: 1, color: T.n2, join: 'round' }, itemStyle: { color: T.n1 }, emphasis: { disabled: true },
          markArea: {
            silent: true, itemStyle: { color: T.band },
            label: { show: true, position: 'insideTop', color: T.muted, fontSize: 10, formatter: '这 7 天' },
            data: [[{ xAxis: DAYS[r.start] }, { xAxis: DAYS[r.end] }]],
          },
        },
        {
          name: '7 日均值', type: 'line', data: mean, showSymbol: false, z: 5,
          lineStyle: { width: 2, color: T.s[0], join: 'round', cap: 'round' }, itemStyle: { color: T.s[0] }, emphasis: { disabled: true },
          markPoint: endPoint(labels, mean, T.s[0], c, (v) => num(v, 1)),
        },
      ],
    });
    const rows = [];
    for (let i = labels.length - 1; i >= 0; i--) {
      if (night[i] == null && mean[i] == null) continue;
      rows.push([labels[i], night[i] == null ? '–' : num(night[i], 1), mean[i] == null ? '–' : num(mean[i], 1),
        lo[i] == null ? '–' : num(lo[i], 1) + ' – ' + num(hi[i], 1)]);
    }
    return {
      option, drill: true,
      legend: [{ name: '7 日均值', color: T.s[0], line: true }, { name: '当晚读数', color: T.n1, line: true }, { name: '个人平稳带', color: T.s[0], wash: true }],
      table: { cols: ['日期', '当晚读数（ms）', '7 日均值', '个人平稳带'], rows },
    };
  };
  /** training load of each report's seven days against the weekly average of the four weeks before */
  const loadChart = (k) => (ctx) => {
    const T = ctx.T, list = REPORTS.slice(Math.max(0, k - HISTORY + 1), k + 1);
    const load = list.map((x) => x.load.load7), base = list.map((x) => x.load.base);
    if (!load.some((v) => v)) return { empty: true };
    const labels = list.map((x) => DAYS[x.end]);
    const c = { T, a: list[0].end, b: list[list.length - 1].end };
    const option = Object.assign(baseOption(c, { right: 12 }), {
      xAxis: xAxis(labels, c, true),
      yAxis: yAxis(c, { zero: true }),
      tooltip: tooltip(c, (i) => ttDom('截至 ' + labels[i], [
        { name: '这 7 天的负荷', value: load[i] == null ? null : num(load[i]), color: i === list.length - 1 ? T.s[0] : T.soft, box: true },
        { name: '此前四周的周均', value: base[i] == null ? null : num(base[i]), color: T.ink2 },
      ], list[i].load.ratio == null ? list[i].load.label : '相当于此前周均的 ' + num(list[i].load.ratio, 2) + ' 倍'), { shadow: true }),
      series: [
        {
          name: '这 7 天的负荷', type: 'bar', barMaxWidth: 24, barMinWidth: 1, emphasis: { disabled: true },
          data: load.map((v, i) => ({ value: v, itemStyle: { color: i === list.length - 1 ? T.s[0] : T.soft, borderRadius: [4, 4, 0, 0] } })),
        },
        {
          name: '此前四周的周均', type: 'line', data: base, step: 'middle', showSymbol: false, connectNulls: true, z: 4,
          lineStyle: { width: 1, color: T.ink2 }, itemStyle: { color: T.ink2 }, emphasis: { disabled: true },
        },
      ],
    });
    return {
      option,
      legend: [{ name: '这 7 天的负荷', color: T.s[0] }, { name: '此前四周的周均', color: T.ink2, line: true }],
      table: {
        cols: ['截至', '这 7 天的负荷', '此前四周的周均', '相当于'],
        rows: list.slice().reverse().map((x) => [DAYS[x.end], x.load.load7 == null ? '–' : num(x.load.load7), x.load.base == null ? '–' : num(x.load.base),
          x.load.ratio == null ? x.load.label : num(x.load.ratio, 2) + ' 倍']),
      },
    };
  };

  // ------------------------------------------------------------------ the four sections
  function sleepCard(r) {
    const s = r.sleep, need = ((H.analysis || {}).params || {}).sleepNeed;
    const part = (key) => s.parts.find((p) => p.key === key) || {};
    const sri = s.sri != null ? s.sri : s.sri28;
    return sectionCard('睡眠', '对照指南的完成度：时长 60 分，规律 40 分', scoreFigure(s),
      el('div', { class: 'meters' },
        meter('时长', part('duration').points, 60, s.mean == null ? '这 7 天有睡眠记录的夜晚不足 4 晚' : `平均每晚 ${hm(s.mean)} · 达到 7 小时得满分`),
        meter('规律', part('regularity').points, 40, sri == null ? '相邻两天都有睡眠记录的不足 5 对' : `作息规律指数 ${num(sri, 1)}${s.sri == null ? '（近四周）' : ''} · 参照人群的中位数约 81`)),
      facts([
        s.bed != null && ['平均入睡 / 醒来', clock(s.bed) + ' / ' + clock(s.wake)],
        s.bedSd != null && ['入睡时间的波动', s.bedSd + ' 分钟'],
        s.durSd != null && ['睡眠时长的波动', s.durSd + ' 分钟'],
        s.short != null && ['不足 6 小时的夜晚', s.short + ' 晚（共 ' + s.nights + ' 晚有记录）'],
        s.cut ? ['记录可能不完整', s.cut + ' 晚，未计入'] : null,
        s.debt != null && ['近 14 天相对需求', (s.debt > 0 ? '少睡 ' : '多睡 ') + num(Math.abs(s.debt), 1) + ' 小时' + (need ? `（按每晚 ${num(need, 1).replace('.0', '')} 小时）` : '')],
      ]));
  }
  function activityCard(r) {
    const a = r.activity;
    const part = (key) => a.parts.find((p) => p.key === key) || {};
    const effort = a.source === 'effort';
    const minutes = a.exercise == null ? '没有手表的强度或锻炼记录'
      : effort ? `7 天合计约 ${num(a.exercise)} 分钟（中等 ${num(a.moderate)} + 高强度 ${num(a.vigorous)} × 2）· 150 分钟得满分`
        : `7 天合计约 ${num(a.exercise)} 分钟（按锻炼分钟）· 150 分钟得满分`;
    const extra = [
      a.concentrated && ['活动的分布', `${num(100 * a.topShare)}% 集中在两天里完成；研究发现，每周达标时集中练和分散练获益相近`],
      a.bursts != null && ['生活里的高强度片段', `日均 ${num(a.bursts, 1)} 次（训练以外 1–3 分钟）`],
    ].filter(Boolean);
    return sectionCard('日常活动', '对照指南的完成度：步数 40 分，中高强度 40 分，力量训练 20 分', scoreFigure(a),
      el('div', { class: 'meters' },
        meter('步数', part('steps').points, 40, a.steps == null ? '没有步数记录' : `日均 ${num(a.steps)} 步 · 7,000 步得满分`),
        meter(effort ? '中高强度' : '运动分钟', part('exercise').points, 40, minutes),
        meter('力量训练', part('strength').points, 20, a.strength == null ? '没有训练记录' : `${a.strength} 天 · 2 天得满分`)),
      extra.length ? facts(extra) : null);
  }
  function recoveryCard(r, ui, ctx) {
    const v = r.recovery;
    const runs = v.hrRuns || [];
    const fact = [
      v.hrv7 != null && `夜间 HRV 的 7 日均值 ${num(v.hrv7, 1)} ms` + (v.hrvLo != null ? `，你的平稳带是 ${num(v.hrvLo, 1)} – ${num(v.hrvHi, 1)}` : ''),
      v.rhr7 != null && `静息心率 ${num(v.rhr7, 1)}` + (v.rhrBase != null ? `，基线 ${num(v.rhrBase, 1)}` : ''),
      ...runs.map((e) => `睡眠心率 ${md(e.start)} 起连续 ${e.nights} 晚比平时高出 ${HR_RISE} 次/分以上` + (e.ongoing ? '' : '，已回落')),
    ].filter(Boolean).join('；');
    return ui.card({
      title: '恢复', h: 220,
      desc: v.days ? `只和你自己比 · ${v.label}：${v.days} 天里有 ${v.steady} 天平稳` : '只和你自己比 · 需要戴着 Apple Watch 睡觉，积累约两个月的夜间数据后才有个人基线',
      emptyText: '还没有足够的夜间 HRV 数据',
      build: (c) => { const out = hrvChart(r)(c); if (!out.empty && fact) out.note = fact; return out; },
    }, ctx);
  }
  function loadCard(r, k, ui, ctx) {
    const l = r.load;
    const fact = l.load7 == null ? '' : `这 7 天训练 ${l.sessions} 次，共 ${mins(l.minutes)}` +
      (l.ratio != null ? `；负荷相当于此前四周周均的 ${num(l.ratio, 2)} 倍` : '');
    return ui.card({
      title: '训练负荷', h: 220,
      desc: '只和你自己比 · ' + l.label + (l.since != null && l.since > 0 ? ` · 距上次训练 ${l.since} 天` : ''),
      emptyText: '没有训练记录',
      build: (c) => { const out = loadChart(k)(c); if (!out.empty && fact) out.note = fact; return out; },
    }, ctx);
  }

  // ------------------------------------------------------------------ history
  function historyTable(k, ui) {
    const rows = [];
    for (let i = REPORTS.length - 1; i >= 0; i--) {
      const x = REPORTS[i];
      rows.push(el('tr', { class: 'go' + (i === k ? ' on' : ''), tabindex: '0', onclick: () => ui.showReport(i),
        onkeydown: (e) => { if (e.key === 'Enter') ui.showReport(i); } },
        el('td', { text: DAYS[x.end] + (x.sunday ? '' : '（最新）') }),
        el('td', { text: x.sleep.score == null ? '–' : String(x.sleep.score) }),
        el('td', { text: x.activity.score == null ? '–' : String(x.activity.score) }),
        el('td', { class: 'l', text: x.recovery.days ? `${x.recovery.label} ${x.recovery.steady}/${x.recovery.days}` : '–' }),
        el('td', { class: 'l', text: x.load.label }),
        el('td', { class: 'l', text: x.tips.map((t) => t.quip || t.title).join('；') || '没有需要调整的' })));
    }
    return el('div', { class: 'tablewrap', style: 'border-top:0;margin-top:6px' },
      el('table', null,
        el('thead', null, el('tr', null, ['截至', '睡眠分', '活动分'].map((c) => el('th', { text: c })),
          ['恢复（平稳天数）', '训练负荷', '建议'].map((c) => el('th', { class: 'l', text: c })))),
        el('tbody', null, rows)));
  }

  // ------------------------------------------------------------------ the tab
  HD.reportTab = (ctx, ui) => {
    if (!REPORTS.length) {
      return [el('div', { class: 'empty', style: 'min-height:200px', text: '数据还不够生成周报：至少需要连续 7 天的记录。' })];
    }
    const k = Math.max(0, Math.min(REPORTS.length - 1, ui.state.report == null ? REPORTS.length - 1 : ui.state.report));
    const r = REPORTS[k], prev = k > 0 ? REPORTS[k - 1] : null;
    const go = (to) => () => ui.showReport(to);
    const bar = el('div', { class: 'daybar' },
      el('button', { class: 'ghost', type: 'button', text: '← 上一期', onclick: go(k - 1), disabled: k === 0 }),
      el('b', { class: 'when', text: span(r) }),
      el('button', { class: 'ghost', type: 'button', text: '下一期 →', onclick: go(k + 1), disabled: k === REPORTS.length - 1 }),
      el('button', { class: 'ghost', type: 'button', text: '最新', onclick: go(REPORTS.length - 1), disabled: k === REPORTS.length - 1 }),
      el('span', { class: 'span', text: (r.sunday ? '周一到周日' : '最近 7 天') + (r.partial ? ' · 最后一天是导出当天，步数等还不完整' : '') }));

    // with a title card above (the page's film), the headline is already its subtitle
    const filmed = !!(HD.film && HD.film('report'));
    const tips = tipsNode(r, ui);
    const head = filmed
      ? (tips ? el('section', { class: 'card s12 report-head filmed' }, el('div', { class: 'tips-head', text: '这周的建议' }), tips) : null)
      : el('section', { class: 'card s12 report-head' }, el('h2', { text: r.headline }), tips);

    const rec = r.recovery, load = r.load;
    const tilesRow = el('div', { class: 'tiles four' },
      tile('恢复', rec.label, '', rec.days ? `${rec.days} 天里有 ${rec.steady} 天平稳` : '需要约两个月的夜间数据',
        trail(k, (x) => (x.recovery.days ? x.recovery.steady / x.recovery.days : null))),
      tile('睡眠', r.sleep.score == null ? '–' : String(r.sleep.score), r.sleep.score == null ? '' : '分',
        r.sleep.score == null ? '有记录的夜晚不足 4 晚' : delta(r.sleep.score, prev && prev.sleep.score, prev, r.sleep.band) || '对照指南的完成度',
        trail(k, (x) => x.sleep.score)),
      tile('日常活动', r.activity.score == null ? '–' : String(r.activity.score), r.activity.score == null ? '' : '分',
        r.activity.score == null ? '数据不足' : delta(r.activity.score, prev && prev.activity.score, prev, r.activity.band) || '对照指南的完成度',
        trail(k, (x) => x.activity.score)),
      tile('训练负荷', load.label, '', load.ratio != null ? `此前四周周均的 ${num(load.ratio, 2)} 倍` : load.load7 ? `这 7 天 ${load.sessions} 次训练` : '',
        trail(k, (x) => x.load.load7)));

    return [
      bar, head, tilesRow,
      ui.section('四个方面'),
      el('div', { class: 'grid' }, recoveryCard(r, ui, ctx), sleepCard(r), activityCard(r), loadCard(r, k, ui, ctx)),
      ui.section('长期变化'),
      el('div', { class: 'grid' }, el('section', { class: 'card s12' },
        el('div', { class: 'card-head' }, el('div', null, el('h3', { text: '近 1 到 6 个月' }),
          el('p', { class: 'desc', text: '只有持续了一段时间的变化才会列为“值得留意”；单独一晚或一周不会' }))),
        el('div', { class: 'longs' }, HD.longRows(r, ui)),
        el('p', { class: 'desc', style: 'margin-top:12px' }, '要去看医生的话，可以带上 ',
          el('button', { class: 'link', type: 'button', text: '给医生的小结', onclick: () => ui.goto('summary') }), '，里面是近三个月的记录，可以打印。'))),
      ui.section('这 7 天'),
      el('div', { class: 'grid' }, el('section', { class: 'card s12' },
        el('div', { class: 'card-head' }, el('div', null, el('h3', { text: '逐日记录' }), el('p', { class: 'desc', text: '点某一行查看那一天的详情' }))),
        dayTable(r, ui))),
      ui.section('往期'),
      el('div', { class: 'grid' }, el('section', { class: 'card s12' },
        el('div', { class: 'card-head' }, el('div', null, el('h3', { text: '每一期的结果' }), el('p', { class: 'desc', text: '每个周日一期，外加最新的 7 天；点某一行切换到那一期' }))),
        historyTable(k, ui))),
      el('div', { class: 'callout', style: 'margin-top:18px' },
        '睡眠和日常活动能对照指南算完成度，所以有分数；恢复和训练负荷只能和你自己的过去比，所以只给状态。每个数字怎么来的、依据是什么，见 ',
        el('button', { class: 'link', type: 'button', text: '数据说明', onclick: () => ui.gotoRef(null) }),
        '。这些内容帮你了解自己的身体，不是诊断；没有提示不等于没有问题。'),
    ];
  };
})();
