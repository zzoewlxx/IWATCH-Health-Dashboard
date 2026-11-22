/* Two reference pages: a printable summary for a doctor's visit, and a look back at how the rules behaved. */
(function () {
  'use strict';
  const HD = window.HD;
  if (!HD || !HD.H) return;
  const { H, DAYS, D, el, num, clock, hm, meanOf, WEEKDAY, DOW, shortSource, xAxis, ttDom, tooltip } = HD;
  const REPORTS = H.reports || [];
  const A = (H.analysis || {}).daily || {};
  const W = H.workouts || [];
  const NOTES = new Map((H.annotations || []).map((e) => [e.d, e]));
  const INDICATOR = new Map(((H.reference || {}).indicators || []).map((x) => [x.id, x]));

  const table = (cols, rows, left = 1) => el('div', { class: 'tablewrap', style: 'border-top:0;margin-top:6px;max-height:none' },
    el('table', null,
      el('thead', null, el('tr', null, cols.map((c, i) => el('th', { class: i < left ? 'l' : '', text: c })))),
      el('tbody', null, rows.map((r) => el('tr', { class: r.on ? 'on' : '' }, r.map((c, i) => el('td', { class: i < left ? 'l' : '' }, c == null ? '–' : c)))))));
  const box = (title, desc, ...body) => el('section', { class: 'card s12' },
    el('div', { class: 'card-head' }, el('div', null, el('h3', { text: title }), desc && el('p', { class: 'desc', text: desc }))), ...body);
  const noteText = (d) => { const e = NOTES.get(d); return e ? e.tags.join('、') + (e.note ? '：' + e.note : '') : ''; };
  const dateLabel = (d) => DAYS[d] + ' ' + WEEKDAY[DOW[d]];

  // ------------------------------------------------------------------ summary for a doctor's visit
  const VITAL_ROWS = [
    ['静息心率', 'rhr', 0, '次/分'], ['睡眠平均心率', 'sleepHr', 0, '次/分'], ['夜间 HRV（SDNN）', 'sleepHrv', 0, 'ms'],
    ['睡眠呼吸频率', 'resp', 1, '次/分'], ['睡眠血氧', 'sleepSpo2', 1, '%'], ['睡眠手腕温度', 'wristTemp', 2, '°C'],
    ['睡眠呼吸紊乱', 'breathDist', 1, '次/小时'], ['体重', 'weight', 1, 'kg'], ['最大摄氧量（估算）', 'vo2max', 1, 'ml/kg·min'],
  ];
  function span(arr, a, b) {
    let lo = null, hi = null, n = 0;
    for (let i = Math.max(0, a); i <= b; i++) {
      const v = (arr || [])[i];
      if (v == null) continue;
      n++; lo = lo == null ? v : Math.min(lo, v); hi = hi == null ? v : Math.max(hi, v);
    }
    return { lo, hi, n };
  }
  HD.summaryTab = (ctx, ui) => {
    if (!REPORTS.length) return [el('div', { class: 'empty', style: 'min-height:200px', text: '数据还不够生成小结。' })];
    const r = REPORTS[REPORTS.length - 1], end = r.end;
    const a90 = Math.max(0, end - 89), a30 = Math.max(0, end - 29), p1 = a30 - 1;
    const m = H.meta, sex = { male: '男', female: '女' }[m.profile.sex];
    const who = [sex, m.profile.age != null ? m.profile.age + ' 岁' : '', m.profile.heightCm ? m.profile.heightCm + ' cm' : ''].filter(Boolean).join(' · ');
    const devices = [...new Set(m.sources.map(shortSource))].slice(0, 4).join('、');

    const vitals = VITAL_ROWS.map(([name, key, dec, unit]) => {
      const s = span(D[key], a90, end);
      if (!s.n) return null;
      const recent = meanOf(D[key] || [], a30, end), prior = p1 >= a90 ? meanOf(D[key] || [], a90, p1) : null;
      return [name + '（' + unit + '）', recent == null ? '–' : num(recent, dec), prior == null ? '–' : num(prior, dec),
        num(s.lo, dec) + ' – ' + num(s.hi, dec), s.n + ' 天'];
    }).filter(Boolean);

    const count = (a, b, test) => { let n = 0; for (let i = Math.max(0, a); i <= b; i++) n += test(i) ? 1 : 0; return n; };
    const mean = (key, a, b, fmt) => { const v = a > b ? null : meanOf(D[key] || [], Math.max(0, a), b); return v == null ? '–' : fmt(v); };
    const works = (a, b) => W.filter((w) => w.d >= a && w.d <= b);
    const habit = (a, b) => [
      mean('sleepTotal', a, b, hm), mean('bedtime', a, b, clock) + ' / ' + mean('waketime', a, b, clock),
      count(a, b, (i) => D.sleepTotal[i] != null && D.sleepTotal[i] < 6) + ' 晚（共 ' + count(a, b, (i) => D.sleepTotal[i] != null) + ' 晚有记录）',
      mean('steps', a, b, (v) => num(v)), mean('exerciseMin', a, b, (v) => num(v)),
      works(a, b).length + ' 次，其中力量 ' + works(a, b).filter((w) => /Strength|Core/.test(w.key)).length + ' 次',
    ];
    const h30 = habit(a30, end), h60 = habit(a90, p1);
    const habits = ['平均睡眠时长', '平均入睡 / 醒来', '不足 6 小时的夜晚', '日均步数', '日均锻炼分钟', '训练记录']
      .map((name, i) => [name, h30[i], h60[i]]);
    const listen = (a, b) => {                            // daily listening and its energy-average level
      let m = 0, n = 0, e = 0;
      for (let i = Math.max(0, a); i <= b; i++) {
        const v = (D.listenMin || [])[i];
        if (v == null) continue;
        n++; m += v;
        if (v > 0 && D.headphone[i] != null) e += v * Math.pow(10, D.headphone[i] / 10);
      }
      return n && m > 0 ? hm(m / n / 60) + ' · ' + num(10 * Math.log10(e / m), 1) + ' 分贝' : n ? '没有用耳机' : '–';
    };
    if (D.listenMin && D.listenMin.slice(a90, end + 1).some((v) => v)) habits.push(['日均耳机收听 · 平均音量', listen(a30, end), listen(a90, p1)]);
    const tests = ((H.audio || {}).tests || []).slice().reverse();
    const hearing = tests.slice(0, 3).map((t) => [t.date + ' ' + t.time,
      t.pta[0] == null ? '–' : num(t.pta[0]) + ' dB HL（' + t.grade[0] + '）', t.pta[1] == null ? '–' : num(t.pta[1]) + ' dB HL（' + t.grade[1] + '）',
      t.device || t.src]);
    if (A.sri28 && A.sri28[end] != null) habits.push(['作息规律指数（0–100，越高越规律）', num(A.sri28[end], 1), a30 > 0 && A.sri28[a30 - 1] != null ? num(A.sri28[a30 - 1], 1) : '–']);

    const flagged = [];
    for (let d = end; d >= a90; d--) {
      if (A.vitalsOut && A.vitalsOut[d] >= 2) flagged.push([dateLabel(d), HD.nightSignals(d).join('、'), noteText(d) || noteText(d - 1)]);
    }
    const hrRule = (INDICATOR.get('night_hr_rise') || {}).params || { rise_bpm: 4, min_nights: 2 };
    const hrRuns = ((H.analysis || {}).hrRuns || []).filter((e) => e.end >= a90 && e.start <= end).reverse()
      .map((e) => [DAYS[e.start] + ' 至 ' + DAYS[e.end].slice(5), e.nights + ' 晚', '+' + num(e.rise, 1) + ' 次/分（平时约 ' + num(e.base, 0) + '）',
        e.members.map((d) => noteText(d) || noteText(d - 1)).filter(Boolean).join('；')]);
    const ecgs = (H.ecg || []).filter((e) => e.d > end - 180 && e.d <= end).reverse()
      .map((e) => [e.date + ' ' + e.time, e.cls, e.hr == null ? '–' : e.hr + ' 次/分（估算）']);
    const marks = [];
    for (let d = end; d >= a90; d--) if (NOTES.has(d)) marks.push([dateLabel(d), NOTES.get(d).tags.join('、'), NOTES.get(d).note]);

    const head = el('section', { class: 'card s12 report-head' },
      el('h2', { text: '健康记录小结' }),
      el('p', { class: 'desc', text: `${DAYS[a90]} 至 ${DAYS[end]}（近 90 天）` + (who ? ' · ' + who : '') + (devices ? ' · 数据来源：' + devices : '') }),
      el('p', { class: 'desc', text: '由可穿戴设备自动记录并整理，不是医疗级测量，也不是诊断。数值适合用来看一段时间里的变化。' }),
      el('div', { class: 'noprint', style: 'margin-top:12px' },
        el('button', { class: 'ghost', type: 'button', text: '打印 / 存为 PDF', onclick: () => window.print() })));

    return [el('div', { class: 'grid printable' },
      head,
      box('主要指标', '近 30 天的平均值，对比再往前 60 天；范围是近 90 天里单日的最低和最高',
        vitals.length ? table(['指标', '近 30 天平均', '此前 60 天平均', '近 90 天范围', '有数据'], vitals)
          : el('div', { class: 'empty', text: '近 90 天没有这些指标的记录' })),
      box('睡眠与活动', null, table(['', '近 30 天', '此前 60 天'], habits)),
      box('长期变化检查', '只有持续了一段时间的变化才会列为“值得留意”', el('div', { class: 'longs' }, HD.longRows(r, null))),
      box('多项夜间体征同时偏离的夜晚', '近 90 天；指同一晚有两项以上明显偏离本人此前四周的常态',
        flagged.length ? table(['日期（醒来那天）', '偏离的体征', '本人标注'], flagged, 3) : el('p', { class: 'desc', style: 'margin-top:10px', text: '近 90 天没有出现。' })),
      box('睡眠心率连续偏高', `近 90 天；指连续 ${hrRule.min_nights} 晚以上比本人此前各晚的中位数高出 ${hrRule.rise_bpm} 次/分以上`,
        hrRuns.length ? table(['日期（醒来那天）', '晚数', '最多高出', '本人标注'], hrRuns, 1) : el('p', { class: 'desc', style: 'margin-top:10px', text: '近 90 天没有出现。' })),
      box('心电图记录', '近 180 天；分类来自 Apple 的心电图 App（单导联）',
        ecgs.length ? table(['时间', '分类', '心率'], ecgs, 2) : el('p', { class: 'desc', style: 'margin-top:10px', text: '近 180 天没有心电图记录。' })),
      hearing.length ? box('听力测试', '最近 ' + hearing.length + ' 次（不限于近 90 天）；每只耳朵 500、1000、2000、4000 Hz 的平均听阈，自测结果，不是临床听力检查',
        table(['时间', '左耳', '右耳', '设备'], hearing, 1)) : null,
      marks.length ? box('本人标注', '近 90 天', table(['日期', '标签', '备注'], marks, 3)) : null,
    )];
  };

  // ------------------------------------------------------------------ backtest
  const TIP_NAME = {
    vitals: '夜间身体信号和平时不一样', hrv_low: '这几天把强度降一档', rhr_high: '静息心率比平时高', sleep_short: '睡得偏少，补一补',
    sleep_below: '睡眠时长略低于建议', load_up: '这周加量有点快', load_restart: '刚恢复训练，慢慢来', sleep_irregular: '把作息固定下来',
    steps_low: '每天多走一走', activity_low: '这周活动量偏少', training_gap: '有一阵没训练了', strength_low: '加一次力量训练',
    headphone_loud: '这周耳机音量偏大', hr_run: '睡眠心率连续几晚比平时高',
  };
  /** the same suggestions as the weekly report's quips, without the numbers that change week to week */
  const TIP_QUIP = {
    vitals: '身体盘面异动，先别加仓', hrv_low: '恢复指数连跌，减仓观望', rhr_high: '静息心率高位站岗', sleep_short: '睡眠账户亏损，逢低补仓',
    sleep_below: '重点关注睡眠 ETF', load_up: '训练杠杆加太猛，当心爆仓', load_restart: '重新建仓，先轻仓试水', sleep_irregular: '作息 K 线上蹿下跳',
    steps_low: '步数跌破均线，每天定投', activity_low: '运动成交量萎缩，小额加仓', training_gap: '被沙发套牢，择机复牌', strength_low: '三倍做多力量训练',
    headphone_loud: '耳机音量高位运行，逢高减仓', hr_run: '心率夜盘连续高开，先别加仓',
  };
  function tally(list) {
    const rows = new Map();
    const add = (id, name, x, level) => {
      const t = rows.get(id) || { id, name, n: 0, last: null, level, weeks: [] };
      t.n++; t.last = x.r.end; t.weeks.push(x.r.end);
      rows.set(id, t);
    };
    for (const x of list) {
      for (const t of x.r.tips) add(t.id, TIP_NAME[t.id] || t.title, x, t.level);
      for (const c of x.r.long || []) if (c.state === 'note') add(c.id, c.name + '（长期）', x, 3);
    }
    return [...rows.values()].sort((p, q) => q.n - p.n);
  }
  /** one row per suggestion, one column per weekly report: a filled cell where it was given */
  const gridChart = (list, rows) => (ctx) => {
    const T = ctx.T, labels = list.map((x) => DAYS[x.r.end]), names = rows.map((t) => t.name).reverse();
    const col = new Map(list.map((x, i) => [x.r.end, i]));
    const data = [];
    rows.forEach((t) => t.weeks.forEach((end) => data.push([col.get(end), names.indexOf(t.name), 1])));
    const c = { T, a: list[0].r.end, b: list[list.length - 1].r.end };
    return {
      option: {
        animation: false, textStyle: { fontFamily: HD.FONT },
        grid: { left: 4, right: 12, top: 8, bottom: 2, containLabel: true },
        xAxis: Object.assign(xAxis(labels, c, true), { splitArea: { show: false } }),
        yAxis: {
          type: 'category', data: names, axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: T.ink2, fontSize: 12 }, splitLine: { show: true, lineStyle: { color: T.grid } },
        },
        visualMap: { show: false, min: 0, max: 1, inRange: { color: [T.s[0], T.s[0]] } },
        tooltip: tooltip(c, (p) => ttDom('截至 ' + labels[p.value[0]], [{ name: names[p.value[1]], value: '给出', color: T.s[0], box: true }]), { item: true }),
        series: [{
          type: 'heatmap', data, itemStyle: { borderColor: T.surface, borderWidth: 2, borderRadius: 2 },
          emphasis: { itemStyle: { borderColor: T.ink, borderWidth: 1 } },
        }],
      },
      table: {
        cols: ['建议', '次数', '出现在（截至日期）'],
        rows: rows.map((t) => [t.name, String(t.n), t.weeks.map((e) => DAYS[e].slice(2)).reverse().join('、')]),
      },
    };
  };
  const unitOf = { night_vitals: ' 个标准差', night_hr_rise: ' 次/分', hrv_night: ' 天', sleep_duration: ' 小时', sleep_timing_variability: ' 分钟', steps: ' 步', training_load: ' 倍', sleep_debt: ' 小时' };

  HD.backtestTab = (ctx, ui) => {
    const B = H.backtest;
    const list = REPORTS.map((r, k) => ({ r, k })).filter((x) => x.r.sunday);
    if (!B || !list.length) return [el('div', { class: 'empty', style: 'min-height:200px', text: '数据还不够做回测：至少需要一期完整的周报。' })];
    const rows = tally(list), quiet = list.filter((x) => !x.r.tips.length).length;

    const freq = box('每条建议出现过多少次', `共 ${list.length} 期周报（每个周日一期），其中 ${quiet} 期没有任何建议`,
      rows.length ? table(['建议', '说的是', '次数', '占比', '最近一次（截至）'],
        rows.map((t) => [TIP_QUIP[t.id] || t.name, TIP_QUIP[t.id] ? t.name : '', t.n + ' 期', num(100 * t.n / list.length) + '%', DAYS[t.last]]), 2)
        : el('p', { class: 'desc', text: '还没有给出过建议。' }));
    const grid = rows.length ? ui.card({
      title: '什么时候给出的', desc: '每一列是一期周报，有色的格子表示那一期给出了这条建议', span: 12, h: 46 + rows.length * 24,
      build: gridChart(list, rows),
    }, ctx) : null;

    const variants = B.variants.map((v) => {
      const ind = INDICATOR.get(v.indicator);
      return el('section', { class: 'card s4' },
        el('div', { class: 'card-head' }, el('div', null, el('h3', { text: v.label }),
          el('p', { class: 'desc', text: `${v.counts}（共 ${num(v.of)} ${v.unit}）` + (ind ? ' · ' + ind.name : '') }))),
        table(['界线', '次数', '占比'], v.rows.map((x) => Object.assign(
          [num(x.value, x.value % 1 ? 1 : 0) + (unitOf[v.indicator] || '') + (x.current ? '（当前）' : ''), x.count + ' ' + v.unit,
            v.of ? num(100 * x.count / v.of, 1) + '%' : '–'], { on: x.current }))));
    });

    const N = B.annotations, flagged = N.flagged.slice().reverse();
    const signalCols = Object.keys(((INDICATOR.get('night_vitals') || {}).params || {}).signals || {});
    const zName = { sleepHr: '睡眠心率', sleepHrv: 'HRV', resp: '呼吸', wristTemp: '腕温', sleepSpo2: '血氧' };
    const hrRule = (INDICATOR.get('night_hr_rise') || {}).params || { rise_bpm: 4 };
    const notes = N.annotated
      ? [box('你标注的日子，身体信号有没有跟着变', `共标注 ${N.annotated} 天。“当晚或次晚被标出”指那两晚里有一晚出现了多项体征同时偏离；“睡眠心率偏高”指那两晚里有一晚比平时高出 ${hrRule.rise_bpm} 次/分以上`,
        table(['标签', '标注天数', '能判断的', '当晚或次晚被标出', '睡眠心率偏高', ...signalCols.map((k) => zName[k] + '平均偏离')],
          N.tags.map((t) => [t.tag, String(t.days), String(t.judged), t.judged ? `${t.hits} 天（${num(100 * t.hits / t.judged)}%）` : '–',
            t.hrJudged ? `${t.hrHits} 天（${num(100 * t.hrHits / t.hrJudged)}%）` : '–',
            ...signalCols.map((k) => (t.z[k] == null ? '–' : (t.z[k] > 0 ? '+' : '−') + num(Math.abs(t.z[k]), 1)))])),
        el('p', { class: 'desc', style: 'margin-top:10px', text: '平均偏离的单位是标准差，相对你此前四周的常态；同一个标签至少要有 3 个可比的夜晚才计算。样本很少时只能当参考。' }))]
      : [];
    notes.push(box('被标出的夜晚', N.annotated ? '右边是你在那天或前一天写的标注' : '还没有标注。把这些夜晚的原因记进 标注.csv，下次更新后这里就能对照',
      flagged.length ? table(['日期（醒来那天）', '偏离的体征', '你的标注'],
        flagged.map((x) => [dateLabel(x.d), HD.nightSignals(x.d).join('、'), x.tags.join('、') + (x.note ? (x.tags.length ? '：' : '') + x.note : '')]), 3)
        : el('p', { class: 'desc', style: 'margin-top:10px', text: '到目前为止没有夜晚被标出。' })));
    const runs = (N.hrRuns || []).slice().reverse();
    notes.push(box('睡眠心率连续偏高的几次', `连续 2 晚以上比平时高出 ${hrRule.rise_bpm} 次/分；右边是你在这几晚或前一天写的标注。和上面的规则各算各的`,
      runs.length ? table(['日期（醒来那天）', '晚数', '最多高出', '你的标注'],
        runs.map((x) => [DAYS[x.start] + ' 至 ' + DAYS[x.end].slice(5), x.nights + ' 晚', '+' + num(x.rise, 1) + ' 次/分',
          x.tags.join('、') + (x.note ? (x.tags.length ? '：' : '') + x.note : '')]), 1)
        : el('p', { class: 'desc', style: 'margin-top:10px', text: '到目前为止没有出现。' })));

    return [
      el('div', { class: 'callout' }, '这一页回头看整段记录：每条建议出现得多不多，换一个界线会怎样，以及被标出的夜晚和你自己的标注对不对得上。界线都写在 pipeline/reference.json 里，改完重新运行更新，这一页就会跟着变。'),
      ui.section('建议出现的频率'),
      el('div', { class: 'grid' }, freq, grid),
      ui.section('换一个界线会怎样'),
      el('div', { class: 'grid' }, variants),
      ui.section('和你的标注对照'),
      el('div', { class: 'grid' }, notes),
    ];
  };
})();
