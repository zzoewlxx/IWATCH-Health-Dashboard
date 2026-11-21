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
    { key: 'hrv', name: '心率变异性（HRV）', unit: 'ms', dec: 1, worse: 'down', better: 'up' },
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
  /** last 7 days of the range vs the 28 days before them */
  HD.baselineStatus = (ctx) => {
    const end = ctx.b, rows = [];
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

  // ------------------------------------------------------------------ correlations
  const strength = (r) => {
    const a = Math.abs(r);
    return (a < 0.1 ? '几乎无关' : (a < 0.3 ? '弱' : a < 0.5 ? '中等' : '较强') + (r > 0 ? '正相关' : '负相关'));
  };
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
    return {
      option,
      note: `r = ${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}，${strength(r)} · ${n} 天`,
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
    const stageColor = [T.stage.deep, T.stage.core, T.stage.rem, T.n1, T.stage.awake, T.n2];
    const lanes = [];
    for (const [a, b, c] of sleep) lanes.push([0, a, b, stageColor[c]]);
    for (const x of works) lanes.push([1, x.a, x.b, T.ink2]);
    const xCommon = {
      type: 'value', min: 0, max: 1440, interval: 120,
      axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false }, splitLine: { show: false },
    };
    const at = (m) => {
      const st = sleep.find((s) => m >= s[0] && m < s[1]);
      const wk = works.find((x) => m >= x.a && m <= x.b);
      return { stage: st ? STAGE_NAMES[st[2]] : null, workout: wk ? wk.w.type : null };
    };
    const rest = D.rhr[d];
    return {
      animation: false, textStyle: { fontFamily: HD.FONT },
      grid: [{ left: 46, right: 44, top: 14, bottom: 96 }, { left: 46, right: 44, height: 40, bottom: 34 }],
      xAxis: [
        Object.assign({ gridIndex: 0, axisLabel: { show: false } }, xCommon),
        Object.assign({ gridIndex: 1, axisLabel: { color: T.muted, fontSize: 11, formatter: (v) => clock(v) } }, xCommon),
      ],
      yAxis: [
        Object.assign(yAxis({ T }, {}), { gridIndex: 0 }),
        {
          gridIndex: 1, type: 'category', data: ['睡眠', '训练'], inverse: true,
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
