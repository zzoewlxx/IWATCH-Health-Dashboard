/* Shared plumbing: data access, formatting, time buckets, theme tokens, ECharts helpers. */
(function () {
  'use strict';
  const H = window.HEALTH_DATA;
  const HD = (window.HD = {});
  if (!H || !window.echarts) {
    document.getElementById('main').innerHTML =
      '<div class="empty" style="min-height:240px">还没有数据。请先双击运行「更新数据.bat」，完成后刷新本页。</div>';
    return;
  }

  const DAYS = H.days, N = DAYS.length, D = H.daily;
  Object.assign(HD, { H, DAYS, N, D });

  // ---------------------------------------------------------------- DOM
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'style') n.style.cssText = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(3)) {
      if (kid == null || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }
  HD.el = el;

  // ---------------------------------------------------------------- formatting
  const pad = (n) => String(n).padStart(2, '0');
  function num(v, dec = 0) {
    if (v == null || Number.isNaN(v)) return '–';
    return v.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  /** minutes relative to midnight (may be negative or >1440) -> "23:40" */
  function clock(min) {
    if (min == null) return '–';
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }
  /** hours -> "7小时32分" */
  function hm(hours) {
    if (hours == null) return '–';
    const m = Math.round(hours * 60);
    return m < 60 ? m + '分' : Math.floor(m / 60) + '小时' + pad(m % 60) + '分';
  }
  /** minutes -> "1小时05分" / "42分" */
  const mins = (m) => (m == null ? '–' : hm(m / 60));
  const signed = (v, dec = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v), dec);
  Object.assign(HD, { pad, num, clock, hm, mins, signed });

  // ---------------------------------------------------------------- calendar
  const T0 = Date.UTC(+DAYS[0].slice(0, 4), +DAYS[0].slice(5, 7) - 1, +DAYS[0].slice(8, 10));
  const dateOf = (i) => new Date(T0 + i * 864e5);
  const iso = (i) => (i >= 0 && i < N ? DAYS[i] : dateOf(i).toISOString().slice(0, 10));
  const DOW = new Int8Array(N);                      // 0 = Monday
  for (let i = 0; i < N; i++) DOW[i] = (dateOf(i).getUTCDay() + 6) % 7;
  const WEEKDAY = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const DAY_INDEX = new Map(DAYS.map((d, i) => [d, i]));
  /** index of a date string, clamped into the data range */
  function indexOfDate(s) {
    if (DAY_INDEX.has(s)) return DAY_INDEX.get(s);
    if (s < DAYS[0]) return 0;
    if (s > DAYS[N - 1]) return N - 1;
    return Math.max(0, Math.min(N - 1, Math.round((Date.parse(s + 'T00:00:00Z') - T0) / 864e5)));
  }
  Object.assign(HD, { DOW, WEEKDAY, iso, indexOfDate });

  // ---------------------------------------------------------------- buckets
  const bucketCache = new Map();
  /**
   * Time buckets for the range [a, b]. Weeks (Monday start) and months are taken whole,
   * even when the range starts mid-week, so every bucket is a like-for-like average.
   */
  function buckets(a, b, gran) {
    const key = a + '|' + b + '|' + gran;
    if (bucketCache.has(key)) return bucketCache.get(key);
    const out = [];
    if (gran === 'day') {
      for (let i = a; i <= b; i++) out.push({ i0: i, i1: i, label: DAYS[i] });
    } else if (gran === 'week') {
      let i = a - DOW[a];
      while (i <= b) {
        out.push({ i0: Math.max(0, i), i1: Math.min(N - 1, i + 6), label: iso(i) });
        i += 7;
      }
    } else {
      let i = a;
      while (i > 0 && DAYS[i - 1].slice(0, 7) === DAYS[a].slice(0, 7)) i--;
      while (i <= b) {
        const m = DAYS[i].slice(0, 7);
        let j = i;
        while (j + 1 < N && DAYS[j + 1].slice(0, 7) === m) j++;
        out.push({ i0: i, i1: j, label: m });
        i = j + 1;
      }
    }
    bucketCache.set(key, out);
    return out;
  }
  function bucketTitle(bk, gran) {
    if (gran === 'day') return bk.label + ' ' + WEEKDAY[DOW[bk.i0]];
    if (gran === 'week') return DAYS[bk.i0] + ' 至 ' + DAYS[bk.i1].slice(5) + '（周均）';
    return bk.label.slice(0, 4) + ' 年 ' + +bk.label.slice(5) + ' 月（月均）';
  }
  function meanOf(arr, i0, i1) {
    let s = 0, n = 0;
    for (let i = i0; i <= i1; i++) if (arr[i] != null) { s += arr[i]; n++; }
    return n ? s / n : null;
  }
  function countOf(arr, i0, i1) {
    let n = 0;
    for (let i = i0; i <= i1; i++) if (arr[i] != null) n++;
    return n;
  }
  const aggMean = (arr, bk) => bk.map((b) => meanOf(arr, b.i0, b.i1));
  const aggCount = (arr, bk) => bk.map((b) => countOf(arr, b.i0, b.i1));
  function firstLast(arr, i0, i1) {
    let f = null, l = null;
    for (let i = i0; i <= i1; i++) if (arr[i] != null) { if (f == null) f = i; l = i; }
    return f == null ? null : { first: f, last: l };
  }
  Object.assign(HD, { buckets, bucketTitle, meanOf, countOf, aggMean, aggCount, firstLast });

  const rollCache = new Map();
  /** trailing mean over the last `win` days, needs at least `minN` values */
  function rolling(key, win = 7, minN = 3) {
    const ck = key + '|' + win + '|' + minN;
    if (rollCache.has(ck)) return rollCache.get(ck);
    const arr = typeof key === 'string' ? D[key] : key;
    const out = new Array(N).fill(null);
    let s = 0, n = 0;
    for (let i = 0; i < N; i++) {
      if (arr[i] != null) { s += arr[i]; n++; }
      if (i >= win && arr[i - win] != null) { s -= arr[i - win]; n--; }
      if (n >= minN) out[i] = s / n;
    }
    if (typeof key === 'string') rollCache.set(ck, out);
    return out;
  }
  HD.rolling = rolling;

  const baseCache = new Map();
  /**
   * Personal baseline for each day: mean and standard deviation of the `win` days
   * before it (the day itself is excluded, so a value is always judged against the past).
   */
  function baseline(key, win = 28, minN = 10) {
    const ck = key + '|' + win + '|' + minN;
    if (baseCache.has(ck)) return baseCache.get(ck);
    const arr = D[key], mean = new Array(N).fill(null), sd = new Array(N).fill(null);
    for (let i = 1; i < N; i++) {
      let s = 0, ss = 0, n = 0;
      for (let j = Math.max(0, i - win); j < i; j++) {
        const v = arr[j];
        if (v != null) { s += v; ss += v * v; n++; }
      }
      if (n >= minN) {
        mean[i] = s / n;
        sd[i] = Math.sqrt(Math.max(0, ss / n - mean[i] * mean[i]));
      }
    }
    const out = { mean, sd };
    baseCache.set(ck, out);
    return out;
  }
  HD.baseline = baseline;

  // ---------------------------------------------------------------- theme
  let themeCache = null;
  /** read from <body>: each page (its film) can set its own colours there */
  function theme() {
    if (themeCache) return themeCache;
    const cs = getComputedStyle(document.body);
    const v = (name) => cs.getPropertyValue(name).trim();
    themeCache = {
      surface: v('--surface'), ink: v('--ink'), ink2: v('--ink-2'), muted: v('--muted'),
      grid: v('--grid'), axis: v('--axis'), border: v('--border'), wash: v('--wash'), band: v('--band'),
      n1: v('--neutral-1'), n2: v('--neutral-2'),
      s: [1, 2, 3, 4, 5].map((i) => v('--series-' + i)),
      soft: v('--series-1-soft'),
      stage: { rem: v('--stage-rem'), core: v('--stage-core'), deep: v('--stage-deep'), awake: v('--stage-awake') },
      zones: [1, 2, 3, 4, 5].map((i) => v('--zone-' + i)),
      seq: [v('--seq-lo'), v('--seq-mid'), v('--seq-hi')],
      good: v('--good'), bad: v('--bad'),
    };
    return themeCache;
  }
  HD.theme = theme;
  HD.resetTheme = () => { themeCache = null; };

  // ---------------------------------------------------------------- ECharts helpers
  const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
  HD.FONT = FONT;

  function xLabeler(ctx) {
    const multiYear = DAYS[ctx.a].slice(0, 4) !== DAYS[ctx.b].slice(0, 4);
    return (v) => (v.length === 7 ? v : multiYear ? v.slice(2) : v.slice(5));
  }
  function xAxis(labels, ctx, bar) {
    const T = ctx.T;
    return {
      type: 'category', data: labels, boundaryGap: !!bar,
      axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false },
      axisLabel: { color: T.muted, fontSize: 11, hideOverlap: true, formatter: xLabeler(ctx), margin: 10 },
      splitLine: { show: false },
    };
  }
  function yAxis(ctx, o = {}) {
    const T = ctx.T;
    return {
      type: 'value', scale: !o.zero, min: o.min, max: o.max, inverse: !!o.inverse, interval: o.interval,
      splitNumber: o.split || 4, minInterval: o.minInterval,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: T.muted, fontSize: 11, formatter: o.fmt, margin: 10 },
      splitLine: { lineStyle: { color: T.grid, width: 1, type: 'solid' } },
    };
  }
  function ttDom(title, rows, foot) {
    const box = el('div', { class: 'tt' });
    if (title) box.append(el('div', { class: 'h', text: title }));
    for (const r of rows) {
      if (!r || r.value == null) continue;
      box.append(el('div', { class: 'r' },
        el('i', { class: r.box ? 'box' : '', style: 'background:' + (r.color || 'transparent') }),
        el('span', { class: 'n', text: r.name }),
        el('b', { text: r.value })));
    }
    if (!box.querySelector('.r')) foot = '这里没有数据';
    if (foot) box.append(el('div', { class: 'f', text: foot }));
    return box;
  }
  function tooltip(ctx, render, o = {}) {
    const T = ctx.T;
    return {
      trigger: o.item ? 'item' : 'axis', confine: true, transitionDuration: 0,
      backgroundColor: T.surface, borderColor: T.axis, borderWidth: 1, padding: [8, 10],
      extraCssText: 'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.14);',
      axisPointer: o.shadow
        ? { type: 'shadow', shadowStyle: { color: T.wash } }
        : { type: 'line', lineStyle: { color: T.muted, width: 1, type: 'solid' } },
      formatter: (ps) => {
        if (o.item) return render(ps) || '';
        const p = Array.isArray(ps) ? ps[0] : ps;
        return p ? render(p.dataIndex, p) || '' : '';
      },
    };
  }
  /** end dot (8px, 2px surface ring) with the latest value beside it */
  function endPoint(labels, values, color, ctx, fmt) {
    let i = values.length - 1;
    while (i >= 0 && values[i] == null) i--;
    if (i < 0) return undefined;
    return {
      symbol: 'circle', symbolSize: 8, silent: true, animation: false,
      itemStyle: { color, borderColor: ctx.T.surface, borderWidth: 2 },
      label: { show: true, position: 'right', distance: 5, color: ctx.T.ink2, fontSize: 11, formatter: () => fmt(values[i]) },
      data: [{ coord: [labels[i], values[i]] }],
    };
  }
  const shortSource = (s) => (/apple\s*watch/i.test(s) ? 'Apple Watch' : /iphone/i.test(s) ? 'iPhone' : s);
  /** vertical hairlines where the device behind a metric changed */
  function eraLines(key, ctx) {
    const runs = (H.meta.eras || {})[key];
    if (!runs || runs.length < 2) return undefined;
    const data = [];
    for (const run of runs.slice(1)) {
      const i = DAY_INDEX.get(run.from);
      if (i == null) continue;
      const b = ctx.bk.findIndex((x) => i >= x.i0 && i <= x.i1);
      if (b <= 0) continue;
      data.push({ xAxis: ctx.bk[b].label, label: { formatter: '改用 ' + shortSource(run.src) } });
    }
    if (!data.length) return undefined;
    return {
      silent: true, symbol: 'none', animation: false,
      lineStyle: { color: ctx.T.axis, width: 1, type: 'solid' },
      label: { position: 'end', color: ctx.T.muted, fontSize: 10, distance: 4 },
      data,
    };
  }
  function baseOption(ctx, o = {}) {
    return {
      animation: false,
      textStyle: { fontFamily: FONT },
      grid: { left: 4, right: o.right == null ? 44 : o.right, top: o.top == null ? 22 : o.top, bottom: o.bottom == null ? 2 : o.bottom, containLabel: true },
      legend: { show: false },
    };
  }
  Object.assign(HD, { xAxis, yAxis, ttDom, tooltip, endPoint, eraLines, baseOption, shortSource });
})();
