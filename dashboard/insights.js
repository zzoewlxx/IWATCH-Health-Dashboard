/* Insight views: calendar heatmap, baseline status, records & streaks, correlations, single day. */
(function () {
  'use strict';
  const HD = window.HD;
  if (!HD || !HD.H) return;
  const { H, DAYS, N, D, el, num, clock, hm, mins, pad, signed, buckets, meanOf, countOf,
    ttDom, tooltip, baseOption, yAxis, WEEKDAY, DOW, SEGS, STAGE_NAMES } = HD;
  const W = H.workouts;
  const I = window.HEALTH_INTRADAY || { hr: [], steps: [] };

  // ------------------------------------------------------------------ calendar heatmap
  /** spec: { key | values:()=>array, name, unit, fmt, zero }  — one row of weeks per year */
  const CAL_ROW = 124;
  HD.calendarHeight = (ctx) => 46 + CAL_ROW * (+DAYS[ctx.b].slice(0, 4) - +DAYS[ctx.a].slice(0, 4) + 1);
  HD.calendar = (spec) => (ctx) => {
    const T = ctx.T, arr = spec.values ? spec.values() : D[spec.key];
    const fmt = spec.fmt || ((v) => num(v, spec.dec || 0) + (spec.unit ? ' ' + spec.unit : ''));
    const data = [], vals = [];
    for (let i = ctx.a; i <= ctx.b; i++) if (arr[i] != null) { data.push([DAYS[i], arr[i]]); vals.push(arr[i]); }
    if (!vals.length) return { empty: true };
    vals.sort((p, q) => p - q);
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    let lo = spec.zero ? 0 : q(0.03), hi = q(0.97);
    if (hi <= lo) hi = lo + 1;
    const years = [];
    for (let y = +DAYS[ctx.a].slice(0, 4); y <= +DAYS[ctx.b].slice(0, 4); y++) years.push(String(y));
    const option = {
      animation: false, textStyle: { fontFamily: HD.FONT },
      visualMap: {
        type: 'continuous', min: lo, max: hi, calculable: false, orient: 'horizontal', right: 4, top: 0,
        itemWidth: 10, itemHeight: 140, text: [fmt(hi), fmt(lo)], textStyle: { color: T.muted, fontSize: 11 },
        inRange: { color: T.seq }, seriesIndex: years.map((_, k) => k),
      },
      calendar: years.map((y, k) => ({
        range: y, top: 52 + k * CAL_ROW, left: 52, right: 8, cellSize: ['auto', 13],
        splitLine: { show: false },
        itemStyle: { color: T.wash, borderColor: T.surface, borderWidth: 2 },
        yearLabel: { show: true, position: 'left', margin: 34, color: T.ink2, fontSize: 12, fontWeight: 600 },
        monthLabel: { nameMap: 'ZH', color: T.muted, fontSize: 11 },
        dayLabel: { firstDay: 1, nameMap: 'ZH', color: T.muted, fontSize: 10 },
      })),
      tooltip: tooltip(ctx, (p) => {
        const d = HD.indexOfDate(p.value[0]);
        return ttDom(p.value[0] + ' ' + WEEKDAY[DOW[d]], [{ name: spec.name, value: fmt(p.value[1]), color: p.color, box: true }]);
      }, { item: true }),
      series: years.map((y, k) => ({
        type: 'heatmap', coordinateSystem: 'calendar', calendarIndex: k,
        data: data.filter((r) => r[0].startsWith(y)),
        emphasis: { itemStyle: { borderColor: T.ink, borderWidth: 1 } },
      })),
    };
    return {
      option, drill: true,
      table: { cols: ['日期', spec.name], rows: data.slice().reverse().map((r) => [r[0], fmt(r[1])]) },
    };
  };
  const workoutMinutes = (() => {
    let cache = null;
    return () => {
      if (cache) return cache;
      cache = new Array(N).fill(null);
      for (const w of W) cache[w.d] = (cache[w.d] || 0) + w.min;
      return cache;
    };
  })();
  HD.workoutMinutes = workoutMinutes;

  // ------------------------------------------------------------------ baseline status
  const VITALS = [
    { key: 'rhr', name: '静息心率', unit: 'bpm', dec: 1, worse: 'up', better: 'down' },
    // sleep-window readings only: the all-day mean depends on when the watch happened to sample
    { key: 'sleepHrv', name: '睡眠期间 HRV', unit: 'ms', dec: 1, worse: 'down', better: 'up' },
    { key: 'sleepHr', name: '睡眠平均心率', unit: 'bpm', dec: 1, worse: 'up', better: 'down' },
    { key: 'resp', name: '睡眠呼吸频率', unit: '次/分', dec: 1, worse: 'up' },
    { key: 'wristTemp', name: '手腕温度', unit: '°C', dec: 2, worse: 'up' },
    { key: 'sleepSpo2', name: '睡眠血氧', unit: '%', dec: 1, worse: 'down' },
    { key: 'sleepTotal', name: '睡眠时长', fmt: hm, worse: 'down', better: 'up' },
  ];
  function stats(arr, i0, i1) {
    let s = 0, ss = 0, n = 0;
    for (let i = Math.max(0, i0); i <= i1; i++) if (arr[i] != null) { s += arr[i]; ss += arr[i] * arr[i]; n++; }
    if (!n) return { n: 0 };
    const mean = s / n;
    return { n, mean, sd: Math.sqrt(Math.max(0, ss / n - mean * mean)) };
  }
  /** last 7 days up to `end` vs the 28 days before them, one row per measure with enough data */
  HD.baselineRows = (end) => {
    const rows = [];
    for (const m of VITALS) {
      const arr = D[m.key];
      const recent = stats(arr, end - 6, end), base = stats(arr, end - 34, end - 7);
      if (recent.n < 3 || base.n < 10 || !base.sd) continue;
      const z = (recent.mean - base.mean) / base.sd;
      const dir = z > 0 ? 'up' : 'down', size = Math.abs(z);
      let state = 'in', label = '在基线内';
      if (size >= 1) {
        const word = (size >= 2 ? '明显' : '略') + (dir === 'up' ? '高于' : '低于') + '基线';
        if (dir === m.worse) { state = size >= 2 ? 'serious' : 'warn'; label = word + '，留意'; }
        else if (dir === m.better) { state = 'good'; label = word + '，向好'; }
        else { state = 'note'; label = word; }
      }
      rows.push({ m, recent, base, z, state, label });
    }
    return rows;
  };
  HD.baselineStatus = (ctx) => {
    const end = ctx.b, rows = HD.baselineRows(end);
    if (!rows.length) return { empty: true };
    const fmt = (m, v) => (m.fmt ? m.fmt(v) : num(v, m.dec) + ' ' + m.unit);
    const icon = { in: '●', good: '✓', warn: '▲', serious: '▲', note: '◆' };
    const table = el('table', { class: 'status' },
      el('thead', null, el('tr', null, ['指标', '最近 7 天', '基线（此前 28 天）', '相对基线的位置', '状态'].map((c, i) => el('th', { class: i === 0 || i >= 3 ? 'l' : '', text: c })))),
      el('tbody', null, rows.map((r) => {
        const pos = Math.max(2, Math.min(98, ((r.z + 3) / 6) * 100));
        return el('tr', null,
          el('td', { class: 'l', text: r.m.name }),
          el('td', null, el('b', { text: fmt(r.m, r.recent.mean) })),
          el('td', { text: fmt(r.m, r.base.mean - r.base.sd).replace(/ [^ ]+$/, r.m.fmt ? '$&' : '') + ' – ' + fmt(r.m, r.base.mean + r.base.sd) }),
          el('td', { class: 'l' }, el('div', { class: 'bullet', role: 'img', 'aria-label': `偏离基线 ${signed(r.z, 1)} 个标准差` },
            el('i', { class: 'band' }), el('i', { class: 'mid' }), el('i', { class: 'dot', style: `left:${pos}%` }))),
          el('td', { class: 'l' }, el('span', { class: 'state ' + r.state }, el('i', { text: icon[r.state] }), r.label)));
      })));
    const wrap = el('div', { class: 'tablewrap', style: 'border-top:0;margin-top:6px;max-height:none' }, table);
    return {
      node: el('div', null, wrap, el('p', { class: 'desc', style: 'margin-top:10px',
        text: `截至 ${DAYS[end]}。浅色带是基线均值 ± 1 个标准差，圆点是最近 7 天的均值；越靠近中线越接近你平时的水平。这只说明相对你自己近期的变化，不是医学判断。` })),
    };
  };

  // ------------------------------------------------------------------ records & streaks
  function extreme(arr, a, b, max) {
    let best = null;
    for (let i = a; i <= b; i++) {
      if (arr[i] == null) continue;
      if (best == null || (max ? arr[i] > arr[best] : arr[i] < arr[best])) best = i;
    }
    return best;
  }
  HD.records = (ctx) => {
    const rows = [];
    const add = (label, key, max, fmt) => {
      const i = extreme(D[key], ctx.a, ctx.b, max);
      if (i != null) rows.push([label, fmt(D[key][i]), DAYS[i] + ' ' + WEEKDAY[DOW[i]]]);
    };
    add('步数最多的一天', 'steps', true, (v) => num(v) + ' 步');
    add('活动能量最高的一天', 'activeKcal', true, (v) => num(v) + ' 千卡');
    add('锻炼时间最长的一天', 'exerciseMin', true, (v) => mins(v));
    add('走得最远的一天', 'distance', true, (v) => num(v, 2) + ' 公里');
    add('睡得最久的一晚', 'sleepTotal', true, hm);
    add('深睡最多的一晚', 'sleepDeep', true, hm);
    add('静息心率最低', 'rhr', false, (v) => num(v) + ' bpm');
    add('HRV 最高（日均）', 'hrv', true, (v) => num(v, 1) + ' ms');
    add('VO₂max 最高', 'vo2max', true, (v) => num(v, 1) + ' ml/kg·min');
    const ws = HD.workoutsIn(ctx.a, ctx.b);
    if (ws.length) {
      const longest = ws.reduce((p, w) => (w.min > p.min ? w : p));
      const hardest = ws.reduce((p, w) => ((w.kcal || 0) > (p.kcal || 0) ? w : p));
      rows.push(['单次训练最长', mins(longest.min) + ' · ' + longest.type, DAYS[longest.d] + ' ' + WEEKDAY[DOW[longest.d]]]);
      rows.push(['单次训练消耗最高', num(hardest.kcal) + ' 千卡 · ' + hardest.type, DAYS[hardest.d] + ' ' + WEEKDAY[DOW[hardest.d]]]);
    }
    if (!rows.length) return { empty: true };
    const wrap = el('div', { class: 'tablewrap', style: 'border-top:0;margin-top:6px;max-height:none' },
      el('table', null,
        el('thead', null, el('tr', null, ['纪录', '数值', '日期'].map((c) => el('th', { text: c })))),
        el('tbody', null, rows.map((r) => el('tr', null, r.map((c) => el('td', { text: c })))))));
    return { node: wrap };
  };

  /** current (ending at `end`) and longest run of consecutive true values in [a, end] */
  function streak(test, a, end) {
    let cur = 0, best = 0, bestEnd = -1, run = 0;
    for (let i = a; i <= end; i++) {
      if (test(i)) { run++; if (run > best) { best = run; bestEnd = i; } } else run = 0;
    }
    for (let i = end; i >= a && test(i); i--) cur++;
    return { cur, best, from: best ? bestEnd - best + 1 : -1, to: bestEnd };
  }
  HD.streaks = (ctx) => {
    // the export day is unfinished: judge "current" streaks up to the last complete day
    const end = DAYS[ctx.b] === H.meta.partialDay ? ctx.b - 1 : ctx.b;
    if (end < ctx.a) return { empty: true };
    const rows = [];
    const add = (label, test, unit = '天') => {
      const s = streak(test, ctx.a, end);
      if (!s.best) return;
      rows.push([label, s.cur + ' ' + unit, s.best + ' ' + unit, DAYS[s.from] + ' → ' + DAYS[s.to].slice(5)]);
    };
    add('连续合上「活动」圆环', (i) => D.activeKcal[i] != null && D.moveGoal[i] != null && D.activeKcal[i] >= D.moveGoal[i]);
    add('连续合上「锻炼」圆环', (i) => D.exerciseMin[i] != null && D.exerciseMin[i] >= (D.exerciseGoal[i] || 30));
    add('连续睡够 7 小时', (i) => D.sleepTotal[i] != null && D.sleepTotal[i] >= 7);
    add('连续每天 5,000 步以上', (i) => D.steps[i] != null && D.steps[i] >= 5000);
    const wm = workoutMinutes();
    add('连续每天都有训练', (i) => wm[i] != null);
    // weeks with at least 3 workouts
    const weeks = buckets(ctx.a, end, 'week').filter((b) => b.i1 - b.i0 === 6);
    if (weeks.length) {
      const n = weeks.map((b) => W.filter((w) => w.d >= b.i0 && w.d <= b.i1).length);
      const s = streak((k) => n[k] >= 3, 0, weeks.length - 1);
      if (s.best) rows.push(['连续每周训练 3 次以上', s.cur + ' 周', s.best + ' 周', DAYS[weeks[s.from].i0] + ' → ' + DAYS[weeks[s.to].i1].slice(5)]);
    }
    if (!rows.length) return { empty: true };
    const wrap = el('div', { class: 'tablewrap', style: 'border-top:0;margin-top:6px;max-height:none' },
      el('table', null,
        el('thead', null, el('tr', null, ['习惯', '当前连续', '最长连续', '最长那次'].map((c) => el('th', { text: c })))),
        el('tbody', null, rows.map((r) => el('tr', null, r.map((c) => el('td', { text: c })))))));
    return { node: wrap };
  };

  // ------------------------------------------------------------------ how big a change has to be
  const NZ = H.noise || { keys: {}, z: 1.96 };
  /** [key, name, how to show a size of change] — the readings people most often compare */
  const NOISE_ROWS = [
    ['rhr', '静息心率', (v) => num(v, 1) + ' 次/分'],
    ['sleepHr', '睡眠心率', (v) => num(v, 1) + ' 次/分'],
    ['sleepHrv', '睡眠 HRV', (v) => num(v, 1) + ' ms'],
    ['sleepTotal', '睡眠时长', (v) => mins(v * 60)],
    ['bedtime', '入睡时间', (v) => mins(v)],
    ['steps', '步数', (v) => num(v) + ' 步'],
    ['modMin', '中等强度', (v) => num(v) + ' 分钟'],
    ['weight', '体重', (v) => num(v, 2) + ' kg'],
    ['bodyFat', '体脂率', (v) => num(v, 1) + ' 个百分点'],
    ['vo2max', 'VO₂max', (v) => num(v, 1) + ' ml/kg·min'],
    ['resp', '呼吸频率', (v) => num(v, 2) + ' 次/分'],
    ['wristTemp', '手腕温度', (v) => num(v, 2) + ' °C'],
  ];
  HD.noiseTable = () => {
    const z = NZ.z || 1.96;
    const rows = NOISE_ROWS.filter(([k]) => NZ.keys[k]).map(([k, name, f]) => {
      const [te, pairs] = NZ.keys[k];
      return el('tr', null, el('td', { class: 'l', text: name }), el('td', { text: '± ' + f(te) }),
        el('td', null, el('b', { text: f(z * Math.SQRT2 * te) })), el('td', { text: f(z * te * Math.sqrt(2 / 7)) }),
        el('td', { class: 'dim', text: pairs ? pairs + ' 对' : 'Apple 的验证数据' }));
    });
    if (!rows.length) return { empty: true };
    return {
      node: el('div', null,
        el('div', { class: 'tablewrap', style: 'border-top:0;margin-top:6px;max-height:none' }, el('table', null,
          el('thead', null, el('tr', null, el('th', { class: 'l', text: '指标' }), el('th', { text: '平时每天的起伏' }),
            el('th', { text: '两次单独读数要差' }), el('th', { text: '两个 7 天平均要差' }), el('th', { text: '依据' }))),
          el('tbody', null, rows))),
        el('p', { class: 'desc', style: 'margin-top:10px', text: `“平时每天的起伏”是典型误差：最近一年里相邻两次读数之差的标准差 ÷ √2。差得比右边两列少，就分不清是真的变了还是平时的起伏，看板上的涨跌箭头这时显示为“持平”。7 天平均那一列按每天都有读数来算。` })),
    };
  };

  // ------------------------------------------------------------------ your own comparisons
  const CT = (H.insights || {}).contrasts;
  const VERDICT = {
    clear: ['看得出差别', 'clear'], maybe: ['可能有差别', 'maybe'],
    none: ['还看不出差别', 'none'], few: ['晚数不够', 'few'],
  };
  const LITERATURE = {
    evening_workout: '研究怎么说：傍晚运动整体上不影响睡眠；可能有影响的是睡前 1 小时内结束的高强度运动（23 项研究的荟萃分析）。',
    listen_before_sleep: '研究怎么说：睡前听歌可能让旋律在脑子里循环、睡得浅一些；而对有失眠困扰的人，每天听 25 到 60 分钟音乐能改善主观睡眠质量。两边方向相反，正好看你自己的数据。',
    daylight: '研究怎么说：白天多接触自然光，生物钟会往前调，晚睡型的人调得更多。',
  };
  const ALCOHOL = '研究怎么说：饮酒后入睡头 3 小时心率升高、HRV 下降，喝得越多越明显（4,098 人的研究）。';
  /** a size of change, worded for the measure it is about */
  function change(key, v) {
    const a = Math.abs(v);
    if (key === 'bedtime') return (v > 0 ? '晚 ' : '早 ') + num(a) + ' 分钟';
    if (key === 'sleepTotal') return (v > 0 ? '多 ' : '少 ') + num(a) + ' 分钟';
    if (key === 'sleepHr') return (v > 0 ? '高 ' : '低 ') + num(a, 1) + ' 次/分';
    return (v > 0 ? '高 ' : '低 ') + num(a, 1) + ' ms';
  }
  function level(key, v) {
    if (v == null) return '–';
    if (key === 'bedtime') return clock(v);
    if (key === 'sleepTotal') return mins(v);
    return num(v, 1) + (key === 'sleepHr' ? ' 次/分' : ' ms');
  }
  const signedNum = (v, dec) => (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v), dec);
  /** a difference and its interval on a line centred on zero, scaled to its own row (rows have different units) */
  function ciBar(r) {
    if (r.diff == null) return el('span', { class: 'dim', text: '–' });
    const scale = Math.max(Math.abs(r.lo), Math.abs(r.hi), 1e-9) * 1.15;
    const pos = (v) => Math.max(0, Math.min(100, 50 + (50 * v) / scale));
    return el('div', { class: 'ci', role: 'img', 'aria-label': `差别 ${signedNum(r.diff, 1)}，95% 区间 ${signedNum(r.lo, 1)} 到 ${signedNum(r.hi, 1)}` },
      el('i', { class: 'zero' }), el('i', { class: 'span ' + r.verdict, style: `left:${pos(r.lo)}%;width:${Math.max(1, pos(r.hi) - pos(r.lo))}%` }),
      el('i', { class: 'dot ' + r.verdict, style: `left:${pos(r.diff)}%` }));
  }
  function contrastCard(item, ui) {
    const names = new Map(CT.outcomes.map((o) => [o.key, o]));
    const lit = LITERATURE[item.id] || (/酒/.test(item.id) ? ALCOHOL : '');
    const rows = item.rows.map((r) => {
      const unit = r.key === 'sleepTotal' || r.key === 'bedtime' ? ' 分钟' : r.key === 'sleepHr' ? ' 次/分' : ' ms';
      const dec = r.key === 'sleepTotal' || r.key === 'bedtime' ? 0 : 1;
      const verdict = r.verdict === 'few' ? `晚数不够（${r.nA} 对 ${r.nB}）` : VERDICT[r.verdict][0];
      return el('tr', null,
        el('td', { class: 'l', text: names.get(r.key).name }),
        el('td', { class: 'pair', text: level(r.key, r.meanA) + ' / ' + level(r.key, r.meanB) }),
        el('td', { class: 'diff' }, r.diff == null ? '–' : [el('b', { text: change(r.key, r.diff) }),
          el('small', { text: `${signedNum(r.lo, dec)} 到 ${signedNum(r.hi, dec)}${unit}` })]),
        el('td', { class: 'l' }, ciBar(r)),
        el('td', { class: 'l' }, el('span', { class: 'verdict ' + VERDICT[r.verdict][1], text: verdict,
          title: r.verdict === 'maybe' ? '区间没有跨过 0，但这里同时比了很多项，校正之后还不够确定，要更多晚上来确认' : null })));
    });
    const card = el('section', { class: 'card s6' },
      el('div', { class: 'card-head' }, el('div', null, el('h3', { text: item.title }),
        el('p', { class: 'desc', text: `有：${item.a}（${item.nA} 晚）· 没有：${item.b}（${item.nB} 晚）` + (item.note ? ' · ' + item.note : '') }))),
      el('div', { class: 'tablewrap', style: 'border-top:0;margin-top:6px;max-height:none' }, el('table', { class: 'contrast' },
        el('thead', null, el('tr', null, el('th', { class: 'l', text: '那一晚' }), el('th', { text: '有 / 没有' }),
          el('th', { text: '差别（95% 区间）' }), el('th', { class: 'l', text: '' }), el('th', { class: 'l', text: '结论' }))),
        el('tbody', null, rows))),
      lit ? el('p', { class: 'desc', style: 'margin-top:10px' }, lit, ' ',
        el('button', { class: 'link', type: 'button', text: '看依据', onclick: () => ui.gotoRef('own_comparisons') })) : null);
    return card;
  }
  HD.contrastNodes = (ui) => {
    if (!CT) return [el('div', { class: 'callout', text: '当前的看板数据是旧版本生成的，还没有这一部分。重新运行一次更新即可。' })];
    const total = CT.items.reduce((s, it) => s + it.rows.filter((r) => r.diff != null).length, 0);
    const out = [el('div', { class: 'callout' },
      `每组把两类夜晚的平均值放在一起比，给出 95% 区间：区间跨过 0（竖线），就是还看不出差别。这里一共比了 ${total} 项，为了挡掉碰巧的结果，按错误发现率 ${num(100 * CT.fdr)}% 再校正一次；区间没跨过 0、但校正后还不够确定的，写作“可能有差别”。这是你自己的观察记录，不是试验：看得出差别，也不说明就是这个原因造成的。`)];
    const cards = CT.items.map((it) => contrastCard(it, ui));
    if (!CT.items.some((it) => it.id.startsWith('tag:'))) {
      cards.push(el('section', { class: 'card s6' },
        el('div', { class: 'card-head' }, el('div', null, el('h3', { text: '你标注的日子' }),
          el('p', { class: 'desc', text: '饮酒、熬夜、生病、出差之后的那一晚' }))),
        el('p', { class: 'desc', style: 'margin-top:10px' },
          `在 标注.csv 里记下这样的日子，同一个标签满 ${CT.minNights} 天后，这里会多一组对照：那天晚上和没有标注的晚上比。`,
          CT.tagsPending.length ? ' 现在的标签：' + CT.tagsPending.map((t) => `${t.tag} ${t.days} 天`).join('、') + '。' : ''),
        el('p', { class: 'desc', text: ALCOHOL })));
    }
    out.push(el('div', { class: 'grid' }, cards));
    return out;
  };

  // ------------------------------------------------------------------ VO2 max among people of the same age
  const FIT = H.fitness;
  HD.vo2Band = () => {
    if (!FIT || !FIT.row) return null;
    const p = FIT.percentiles, row = FIT.row;
    return [row[p.indexOf(25)], row[p.indexOf(75)], `同龄同性别中间一半（第 25 到 75 百分位）`];
  };
  HD.vo2Peers = (ui) => () => {
    if (!FIT) return { empty: true };
    const sexWord = { male: '男性', female: '女性' }[FIT.sex] || '';
    const recent = `近 30 天平均 ${num(FIT.value, 1)} ml/kg·min（${FIT.n} 次读数，最新 ${FIT.last}）`;
    if (FIT.why === 'profile' || FIT.why === 'young') {
      return { node: el('div', { class: 'peers' }, el('p', { class: 'desc', text: recent }),
        el('p', { class: 'desc', text: FIT.why === 'young' ? '参照表从 20 岁开始，未满 20 岁先不和同龄人比。'
          : '健康 App 里没有填年龄或性别，没法和同龄人比。在 iPhone 的健康 App → 个人资料 → 健康详细信息里填好，下次更新后这里就会显示。' })) };
    }
    const group = `${FIT.group[0]}–${FIT.group[1]} 岁${sexWord}` + (FIT.beyond ? '（参照表只到 79 岁）' : '');
    if (FIT.why === 'stale') {
      return { node: el('div', { class: 'peers' }, el('p', { class: 'desc', text: recent }),
        el('p', { class: 'desc', text: `最近一次读数在半年以前，先不给位置。戴着手表做户外步行、跑步或徒步，就会有新的读数。参照组：${group}。` })) };
    }
    const p = FIT.percentiles, row = FIT.row;
    // a strip in percentile space; the table's columns become the ticks
    const at = (pct) => Math.max(0, Math.min(100, pct));
    const dotPct = FIT.pct != null ? FIT.pct : FIT.side === 'below' ? 2 : 98;
    const lo = FIT.pctLo != null ? FIT.pctLo : FIT.loSide === 'below' ? 0 : 100;
    const hi = FIT.pctHi != null ? FIT.pctHi : FIT.hiSide === 'above' ? 100 : 0;
    const lowEdge = FIT.group[0] >= 60 ? null : 20;
    const strip = el('div', { class: 'pstrip', role: 'img', 'aria-label': `约第 ${FIT.pct == null ? (FIT.side === 'below' ? '5 以下' : '95 以上') : FIT.pct} 百分位` },
      lowEdge ? el('i', { class: 'low', style: `width:${lowEdge}%` }) : null,
      el('i', { class: 'err', style: `left:${at(lo)}%;width:${Math.max(1, at(hi) - at(lo))}%` }),
      el('i', { class: 'dot', style: `left:${at(dotPct)}%` }),
      p.map((q, k) => el('span', { class: 'tick', style: `left:${q}%` }, el('b', { text: '第 ' + q }), el('em', { text: num(row[k], 1) }))));
    const where = FIT.pct != null ? `约第 ${FIT.pct} 百分位` : FIT.side === 'below' ? '低于第 5 百分位' : '高于第 95 百分位';
    const met = FIT.vsMedianMet;
    const vsMedian = `同龄中位数 ${num(FIT.median, 1)}，` + (Math.abs(met) < 0.05 ? '你在中位数上'
      : `你${met > 0 ? '高' : '低'} ${num(Math.abs(FIT.value - FIT.median), 1)}（约 ${num(Math.abs(met), 1)} MET）`);
    const lowLine = FIT.group[0] >= 60 ? `60 岁及以上${sexWord}低于 ${num(FIT.lowLine, 0)}` : `低于 ${num(FIT.lowLine, 1)}（同龄同性别最低的五分之一）`;
    const errText = FIT.pctLo != null && FIT.pctHi != null ? `第 ${FIT.pctLo} 到第 ${FIT.pctHi} 百分位之间`
      : `${FIT.pctLo != null ? '第 ' + FIT.pctLo : '第 5 以下'} 到 ${FIT.pctHi != null ? '第 ' + FIT.pctHi : '第 95 以上'} 之间`;
    return {
      node: el('div', { class: 'peers' },
        el('div', { class: 'peers-head' }, el('b', { class: 'big', text: where }), el('span', { text: '参照组：' + group + '，FRIEND 跑步机测试' })),
        el('p', { class: 'desc', text: recent }),
        strip,
        el('dl', { class: 'facts' },
          el('dt', { text: '和中位数比' }), el('dd', { text: vsMedian }),
          el('dt', { text: '手表的估算误差' }), el('dd', { text: `常见误差约 ±4.7，所以位置可能在${errText}` }),
          el('dt', { text: 'Apple 的“低”档' }), el('dd', { text: lowLine + (FIT.low ? '。你的读数落在这一档；Apple 的说法是，大多数人可以通过提高有氧运动的强度和频率来提高' : '。你不在这一档') })),
        el('p', { class: 'desc', style: 'margin-top:12px' },
          '心肺适能是少数能练上去的健康指标：6 到 12 周的有氧训练通常能让 VO₂max 提高 5% 到 10%。33 项研究的荟萃分析里，它每高 1 MET（3.5 ml/kg·min），长期的全因死亡风险约低 13%。和同龄人比只是参照，和自己过去比更有意义。 ',
          el('button', { class: 'link', type: 'button', text: '看依据', onclick: () => ui.gotoRef('vo2max_peers') }))),
    };
  };

  // ------------------------------------------------------------------ correlations
  const strength = (r) => {
    const a = Math.abs(r);
    return (a < 0.1 ? '几乎无关' : (a < 0.3 ? '弱' : a < 0.5 ? '中等' : '较强') + (r > 0 ? '正相关' : '负相关'));
  };
  /** small seeded generator, so an interval reads the same every time the page is drawn */
  function mulberry32(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pearson(pts) {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    const n = pts.length;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
    const vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
    return vx > 0 && vy > 0 ? (sxy - sx * sy / n) / Math.sqrt(vx * vy) : null;
  }
  /** 95% interval for r, resampling whole weeks (runs of 7 points in time order): neighbouring days are alike */
  function rInterval(pts) {
    const blocks = [];
    for (let k = 0; k < pts.length; k += 7) blocks.push(pts.slice(k, k + 7));
    if (blocks.length < 4) return null;
    const rnd = mulberry32(pts.length * 7919 + 17), reps = 400, rs = [];
    for (let b = 0; b < reps; b++) {
      const sample = [];
      for (let k = 0; k < blocks.length; k++) sample.push(...blocks[Math.floor(rnd() * blocks.length)]);
      const r = pearson(sample);
      if (r != null) rs.push(r);
    }
    rs.sort((p, q) => p - q);
    return rs.length < reps * 0.9 ? null : [rs[Math.floor(0.025 * rs.length)], rs[Math.ceil(0.975 * rs.length) - 1]];
  }
  /** spec: { x:{key,name,unit,dec,fmt}, y:{...}, lag } — y is taken `lag` days after x */
  HD.scatter = (spec) => (ctx) => {
    const T = ctx.T, X = D[spec.x.key], Y = D[spec.y.key], lag = spec.lag || 0;
    const pts = [];
    for (let i = ctx.a; i <= ctx.b - lag; i++) {
      if (X[i] != null && Y[i + lag] != null) pts.push([X[i], Y[i + lag], i]);
    }
    const n = pts.length;
    if (n < 20) return { empty: true };
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
    const cov = sxy - sx * sy / n, vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
    if (vx <= 0 || vy <= 0) return { empty: true };
    const r = cov / Math.sqrt(vx * vy), slope = cov / vx, icpt = sy / n - slope * sx / n;
    const xs = pts.map((p) => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
    const fx = spec.x.fmt || ((v) => num(v, spec.x.dec || 0)), fy = spec.y.fmt || ((v) => num(v, spec.y.dec || 0));
    const ux = spec.x.unit ? ' ' + spec.x.unit : '', uy = spec.y.unit ? ' ' + spec.y.unit : '';
    const axis = (o) => Object.assign(yAxis(ctx, { fmt: o.axisFmt || o.fmt, interval: o.interval, min: o.min, max: o.max }), {
      name: o.name + (o.unit ? '（' + o.unit + '）' : ''), nameLocation: 'middle', nameTextStyle: { color: T.muted, fontSize: 11 },
    });
    const option = Object.assign(baseOption(ctx, { right: 14, top: 12, bottom: 22 }), {
      grid: { left: 26, right: 14, top: 12, bottom: 22, containLabel: true },
      xAxis: Object.assign(axis(spec.x), { nameGap: 26, splitLine: { show: false }, axisLine: { show: true, lineStyle: { color: T.axis } } }),
      yAxis: Object.assign(axis(spec.y), { nameGap: 38 }),
      tooltip: tooltip(ctx, (p) => {
        if (p.seriesIndex !== 0) return '';
        const i = p.value[2];
        return ttDom(DAYS[i] + ' ' + WEEKDAY[DOW[i]] + (lag ? '（及次日）' : ''), [
          { name: spec.x.name, value: fx(p.value[0]) + ux, color: T.s[0], box: true },
          { name: spec.y.name + (lag ? '（次日）' : ''), value: fy(p.value[1]) + uy, color: T.s[0], box: true },
        ]);
      }, { item: true }),
      series: [
        {
          type: 'scatter', data: pts, symbolSize: 8,
          itemStyle: { color: T.s[0], opacity: 0.55, borderColor: T.surface, borderWidth: 1 },
          emphasis: { itemStyle: { opacity: 1, borderColor: T.ink, borderWidth: 1 } },
        },
        {
          type: 'line', data: [[x0, icpt + slope * x0], [x1, icpt + slope * x1]], showSymbol: false, silent: true,
          lineStyle: { width: 2, color: T.ink, cap: 'round' }, emphasis: { disabled: true }, tooltip: { show: false },
        },
      ],
    });
    const ci = rInterval(pts);
    const fr = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
    const verdict = ci == null ? strength(r) : ci[0] > 0 || ci[1] < 0 ? strength(r) : '还看不出关系';
    return {
      option,
      note: `r = ${fr(r)}` + (ci ? `（95% 区间 ${fr(ci[0])} 到 ${fr(ci[1])}）` : '') + `，${verdict} · ${n} 天`,
      table: {
        cols: ['日期', spec.x.name, spec.y.name + (lag ? '（次日）' : '')],
        rows: pts.slice().reverse().map((p) => [DAYS[p[2]], fx(p[0]), fy(p[1])]),
      },
    };
  };

  // ------------------------------------------------------------------ single day
  HD.hasIntraday = (d) => !!(I.hr && I.hr[d]);
  HD.lastIntradayDay = () => {
    for (let d = N - 1; d >= 0; d--) if (I.hr && I.hr[d] && I.hr[d].length >= 40 && DAYS[d] !== H.meta.partialDay) return d;
    return N - 1;
  };
  /** sleep segments that fall on calendar day d, in minutes from that day's midnight */
  function daySleep(d) {
    const out = [];
    for (const [s, e, c] of SEGS.get(d) || []) { const a = Math.max(0, s), b = Math.min(1440, e); if (b > a) out.push([a, b, c]); }
    for (const [s, e, c] of SEGS.get(d + 1) || []) { const a = Math.max(0, s + 1440), b = Math.min(1440, e + 1440); if (b > a) out.push([a, b, c]); }
    return out;
  }
  function dayWorkouts(d) {
    return W.filter((w) => w.d === d).map((w) => {
      const m0 = +w.time.slice(0, 2) * 60 + +w.time.slice(3, 5);
      return { w, a: m0, b: Math.min(1440, m0 + w.min) };
    });
  }
  HD.dayHeart = (d, T) => {
    const flat = (I.hr || [])[d];
    if (!flat || flat.length < 4) return null;
    const pts = [];
    for (let k = 0; k < flat.length; k += 2) {
      if (k && flat[k] - flat[k - 2] > 12) pts.push([flat[k - 2] + 1, null]);     // a real gap: break the line
      pts.push([flat[k], flat[k + 1]]);
    }
    const sleep = daySleep(d), works = dayWorkouts(d);
    const listen = HD.dayListening ? HD.dayListening(d) : [];
    const stageColor = [T.stage.deep, T.stage.core, T.stage.rem, T.n1, T.stage.awake, T.n2];
    const lanes = [];
    for (const [a, b, c] of sleep) lanes.push([0, a, b, stageColor[c]]);
    for (const x of works) lanes.push([1, x.a, x.b, T.ink2]);
    if (listen.length) for (const [a, b] of HD.dayListeningLane(d)) lanes.push([2, a, b, T.s[2]]);
    const laneNames = listen.length ? ['睡眠', '训练', '耳机'] : ['睡眠', '训练'];
    const laneH = 20 * laneNames.length;
    const xCommon = {
      type: 'value', min: 0, max: 1440, interval: 120,
      axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false }, splitLine: { show: false },
    };
    const at = (m) => {
      const st = sleep.find((s) => m >= s[0] && m < s[1]);
      const wk = works.find((x) => m >= x.a && m <= x.b);
      const hp = listen.find((s) => m >= s[0] && m < s[1]);
      return { stage: st ? STAGE_NAMES[st[2]] : null, workout: wk ? wk.w.type : null, listen: hp ? num(hp[2], 1) + ' 分贝' : null };
    };
    const rest = D.rhr[d];
    return {
      animation: false, textStyle: { fontFamily: HD.FONT },
      grid: [{ left: 46, right: 44, top: 14, bottom: 56 + laneH }, { left: 46, right: 44, height: laneH, bottom: 34 }],
      xAxis: [
        Object.assign({ gridIndex: 0, axisLabel: { show: false } }, xCommon),
        Object.assign({ gridIndex: 1, axisLabel: { color: T.muted, fontSize: 11, formatter: (v) => clock(v) } }, xCommon),
      ],
      yAxis: [
        Object.assign(yAxis({ T }, {}), { gridIndex: 0 }),
        {
          gridIndex: 1, type: 'category', data: laneNames, inverse: true,
          axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: T.muted, fontSize: 11 },
          splitLine: { show: false },
        },
      ],
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      tooltip: {
        trigger: 'axis', confine: true, transitionDuration: 0, backgroundColor: T.surface, borderColor: T.axis, borderWidth: 1,
        padding: [8, 10], extraCssText: 'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.14);',
        axisPointer: { type: 'line', lineStyle: { color: T.muted, width: 1, type: 'solid' } },
        formatter: (ps) => {
          const p = (Array.isArray(ps) ? ps : [ps]).find((q) => q.seriesIndex === 0 && q.value && q.value[1] != null);
          if (!p) return '';
          const m = p.value[0], ctxAt = at(m);
          return ttDom(clock(m), [
            { name: '心率', value: p.value[1] + ' bpm', color: T.s[0] },
            ctxAt.stage && { name: '睡眠', value: ctxAt.stage },
            ctxAt.workout && { name: '训练', value: ctxAt.workout },
            ctxAt.listen && { name: '耳机', value: ctxAt.listen },
          ]);
        },
      },
      series: [
        {
          type: 'line', data: pts, showSymbol: false, connectNulls: false, xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { width: 1.5, color: T.s[0], join: 'round' }, itemStyle: { color: T.s[0] }, emphasis: { disabled: true },
          markLine: rest == null ? undefined : {
            silent: true, symbol: 'none', animation: false, lineStyle: { color: T.muted, width: 1, type: 'solid' },
            label: { position: 'end', color: T.muted, fontSize: 10, formatter: '静息 ' + Math.round(rest) },
            data: [{ yAxis: rest }],
          },
        },
        {
          type: 'custom', data: lanes, xAxisIndex: 1, yAxisIndex: 1, silent: true, tooltip: { show: false },
          encode: { x: [1, 2], y: 0 },
          renderItem: (params, api) => {
            const p0 = api.coord([api.value(1), api.value(0)]), p1 = api.coord([api.value(2), api.value(0)]);
            return { type: 'rect', shape: { x: p0[0], y: p0[1] - 6, width: Math.max(1, p1[0] - p0[0]), height: 12, r: 2 }, style: { fill: api.value(3) } };
          },
        },
      ],
    };
  };
  HD.daySteps = (d, T) => {
    const row = (I.steps || [])[d];
    if (!row || !row.some(Boolean)) return null;
    const ctx = { T };
    return {
      animation: false, textStyle: { fontFamily: HD.FONT },
      grid: { left: 4, right: 12, top: 14, bottom: 2, containLabel: true },
      xAxis: {
        type: 'category', data: row.map((_, h) => pad(h)), axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false },
        axisLabel: { color: T.muted, fontSize: 11, interval: 1, formatter: (v) => v + ':00' },
      },
      yAxis: yAxis(ctx, { zero: true }),
      tooltip: tooltip(ctx, (i) => ttDom(pad(i) + ':00 – ' + pad((i + 1) % 24) + ':00', [{ name: '步数', value: num(row[i]) + ' 步', color: T.s[0], box: true }]), { shadow: true }),
      series: [{ type: 'bar', data: row, barMaxWidth: 24, itemStyle: { color: T.s[0], borderRadius: [4, 4, 0, 0] }, emphasis: { disabled: true } }],
    };
  };
  HD.daySleep = daySleep;
  HD.dayWorkouts = dayWorkouts;
})();
