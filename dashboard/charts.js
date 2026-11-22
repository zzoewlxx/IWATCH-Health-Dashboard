/* Chart builders. Each returns build(ctx) -> { option, legend, table } | { empty } | { node }. */
(function () {
  'use strict';
  const HD = window.HD;
  if (!HD || !HD.H) return;
  const { H, DAYS, N, D, el, num, clock, hm, mins, pad, buckets, bucketTitle, aggMean, aggCount, meanOf,
    rolling, xAxis, yAxis, ttDom, tooltip, endPoint, eraLines, baseOption, WEEKDAY, DOW } = HD;

  const anyValue = (xs) => xs.some((v) => v != null);
  const round = (v, dec) => (v == null ? null : +v.toFixed(dec));
  const granWord = (g) => (g === 'day' ? '每日' : g === 'week' ? '周均' : '月均');
  const tableDate = (ctx) => (ctx.gran === 'day' ? '日期' : ctx.gran === 'week' ? '周（起始日）' : '月份');

  /** rows newest-first for the table twin */
  function tableOf(ctx, cols, rowFn) {
    const rows = [];
    for (let i = ctx.bk.length - 1; i >= 0; i--) {
      const r = rowFn(i);
      if (r) rows.push([ctx.bk[i].label, ...r]);
    }
    return { cols: [tableDate(ctx), ...cols], rows };
  }

  // ------------------------------------------------------------------ single-metric trend
  /**
   * spec: { key, values, name, unit, dec, form:'line'|'bar', roll, minN, zero, band:[lo,hi,label],
   *         goalKey, fmt, axisFmt, eras, sparse, yMin, yMax, right }
   * `values` (optional) is a per-day array to plot instead of the daily series `key`.
   * Daily view: every day as a quiet context mark + a 7-day mean as the emphasis line.
   * Weekly / monthly view: the bucket mean.
   */
  HD.trend = (spec) => (ctx) => {
    const T = ctx.T, arr = spec.values || D[spec.key];
    if (!arr) return { empty: true };
    const fmt = spec.fmt || ((v) => num(v, spec.dec || 0));
    const unit = spec.unit ? ' ' + spec.unit : '';
    const labels = ctx.labels, bar = spec.form === 'bar';
    const win = spec.roll == null ? 7 : spec.roll;
    const series = [], legend = [];
    let main, roll = null, goal = null;

    if (ctx.gran === 'day') {
      main = ctx.bk.map((b) => arr[b.i0]);
      if (win) {
        const smooth = rolling(spec.values || spec.key, win, spec.minN || (spec.sparse ? 1 : 3));
        roll = ctx.bk.map((b) => smooth[b.i0]);
      }
    } else {
      main = aggMean(arr, ctx.bk);
    }
    if (!anyValue(main)) return { empty: true };
    const counts = ctx.gran === 'day' ? null : aggCount(arr, ctx.bk);
    const emphasised = ctx.gran !== 'day' || !win;       // is the main series the headline?
    const mainName = granWord(ctx.gran) + (spec.short || '');
    const few = main.filter((v) => v != null).length <= 31;

    if (bar) {
      series.push({
        name: mainName, type: 'bar', data: main, barMaxWidth: 24, barMinWidth: 1,
        itemStyle: { color: emphasised ? T.s[0] : T.soft, borderRadius: [4, 4, 0, 0] },
        emphasis: { itemStyle: { color: T.s[0] } },
      });
      legend.push({ name: mainName, color: emphasised ? T.s[0] : T.soft });
    } else {
      series.push({
        name: mainName, type: 'line', data: main, connectNulls: !!spec.sparse,
        showSymbol: few || !!spec.sparse, showAllSymbol: true, symbol: 'circle', symbolSize: emphasised ? 8 : 5,
        lineStyle: { width: emphasised ? 2 : 1, color: emphasised ? T.s[0] : T.n2, join: 'round', cap: 'round' },
        itemStyle: emphasised ? { color: T.s[0], borderColor: T.surface, borderWidth: 2 } : { color: T.n1 },
        emphasis: { disabled: true },
        markPoint: emphasised ? endPoint(labels, main, T.s[0], ctx, fmt) : undefined,
      });
      legend.push({ name: mainName, color: emphasised ? T.s[0] : T.n1, line: true });
    }
    if (roll && anyValue(roll)) {
      const name = win + ' 日均值';
      series.push({
        name, type: 'line', data: roll, showSymbol: false, connectNulls: !!spec.sparse, z: 5,
        lineStyle: { width: 2, color: T.s[0], join: 'round', cap: 'round' }, itemStyle: { color: T.s[0] },
        emphasis: { disabled: true },
        markPoint: endPoint(labels, roll, T.s[0], ctx, fmt),
      });
      legend.push({ name, color: T.s[0], line: true });
    }
    if (spec.goalKey && D[spec.goalKey]) {
      goal = ctx.gran === 'day' ? ctx.bk.map((b) => D[spec.goalKey][b.i0]) : aggMean(D[spec.goalKey], ctx.bk);
      if (anyValue(goal)) {
        series.push({
          name: '目标', type: 'line', data: goal, step: 'middle', showSymbol: false, connectNulls: true, z: 4,
          lineStyle: { width: 1, color: T.ink2 }, itemStyle: { color: T.ink2 }, emphasis: { disabled: true },
        });
        legend.push({ name: '目标', color: T.ink2, line: true });
      } else goal = null;
    }
    // Personal baseline: mean ± 1 SD of the 28 days before each day, as a quiet wash
    // behind the line. A value outside it is a real departure from your own normal.
    let base = null;
    if (spec.baseline && ctx.gran === 'day') {
      const B = HD.baseline(spec.key);
      const lo = ctx.bk.map((b) => (B.mean[b.i0] == null ? null : B.mean[b.i0] - B.sd[b.i0]));
      const hi = ctx.bk.map((b) => (B.mean[b.i0] == null ? null : B.mean[b.i0] + B.sd[b.i0]));
      if (anyValue(lo)) {
        base = { lo, hi };
        const wash = { type: 'line', stack: 'baseline', showSymbol: false, silent: true, z: 1, lineStyle: { opacity: 0 }, emphasis: { disabled: true } };
        series.push(Object.assign({ name: '个人基线范围', data: lo, itemStyle: { color: T.s[0] } }, wash));
        series.push(Object.assign({ name: '个人基线范围', data: hi.map((v, i) => (v == null ? null : v - lo[i])), areaStyle: { color: T.s[0], opacity: 0.13 }, itemStyle: { color: T.s[0] } }, wash));
        legend.push({ name: '个人基线范围', color: T.s[0], wash: true });
      }
    }
    const first = series[0];
    if (spec.band) {
      first.markArea = {
        silent: true, itemStyle: { color: T.band },
        label: { show: true, position: 'insideTopLeft', color: T.muted, fontSize: 10, formatter: spec.band[2] || '' },
        data: [[{ yAxis: spec.band[0] }, { yAxis: spec.band[1] }]],
      };
    }
    if (spec.eras) first.markLine = eraLines(spec.key, ctx);

    const option = Object.assign(baseOption(ctx, { right: spec.right }), {
      xAxis: xAxis(labels, ctx, bar),
      yAxis: yAxis(ctx, { zero: bar || spec.zero, fmt: spec.axisFmt, min: spec.yMin, max: spec.yMax, inverse: spec.inverse }),
      tooltip: tooltip(ctx, (i) => ttDom(bucketTitle(ctx.bk[i], ctx.gran), [
        { name: mainName, value: main[i] == null ? null : fmt(main[i]) + unit, color: legend[0].color, box: bar },
        roll && { name: win + ' 日均值', value: roll[i] == null ? null : fmt(roll[i]) + unit, color: T.s[0] },
        goal && { name: '目标', value: goal[i] == null ? null : fmt(goal[i]) + unit, color: T.ink2 },
        base && { name: '个人基线范围', value: base.lo[i] == null ? null : fmt(base.lo[i]) + ' – ' + fmt(base.hi[i]) + unit, color: T.s[0], box: true },
      ], counts ? counts[i] + ' 天有数据' : base && main[i] != null && base.lo[i] != null
        ? (main[i] > base.hi[i] ? '当天高于基线范围' : main[i] < base.lo[i] ? '当天低于基线范围' : '当天在基线范围内') : null), { shadow: bar }),
      series,
    });
    const cols = [spec.name + (spec.unit ? '（' + spec.unit + '）' : '')];
    if (roll) cols.push(win + ' 日均值');
    if (base) cols.push('个人基线范围');
    if (counts) cols.push('有数据天数');
    const table = tableOf(ctx, cols, (i) => {
      if (main[i] == null && !(roll && roll[i] != null)) return null;
      const r = [main[i] == null ? '–' : fmt(main[i])];
      if (roll) r.push(roll[i] == null ? '–' : fmt(roll[i]));
      if (base) r.push(base.lo[i] == null ? '–' : fmt(base.lo[i]) + ' – ' + fmt(base.hi[i]));
      if (counts) r.push(counts[i]);
      return r;
    });
    return { option, legend: legend.length > 1 ? legend : null, table, drill: ctx.gran === 'day' };
  };

  // ------------------------------------------------------------------ several lines, one axis
  /** spec: { series:[{key,name,color(T)}], dec, unit, fmt, axisFmt, zero, roll, band, eras } */
  HD.multiLine = (spec) => (ctx) => {
    const T = ctx.T, labels = ctx.labels;
    const fmt = spec.fmt || ((v) => num(v, spec.dec || 0));
    const unit = spec.unit ? ' ' + spec.unit : '';
    const win = spec.roll == null ? 7 : spec.roll;
    const smooth = ctx.gran === 'day' && win;
    const rows = spec.series.map((s) => {
      const arr = D[s.key];
      const data = !arr ? [] : smooth ? ctx.bk.map((b) => rolling(s.key, win, 3)[b.i0]) : aggMean(arr, ctx.bk);
      return { s, data, color: s.color(T) };
    });
    if (!rows.some((r) => anyValue(r.data))) return { empty: true };
    const few = ctx.bk.length <= 31 && !smooth;
    const series = rows.map((r, k) => ({
      name: r.s.name, type: 'line', data: r.data, showSymbol: few, showAllSymbol: true, symbol: 'circle', symbolSize: 8,
      lineStyle: { width: 2, color: r.color, join: 'round', cap: 'round' },
      itemStyle: { color: r.color, borderColor: T.surface, borderWidth: 2 }, emphasis: { disabled: true },
      markPoint: endPoint(labels, r.data, r.color, ctx, fmt),
      markLine: k === 0 && spec.eras ? eraLines(spec.series[0].key, ctx) : undefined,
      markArea: k === 0 && spec.band ? {
        silent: true, itemStyle: { color: T.band },
        label: { show: true, position: 'insideTopLeft', color: T.muted, fontSize: 10, formatter: spec.band[2] || '' },
        data: [[{ yAxis: spec.band[0] }, { yAxis: spec.band[1] }]],
      } : undefined,
    }));
    const option = Object.assign(baseOption(ctx), {
      xAxis: xAxis(labels, ctx, false),
      yAxis: yAxis(ctx, { zero: spec.zero, fmt: spec.axisFmt, min: spec.yMin, max: spec.yMax, interval: spec.interval }),
      tooltip: tooltip(ctx, (i) => ttDom(
        bucketTitle(ctx.bk[i], ctx.gran),
        rows.map((r) => ({ name: r.s.name, value: r.data[i] == null ? null : fmt(r.data[i]) + unit, color: r.color })),
        smooth ? win + ' 日均值' : null)),
      series,
    });
    return {
      option,
      drill: ctx.gran === 'day',
      legend: rows.map((r) => ({ name: r.s.name, color: r.color, line: true })),
      table: tableOf(ctx, rows.map((r) => r.s.name + (smooth ? '（' + win + ' 日均）' : '')), (i) =>
        rows.some((r) => r.data[i] != null) ? rows.map((r) => (r.data[i] == null ? '–' : fmt(r.data[i]))) : null),
    };
  };

  // ------------------------------------------------------------------ stacked bars
  function stackOption(ctx, labels, parts, o = {}) {
    // parts: [{ name, color, data }] bottom -> top
    const T = ctx.T;
    const gap = labels.length <= 70;
    const tops = labels.map((_, i) => {
      for (let k = parts.length - 1; k >= 0; k--) if (parts[k].data[i]) return k;
      return -1;
    });
    const series = parts.map((p, k) => ({
      name: p.name, type: 'bar', stack: 'a', barMaxWidth: 24, barMinWidth: 1,
      itemStyle: { color: p.color, borderColor: T.surface, borderWidth: gap ? 1 : 0 },
      emphasis: { disabled: true },
      data: p.data.map((v, i) => (tops[i] === k && gap ? { value: v, itemStyle: { borderRadius: [4, 4, 0, 0] } } : v)),
    }));
    let interval, max;
    if (o.minutes) {                                    // pick a whole-hour (or half-hour) step
      const top = Math.max(1, ...labels.map((_, i) => parts.reduce((t, p) => t + (p.data[i] || 0), 0)));
      interval = [30, 60, 120, 180, 240, 360, 480, 720].find((st) => top / st <= 5) || 1440;
      max = Math.ceil(top / interval) * interval;
    }
    return Object.assign(baseOption(ctx, { right: o.right == null ? 12 : o.right }), {
      xAxis: xAxis(labels, ctx, true),
      yAxis: yAxis(ctx, {
        zero: true, interval, max,
        fmt: o.minutes ? (v) => (v === 0 ? '0' : v % 60 === 0 ? v / 60 + ' 小时' : v + ' 分') : o.axisFmt,
      }),
      series,
    });
  }

  /** spec: { parts:[{key,name,color(T)}], unit, dec, totalName } — stacked daily parts + 7-day mean of the total */
  HD.stackTrend = (spec) => (ctx) => {
    const T = ctx.T, labels = ctx.labels, day = ctx.gran === 'day';
    const get = (arr) => (day ? ctx.bk.map((b) => arr[b.i0]) : aggMean(arr, ctx.bk));
    const parts = spec.parts.map((p) => ({ name: p.name, color: p.color(T), data: get(D[p.key]) }));
    if (!parts.some((p) => anyValue(p.data))) return { empty: true };
    const fmt = (v) => num(v, spec.dec || 0), unit = ' ' + spec.unit;
    const total = labels.map((_, i) => (parts.every((p) => p.data[i] != null) ? parts.reduce((s, p) => s + p.data[i], 0) : null));
    const option = stackOption(ctx, labels, parts, { right: day ? 44 : 12 });
    const legend = parts.map((p) => ({ name: p.name, color: p.color }));
    let roll = null;
    if (day && spec.totalKey) {
      roll = ctx.bk.map((b) => rolling(spec.totalKey, 7, 3)[b.i0]);
      option.series.push({
        name: '合计的 7 日均值', type: 'line', data: roll, showSymbol: false, z: 5,
        lineStyle: { width: 2, color: T.ink, join: 'round', cap: 'round' }, itemStyle: { color: T.ink },
        emphasis: { disabled: true }, markPoint: endPoint(labels, roll, T.ink, ctx, fmt),
      });
      legend.push({ name: '合计的 7 日均值', color: T.ink, line: true });
    }
    if (spec.eras) option.series[0].markLine = eraLines(spec.eras, ctx);
    option.tooltip = tooltip(ctx, (i) => ttDom(bucketTitle(ctx.bk[i], ctx.gran), [
      ...parts.map((p) => ({ name: p.name, value: p.data[i] == null ? null : fmt(p.data[i]) + unit, color: p.color, box: true })).reverse(),
      { name: '合计', value: total[i] == null ? null : fmt(total[i]) + unit },
      roll && { name: '合计的 7 日均值', value: roll[i] == null ? null : fmt(roll[i]) + unit, color: T.ink },
    ]), { shadow: true });
    return {
      option, legend, drill: day,
      table: tableOf(ctx, [...parts.map((p) => p.name), '合计'], (i) =>
        total[i] == null ? null : [...parts.map((p) => fmt(p.data[i])), fmt(total[i])]),
    };
  };

  // ------------------------------------------------------------------ sleep: stages per night
  const inBedOnly = D.sleepInBed.map((v, i) => (H.sleepKind[i] === 'inbed' ? v : null));
  HD.sleepStages = (ctx) => {
    const T = ctx.T, labels = ctx.labels, day = ctx.gran === 'day';
    const get = (arr) => (day ? ctx.bk.map((b) => arr[b.i0]) : aggMean(arr, ctx.bk));
    const total = get(D.sleepTotal);
    // Weekly / monthly: average every stage over the same nights (those with measured
    // sleep), so the stacked parts add up to the average total instead of mixing nights.
    const stage = (arr) => (day ? ctx.bk.map((b) => arr[b.i0]) : ctx.bk.map((b) => {
      let s = 0, n = 0;
      for (let i = b.i0; i <= b.i1; i++) if (D.sleepTotal[i] != null) { s += arr[i] || 0; n++; }
      return n ? s / n : null;
    }));
    const inbed = get(inBedOnly).map((v, i) => (day || total[i] == null ? v : null));
    const all = [
      { name: '深睡', color: T.stage.deep, data: stage(D.sleepDeep) },
      { name: '核心', color: T.stage.core, data: stage(D.sleepCore) },
      { name: '快速眼动', color: T.stage.rem, data: stage(D.sleepRem) },
      { name: '未分期睡眠', color: T.n1, data: stage(D.sleepUnspec) },
      { name: '仅卧床记录', color: T.n2, data: inbed },
    ];
    const parts = all.filter((p) => p.data.some((v) => v));
    if (!parts.length) return { empty: true };
    const option = stackOption(ctx, labels, parts, { axisFmt: (v) => v + ' h', right: day ? 78 : 12 });
    option.series[0].markArea = {
      silent: true, itemStyle: { color: T.band },
      label: { show: true, position: 'insideTopLeft', color: T.muted, fontSize: 10, formatter: '成人建议 7–9 小时' },
      data: [[{ yAxis: 7 }, { yAxis: 9 }]],
    };
    option.series[0].markLine = eraLines('sleepTotal', ctx);
    const legend = parts.map((p) => ({ name: p.name, color: p.color }));
    let roll = null;
    if (day) {
      roll = ctx.bk.map((b) => rolling('sleepTotal', 7, 3)[b.i0]);
      if (anyValue(roll)) {
        option.series.push({
          name: '7 日均值', type: 'line', data: roll, showSymbol: false, z: 5,
          lineStyle: { width: 2, color: T.ink, join: 'round', cap: 'round' }, itemStyle: { color: T.ink },
          emphasis: { disabled: true }, markPoint: endPoint(labels, roll, T.ink, ctx, (v) => hm(v)),
        });
        legend.push({ name: '7 日均值', color: T.ink, line: true });
      }
    }
    const bed = get(D.bedtime), wake = get(D.waketime);
    option.tooltip = tooltip(ctx, (i) => ttDom(bucketTitle(ctx.bk[i], ctx.gran), [
      ...parts.map((p) => ({ name: p.name, value: p.data[i] ? hm(p.data[i]) : null, color: p.color, box: true })),
      { name: '睡眠合计', value: total[i] == null ? null : hm(total[i]) },
      roll && { name: '7 日均值', value: roll[i] == null ? null : hm(roll[i]), color: T.ink },
      { name: '入睡 – 醒来', value: bed[i] == null ? null : clock(bed[i]) + ' – ' + clock(wake[i]) },
    ]), { shadow: true });
    return {
      option, legend, drill: day,
      table: tableOf(ctx, ['睡眠合计', '深睡', '核心', '快速眼动', '入睡', '醒来'], (i) =>
        total[i] == null && !parts.some((p) => p.data[i]) ? null
          : [hm(total[i]), hm(all[0].data[i]), hm(all[1].data[i]), hm(all[2].data[i]), clock(bed[i]), clock(wake[i])]),
    };
  };

  // ------------------------------------------------------------------ sleep: clock-time timeline
  const SEGS = new Map(H.sleepSegs.map(([d, segs]) => [d, segs]));
  const STAGE_NAMES = ['深睡', '核心', '快速眼动', '未分期睡眠', '清醒', '卧床'];
  HD.sleepTimeline = (ctx) => {
    const T = ctx.T;
    const colors = [T.stage.deep, T.stage.core, T.stage.rem, T.n1, T.stage.awake, T.n2];
    const labels = [];
    for (let i = ctx.a; i <= ctx.b; i++) labels.push(DAYS[i]);
    const detailed = labels.length <= 150;
    const data = [];
    let lo = Infinity, hi = -Infinity;
    for (let i = ctx.a; i <= ctx.b; i++) {
      const segs = SEGS.get(i);
      if (!segs) continue;
      if (detailed) {
        for (const [s, e, c] of segs) { data.push([i - ctx.a, s, e, c]); lo = Math.min(lo, s); hi = Math.max(hi, e); }
      } else if (D.bedtime[i] != null) {
        data.push([i - ctx.a, D.bedtime[i], D.waketime[i], H.sleepKind[i] === 'inbed' ? 5 : 1]);
        lo = Math.min(lo, D.bedtime[i]); hi = Math.max(hi, D.waketime[i]);
      }
    }
    if (!data.length) return { empty: true };
    lo = Math.max(-360, Math.floor(lo / 60) * 60);
    hi = Math.min(1080, Math.ceil(hi / 60) * 60);
    const option = Object.assign(baseOption(ctx, { right: 12 }), {
      xAxis: xAxis(labels, ctx, true),
      yAxis: yAxis(ctx, { min: lo, max: hi, inverse: true, interval: 120, fmt: (v) => clock(v) }),
      tooltip: tooltip(ctx, (_, p) => {
        const d = HD.indexOfDate(p.axisValue);
        const staged = H.sleepKind[d] === 'stages';
        return ttDom(DAYS[d] + ' ' + WEEKDAY[DOW[d]], [
          { name: H.sleepKind[d] === 'inbed' ? '卧床' : '入睡 – 醒来', value: clock(D.bedtime[d]) + ' – ' + clock(D.waketime[d]) },
          { name: '睡眠合计', value: D.sleepTotal[d] == null ? null : hm(D.sleepTotal[d]) },
          staged && { name: '深睡', value: hm(D.sleepDeep[d]), color: colors[0], box: true },
          staged && { name: '核心', value: hm(D.sleepCore[d]), color: colors[1], box: true },
          staged && { name: '快速眼动', value: hm(D.sleepRem[d]), color: colors[2], box: true },
          { name: '夜间清醒', value: D.sleepAwake[d] ? mins(D.sleepAwake[d]) : null, color: colors[4], box: true },
          { name: '小睡', value: D.sleepNap[d] ? hm(D.sleepNap[d]) : null },
        ], H.sleepKind[d] === 'inbed' ? '仅有卧床记录，无睡眠分期' : null);
      }, { shadow: true }),
      series: [{
        type: 'custom', data, encode: { x: 0, y: [1, 2] }, clip: true,
        renderItem: (params, api) => {
          const x = api.value(0), p0 = api.coord([x, api.value(1)]), p1 = api.coord([x, api.value(2)]);
          const w = Math.max(1, Math.min(14, api.size([1, 0])[0] * 0.72));
          const shape = window.echarts.graphic.clipRectByRect(
            { x: p0[0] - w / 2, y: Math.min(p0[1], p1[1]), width: w, height: Math.abs(p1[1] - p0[1]) },
            { x: params.coordSys.x, y: params.coordSys.y, width: params.coordSys.width, height: params.coordSys.height });
          return shape && { type: 'rect', shape, style: { fill: colors[api.value(3)] } };
        },
      }],
    });
    const used = new Set(data.map((r) => r[3]));
    const rows = [];
    for (let i = ctx.b; i >= ctx.a; i--) {
      if (D.bedtime[i] == null) continue;
      rows.push([DAYS[i], clock(D.bedtime[i]), clock(D.waketime[i]), hm(D.sleepTotal[i]), D.sleepAwake[i] == null ? '–' : mins(D.sleepAwake[i])]);
    }
    return {
      option, drill: true,
      legend: detailed ? [0, 1, 2, 3, 4, 5].filter((c) => used.has(c)).map((c) => ({ name: STAGE_NAMES[c], color: colors[c] }))
        : [{ name: '入睡 → 醒来', color: colors[1] }, used.has(5) && { name: '仅卧床记录', color: colors[5] }].filter(Boolean),
      table: { cols: ['醒来日期', '入睡', '醒来', '睡眠合计', '夜间清醒'], rows },
    };
  };

  // ------------------------------------------------------------------ heart-rate daily range
  HD.hrRange = (ctx) => {
    const T = ctx.T, labels = ctx.labels;
    const get = (k) => (ctx.gran === 'day' ? ctx.bk.map((b) => D[k][b.i0]) : aggMean(D[k], ctx.bk));
    const lo = get('hrMin'), hi = get('hrMax'), avg = get('hrAvg');
    if (!anyValue(avg)) return { empty: true };
    const data = [];
    labels.forEach((_, i) => { if (lo[i] != null && hi[i] != null) data.push([i, lo[i], hi[i]]); });
    const yMin = Math.floor((Math.min(...data.map((r) => r[1])) - 2) / 20) * 20;
    const yMax = Math.ceil((Math.max(...data.map((r) => r[2])) + 2) / 20) * 20;
    const option = Object.assign(baseOption(ctx), {
      xAxis: xAxis(labels, ctx, true),
      yAxis: yAxis(ctx, { min: yMin, max: yMax, interval: yMax - yMin > 180 ? 40 : 20 }),
      tooltip: tooltip(ctx, (i) => ttDom(bucketTitle(ctx.bk[i], ctx.gran), [
        { name: ctx.gran === 'day' ? '最低 – 最高' : '日最低 – 日最高（平均）', value: lo[i] == null ? null : num(lo[i]) + ' – ' + num(hi[i]) + ' bpm', color: T.soft, box: true },
        { name: '全天平均', value: avg[i] == null ? null : num(avg[i], 1) + ' bpm', color: T.s[0] },
      ]), { shadow: true }),
      series: [
        {
          name: '最低 – 最高', type: 'custom', data, encode: { x: 0, y: [1, 2] }, z: 2,
          markLine: eraLines('hrAvg', ctx),
          renderItem: (params, api) => {
            const x = api.value(0), p0 = api.coord([x, api.value(1)]), p1 = api.coord([x, api.value(2)]);
            const w = Math.max(1, Math.min(8, api.size([1, 0])[0] * 0.6));
            return { type: 'rect', shape: { x: p0[0] - w / 2, y: p1[1], width: w, height: Math.max(1, p0[1] - p1[1]), r: w / 2 }, style: { fill: T.soft } };
          },
        },
        {
          name: '全天平均', type: 'line', data: avg, showSymbol: false, z: 5,
          lineStyle: { width: 2, color: T.s[0], join: 'round', cap: 'round' }, itemStyle: { color: T.s[0] },
          emphasis: { disabled: true }, markPoint: endPoint(labels, avg, T.s[0], ctx, (v) => num(v)),
        },
      ],
    });
    return {
      option, drill: ctx.gran === 'day',
      legend: [{ name: '最低 – 最高', color: T.soft }, { name: '全天平均', color: T.s[0], line: true }],
      table: tableOf(ctx, ['最低', '平均', '最高'], (i) => (avg[i] == null ? null : [num(lo[i]), num(avg[i], 1), num(hi[i])])),
    };
  };

  // ------------------------------------------------------------------ heart rate by hour of day
  HD.hrHeatmap = (ctx) => {
    const T = ctx.T;
    const bk = ctx.gran === 'day' && ctx.bk.length > 200 ? buckets(ctx.a, ctx.b, 'week') : ctx.bk;
    const gran = bk === ctx.bk ? ctx.gran : 'week';
    const labels = bk.map((b) => b.label);
    const data = [], vals = [];
    bk.forEach((b, x) => {
      for (let h = 0; h < 24; h++) {
        let s = 0, n = 0;
        for (let i = b.i0; i <= b.i1; i++) {
          const row = H.hrHourly[i];
          if (row && row[h] != null) { s += row[h]; n++; }
        }
        if (n) { const v = Math.round(s / n); data.push([x, h, v]); vals.push(v); }
      }
    });
    if (!data.length) return { empty: true };
    vals.sort((p, q) => p - q);
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    const lo = Math.floor(q(0.02) / 5) * 5, hi = Math.ceil(q(0.98) / 5) * 5;
    const option = Object.assign(baseOption(ctx, { right: 12, top: 34 }), {
      xAxis: Object.assign(xAxis(labels, Object.assign({}, ctx, { gran }), true), { splitArea: { show: false } }),
      yAxis: {
        type: 'category', inverse: true, data: Array.from({ length: 24 }, (_, h) => h),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: T.muted, fontSize: 11, interval: 0, formatter: (h) => (h % 6 === 0 ? pad(h) + ':00' : '') },
      },
      visualMap: {
        type: 'continuous', min: lo, max: hi, dimension: 2, calculable: false, orient: 'horizontal',
        right: 4, top: 0, itemWidth: 10, itemHeight: 140, text: [hi + ' bpm', lo + ' bpm'],
        textStyle: { color: T.muted, fontSize: 11 }, inRange: { color: T.seq },
      },
      tooltip: tooltip(ctx, (p) => ttDom(
        bucketTitle(bk[p.value[0]], gran).replace('（周均）', '').replace('（月均）', ''),
        [{ name: pad(p.value[1]) + ':00 – ' + pad((p.value[1] + 1) % 24) + ':00', value: p.value[2] + ' bpm', color: p.color, box: true }],
        gran === 'day' ? null : '该时段的平均心率'), { item: true }),
      series: [{
        type: 'heatmap', data, progressive: 0,
        itemStyle: { borderColor: T.surface, borderWidth: labels.length <= 120 ? 1 : 0 },
        emphasis: { itemStyle: { borderColor: T.ink, borderWidth: 1 } },
      }],
    });
    const cols = ['00–06', '06–12', '12–18', '18–24'];
    const rows = [];
    for (let x = bk.length - 1; x >= 0; x--) {
      const sums = [0, 0, 0, 0], ns = [0, 0, 0, 0];
      for (const r of data) if (r[0] === x) { sums[Math.floor(r[1] / 6)] += r[2]; ns[Math.floor(r[1] / 6)]++; }
      if (ns.some(Boolean)) rows.push([labels[x], ...sums.map((s, k) => (ns[k] ? num(s / ns[k]) : '–'))]);
    }
    return { option, table: { cols: [gran === 'day' ? '日期' : gran === 'week' ? '周（起始日）' : '月份', ...cols.map((c) => c + ' 时均值')], rows } };
  };

  // ------------------------------------------------------------------ workouts
  const W = H.workouts;
  const typeTotals = new Map();
  for (const w of W) typeTotals.set(w.type, (typeTotals.get(w.type) || 0) + w.min);
  /** colour follows the workout type (ranked once over all data), never the current filter */
  const TYPE_ORDER = [...typeTotals.entries()].sort((p, q) => q[1] - p[1]).map((e) => e[0]);
  const TOP_TYPES = TYPE_ORDER.slice(0, 5);
  HD.typeColor = (type, T) => { const k = TOP_TYPES.indexOf(type); return k < 0 ? T.n1 : T.s[k]; };
  HD.workoutsIn = (a, b) => W.filter((w) => w.d >= a && w.d <= b);
  const workoutBuckets = (ctx) => (ctx.gran === 'day' ? buckets(ctx.a, ctx.b, 'week') : ctx.bk);
  const workoutGran = (ctx) => (ctx.gran === 'day' ? 'week' : ctx.gran);

  HD.workoutVolume = (ctx) => {
    const T = ctx.T, bk = workoutBuckets(ctx), gran = workoutGran(ctx), labels = bk.map((b) => b.label);
    const names = [...TOP_TYPES, '其他'];
    const sums = names.map(() => labels.map(() => 0)), counts = labels.map(() => 0);
    let any = false;
    for (const w of W) {
      const x = bk.findIndex((b) => w.d >= b.i0 && w.d <= b.i1);
      if (x < 0) continue;
      const k = TOP_TYPES.indexOf(w.type);
      sums[k < 0 ? names.length - 1 : k][x] += w.min;
      counts[x]++; any = true;
    }
    if (!any) return { empty: true };
    const parts = names.map((n, k) => ({ name: n, color: k < TOP_TYPES.length ? T.s[k] : T.n1, data: sums[k].map((v) => Math.round(v)) }))
      .filter((p) => p.data.some(Boolean));
    const c2 = Object.assign({}, ctx, { gran, bk });
    const option = stackOption(c2, labels, parts, { minutes: true });
    option.tooltip = tooltip(ctx, (i) => ttDom(bucketTitle(bk[i], gran).replace('周均', '合计').replace('月均', '合计'), [
      ...parts.map((p) => ({ name: p.name, value: p.data[i] ? mins(p.data[i]) : null, color: p.color, box: true })),
      { name: '合计', value: mins(parts.reduce((s, p) => s + p.data[i], 0)) },
    ], counts[i] + ' 次训练'), { shadow: true });
    return {
      option, legend: parts.map((p) => ({ name: p.name, color: p.color })),
      table: {
        cols: [gran === 'week' ? '周（起始日）' : '月份', '次数', ...parts.map((p) => p.name + '（分）')],
        rows: labels.map((l, i) => [l, counts[i], ...parts.map((p) => p.data[i] || '–')]).filter((r) => r[1]).reverse(),
      },
    };
  };

  HD.workoutZones = (ctx) => {
    const T = ctx.T, bk = workoutBuckets(ctx), gran = workoutGran(ctx), labels = bk.map((b) => b.label);
    const sums = [0, 1, 2, 3, 4].map(() => labels.map(() => 0));
    let any = false;
    for (const w of W) {
      if (!w.zones || w.zones.length !== 5) continue;
      const x = bk.findIndex((b) => w.d >= b.i0 && w.d <= b.i1);
      if (x < 0) continue;
      w.zones.forEach((m, k) => { sums[k][x] += m; });
      any = true;
    }
    if (!any) return { empty: true };
    const parts = sums.map((s, k) => ({ name: '区间 ' + (k + 1), color: T.zones[k], data: s.map((v) => Math.round(v)) }));
    const option = stackOption(Object.assign({}, ctx, { gran, bk }), labels, parts, { minutes: true });
    option.tooltip = tooltip(ctx, (i) => ttDom(bucketTitle(bk[i], gran).replace('周均', '合计').replace('月均', '合计'),
      parts.map((p) => ({ name: p.name, value: p.data[i] ? mins(p.data[i]) : null, color: p.color, box: true })).reverse()), { shadow: true });
    return {
      option, legend: parts.map((p) => ({ name: p.name, color: p.color })),
      table: {
        cols: [gran === 'week' ? '周（起始日）' : '月份', ...parts.map((p) => p.name + '（分）')],
        rows: labels.map((l, i) => [l, ...parts.map((p) => p.data[i] || '–')]).filter((r) => r.slice(1).some((v) => v !== '–')).reverse(),
      },
    };
  };

  // ------------------------------------------------------------------ weekday pattern
  /** spec: { key, name, unit, fmt, axisFmt } — fmt (optional) formats a value, unit included */
  HD.weekdayBars = (spec) => (ctx) => {
    const T = ctx.T, arr = D[spec.key];
    const fmt = spec.fmt || ((v) => num(v) + ' ' + spec.unit);
    const s = new Array(7).fill(0), n = new Array(7).fill(0);
    for (let i = ctx.a; i <= ctx.b; i++) if (arr[i] != null) { s[DOW[i]] += arr[i]; n[DOW[i]]++; }
    if (!n.some(Boolean)) return { empty: true };
    const data = s.map((v, k) => (n[k] ? Math.round(v / n[k]) : null));
    const c2 = Object.assign({}, ctx, { a: 0, b: 0 });
    const option = Object.assign(baseOption(ctx, { right: 12, top: 26 }), {
      xAxis: Object.assign(xAxis(WEEKDAY, c2, true), { axisLabel: { color: T.muted, fontSize: 11 } }),
      yAxis: yAxis(ctx, { zero: true, fmt: spec.axisFmt }),
      tooltip: tooltip(ctx, (i) => ttDom(WEEKDAY[i], [{ name: '平均' + spec.name, value: data[i] == null ? null : fmt(data[i]), color: T.s[0], box: true }], n[i] + ' 天')),
      series: [{
        type: 'bar', data, barMaxWidth: 24, itemStyle: { color: T.s[0], borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', color: T.ink2, fontSize: 11, formatter: (p) => (spec.fmt ? spec.fmt(p.value) : num(p.value)) },
        labelLayout: { hideOverlap: true },                // narrow screens: drop colliding labels, the table keeps every value
        emphasis: { disabled: true },
      }],
    });
    return { option, table: { cols: ['星期', '平均' + spec.name, '天数'], rows: WEEKDAY.map((w, k) => [w, data[k] == null ? '–' : fmt(data[k]), n[k]]) } };
  };

  // ------------------------------------------------------------------ sleeping heart rate against its usual level
  const AN = (H.analysis || {}).daily || {};
  const HR_RULE = (((H.reference || {}).indicators || []).find((x) => x.id === 'night_hr_rise') || {}).params || { rise_bpm: 4, min_nights: 2 };
  /** each night above (or below) the median of the nights before it; nights in a run of high ones stand out */
  HD.nightHrRise = (ctx) => {
    const T = ctx.T, a = ctx.a, b = ctx.b, rise = AN.hrRise, run = AN.hrRun;
    if (!rise || !rise.slice(a, b + 1).some((v) => v != null)) return { empty: true };
    const inRun = new Set(((H.analysis || {}).hrRuns || []).flatMap((e) => e.members));
    const labels = DAYS.slice(a, b + 1);
    const c = { T, a, b };
    const kind = (d) => (rise[d] == null ? null : inRun.has(d) ? 'run' : rise[d] >= HR_RULE.rise_bpm ? 'one' : 'ok');
    const color = { run: T.s[0], one: T.soft, ok: T.n2 };
    const data = labels.map((_, k) => {
      const d = a + k, v = rise[d];
      return v == null ? null : { value: v, itemStyle: { color: color[kind(d)], borderRadius: v >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2] } };
    });
    const word = { run: '连续偏高', one: '只偏高这一晚', ok: '和平时差不多' };
    const option = Object.assign(baseOption(c, { right: 12 }), {
      xAxis: xAxis(labels, c, true),
      yAxis: yAxis(c, { fmt: (v) => (v > 0 ? '+' : '') + v }),
      tooltip: tooltip(c, (i) => {
        const d = a + i;
        if (rise[d] == null) return '';
        return ttDom(labels[i] + ' ' + WEEKDAY[DOW[d]], [
          { name: '睡眠心率', value: D.sleepHr[d] == null ? null : num(D.sleepHr[d], 1) + ' 次/分', color: color[kind(d)], box: true },
          { name: '平时（此前各晚的中位数）', value: AN.hrBase[d] == null ? null : num(AN.hrBase[d], 1) + ' 次/分' },
          { name: '差', value: HD.signed(rise[d], 1) + ' 次/分' },
        ], run[d] >= 2 ? `连续第 ${run[d]} 晚偏高` : word[kind(d)]);
      }, { shadow: true }),
      series: [{
        type: 'bar', data, barMaxWidth: 10, barMinWidth: 1, emphasis: { disabled: true },
        markLine: {
          silent: true, symbol: 'none', animation: false, lineStyle: { color: T.muted, width: 1, type: 'dashed' },
          label: { position: 'insideEndTop', color: T.muted, fontSize: 10, formatter: `高出 ${HR_RULE.rise_bpm} 次/分` },
          data: [{ yAxis: HR_RULE.rise_bpm }],
        },
      }],
    });
    const rows = [];
    for (let d = b; d >= a; d--) {
      if (rise[d] == null) continue;
      rows.push([DAYS[d], num(D.sleepHr[d], 1), num(AN.hrBase[d], 1), HD.signed(rise[d], 1), run[d] >= 2 ? `连续第 ${run[d]} 晚` : word[kind(d)]]);
    }
    return {
      option, drill: true,
      legend: [{ name: `连续 ${HR_RULE.min_nights} 晚以上偏高`, color: T.s[0] }, { name: '只偏高一晚', color: T.soft }, { name: '其他夜晚', color: T.n2 }],
      table: { cols: ['日期', '睡眠心率', '平时', '差（次/分）', ''], rows },
    };
  };

  // ------------------------------------------------------------------ weekly rhythm of a reading
  /** spec: { key, name, unit, dec } — how far each weekday sits from the days around it (noise.py), with 95% bars */
  HD.weekdayRhythm = (spec) => (ctx) => {
    const T = ctx.T, rows = (((H.noise || {}).weekday || {})[spec.key]);
    if (!rows) return { empty: true };
    const dec = spec.dec == null ? 2 : spec.dec, unit = spec.unit ? ' ' + spec.unit : '';
    const mean = rows.map((r) => r[0]), se = rows.map((r) => r[1]);
    const c2 = Object.assign({}, ctx, { a: 0, b: 0 });
    const fmt = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v), dec) + unit;
    const option = Object.assign(baseOption(ctx, { right: 12, top: 18 }), {
      xAxis: Object.assign(xAxis(WEEKDAY, c2, true), { axisLabel: { color: T.muted, fontSize: 11 } }),
      yAxis: yAxis(ctx, { fmt: (v) => (v > 0 ? '+' : '') + v }),
      tooltip: tooltip(ctx, (i) => ttDom(WEEKDAY[i], [
        { name: '比前后几天的平均', value: mean[i] == null ? null : fmt(mean[i]), color: T.s[0], box: true },
        { name: '95% 范围', value: mean[i] == null ? null : fmt(mean[i] - 1.96 * se[i]) + ' 到 ' + fmt(mean[i] + 1.96 * se[i]) },
      ], rows[i][2] + ' 次称重'), { shadow: true }),
      series: [
        { type: 'bar', data: mean, barMaxWidth: 26, itemStyle: { color: T.s[0], borderRadius: 2 }, emphasis: { disabled: true } },
        {
          type: 'custom', silent: true, tooltip: { show: false }, z: 5, encode: { x: 0, y: [1, 2] },   // the axis spans the whiskers
          data: mean.map((m, i) => (m == null ? [i, null, null] : [i, m - 1.96 * se[i], m + 1.96 * se[i]])),
          renderItem: (params, api) => {
            if (api.value(1) == null || Number.isNaN(api.value(1))) return null;
            const lo = api.coord([api.value(0), api.value(1)]), hi = api.coord([api.value(0), api.value(2)]);
            const w = 5, style = { stroke: T.ink2, lineWidth: 1.2 };
            return { type: 'group', children: [
              { type: 'line', shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style },
              { type: 'line', shape: { x1: lo[0] - w, y1: lo[1], x2: lo[0] + w, y2: lo[1] }, style },
              { type: 'line', shape: { x1: hi[0] - w, y1: hi[1], x2: hi[0] + w, y2: hi[1] }, style },
            ] };
          },
        },
      ],
    });
    // seven weekdays are looked at together: one of them past its 95% bar is no surprise, so the
    // verdict uses the Bonferroni line for seven comparisons (two-sided 0.05 / 7, z = 2.69)
    const clear = rows.map((r) => r[0] != null && Math.abs(r[0]) > 2.69 * r[1]);
    return {
      option, clear,
      table: { cols: ['星期', '比前后几天的平均', '95% 范围', '称重次数'],
        rows: WEEKDAY.map((w, i) => [w, mean[i] == null ? '–' : fmt(mean[i]),
          mean[i] == null ? '–' : fmt(mean[i] - 1.96 * se[i]) + ' 到 ' + fmt(mean[i] + 1.96 * se[i]), rows[i][2]]) },
    };
  };

  // ------------------------------------------------------------------ ECG strip
  HD.ecgOption = (rec, T) => {
    const step = 1 / rec.fs;
    const data = rec.uv.map((v, i) => [+(i * step).toFixed(4), v / 1000]);
    return {
      animation: false, textStyle: { fontFamily: HD.FONT },
      grid: { left: 4, right: 16, top: 12, bottom: 44, containLabel: true },
      xAxis: {
        type: 'value', min: 0, max: rec.sec, minInterval: 0.2,
        axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false },
        axisLabel: { color: T.muted, fontSize: 11, formatter: (v) => v + ' s' },
        splitLine: { lineStyle: { color: T.grid } },
      },
      yAxis: {
        type: 'value', scale: true, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: T.muted, fontSize: 11, formatter: (v) => v + ' mV' },
        splitLine: { lineStyle: { color: T.grid } },
      },
      dataZoom: [
        { type: 'inside', startValue: 0, endValue: 10 },
        {
          type: 'slider', height: 18, bottom: 6, startValue: 0, endValue: 10, showDetail: false,
          borderColor: T.grid, fillerColor: T.wash, backgroundColor: 'transparent',
          dataBackground: { lineStyle: { color: T.axis }, areaStyle: { color: 'transparent' } },
          selectedDataBackground: { lineStyle: { color: T.muted }, areaStyle: { color: 'transparent' } },
          handleStyle: { color: T.surface, borderColor: T.muted }, moveHandleStyle: { color: T.axis },
        },
      ],
      tooltip: {
        trigger: 'axis', confine: true, transitionDuration: 0, backgroundColor: T.surface, borderColor: T.axis, borderWidth: 1,
        padding: [8, 10], extraCssText: 'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.14);',
        axisPointer: { type: 'line', lineStyle: { color: T.muted, width: 1, type: 'solid' } },
        formatter: (ps) => {
          const p = Array.isArray(ps) ? ps[0] : ps;
          if (!p || !Array.isArray(p.value)) return '';
          return ttDom(p.value[0].toFixed(2) + ' 秒', [{ name: '电压', value: p.value[1].toFixed(3) + ' mV', color: T.ink }]);
        },
      },
      series: [{
        type: 'line', data, showSymbol: false, sampling: 'lttb',
        lineStyle: { width: 1.25, color: T.ink, join: 'round' }, emphasis: { disabled: true },
      }],
    };
  };

  // ------------------------------------------------------------------ sparkline (stat tiles)
  /** `prev` in the de-emphasis grey, `cur` in the accent, on one shared scale */
  HD.sparkline = (prev, cur) => {
    const all = [...prev, ...cur].filter((v) => v != null);
    if (all.length < 2) return null;
    const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
    const n = prev.length + cur.length, Wd = 200, Ht = 30;
    const x = (i) => (n === 1 ? 0 : (i / (n - 1)) * Wd), y = (v) => Ht - 2 - ((v - lo) / span) * (Ht - 4);
    const path = (vals, off) => {
      let d = '', pen = false;
      vals.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + x(i + off).toFixed(1) + ' ' + y(v).toFixed(1);
        pen = true;
      });
      return d;
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${Wd} ${Ht}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const mk = (d, stroke) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(p);
    };
    const lastPrev = prev.length ? prev[prev.length - 1] : null;
    if (prev.length) mk(path(prev, 0), 'var(--neutral-2)');
    // join the two periods so the line does not break at the boundary
    mk(path(lastPrev == null ? cur : [lastPrev, ...cur], lastPrev == null ? prev.length : prev.length - 1), 'var(--series-1)');
    return svg;
  };

  Object.assign(HD, { tableOf, anyValue, round, TYPE_ORDER, meanOf, SEGS, STAGE_NAMES, stackOption });
})();
