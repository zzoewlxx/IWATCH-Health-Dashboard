/* The headphone page, told like a Hong Kong night film: reels, acts, subtitles, a cast list. */
(function () {
  'use strict';
  const HD = window.HD;
  if (!HD || !HD.H) return;
  const { H, DAYS, N, D, el, num, clock, mins, pad, buckets, ttDom, yAxis, WEEKDAY, DOW } = HD;
  const AU = H.audio || null;
  const HP = (window.HEALTH_INTRADAY || {}).hp || [];
  const REF = new Map(((H.reference || {}).indicators || []).map((x) => [x.id, x]));
  const DOSE = Object.assign({ ref_db: 80, ref_hours: 40, window_days: 7, session_gap_min: 5, level_bins: [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90] },
    (REF.get('headphone_dose') || {}).params);
  const TEST = Object.assign({ pta_freqs: [500, 1000, 2000, 4000], normal_below: 20, change_db: 10, grades: [] },
    (REF.get('hearing_test') || {}).params);
  const ready = !!AU && Array.isArray(D.listenMin) && Array.isArray(AU.devDb);
  const DEV = ready ? AU.devices : [];
  const PARTIAL = DAYS.indexOf(H.meta.partialDay);
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const NIGHT = [22, 23, 0, 1, 2, 3, 4];                          // "夜里": 22:00 to 05:00
  const WHO_TABLE = [[80, '40 小时'], [85, '12 小时 30 分'], [90, '4 小时'], [95, '1 小时 15 分'], [100, '20 分钟']];
  // Two films, picked by the stylesheet (--hk-mode): night is neon red, tungsten amber and fluorescent
  // teal on green-black; day is a sunny afternoon shot bright: jade green, deep blue and vermilion on warm
  // white, flat colour instead of neon. `main` is the listening series, `alt` the night / second series.
  // The day trio was checked for colour-blind separation (protan ΔE 8.2) and 3:1 contrast on the paper.
  const PALETTES = {
    night: { mode: 'night', ink: '#efe6d2', muted: 'rgba(239,230,210,0.6)', grid: 'rgba(239,230,210,0.09)', axis: 'rgba(239,230,210,0.25)',
      faint: 'rgba(239,230,210,0.03)', ring: 'rgba(239,230,210,0.16)', connector: 'rgba(239,230,210,0.32)', band: 'rgba(239,230,210,0.05)',
      red: '#ff4141', main: '#ffb52e', alt: '#3fd6c6', paper: '#0b0f0e', refLabel: '#ff9a9a',
      glow: 1, mainGlow: 'rgba(255,181,46,0.8)', redGlow: 'rgba(255,65,65,1)', area: 'rgba(255,181,46,0.26)', stripArea: 'rgba(255,181,46,0.26)',
      tipBg: 'rgba(8, 11, 10, 0.94)', tipBorder: 'rgba(239,230,210,0.3)', tipDark: true,
      levels: ['rgba(239,230,210,0.05)', 'rgba(255,181,46,0.18)', 'rgba(255,181,46,0.34)', 'rgba(255,181,46,0.54)', 'rgba(255,190,70,0.78)', 'rgba(255,214,120,0.98)'],
      art: { line: '#a8f5ec', accent: '#ff4141', sign: '#ff6a6a', waves: '#ffb52e' } },
    day: { mode: 'day', ink: '#17251c', muted: 'rgba(23,37,28,0.6)', grid: 'rgba(23,37,28,0.08)', axis: 'rgba(23,37,28,0.26)',
      faint: 'rgba(255,253,246,0.6)', ring: 'rgba(23,37,28,0.16)', connector: 'rgba(23,37,28,0.26)', band: 'rgba(23,37,28,0.045)',
      red: '#e85a35', main: '#14683a', alt: '#2a4f9e', paper: '#fffdf6', refLabel: '#c8442a',
      glow: 0, mainGlow: 'rgba(0,0,0,0)', redGlow: 'rgba(0,0,0,0)', area: 'rgba(20,104,58,0.14)', stripArea: 'rgba(255,255,255,0.85)',
      tipBg: 'rgba(255, 253, 246, 0.98)', tipBorder: 'rgba(23,37,28,0.18)', tipDark: false,
      levels: ['rgba(23,37,28,0.06)', '#74c481', '#53ab63', '#3c914e', '#2c783d', '#246131'],
      art: { line: '#14683a', accent: '#e85a35', sign: '#14683a', waves: '#e85a35' } },
  };
  let C = PALETTES.night;
  const MONO = 'Consolas, "SF Mono", Menlo, "Courier New", monospace';
  /** what the reader has picked on this page; kept while switching tabs */
  const page = { dev: -1, weekday: -1, vol: 'level', test: null, cal: null, shown: null };
  const hpParam = new URLSearchParams(location.search).get('hp');
  if (hpParam != null && /^\d+$/.test(hpParam)) page.dev = +hpParam;

  // ------------------------------------------------------------------ words and numbers
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dot = (d) => DAYS[d].replace(/-/g, '.');
  const dateZh = (d) => `${+DAYS[d].slice(0, 4)} 年 ${+DAYS[d].slice(5, 7)} 月 ${+DAYS[d].slice(8, 10)} 日`;
  const dateEn = (d) => `${MONTHS_EN[+DAYS[d].slice(5, 7) - 1]} ${+DAYS[d].slice(8, 10)}, ${DAYS[d].slice(0, 4)}`;
  const PERIOD = (h) => (h < 5 ? '凌晨' : h < 8 ? '清晨' : h < 11 ? '上午' : h < 13 ? '中午' : h < 17 ? '下午' : h < 19 ? '傍晚' : '晚上');
  function clockZh(m) {
    const t = ((Math.round(m) % 1440) + 1440) % 1440, h = Math.floor(t / 60), mm = t % 60;
    const h12 = h <= 12 ? h : h - 12;
    return `${PERIOD(h)} ${h12} 点` + (mm ? ` ${mm} 分` : '');
  }
  function clockEn(m) {
    const t = ((Math.round(m) % 1440) + 1440) % 1440, h = Math.floor(t / 60), mm = t % 60;
    return `${h % 12 || 12}${mm ? ':' + pad(mm) : ''} ${h < 12 ? 'am' : 'pm'}`;
  }
  const hourEn = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
  const pct = (v, dec) => (v == null ? '–' : num(100 * v, dec == null ? 0 : dec) + '%');
  const dosePct = (v) => (v == null ? '–' : (v >= 10 ? num(v, 0) : v >= 1 ? num(v, 1) : num(v, 2)) + '%');
  /** 316 -> "5 小时 16 分", 42 -> "42 分钟" */
  function hmText(m) {
    if (m == null) return '–';
    const t = Math.round(m);
    return t < 60 ? t + ' 分钟' : num(Math.floor(t / 60)) + ' 小时' + (t % 60 ? ' ' + (t % 60) + ' 分' : '');
  }
  /** for the voice-over: 5180 -> "86 个小时 20 分钟" */
  function hoursZh(m) {
    const t = Math.round(m || 0);
    return t < 60 ? `${t} 分钟` : `${num(Math.floor(t / 60))} 个小时` + (t % 60 ? ` ${t % 60} 分钟` : '');
  }
  function hoursEn(m) {
    const t = Math.round(m || 0), h = Math.floor(t / 60), mm = t % 60;
    const hs = h ? `${h.toLocaleString('en-US')} hour${h === 1 ? '' : 's'}` : '';
    const ms = mm ? `${mm} minute${mm === 1 ? '' : 's'}` : '';
    return [hs, ms].filter(Boolean).join(' and ') || '0 minutes';
  }
  /** big digits with small units */
  function hmBig(m) {
    const t = Math.round(m || 0);
    if (t < 60) return [el('b', { text: String(t) }), el('small', { text: '分钟' })];
    return [el('b', { text: num(Math.floor(t / 60)) }), el('small', { text: '小时' })].concat(t % 60 ? [el('b', { text: String(t % 60) }), el('small', { text: '分' })] : []);
  }
  const weeklyAt = (level) => DOSE.ref_hours * Math.pow(10, (DOSE.ref_db - level) / 10);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const grad = (x2, y2, stops) => new window.echarts.graphic.LinearGradient(0, 0, x2, y2,
    stops.map((s, i) => (Array.isArray(s) ? { offset: s[0], color: s[1] } : { offset: stops.length > 1 ? i / (stops.length - 1) : 0, color: s })));
  function filmTip(render, o = {}) {
    return {
      trigger: o.item ? 'item' : 'axis', confine: true, transitionDuration: 0,
      backgroundColor: C.tipBg, borderColor: C.tipBorder, borderWidth: 1, padding: [8, 12],
      extraCssText: 'border-radius:2px;box-shadow:0 10px 30px rgba(0,0,0,' + (C.tipDark ? '.5' : '.15') + ');',
      axisPointer: { type: 'line', lineStyle: { color: C.axis, width: 1, type: 'solid' } },
      formatter: (ps) => { const n = render(ps); if (n && n.classList && C.tipDark) n.classList.add('on-dark'); return n || ''; },
    };
  }
  let axisText = { color: C.muted, fontSize: 11, fontFamily: MONO };
  /** follow the stylesheet: day in the light theme, night in the dark one */
  function usePalette() {
    C = PALETTES[getComputedStyle(document.body).getPropertyValue('--hk-mode').trim() === 'day' ? 'day' : 'night'];
    axisText = { color: C.muted, fontSize: 11, fontFamily: MONO };
  }
  /** replace a panel in place, letting go of any chart inside the old one */
  function swap(oldNode, newNode) {
    oldNode.querySelectorAll('div').forEach((n) => { const c = window.echarts.getInstanceByDom(n); if (c) c.dispose(); });
    oldNode.replaceWith(newNode);
  }
  const add = (box, ...kids) => { for (const k of kids.flat()) if (k != null && k !== false && k !== '') box.append(k); return box; };
  /** a framed panel: title, its English line, and an optional note on the right */
  function panel(cls, title, en, right) {
    return el('section', { class: 'hk-panel ' + cls },
      el('header', { class: 'hk-ph' }, el('h3', null, title, en ? el('span', { text: en }) : null), right ? el('span', { class: 'r', text: right }) : null));
  }
  const scene = (no, zh, en, tc) => el('h2', { class: 'hk-scene' }, el('span', { class: 'no', text: no }), el('span', { class: 't', text: zh }),
    el('span', { class: 'en', text: en }), el('i', { class: 'rule' }), el('span', { class: 'tc', text: tc || '' }));
  const vo = (zh, en) => el('div', { class: 'hk-vo' }, el('p', { class: 'zh', text: zh }), en ? el('p', { class: 'en', text: en }) : null);

  // ------------------------------------------------------------------ the selection
  let firstAll = -1, lastAll = -1;
  if (ready) for (let d = 0; d < N; d++) if (D.listenMin[d] > 0) { if (firstAll < 0) firstAll = d; lastAll = d; }
  const SHAPE = /max|studio|solo|xm\d|wh-|qc\d|头戴|over/i;
  function selectionFor(k) {
    if (k < 0 || !DEV[k]) {
      return { k: -1, label: '全部耳机', min: D.listenMin, db: D.headphone, dose: D.hpDose, hourly: AU.hourly, bins: AU.bins, first: firstAll, last: lastAll, shape: 'all' };
    }
    const dv = DEV[k];
    return { k, label: dv.label, dv, min: AU.devDaily[k], db: AU.devDb[k], dose: AU.devDose[k], hourly: AU.devHourly[k], bins: AU.devBins[k],
      first: dv.first, last: dv.last, shape: SHAPE.test(dv.label + ' ' + dv.name) ? 'over' : 'buds' };
  }
  /** the days the page looks at: "全部" means this pair's own first to last day */
  function rangeFor(S, ui) {
    const st = ui.state;
    if (st.preset === 'all' && S.first >= 0) return { a: S.first, b: S.last };
    return { a: st.a, b: st.b };
  }
  function stats(S, a, b) {
    let minutes = 0, days = 0, listened = 0, em = 0, e = 0;
    for (let d = Math.max(0, a); d <= Math.min(N - 1, b); d++) {
      if (d === PARTIAL || S.min[d] == null) continue;
      days++;
      const m = S.min[d];
      if (m > 0) {
        listened++; minutes += m;
        if (S.db[d] != null) { em += m; e += m * Math.pow(10, S.db[d] / 10); }
      }
    }
    return { minutes, days, listened, db: em > 0 ? 10 * Math.log10(e / em) : null };
  }
  function dose7(S, d) {
    let s = 0;
    for (let i = Math.max(0, d - DOSE.window_days + 1); i <= d; i++) if (i !== PARTIAL && S.dose[i] != null) s += S.dose[i];
    return s;
  }
  const sessionsOf = (S, a, b, minLen = 0) => AU.sessions.filter((s) => s[0] >= a && s[0] <= b && (S.k < 0 || s[5] === S.k) && s[3] >= minLen);
  function hourProfile(S, a, b, weekday = -1) {
    const sums = new Array(24).fill(0);
    let days = 0;
    for (let d = Math.max(0, a); d <= Math.min(N - 1, b); d++) {
      if (d === PARTIAL || S.min[d] == null || (weekday >= 0 && DOW[d] !== weekday)) continue;
      days++;
      const row = S.hourly[d];
      if (row) for (let h = 0; h < 24; h++) sums[h] += row[h];
    }
    return { sums, days };
  }
  function weekdayAverages(S, a, b) {
    const s = new Array(7).fill(0), n = new Array(7).fill(0);
    for (let d = Math.max(0, a); d <= Math.min(N - 1, b); d++) {
      if (d === PARTIAL || S.min[d] == null) continue;
      s[DOW[d]] += S.min[d]; n[DOW[d]]++;
    }
    return s.map((v, k) => (n[k] ? v / n[k] : null));
  }
  function longestRun(S, a, b) {
    let run = 0, best = 0;
    for (let d = Math.max(0, a); d <= Math.min(N - 1, b); d++) {
      if (S.min[d] > 0) best = Math.max(best, ++run); else if (d !== PARTIAL) run = 0;
    }
    return best;
  }
  /** [{a, b, label, title, d?}]: single days up to 3 months, weeks up to about a year, then months */
  function groupsFor(R) {
    const len = R.b - R.a + 1;
    if (len <= 92) {
      const out = [];
      for (let d = R.a; d <= R.b; d++) if (d !== PARTIAL) out.push({ a: d, b: d, d, label: DAYS[d], title: DAYS[d] + ' ' + WEEKDAY[DOW[d]] });
      return { groups: out, unit: 'day' };
    }
    const gran = len <= 400 ? 'week' : 'month';
    const groups = buckets(R.a, R.b, gran).map((bk) => {
      const a = Math.max(bk.i0, R.a), b = Math.min(bk.i1, R.b);
      return { a, b, label: gran === 'week' ? DAYS[bk.i0] : bk.label,
        title: gran === 'week' ? DAYS[a] + ' 至 ' + DAYS[b].slice(5) : +bk.label.slice(0, 4) + ' 年 ' + +bk.label.slice(5) + ' 月' };
    });
    return { groups, unit: gran };
  }
  const UNIT = { day: ['每天', 'DAILY'], week: ['每周', 'WEEKLY'], month: ['每月', 'MONTHLY'] };

  // ------------------------------------------------------------------ pictures: neon line drawings (no product photos)
  const GLOW = '<defs><filter id="hkGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/>' +
    '<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
  const BUD = '<ellipse rx="34" ry="29"/><path d="M-6 17v80a9 9 0 0 0 18 0V21"/><ellipse cx="-29" cy="1" rx="8" ry="13"/><path d="M5 -15h11"/>';
  function art(shape) {
    const a = C.art, f = C.glow ? ' filter="url(#hkGlow)"' : '', defs = C.glow ? GLOW : '';
    const g = (stroke, w, inner) => `<g fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${f}>${inner}</g>`;
    if (shape === 'buds') {
      return `<svg viewBox="0 0 300 220" role="img" aria-label="入耳式耳机">${defs}` +
        g(a.line, 3, `<g transform="translate(112 68) rotate(-13)">${BUD}</g><g transform="translate(190 68) rotate(13) scale(-1 1)">${BUD}</g>`) +
        g(a.accent, 3, '<path d="M78 200h144"/>') + '</svg>';
    }
    if (shape === 'over') {
      return `<svg viewBox="0 0 300 220" role="img" aria-label="头戴式耳机">${defs}` +
        g(a.line, 3, '<path d="M66 132C66 44 234 44 234 132"/><rect x="44" y="114" width="54" height="78" rx="24"/><rect x="202" y="114" width="54" height="78" rx="24"/><path d="M80 128v50M220 128v50"/>') +
        g(a.accent, 3, '<path d="M78 208h144"/>') + '</svg>';
    }
    return `<svg viewBox="0 0 300 220" role="img" aria-label="全部耳机">${defs}` +
      g(a.sign, 3.2, '<path d="M90 136v-24a60 60 0 0 1 120 0v24"/><rect x="78" y="128" width="30" height="50" rx="12"/><rect x="192" y="128" width="30" height="50" rx="12"/>') +
      g(a.waves, 2.4, '<path d="M128 156c6-10 6-22 0-32M146 164c10-18 10-38 0-56M164 156c6-10 6-22 0-32"/>') + '</svg>';
  }

  // ------------------------------------------------------------------ top bar: reels and the time range
  const RANGES = [['all', '全部'], ['365', '一年'], ['90', '90 天'], ['30', '30 天'], ['7', '7 天']];
  function topBar(R, ui) {
    const total = DEV.reduce((s, dv) => s + dv.minutes, 0);
    const reel = (k, i, name, minutes) => el('button', {
      class: 'hk-reel', type: 'button', 'aria-pressed': page.dev === k ? 'true' : 'false',
      onclick: () => { if (page.dev !== k) { page.dev = k; page.weekday = -1; page.cal = null; ui.refresh(); } },
    }, el('span', { class: 'no', text: 'REEL ' + pad(i) }), el('b', { text: name }), el('span', { class: 'h', text: num(Math.round(minutes / 60)) + ' 小时' }));
    const date = (value, onPick, label) => {
      const input = el('input', { type: 'date', value: DAYS[value], min: DAYS[0], max: DAYS[N - 1], 'aria-label': label });
      input.addEventListener('change', () => { if (input.value) onPick(HD.indexOfDate(input.value)); });
      return input;
    };
    return el('header', { class: 'hk-top' },
      el('nav', { class: 'hk-reels', 'aria-label': '选择耳机' },
        reel(-1, 0, '全部耳机', total), DEV.map((dv, k) => reel(k, k + 1, dv.label, dv.minutes))),
      el('div', { class: 'hk-range' },
        el('div', { class: 'opts', role: 'group', 'aria-label': '时间范围' }, RANGES.map(([id, name]) => el('button', {
          type: 'button', 'aria-pressed': ui.state.preset === id ? 'true' : 'false', text: name, onclick: () => ui.setPreset(id) }))),
        el('div', { class: 'dates' }, date(R.a, (a) => ui.setRange(a, R.b), '开始日期'), el('span', { text: '—' }), date(R.b, (b) => ui.setRange(R.a, b), '结束日期'))));
  }

  // ------------------------------------------------------------------ the title card
  function heroPoints(S, R) {
    const { groups, unit } = groupsFor(R);
    const pts = groups.map((g) => {
      let m = 0, n = 0;
      for (let d = g.a; d <= g.b; d++) if (d !== PARTIAL && S.min[d] != null) { m += S.min[d]; n++; }
      return Object.assign({}, g, { min: m, note: g.d != null ? null : n + ' 天' });
    });
    return { pts, unit };
  }
  function heroOption(pts) {
    const labels = pts.map((p) => p.label), vals = pts.map((p) => +(p.min / 60).toFixed(2));
    let peak = -1;
    vals.forEach((v, i) => { if (v > 0 && (peak < 0 || v > vals[peak])) peak = i; });
    return {
      option: {
        animation: !REDUCED, animationDuration: 900, animationEasing: 'cubicOut',
        textStyle: { fontFamily: HD.FONT },
        grid: { left: 10, right: 10, top: 14, bottom: 4, containLabel: true },
        xAxis: {
          type: 'category', data: labels, boundaryGap: false, axisLine: { show: false }, axisTick: { show: false },
          axisLabel: Object.assign({}, axisText, { interval: (i) => i === 0 || i === labels.length - 1, alignMinLabel: 'left', alignMaxLabel: 'right',
            formatter: (v) => v.replace(/-/g, '.') }),
        },
        yAxis: { type: 'value', min: 0, splitNumber: 3, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false },
          splitLine: { lineStyle: { color: C.grid } } },
        tooltip: filmTip((ps) => {
          const p = pts[(Array.isArray(ps) ? ps[0] : ps).dataIndex];
          return ttDom(p.title, [{ name: '收听', value: hmText(p.min), color: C.main }], p.note || (p.d != null ? '点一下看这一天' : null));
        }),
        series: [{
          type: 'line', data: vals, smooth: 0.35, smoothMonotone: 'x', showSymbol: false, symbol: 'circle', symbolSize: 9,
          lineStyle: { width: 2.2, color: C.main, shadowBlur: 14 * C.glow, shadowColor: C.mainGlow, cap: 'round', join: 'round' },
          itemStyle: { color: C.main, borderColor: C.paper, borderWidth: 2 },
          areaStyle: { color: grad(0, 1, [[0, C.stripArea], [1, 'rgba(255,255,255,0)']]) },
          markPoint: peak < 0 ? undefined : {
            symbol: 'circle', symbolSize: 11, silent: true, animation: false, label: { show: false },
            itemStyle: { color: C.red, shadowBlur: 18 * C.glow, shadowColor: C.redGlow, borderColor: C.paper, borderWidth: C.glow ? 0 : 2 },
            data: [{ coord: [labels[peak], vals[peak]] }],
          },
        }],
      },
      peak,
    };
  }
  function countUp(hNode, mNode, minutes) {
    const from = page.shown == null ? 0 : page.shown;
    page.shown = minutes;
    const paint = (v) => { const x = Math.max(0, Math.round(v)); hNode.textContent = num(Math.floor(x / 60)); mNode.textContent = pad(x % 60); };
    if (REDUCED || from === minutes) { paint(minutes); return; }
    // frame times can run behind the clock: time the animation from its own first frame,
    // and once it has landed on the final value let no late frame paint over it
    let t0 = null, done = false;
    const finish = () => { if (!done) { done = true; paint(minutes); } };
    const step = (now) => {
      if (done) return;
      if (t0 == null) t0 = now;
      const k = Math.min(1, Math.max(0, (now - t0) / 800));
      if (k >= 1) { finish(); return; }
      paint(from + (minutes - from) * (1 - Math.pow(1 - k, 3)));
      requestAnimationFrame(step);
    };
    paint(from);
    requestAnimationFrame(step);
    setTimeout(finish, 1000);
  }
  function phrase(R, ui) {
    switch (ui.state.preset) {
      case 'all': return ['这些日子里', 'All this time'];
      case '365': return ['这一年', 'This past year'];
      case '90': return ['这 90 天', 'These 90 days'];
      case '30': return ['这 30 天', 'These 30 days'];
      case '7': return ['这 7 天', 'These 7 days'];
      default: return [`从 ${dateZh(R.a)} 到 ${dateZh(R.b)}`, `From ${dateEn(R.a)} to ${dateEn(R.b)}`];
    }
  }
  function titleCard(S, R, ui) {
    const st = stats(S, R.a, R.b), all = S.k >= 0 ? stats(selectionFor(-1), R.a, R.b) : null;
    const ss = sessionsOf(S, R.a, R.b, 0), last = ss.length ? ss[ss.length - 1] : null;
    const [title, variant] = S.label.split('（');
    const name = title.trim();
    const hN = el('b'), mN = el('b');
    queueMicrotask(() => countUp(hN, mN, st.minutes));
    const facts = [
      st.days ? '日均 ' + hmText(st.minutes / st.days) : null,
      all && all.minutes ? '占全部耳机 ' + pct(st.minutes / all.minutes) : null,
      st.listened ? `${num(st.listened)} 天有它` : null,
      ss.length ? `${num(ss.filter((s) => s[3] >= 1).length)} 次` : null,
    ].filter(Boolean);
    const pic = el('div', { class: 'hk-art' });
    pic.innerHTML = art(S.shape);
    const { pts, unit } = heroPoints(S, R);
    const { option, peak } = heroOption(pts);
    const plot = el('div', { class: 'plot', style: 'height:150px', role: 'img', 'aria-label': `收听时长，${UNIT[unit][0]}一个点` });
    queueMicrotask(() => {
      const chart = ui.mountChart(plot, option);
      if (unit === 'day') {
        plot.style.cursor = 'pointer';
        chart.getZr().on('click', (e) => {
          if (!chart.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return;
          const i = Math.round(chart.convertFromPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])[0]);
          if (pts[i] && pts[i].d != null) ui.gotoDay(DAYS[pts[i].d]);
        });
      }
    });
    const [p0, p1] = phrase(R, ui);
    let zh, en;
    if (st.minutes) {
      zh = (S.k < 0 ? `${p0}，我一共戴着耳机 ${hoursZh(st.minutes)}。` : `${p0}，我和 ${name} 在一起 ${hoursZh(st.minutes)}。`) +
        (last ? `最后一次，是 ${dateZh(last[0])}${clockZh(last[1])}。` : '');
      en = (S.k < 0 ? `${p1}, I wore my headphones for ${hoursEn(st.minutes)}.` : `${p1}, ${name} and I spent ${hoursEn(st.minutes)} together.`) +
        (last ? ` The last time was ${dateEn(last[0])}, ${clockEn(last[1])}.` : '');
    } else {
      zh = `${p0}，它一直安静地躺在盒子里。` + (S.last >= 0 ? `上一次见面，是 ${dateZh(S.last)}。` : '');
      en = `${p1}, it stayed quietly in its case.` + (S.last >= 0 ? ` We last met on ${dateEn(S.last)}.` : '');
    }
    const reelNo = S.k < 0 ? 0 : S.k + 1;
    return el('section', { class: 'hk-hero' },
      el('div', { class: 'bar' },
        el('span', { class: 'rec', text: `REEL ${pad(reelNo)} · ${S.k < 0 ? 'ALL HEADPHONES' : name.toUpperCase()}` }),
        el('span', { text: S.first >= 0 ? `${dot(S.first)} — ${dot(S.last)}` : '' })),
      el('div', { class: 'hk-frame' },
        el('div', { class: 'hk-sign', 'aria-hidden': 'true' }, el('span', { class: 'cn', text: '耳機' }), el('span', { class: 'lat', text: 'EARPHONES' })),
        el('div', { class: 'hk-title' },
          el('div', { class: 'kicker', text: S.k < 0 ? `${DEV.length} 副耳机 · ${num(Math.round(DEV.reduce((s, dv) => s + dv.minutes, 0) / 60))} 小时的故事` : '主演 · STARRING' }),
          el('h2', { class: 'hk-name' }, name, variant ? el('small', { text: variant.replace('）', '') }) : null),
          el('div', { class: 'hk-total', 'aria-live': 'polite' }, hN, el('small', { text: '小时' }), mN, el('small', { text: '分' })),
          el('div', { class: 'hk-facts' }, facts.map((f) => el('span', { text: f }))),
          st.minutes || S.k < 0 || S.last < 0 ? null
            : el('button', { class: 'hk-link', type: 'button', text: '看它的全部记录 →', onclick: () => ui.setPreset('all') })),
        pic),
      el('div', { class: 'hk-strip' },
        el('div', { class: 'head' }, el('span', { text: `${UNIT[unit][0]} · ${UNIT[unit][1]}` }),
          el('span', { text: peak >= 0 ? `最高 ${hmText(pts[peak].min)} · ${pts[peak].title}` : '' })),
        plot),
      el('div', { class: 'hk-subs' }, el('p', { class: 'zh', text: zh }), el('p', { class: 'en', text: en })));
  }

  // ------------------------------------------------------------------ act one: time
  function levels(values) {
    const xs = values.filter((v) => v > 0).sort((p, q) => p - q);
    const q = (f) => xs[Math.min(xs.length - 1, Math.floor(f * xs.length))];
    const cuts = xs.length ? [q(0.2), q(0.45), q(0.7), q(0.9)] : [];
    return (v) => (!(v > 0) ? 0 : 1 + cuts.filter((c) => v > c).length);
  }
  function calendarPanel(S, R, ui) {
    const st = stats(S, R.a, R.b);
    const box = panel('c12 hk-cal-panel', '收听日历', 'CONTACT SHEET', `${num(st.listened)} 天有记录 · 点一格看详情`);
    const big = el('div', { class: 'hk-big' }), what = el('div', { class: 'what' }), more = el('div', { class: 'more' });
    const side = el('div', { class: 'hk-cal-side', 'aria-live': 'polite' }, big, what, more);
    const main = el('div', { class: 'hk-cal-main' });
    let grid;
    const choose = (btn) => { grid.querySelectorAll('.on').forEach((n) => n.classList.remove('on')); if (btn) btn.classList.add('on'); };
    if (R.b - R.a + 1 <= 126) {
      const showDay = (d) => {
        const m = S.min[d] || 0, ss = sessionsOf(S, d, d, 1);
        big.textContent = '';
        big.append(...(m ? hmBig(m) : [el('b', { text: '0' }), el('small', { text: '分钟' })]));
        what.textContent = dateZh(d) + ' ' + WEEKDAY[DOW[d]];
        more.textContent = '';
        add(more, m && S.db[d] != null ? el('div', { text: `平均 ${num(S.db[d])} 分贝` }) : null,
          ss.length ? el('div', { text: `${ss.length} 次，最长一次 ${hmText(Math.max(...ss.map((s) => s[2])))}` }) : null,
          m ? el('button', { class: 'hk-link', type: 'button', text: '看这一天 →', onclick: () => ui.gotoDay(DAYS[d]) }) : el('div', { text: '这一天，没有戴耳机。' }));
      };
      const start = R.a - DOW[R.a], weeks = Math.ceil((R.b - start + 1) / 7);
      const vals = [];
      for (let d = R.a; d <= R.b; d++) vals.push(S.min[d] || 0);
      const lv = levels(vals), cols = `repeat(${weeks},minmax(0,34px))`;
      const months = el('div', { class: 'hk-cal-months', style: 'grid-template-columns:' + cols });
      grid = el('div', { class: 'hk-cal days', style: 'grid-template-columns:' + cols });
      let lastMonth = '', topD = -1, topBtn = null, keep = null;
      for (let w = 0; w < weeks; w++) {
        const first = Math.min(N - 1, Math.max(R.a, start + w * 7)), m = DAYS[first].slice(5, 7);
        months.append(el('span', { text: m !== lastMonth ? +m + '月' : '' }));
        lastMonth = m;
        for (let k = 0; k < 7; k++) {
          const d = start + w * 7 + k;
          if (d < R.a || d > R.b || d >= N) { grid.append(el('i', { class: 'void' })); continue; }
          const v = S.min[d] || 0;
          const btn = el('button', { type: 'button', title: `${DAYS[d]} · ${v ? hmText(v) : '没有戴耳机'}`, 'aria-label': `${DAYS[d]} ${v ? hmText(v) : '没有戴耳机'}`,
            style: 'background:' + C.levels[lv(v)], onclick: (e) => { choose(e.currentTarget); page.cal = d; showDay(d); } });
          grid.append(btn);
          if (v > 0 && (topD < 0 || v > S.min[topD])) { topD = d; topBtn = btn; }
          if (d === page.cal) keep = btn;
        }
      }
      main.append(months, grid);
      if (keep) { choose(keep); showDay(page.cal); } else if (topD >= 0) { choose(topBtn); showDay(topD); more.prepend(el('div', { class: 'hint', text: '听得最久的一天' })); }
      else { big.append(el('b', { text: '–' })); what.textContent = '这段时间没有记录'; }
    } else {
      const y0 = +DAYS[R.a].slice(0, 4), y1 = +DAYS[R.b].slice(0, 4);
      const cells = [];
      for (let y = y0; y <= y1; y++) for (let m = 1; m <= 12; m++) {
        let tot = 0, n = 0, on = 0;
        const key = y + '-' + pad(m);
        for (let d = R.a; d <= R.b; d++) if (DAYS[d].startsWith(key) && d !== PARTIAL && S.min[d] != null) { tot += S.min[d]; n++; if (S.min[d] > 0) on++; }
        cells.push({ y, m, tot, n, on });
      }
      const showMonth = (c) => {
        big.textContent = '';
        big.append(...hmBig(c.tot));
        what.textContent = `${c.y} 年 ${c.m} 月`;
        more.textContent = '';
        add(more, el('div', { text: `日均 ${hmText(c.tot / c.n)}` }), el('div', { text: `${c.on} 天戴过耳机（共 ${c.n} 天有数据）` }));
      };
      const lv = levels(cells.map((c) => (c.n ? c.tot : 0)));
      grid = el('div', { class: 'hk-cal months' });
      grid.append(el('span'), ...Array.from({ length: 12 }, (_, m) => el('span', { class: 'mh', text: pad(m + 1) })));
      let top = null, topBtn = null;
      for (let y = y0; y <= y1; y++) {
        grid.append(el('span', { class: 'yh', text: String(y) }));
        for (const c of cells.filter((x) => x.y === y)) {
          if (!c.n) { grid.append(el('i', { class: 'void' })); continue; }
          const btn = el('button', { type: 'button', title: `${c.y} 年 ${c.m} 月 · ${hmText(c.tot)}`, 'aria-label': `${c.y} 年 ${c.m} 月 ${hmText(c.tot)}`,
            style: 'background:' + C.levels[lv(c.tot)], onclick: (e) => { choose(e.currentTarget); showMonth(c); } });
          grid.append(btn);
          if (!top || c.tot > top.tot) { top = c; topBtn = btn; }
        }
      }
      main.append(grid);
      if (top) { choose(topBtn); showMonth(top); more.prepend(el('div', { class: 'hint', text: '听得最多的一个月' })); }
    }
    main.append(el('div', { class: 'hk-scale' }, '少', C.levels.slice(1).map((c) => el('i', { style: 'background:' + c })), '多'));
    box.append(el('div', { class: 'hk-cal-wrap' }, main, side));
    return box;
  }
  function ledgerPanel(S, R) {
    const st = stats(S, R.a, R.b), ss = sessionsOf(S, R.a, R.b, 1);
    const longest = ss.reduce((p, s) => (!p || s[2] > p[2] ? s : p), null);
    let top = -1;
    for (let d = R.a; d <= R.b; d++) if (d !== PARTIAL && S.min[d] > 0 && (top < 0 || S.min[d] > S.min[top])) top = d;
    const cell = (k, value, note) => el('div', { class: 'hk-cell' }, el('div', { class: 'k', text: k }), el('div', { class: 'v' }, value), el('div', { class: 'n', text: note || '' }));
    const box = panel('c12 hk-ledger', '账本', 'LEDGER', '每一格都是这段时间里的一个数字');
    return add(box, el('div', { class: 'hk-row7' },
      cell('收听次数', [el('b', { text: num(ss.length) }), el('small', { text: '次' })], '不足 1 分钟的不计'),
      cell('平均每次', hmBig(ss.length ? ss.reduce((s, x) => s + x[2], 0) / ss.length : 0), `停顿 ${DOSE.session_gap_min} 分钟内算一次`),
      cell('最长一次', hmBig(longest ? longest[2] : 0), longest ? dot(longest[0]) + ' ' + clock(longest[1]) : ''),
      cell('听得最久的一天', hmBig(top >= 0 ? S.min[top] : 0), top >= 0 ? dot(top) + ' ' + WEEKDAY[DOW[top]] : ''),
      cell('有它的日子', [el('b', { text: num(st.listened) }), el('small', { text: '天' })], st.days ? '占这段时间的 ' + pct(st.listened / st.days) : ''),
      cell('最长连续', [el('b', { text: num(longestRun(S, R.a, R.b)) }), el('small', { text: '天' })], '一天都没分开'),
      cell('收听日平均', hmBig(st.listened ? st.minutes / st.listened : 0), '只算戴过耳机的日子')));
  }

  // ------------------------------------------------------------------ act two: night
  function clockSvg(avg, peak, onHover) {
    const NS = 'http://www.w3.org/2000/svg', c = 150, r0 = 62, r1 = 140;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 300 300');
    svg.setAttribute('class', 'hk-clock');
    const max = Math.max(...avg, 0.0001);
    const mk = (tag, attrs, parent = svg) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); parent.append(n); return n; };
    mk('circle', { cx: c, cy: c, r: 52, fill: C.faint, stroke: C.ring });
    [[0, c, c - 31], [6, c + 33, c + 4], [12, c, c + 39], [18, c - 33, c + 4]].forEach(([h, x, y]) => {
      const t = mk('text', { x, y, 'text-anchor': 'middle', fill: C.muted, 'font-size': 12, 'font-family': MONO });
      t.textContent = pad(h);
    });
    avg.forEach((v, h) => {
      const ang = (h / 24) * Math.PI * 2 - Math.PI / 2, len = 10 + (r1 - r0 - 10) * Math.sqrt(v / max);
      const x0 = c + Math.cos(ang) * r0, y0 = c + Math.sin(ang) * r0;
      const night = NIGHT.includes(h), color = h === peak ? C.red : night ? C.alt : C.main;
      const g = mk('g', { class: 'bar' + (h === peak ? ' peak' : night ? ' night' : ''), tabindex: '0' });
      mk('line', { x1: x0, y1: y0, x2: c + Math.cos(ang) * (r1 + 4), y2: c + Math.sin(ang) * (r1 + 4), stroke: 'transparent', 'stroke-width': 22 }, g);
      mk('line', { x1: x0, y1: y0, x2: c + Math.cos(ang) * (r0 + len), y2: c + Math.sin(ang) * (r0 + len), 'stroke-width': 7, 'stroke-linecap': 'round',
        stroke: color, 'stroke-opacity': h === peak ? 1 : (0.35 + 0.6 * v / max).toFixed(2) }, g);
      const tt = mk('title', {}, g);
      tt.textContent = `${pad(h)}:00–${pad((h + 1) % 24)}:00 平均每天 ${num(v, 1)} 分钟`;
      g.addEventListener('mouseenter', () => onHover(h));
      g.addEventListener('focus', () => onHover(h));
      g.addEventListener('mouseleave', () => onHover(-1));
      g.addEventListener('blur', () => onHover(-1));
    });
    return svg;
  }
  function clockPanel(S, R) {
    const wk = weekdayAverages(S, R.a, R.b);
    const best = wk.reduce((p, v, k) => (v != null && (p < 0 || v > wk[p]) ? k : p), -1);
    const prof = hourProfile(S, R.a, R.b, page.weekday);
    const avg = prof.sums.map((v) => (prof.days ? v / prof.days : 0));
    const total = avg.reduce((s, v) => s + v, 0);
    const peak = total ? avg.indexOf(Math.max(...avg)) : -1;
    const night = total ? NIGHT.reduce((s, h) => s + avg[h], 0) / total : 0;
    const box = panel('c6 hk-clock-panel', '收听时段', 'HOURS', best >= 0 ? WEEKDAY[best] + '听得最多' : '');
    const bigH = el('b'), l1 = el('div', { class: 'l1' }), l2 = el('div', { class: 'l2' });
    const paint = (h) => {
      const hh = h >= 0 ? h : peak;
      bigH.textContent = hh >= 0 ? pad(hh) : '–';
      l1.textContent = hh < 0 ? '这段时间没有记录' : h >= 0 ? `${pad(h)}:00–${pad((h + 1) % 24)}:00 · 平均每天 ${num(avg[h], 1)} 分钟`
        : `${pad(peak)}:00–${pad((peak + 1) % 24)}:00 听得最多`;
      l2.textContent = total ? `夜里（22–5 点）占 ${pct(night)}` + (page.weekday >= 0 ? ` · 只看${WEEKDAY[page.weekday]}` : '') : '';
    };
    paint(-1);
    const maxW = Math.max(...wk.map((v) => v || 0), 1);
    const week = el('div', { class: 'hk-week', role: 'group', 'aria-label': '按星期筛选' }, wk.map((v, k) => el('div', { class: 'wd' },
      el('button', { type: 'button', 'aria-pressed': page.weekday === k ? 'true' : 'false', title: v == null ? '' : `${WEEKDAY[k]}平均每天 ${hmText(v)}`,
        'aria-label': `${WEEKDAY[k]}，平均每天 ${hmText(v)}`, onclick: () => { page.weekday = page.weekday === k ? -1 : k; swap(box, clockPanel(S, R)); } },
      el('i', { style: `height:${(12 + 88 * (v || 0) / maxW).toFixed(0)}%` })),
      el('span', { text: WEEKDAY[k].slice(1) }))));
    return add(box,
      el('div', { class: 'hk-clock-row' }, clockSvg(avg, peak, paint),
        el('div', { class: 'hk-clock-side' },
          el('div', { class: 'hk-hour' }, bigH, el('small', { text: '点' })), l1, l2,
          el('div', { class: 'hk-key' }, el('span', null, el('i', { style: 'background:' + C.main }), '白天'),
            el('span', null, el('i', { style: 'background:' + C.alt }), '夜里'), el('span', null, el('i', { style: 'background:' + C.red }), '最多的一个钟头')))),
      week,
      el('p', { class: 'hint', text: page.weekday >= 0 ? '再点一次星期，回到每一天。' : '把鼠标放在刻度上看每个钟头；点星期只看那一天。' }));
  }
  const PERSONAS = {
    ELD: ['耳机常驻居民', 'THE RESIDENT', '几乎天天戴，一戴就是大半天。耳机已经在你耳朵上落了户。'],
    ELN: ['夜航电台', 'NIGHT RADIO', '天天都听，越到夜里越投入，一段能放很久。'],
    ESD: ['碎片收集家', 'FRAGMENT COLLECTOR', '天天都听，每次不长：通勤、排队、午休，零碎时间都交给了耳机。'],
    ESN: ['睡前一曲', 'ONE MORE SONG', '每天都会听上一小段，夜里尤其多。'],
    CLD: ['周末沉浸派', 'WEEKEND DRIFTER', '不一定天天听，可一旦戴上就停不下来。'],
    CLN: ['午夜长听', 'MIDNIGHT LONG PLAY', '想起来才听，多半在夜里，一听就是很久。'],
    CSD: ['随取随用', 'GRAB AND GO', '需要时才拿出来，听完就收好，耳机对你是件趁手的工具。'],
    CSN: ['夜里偶遇', 'CHANCE ENCOUNTER', '偶尔在夜里听一会儿，来去随意。'],
  };
  function persona(S, R) {
    const st = stats(S, R.a, R.b);
    if (st.listened < 5) return null;
    const hp = hourProfile(S, R.a, R.b), total = hp.sums.reduce((s, v) => s + v, 0);
    const night = total ? NIGHT.reduce((s, h) => s + hp.sums[h], 0) / total : 0;
    const ss = sessionsOf(S, R.a, R.b, 1);
    const avg = ss.length ? ss.reduce((s, x) => s + x[2], 0) / ss.length : 0;
    const attend = st.days ? st.listened / st.days : 0;
    const key = (attend >= 0.7 ? 'E' : 'C') + (avg >= 30 ? 'L' : 'S') + (night >= 0.35 ? 'N' : 'D');
    let tone = '';
    let peak7 = 0;
    for (let d = R.a; d <= R.b; d++) peak7 = Math.max(peak7, dose7(S, d));
    if (st.db != null && st.db < 60) tone = '音量也很温柔。';
    else if (peak7 >= 100) tone = '有几周音量冲高，记得逢高减仓（调低一两格）。';
    const [name, en, line] = PERSONAS[key];
    return { key, name, en, line: line + tone, night, avg, attend, db: st.db,
      tags: [attend >= 0.7 ? '天天' : '随缘', avg >= 30 ? '长时间' : '短时间', night >= 0.35 ? '夜里' : '白天', st.db != null && st.db < 70 ? '轻声' : '偏响'] };
  }
  function trait(name, value, pos, ends, lean) {
    const knob = el('i', { class: 'knob', style: 'left:50%' });
    requestAnimationFrame(() => requestAnimationFrame(() => { knob.style.left = (100 * clamp01(pos)).toFixed(1) + '%'; }));
    return el('div', { class: 'hk-trait' },
      el('div', { class: 'top' }, el('span', { text: name }), el('b', { text: value })),
      el('div', { class: 'track', role: 'img', 'aria-label': `${name} ${value}，偏向${pos >= 0.5 ? ends[1] : ends[0]}` }, el('i', { class: 'mid' }), knob),
      el('div', { class: 'ends' }, el('span', { class: lean === 0 ? 'on' : '', text: ends[0] }), el('span', { class: lean === 1 ? 'on' : '', text: ends[1] })));
  }
  function personaPanel(S, R) {
    const p = persona(S, R);
    const box = panel('c6 hk-persona', '收听性格', 'CHARACTER', '按所选时间判定 · 只是好玩的描述');
    if (!p) return add(box, el('p', { class: 'hint', style: 'margin-top:16px', text: '这段时间戴耳机的日子不到 5 天，还看不出性格。换一个更长的时间范围试试。' }));
    return add(box,
      el('div', { class: 'hk-neon', text: p.name }),
      el('div', { class: 'hk-neon-en', text: p.en }),
      el('p', { class: 'line', text: p.line }),
      el('div', { class: 'hk-tags' }, p.tags.map((t) => el('span', { text: t }))),
      el('div', { class: 'hk-traits' },
        trait('夜里听（22–5 点）', pct(p.night), p.night / 0.58, ['白天', '夜里'], p.night >= 0.35 ? 1 : 0),
        trait('平均每次', hmText(p.avg), 0.5 + Math.log2(Math.max(1, p.avg) / 30) / 4, ['短', '长'], p.avg >= 30 ? 1 : 0),
        trait('出勤率', pct(p.attend), p.attend, ['随缘', '天天'], p.attend >= 0.7 ? 1 : 0),
        trait('平均音量', p.db == null ? '–' : num(p.db) + ' 分贝', p.db == null ? 0.5 : (p.db - 40) / 60, ['轻', '响'], p.db != null && p.db >= 70 ? 1 : 0)));
  }

  // ------------------------------------------------------------------ act three: sound
  function binLabel(k, E) { return k === 0 ? '<' + E[0] : k === E.length ? '≥' + E[E.length - 1] : E[k - 1] + '–' + E[k]; }
  function volumeChart(S, R) {
    const { groups } = groupsFor(R), daily = groups.length > 0 && groups[0].d != null;
    const base = { animation: false, textStyle: { fontFamily: HD.FONT }, grid: { left: 6, right: 12, top: 20, bottom: 2, containLabel: true } };
    const axisX = (labels, bar) => ({
      type: 'category', data: labels, boundaryGap: !!bar, axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false },
      axisLabel: Object.assign({}, axisText, { hideOverlap: true, formatter: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.slice(5).replace('-', '.') : v.replace('-', '.')) }),
    });
    const axisY = (o) => Object.assign({ type: 'value', splitNumber: 3, axisLine: { show: false }, axisTick: { show: false },
      axisLabel: axisText, splitLine: { lineStyle: { color: C.grid } } }, o);
    const refLine = (y, text) => ({ silent: true, symbol: 'none', animation: false, lineStyle: { color: C.red, width: 1, type: 'solid', opacity: 0.85 },
      label: { position: 'insideEndTop', color: C.refLabel, fontSize: 10, fontFamily: MONO, formatter: text }, data: [{ yAxis: y }] });
    if (page.vol === 'level') {
      const vals = groups.map((g) => { const s = stats(S, g.a, g.b).db; return s == null ? null : +s.toFixed(1); });
      const xs = vals.filter((v) => v != null);
      if (!xs.length) return null;
      return Object.assign(base, {
        xAxis: axisX(groups.map((g) => g.label), false),
        yAxis: axisY({ min: Math.floor((Math.min(...xs) - 4) / 10) * 10, max: Math.max(DOSE.ref_db + 5, Math.ceil(Math.max(...xs) / 5) * 5 + 5),
          axisLabel: Object.assign({}, axisText, { formatter: (v) => v + ' dB' }) }),
        tooltip: filmTip((ps) => { const i = ps[0].dataIndex; return ttDom(groups[i].title, [{ name: '平均音量', value: vals[i] == null ? null : num(vals[i], 1) + ' 分贝', color: C.main }], '按收听时长的能量平均'); }),
        series: [{ type: 'line', data: vals, connectNulls: false, smooth: 0.3, smoothMonotone: 'x', showSymbol: xs.length <= 31, symbolSize: 6,
          itemStyle: { color: C.main, borderColor: C.paper, borderWidth: 2 }, lineStyle: { width: 2, color: C.main, shadowBlur: 10 * C.glow, shadowColor: C.mainGlow },
          markLine: refLine(DOSE.ref_db, `${DOSE.ref_db} dB · 每周 ${DOSE.ref_hours} 小时`) }],
      });
    }
    if (page.vol === 'dose') {
      // days: the 7 days up to each day; weeks: that week; months: scaled to an average week
      const vals = daily ? groups.map((g) => +dose7(S, g.a).toFixed(2)) : groups.map((g) => {
        let s = 0;
        for (let d = g.a; d <= g.b; d++) if (d !== PARTIAL && S.dose[d] != null) s += S.dose[d];
        return +(g.b - g.a <= 6 ? s : (s * 7) / (g.b - g.a + 1)).toFixed(2);
      });
      const max = Math.max(...vals, 0);
      const line = { type: daily ? 'line' : 'bar', data: vals, barMaxWidth: 14, showSymbol: false, smooth: 0.3, smoothMonotone: 'x',
        itemStyle: { color: C.main, borderRadius: [2, 2, 0, 0] }, lineStyle: { width: 2, color: C.main, shadowBlur: 10 * C.glow, shadowColor: C.mainGlow },
        areaStyle: daily ? { color: grad(0, 1, [[0, C.area], [1, 'rgba(0,0,0,0)']]) } : undefined };
      if (max >= 30) line.markLine = refLine(100, '100% · WHO 每周上限');
      return Object.assign(base, {
        xAxis: axisX(groups.map((g) => g.label), !daily),
        yAxis: axisY({ min: 0, max: max >= 30 ? Math.max(110, Math.ceil(max / 10) * 10) : undefined, axisLabel: Object.assign({}, axisText, { formatter: (v) => v + '%' }) }),
        tooltip: filmTip((ps) => { const i = ps[0].dataIndex, g = groups[i]; return ttDom(daily ? '截至 ' + DAYS[g.a] : g.title, [{ name: daily ? '往前 7 天的剂量' : g.b - g.a <= 6 ? '这一周的剂量' : '平均每周的剂量', value: dosePct(vals[i]), color: C.main }], `100% = ${DOSE.ref_db} 分贝听 ${DOSE.ref_hours} 小时`); }),
        series: [line],
      });
    }
    const E = AU.binEdges || DOSE.level_bins, nb = E.length + 1, sums = new Array(nb).fill(0);
    for (let d = R.a; d <= R.b; d++) { const b = S.bins[d]; if (b) for (let k = 0; k < nb; k++) sums[k] += b[k]; }
    const total = sums.reduce((s, v) => s + v, 0);
    if (!total) return null;
    const loudFrom = E.indexOf(DOSE.ref_db) + 1, labels = sums.map((_, k) => binLabel(k, E));
    return Object.assign(base, {
      xAxis: Object.assign(axisX(labels, true), { axisLabel: Object.assign({}, axisText, { fontSize: 10, interval: 0, hideOverlap: true }) }),
      yAxis: axisY({ min: 0, axisLabel: Object.assign({}, axisText, { formatter: (v) => v + ' h' }) }),
      tooltip: filmTip((ps) => { const i = ps[0].dataIndex; const lv = i === 0 ? null : i === nb - 1 ? E[nb - 2] : (E[i - 1] + E[i]) / 2;
        return ttDom(labels[i] + ' 分贝', [{ name: '收听', value: hmText(sums[i]), color: i >= loudFrom ? C.red : C.main }, { name: '占比', value: num(100 * sums[i] / total, 1) + '%' },
          lv != null && { name: '按 WHO 参考每周可听', value: weeklyAt(lv) >= 168 ? '超过 168 小时' : '约 ' + hmText(weeklyAt(lv) * 60) }]); }),
      series: [{ type: 'bar', barMaxWidth: 18, data: sums.map((v, k) => ({ value: +(v / 60).toFixed(2), itemStyle: { color: loudFrom > 0 && k >= loudFrom ? C.red : C.main, borderRadius: [2, 2, 0, 0] } })) }],
    });
  }
  function volumePanel(S, R, ui) {
    const st = stats(S, R.a, R.b);
    let lastD = -1, peak = 0;
    for (let d = R.a; d <= R.b; d++) { if (S.min[d] > 0) lastD = d; peak = Math.max(peak, dose7(S, d)); }
    const now7 = lastD >= 0 ? dose7(S, lastD) : null;
    const E = AU.binEdges || DOSE.level_bins, loudFrom = E.indexOf(DOSE.ref_db) + 1;
    let loud = 0, all = 0;
    for (let d = R.a; d <= R.b; d++) { const b = S.bins[d]; if (b) b.forEach((v, k) => { all += v; if (loudFrom > 0 && k >= loudFrom) loud += v; }); }
    const box = panel('c7 hk-vol', '平均播放音量', 'VOLUME', peak >= 100 ? '有几周超过 WHO 每周上限' : '在 WHO 每周上限以内');
    const knob = el('i', { class: 'knob', style: 'left:0%' });
    if (st.db != null) requestAnimationFrame(() => requestAnimationFrame(() => { knob.style.left = (100 * clamp01((st.db - 40) / 60)).toFixed(1) + '%'; }));
    const at = (db) => (100 * (db - 40) / 60).toFixed(1) + '%';
    const plot = el('div', { class: 'plot', style: 'height:180px' });
    const views = [['level', '音量走势'], ['dose', '声音剂量'], ['bins', '音量分布']];
    add(box,
      el('div', { class: 'hk-vol-top' },
        el('div', { class: 'hk-big db' }, el('b', { text: st.db == null ? '–' : num(st.db) }), el('small', { text: '分贝' })),
        el('div', { class: 'hk-tube-wrap' },
          el('div', { class: 'hk-tube', role: 'img', 'aria-label': st.db == null ? '没有音量记录' : `平均 ${num(st.db)} 分贝，标尺 40 到 100` },
            el('i', { class: 'tick', style: 'left:' + at(DOSE.ref_db) }), knob),
          el('div', { class: 'hk-tube-scale' }, el('span', { text: '40' }), el('span', { style: 'left:' + at(DOSE.ref_db), text: DOSE.ref_db + ' dB' }), el('span', { text: '100' })))),
      el('p', { class: 'note', text: (!all ? '' : loud ? `${DOSE.ref_db} 分贝以上 ${hmText(loud)}，占 ${num(100 * loud / all, 1)}%。` : `几乎没有时间超过 ${DOSE.ref_db} 分贝。`) +
        `WHO 建议：${DOSE.ref_db} 分贝的音量每周累计不超过 ${DOSE.ref_hours} 小时` + (now7 != null ? `；截至 ${dot(lastD)}，最近 7 天用掉了这个上限的 ${dosePct(now7)}。` : '。') }),
      el('div', { class: 'hk-tabs', role: 'group', 'aria-label': '换一种看法' }, views.map(([id, name]) => el('button', {
        type: 'button', 'aria-pressed': page.vol === id ? 'true' : 'false', text: name,
        onclick: () => { if (page.vol !== id) { page.vol = id; swap(box, volumePanel(S, R, ui)); } } }))),
      plot,
      el('p', { class: 'hint' }, 'WHO 的参考：', WHO_TABLE.map(([v, t]) => `${v} 分贝 ${t}`).join(' · '), '。',
        el('button', { class: 'hk-link', type: 'button', text: '看依据', onclick: () => ui.gotoRef('headphone_dose') })));
    const option = volumeChart(S, R);
    if (option) queueMicrotask(() => ui.mountChart(plot, option));
    else plot.replaceWith(el('p', { class: 'hint', style: 'margin:30px 0', text: '这段时间没有音量记录' }));
    return box;
  }
  const X_MARK = 'path://M2,0 L5,3 L8,0 L10,2 L7,5 L10,8 L8,10 L5,7 L2,10 L0,8 L3,5 L0,2 Z';
  const column = (hz) => Math.round(2 * Math.log2(hz / 250));
  const hzShort = (hz) => (hz >= 1000 ? +(hz / 1000).toFixed(1) + 'k' : String(hz));
  function audiogramOption(t) {
    const left = t.points.filter((p) => p[1] != null).map((p) => [column(p[0]), p[1], p[0]]);
    const right = t.points.filter((p) => p[2] != null).map((p) => [column(p[0]), p[2], p[0]]);
    const names = new Map([[0, '250'], [2, '500'], [4, '1k'], [6, '2k'], [8, '4k'], [10, '8k']]);
    for (const p of t.points) names.set(column(p[0]), hzShort(p[0]));
    const cols = [...names.keys()];
    const vals = left.concat(right).map((p) => p[1]);
    const yMin = Math.min(-10, Math.floor((Math.min(...vals) - 5) / 10) * 10);
    const yMax = Math.max(60, Math.ceil((Math.max(...vals) + 15) / 10) * 10);
    const bands = [];
    let lo = yMin;
    for (const [upper, label] of TEST.grades) {
      const hi = upper == null ? yMax : Math.min(yMax, upper + 0.5);
      if (hi > lo) bands.push([lo, hi, label]);
      lo = hi;
      if (lo >= yMax) break;
    }
    const line = (name, data, color, symbol, size, item) => ({
      name, type: 'line', data, symbol, symbolSize: size, showAllSymbol: true, z: 5,
      lineStyle: { width: 2, color, join: 'round', cap: 'round', shadowBlur: 10 * C.glow, shadowColor: color }, itemStyle: item, emphasis: { disabled: true },
    });
    const series = [
      line('左耳', left, C.alt, X_MARK, 11, { color: C.alt }),
      line('右耳', right, C.red, 'circle', 10, { color: C.paper, borderColor: C.red, borderWidth: 2.2 }),
    ];
    series[0].markArea = {
      silent: true,
      data: bands.map(([a, b, label], k) => [
        { yAxis: a, itemStyle: { color: k % 2 ? C.band : 'transparent' },
          label: { show: true, position: 'insideBottomRight', color: C.muted, fontSize: 11, formatter: label } },
        { yAxis: b }]),
    };
    return {
      animation: false, textStyle: { fontFamily: HD.FONT },
      grid: { left: 8, right: 30, top: 14, bottom: 6, containLabel: true },
      xAxis: {
        type: 'value', min: Math.min(-1, Math.min(...cols) - 1), max: Math.max(11, Math.max(...cols) + 1), interval: 1,
        name: 'Hz', nameLocation: 'end', nameGap: 6, nameTextStyle: axisText,
        axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false },
        axisLabel: Object.assign({}, axisText, { formatter: (v) => names.get(Math.round(v)) || '' }),
        splitLine: { show: true, lineStyle: { color: C.grid } },
      },
      yAxis: {
        type: 'value', inverse: true, min: yMin, max: yMax, interval: 10, name: 'dB HL', nameLocation: 'start',
        nameTextStyle: Object.assign({}, axisText, { align: 'right' }),
        axisLine: { show: false }, axisTick: { show: false }, axisLabel: axisText, splitLine: { lineStyle: { color: C.grid } },
      },
      tooltip: filmTip((ps) => {
        const list = Array.isArray(ps) ? ps : [ps];
        if (!list.length || !list[0].value) return '';
        return ttDom(hzShort(list[0].value[2]) + ' Hz', list.map((p) => ({ name: p.seriesName, value: num(p.value[1], 1) + ' dB HL', color: p.seriesIndex ? C.red : C.alt })),
          '数值越大，需要越响才听得到');
      }),
      series,
    };
  }
  function testPanel(ui) {
    const tests = AU.tests || [];
    const box = panel('c5 hk-test', '听力测试', 'HEARING TEST', tests.length ? `共 ${tests.length} 次 · 不受时间范围影响` : '');
    if (!tests.length) {
      return add(box, el('p', { class: 'hint', style: 'margin-top:16px', text: '还没有听力测试记录。AirPods Pro 2 或 AirPods Pro 3 配合 iOS 18.1 以上的 iPhone，可以在「设置」里点你的 AirPods 做一次听力测试，结果会存进健康 App。' }));
    }
    const k = page.test == null || !tests[page.test] ? tests.length - 1 : page.test, t = tests[k];
    if (tests.length > 1) {
      box.append(el('div', { class: 'hk-tabs' }, tests.map((x, i) => el('button', {
        type: 'button', 'aria-pressed': i === k ? 'true' : 'false', text: x.date, onclick: () => { page.test = i; swap(box, testPanel(ui)); } }))));
    }
    const ear = (i, name, color, mark) => el('div', { class: 'hk-ear' },
      el('div', { class: 'k' }, el('i', { style: 'background:' + color }), `${name}（${mark}）`),
      el('div', { class: 'hk-big' }, el('b', { text: t.pta[i] == null ? '–' : num(t.pta[i]) }), el('small', { text: 'dB HL' })),
      el('div', { class: 'n', text: t.grade[i] || '有频率没测，算不出' }));
    const vals = t.pta.filter((v) => v != null);
    const strict = vals.length === 2 && Math.max(...vals) >= TEST.normal_below;
    const worse = t.change ? t.change.map((c, i) => (c != null && c >= TEST.change_db ? (i ? '右耳' : '左耳') : null)).filter(Boolean) : [];
    const plot = el('div', { class: 'plot', style: 'height:230px', role: 'img', 'aria-label': '听力图' });
    queueMicrotask(() => ui.mountChart(plot, audiogramOption(t)));
    return add(box,
      el('div', { class: 'hk-ears' }, ear(0, '左耳', C.alt, '×'), ear(1, '右耳', C.red, '○')),
      plot,
      el('p', { class: 'hint', text: `${t.date} ${t.time}` + (t.device ? ' · ' + t.device : '') + ' · 每只耳朵取 500、1k、2k、4k Hz 的平均听阈。' +
        (vals.length === 2 ? (strict ? `按 WHO 现行分级，双耳都低于 ${TEST.normal_below} dB HL 才算正常，这次有一只在 ${TEST.normal_below} 或以上。` : `双耳都低于 ${TEST.normal_below} dB HL，按 WHO 现行分级也在正常范围。`) : '') +
        (t.change ? ' 和上一次比：' + t.change.map((c, i) => (c == null ? null : (i ? '右耳 ' : '左耳 ') + (c === 0 ? '持平' : (c > 0 ? '高了 ' : '低了 ') + num(Math.abs(c), 1) + ' dB'))).filter(Boolean).join('，') + '（越高越差）。' : '') }),
      worse.length ? el('p', { class: 'note', text: `${worse.join('和')}比上一次高了 ${TEST.change_db} dB 以上，超出了这个测试常见的误差。可以过几天在安静的地方再测一次；结果相近，或者觉得听不清、耳鸣，可以去医院耳鼻喉科或听力门诊看看。` }) : null,
      el('p', { class: 'hint' }, '与听力师用标准设备做的检查相比，88.5% 的耳朵相差在 5 dB 以内（Apple 的验证研究）。这是自测，不是诊断。',
        el('button', { class: 'hk-link', type: 'button', text: '分级和出处', onclick: () => ui.gotoRef('hearing_test') })));
  }

  // ------------------------------------------------------------------ act four: before sleep
  /** each night: when the last listening ended, and when sleep began (minutes after noon, so evenings sort before small hours) */
  function nightsOf(S, R) {
    const spans = sessionsOf(S, R.a - 1, R.b, 0).map((s) => [s[0] * 1440 + s[1], s[0] * 1440 + s[1] + s[2]]);
    const out = [];
    let nights = 0, before = 0, after = 0;
    for (let d = R.a; d <= R.b; d++) {
      const bt = D.bedtime[d];
      if (bt == null || d === PARTIAL) continue;
      nights++;
      const onset = d * 1440 + bt;
      let pre = 0, post = 0, last = null;
      for (const [a, b] of spans) {
        pre += Math.max(0, Math.min(b, onset) - Math.max(a, onset - 60));
        post += Math.max(0, Math.min(b, onset + 60) - Math.max(a, onset));
        if (a < onset && b > onset - 720) last = last == null ? Math.min(b, onset) : Math.max(last, Math.min(b, onset));
      }
      if (pre >= 1) before++;
      if (post >= 10) after++;
      if (last != null) out.push({ d, end: last - (d * 1440 - 720), bed: onset - (d * 1440 - 720), gap: onset - last });
    }
    return { list: out, nights, before, after };
  }
  const median = (xs) => { const s = xs.slice().sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
  function sleepChart(list, R) {
    let rows = list.map((n) => ({ label: DAYS[n.d], title: DAYS[n.d] + ' ' + WEEKDAY[DOW[n.d]] + ' 醒来的那一晚', end: n.end, bed: n.bed, d: n.d }));
    if (R.b - R.a + 1 > 126) {                                  // long ranges: the median night of each week
      const byWeek = new Map();
      for (const n of list) { const key = n.d - DOW[n.d]; if (!byWeek.has(key)) byWeek.set(key, []); byWeek.get(key).push(n); }
      rows = [...byWeek.entries()].sort((p, q) => p[0] - q[0]).map(([w, ns]) => ({
        label: DAYS[Math.max(0, w)], title: `${DAYS[ns[0].d]} 那一周（${ns.length} 晚的中位数）`, end: median(ns.map((n) => n.end)), bed: median(ns.map((n) => n.bed)) }));
    }
    if (!rows.length) return null;
    const ys = rows.flatMap((r) => [r.end, r.bed]).sort((p, q) => p - q);
    const q = (f) => ys[Math.min(ys.length - 1, Math.max(0, Math.floor(f * (ys.length - 1))))];
    const lo = Math.max(0, Math.floor((q(0.03) - 30) / 120) * 120), hi = Math.min(1440, Math.ceil((q(0.97) + 30) / 120) * 120);
    const weekly = R.b - R.a + 1 > 126;
    return {
      option: {
        animation: false, textStyle: { fontFamily: HD.FONT },
        grid: { left: 6, right: 14, top: 12, bottom: 2, containLabel: true },
        xAxis: { type: 'category', data: rows.map((r) => r.label), axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false },
          axisLabel: Object.assign({}, axisText, { hideOverlap: true, formatter: (v) => (weekly ? v.slice(2) : v.slice(5)).replace(/-/g, '.') }) },
        yAxis: { type: 'value', inverse: true, min: lo, max: hi, interval: 120, axisLine: { show: false }, axisTick: { show: false },
          axisLabel: Object.assign({}, axisText, { formatter: (v) => clock(v + 720) }), splitLine: { lineStyle: { color: C.grid } } },
        tooltip: filmTip((p) => {
          const r = rows[p.dataIndex];
          return ttDom(r.title, [{ name: '摘下耳机', value: clock(r.end + 720), color: C.main }, { name: '入睡', value: clock(r.bed + 720), color: C.alt },
            { name: '中间隔了', value: hmText(r.bed - r.end) }]);
        }, { item: true }),
        series: [{
          type: 'custom', data: rows.map((r, i) => [i, r.end, r.bed]), encode: { x: 0, y: [1, 2] }, clip: true,
          renderItem: (params, api) => {
            const x = api.value(0), p0 = api.coord([x, api.value(1)]), p1 = api.coord([x, api.value(2)]);
            return { type: 'group', children: [
              { type: 'line', shape: { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1] }, style: { stroke: C.connector, lineWidth: 1.4 } },
              { type: 'circle', shape: { cx: p0[0], cy: p0[1], r: 3.4 }, style: { fill: C.main, shadowBlur: 6 * C.glow, shadowColor: C.main } },
              { type: 'circle', shape: { cx: p1[0], cy: p1[1], r: 3.4 }, style: { fill: C.alt, shadowBlur: 6 * C.glow, shadowColor: C.alt } },
            ] };
          },
        }],
      },
      rows,
    };
  }
  function sleepPanel(S, R, ui) {
    const n = nightsOf(S, R);
    const box = panel('c12 hk-sleep', '摘下耳机，到睡着', 'THE DISTANCE', '入睡时间取当晚最长的一段睡眠');
    if (!n.nights) return add(box, el('p', { class: 'hint', style: 'margin-top:16px', text: '这段时间没有睡眠记录。' }));
    const g = median(n.list.map((x) => x.gap));
    const chart = sleepChart(n.list, R);
    const plot = el('div', { class: 'plot', style: 'height:250px', role: 'img', 'aria-label': '每晚摘下耳机和入睡的时间' });
    if (chart) {
      queueMicrotask(() => {
        const c = ui.mountChart(plot, chart.option);
        c.on('click', (p) => { const r = chart.rows[p.dataIndex]; if (r && r.d != null) ui.gotoDay(DAYS[r.d]); });
      });
    }
    return add(box,
      el('div', { class: 'hk-sleep-row' },
        el('div', { class: 'hk-sleep-side' },
          el('div', { class: 'hk-big' }, g == null ? el('b', { text: '–' }) : hmBig(g)),
          el('div', { class: 'what', text: '收听结束到入睡的间隔（中位数）' }),
          n.list.length >= 3 ? el('div', { class: 'hk-dist' },
            el('span', null, el('i', { style: 'background:' + C.main }), el('b', { text: clock(median(n.list.map((x) => x.end)) + 720) }), ' 摘下耳机'),
            el('em'),
            el('span', null, el('i', { style: 'background:' + C.alt }), el('b', { text: clock(median(n.list.map((x) => x.bed)) + 720) }), ' 入睡')) : null,
          el('dl', { class: 'hk-dl' },
            el('dt', { text: '入睡前一小时在听' }), el('dd', { text: `${n.before} 晚 / 共 ${n.nights} 晚` }),
            el('dt', { text: '入睡后还在播放 10 分钟以上' }), el('dd', { text: `${n.after} 晚` + (n.after ? '，可能是听着睡着了' : '') })),
          n.after >= 3 ? el('p', { class: 'hint', text: '给耳机设一道止损线：在「时钟」App 的计时器里把“计时结束时”设为“停止播放”，听着睡着也不会放一整夜。' }) : null),
        chart ? el('div', { class: 'hk-sleep-plot' }, el('div', { class: 'hk-key' },
          el('span', null, el('i', { style: 'background:' + C.main }), '最后一次收听结束'), el('span', null, el('i', { style: 'background:' + C.alt }), '入睡'),
          el('span', { class: 'r', text: R.b - R.a + 1 > 126 ? '每周取中位数' : '每晚一条 · 点一晚查看那一天' })), plot) : null));
  }

  // ------------------------------------------------------------------ credits
  function creditsPanel(S, R, ui) {
    const per = DEV.map((_, k) => { let s = 0; for (let d = R.a; d <= R.b; d++) s += AU.devDaily[k][d] || 0; return s; });
    const order = DEV.map((_, k) => k).sort((p, q) => per[q] - per[p]);
    const box = panel('c12 hk-credits', '演员表', 'CAST', '点一副耳机，整部片子都换成它');
    add(box, el('div', { class: 'hk-cast' }, order.map((k, i) => {
      const dv = DEV[k];
      return el('button', { type: 'button', class: 'hk-castrow', 'aria-pressed': page.dev === k ? 'true' : 'false',
        onclick: () => { page.dev = page.dev === k ? -1 : k; page.weekday = -1; page.cal = null; ui.refresh(); } },
      el('span', { class: 'role', text: per[k] && i === 0 ? '主演' : per[k] ? '客串' : '本段未出场' }),
      el('b', { text: dv.label }), el('i', { class: 'lead' }),
      el('span', { class: 'hrs', text: per[k] ? hmText(per[k]) : '–' }),
      el('span', { class: 'meta', text: `${dot(dv.first)} — ${dot(dv.last)} · ${dv.db == null ? '–' : num(dv.db, 1) + ' 分贝'}` }));
    })), el('p', { class: 'hint', text: 'AirPods 和 Beats 的音量按型号测，最准；其他耳机是 iPhone 按音量估算的，两者不宜直接比较。' }));
    const ss = sessionsOf(S, R.a, R.b, 0).slice().reverse();
    if (ss.length) {
      const cap = 400, srcs = AU.sessionSources || [];
      const rows = ss.slice(0, cap).map((s) => el('tr', {
        class: 'go', tabindex: '0', title: '查看这一天', onclick: () => ui.gotoDay(DAYS[s[0]]),
        onkeydown: (e) => { if (e.key === 'Enter') ui.gotoDay(DAYS[s[0]]); },
      }, el('td', { class: 'l', text: DAYS[s[0]] + ' ' + WEEKDAY[DOW[s[0]]] }), el('td', { text: clock(s[1]) + ' – ' + clock(s[1] + s[2]) }),
      el('td', { text: mins(s[2]) }), el('td', { text: s[4] == null ? '–' : num(s[4], 1) + ' dB' }),
      el('td', { class: 'l', text: (DEV[s[5]] || {}).label || '–' }), el('td', { class: 'l', text: HD.shortSource(srcs[s[6]] || '') })));
      box.append(el('details', { class: 'hk-log' },
        el('summary', null, el('span', { text: '全部收听记录' }), el('span', { class: 'r', text: `${num(ss.length)} 次 · 展开` })),
        el('div', { class: 'tablewrap tall' }, el('table', null,
          el('thead', null, el('tr', null, ['日期', '时间', '时长', '平均音量', '耳机', '播放设备'].map((c, i) => el('th', { class: i === 0 || i >= 4 ? 'l' : '', text: c })))),
          el('tbody', null, rows))),
        ss.length > cap ? el('p', { class: 'hint', text: `只列出最近 ${cap} 次。缩小时间范围可以看到更早的。` }) : null));
    }
    return box;
  }

  // ------------------------------------------------------------------ the tab
  HD.hearingTab = (ctx, ui) => {
    if (!ready) return [el('div', { class: 'callout', text: '当前的看板数据是旧版本生成的，还没有耳机数据。重新运行一次更新即可。' })];
    if (!DEV.length && !(AU.tests || []).length) {
      return [el('div', { class: 'hk' }, el('section', { class: 'hk-panel' },
        el('p', { class: 'hint', text: '导出里没有耳机音量记录。用 AirPods 或其他耳机在 iPhone 上听歌、看视频时，健康 App 会自动记录耳机音量。' })))];
    }
    usePalette();
    if (page.dev >= DEV.length) page.dev = -1;
    const S = selectionFor(page.dev), R = rangeFor(S, ui);
    const st = stats(S, R.a, R.b);
    // the voice-overs, in the first person, written from the reader's own numbers
    const run = longestRun(S, R.a, R.b);
    const prof = hourProfile(S, R.a, R.b), tot = prof.sums.reduce((s, v) => s + v, 0);
    const peakH = tot ? prof.sums.indexOf(Math.max(...prof.sums)) : -1, night = tot ? NIGHT.reduce((s, h) => s + prof.sums[h], 0) / tot : 0;
    let lastD = -1, peak7 = 0;
    for (let d = R.a; d <= R.b; d++) { if (S.min[d] > 0) lastD = d; peak7 = Math.max(peak7, dose7(S, d)); }
    const now7 = lastD >= 0 ? dose7(S, lastD) : null;
    const nn = nightsOf(S, R), gap = median(nn.list.map((x) => x.gap));
    const endM = nn.list.length ? median(nn.list.map((x) => x.end)) + 720 : null, bedM = nn.list.length ? median(nn.list.map((x) => x.bed)) + 720 : null;
    const pairs = DEV.length, allMin = DEV.reduce((s, dv) => s + dv.minutes, 0);
    const voTime = st.listened ? vo(`${num(st.listened)} 天里有它。最长的一段，连续 ${run} 天，没有分开过。`, `It was there on ${st.listened.toLocaleString('en-US')} days. The longest stretch: ${run} days in a row, never apart.`)
      : vo('这段时间，我们没有见面。', "We didn't meet this time.");
    const voNight = peakH < 0 ? null : night >= 0.35
      ? vo(`夜越深，听得越久。${pct(night)} 的声音，留在了晚上 10 点到凌晨 5 点之间。`, `The later it got, the longer I listened. ${pct(night)} of it happened between 10 pm and 5 am.`)
      : vo(`一天里，${clockZh(peakH * 60)}我听得最多。过了晚上 10 点，只剩 ${pct(night)}。`, `${hourEn(peakH)} was when I listened most. After 10 pm, only ${pct(night)} was left.`);
    const voSound = st.db == null ? null : peak7 >= 100
      ? vo('有几个星期，音量冲上了 WHO 的每周上限。逢高减仓吧：把音量调低一两格。', 'Some weeks ran above the WHO weekly limit. Time to take profits: turn it down a notch or two.')
      : vo(`音量一直不高，平均 ${num(st.db)} 分贝。` + (now7 != null ? `最近 7 天，只用掉 WHO 每周上限的 ${dosePct(now7)}。` : ''),
        `I kept it low, ${num(st.db)} dB on average.` + (now7 != null ? ` In the last 7 days I used just ${dosePct(now7)} of the WHO weekly limit.` : ''));
    const voSleep = gap == null ? null : vo(`我通常在${clockZh(endM)}摘下耳机，${clockZh(bedM)}睡着。中间隔着 ${hoursZh(gap)}。` + (nn.after ? `有 ${nn.after} 个夜晚，我是听着睡着的。` : ''),
      `I usually take them off around ${clockEn(endM)} and fall asleep around ${clockEn(bedM)}. ${hoursEn(gap)} in between.` + (nn.after ? ` On ${nn.after} night${nn.after === 1 ? '' : 's'}, I fell asleep listening.` : ''));
    const voEnd = vo(`谢谢这 ${pairs} 副耳机，陪我听了 ${hoursZh(allMin)}。`, `Thanks to ${pairs === 1 ? 'this pair' : `these ${pairs} pairs`} of headphones for ${hoursEn(allMin)} of company.`);
    const film = el('div', { class: 'hk' },
      topBar(R, ui),
      titleCard(S, R, ui),
      scene('第一幕', '时间', 'SCENE 01 · TIME', `${dot(R.a)} — ${dot(R.b)}`), voTime,
      el('div', { class: 'hk-grid' }, calendarPanel(S, R, ui), ledgerPanel(S, R)),
      scene('第二幕', '夜', 'SCENE 02 · NIGHT', '22:00 — 05:00'), voNight,
      el('div', { class: 'hk-grid' }, clockPanel(S, R), personaPanel(S, R)),
      scene('第三幕', '声音', 'SCENE 03 · SOUND', `WHO · ${DOSE.ref_db} dB × ${DOSE.ref_hours} h`), voSound,
      el('div', { class: 'hk-grid' }, volumePanel(S, R, ui), testPanel(ui)),
      scene('第四幕', '入睡之前', 'SCENE 04 · BEFORE SLEEP', gap == null ? '' : `${clock(endM)} → ${clock(bedM)}`), voSleep,
      el('div', { class: 'hk-grid' }, sleepPanel(S, R, ui)),
      scene('片尾', '演职员表', 'END CREDITS', `${pairs} PAIRS · ${num(Math.round(allMin / 60))} H`), voEnd,
      el('div', { class: 'hk-grid' }, creditsPanel(S, R, ui)),
      el('p', { class: 'hk-foot' },
        '耳机音量由 iPhone 或 iPad 在用耳机播放媒体时测量，电话不计入。声音剂量按 WHO 与国际电信联盟的安全收听标准计算。旁白是按你自己的数字写的，帮你了解收听习惯，不是诊断。每个数字怎么来的，见 ',
        el('button', { class: 'hk-link', type: 'button', text: '数据说明', onclick: () => ui.gotoRef('headphone_dose') }), '。'));
    return [film];
  };

  // ------------------------------------------------------------------ single day (used by the 单日 tab)
  /** this day's listening as [start_min, end_min, dB] spans */
  HD.dayListening = (d) => {
    const flat = HP[d];
    if (!flat) return [];
    const out = [];
    for (let k = 0; k < flat.length; k += 3) out.push([flat[k], flat[k + 1], flat[k + 2]]);
    return out;
  };
  /** the day's spans merged across short pauses, for the lane under the heart-rate chart */
  HD.dayListeningLane = (d, gap = 2) => {
    const out = [];
    for (const [a, b] of HD.dayListening(d)) {
      const last = out[out.length - 1];
      if (last && a - last[1] <= gap) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
    return out;
  };
  HD.dayVolume = (d, T) => {
    const spans = HD.dayListening(d);
    if (!spans.length) return null;
    const vals = spans.map((s) => s[2]);
    const yMin = Math.floor((Math.min(...vals) - 5) / 10) * 10, yMax = Math.max(DOSE.ref_db + 5, Math.ceil((Math.max(...vals) + 5) / 10) * 10);
    return {
      animation: false, textStyle: { fontFamily: HD.FONT },
      grid: { left: 46, right: 44, top: 14, bottom: 30 },              // lines up with the heart-rate chart above
      xAxis: {
        type: 'value', min: 0, max: 1440, interval: 120, axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false },
        axisLabel: { color: T.muted, fontSize: 11, formatter: (v) => clock(v) }, splitLine: { show: false },
      },
      yAxis: yAxis({ T }, { min: yMin, max: yMax, fmt: (v) => v + ' dB' }),
      tooltip: {
        trigger: 'item', confine: true, transitionDuration: 0, backgroundColor: T.surface, borderColor: T.axis, borderWidth: 1,
        padding: [8, 10], extraCssText: 'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.14);',
        formatter: (p) => ttDom(clock(p.value[0]) + ' – ' + clock(p.value[1]), [
          { name: '平均音量', value: num(p.value[2], 1) + ' 分贝', color: T.s[2], box: true },
          { name: '时长', value: mins(p.value[1] - p.value[0]) },
        ]),
      },
      series: [{
        type: 'custom', data: spans, encode: { x: [0, 1], y: 2 },
        renderItem: (params, api) => {
          const p0 = api.coord([api.value(0), api.value(2)]), p1 = api.coord([api.value(1), api.value(2)]);
          return { type: 'rect', shape: { x: p0[0], y: p0[1] - 3, width: Math.max(2, p1[0] - p0[0]), height: 6, r: 3 }, style: { fill: T.s[2] } };
        },
        markLine: {
          silent: true, symbol: 'none', animation: false, lineStyle: { color: T.muted, width: 1, type: 'solid' },
          label: { position: 'insideEndTop', color: T.muted, fontSize: 10, formatter: DOSE.ref_db + ' 分贝' },
          data: [{ yAxis: DOSE.ref_db }],
        },
      }],
    };
  };
  HD.dayListenStats = (d) => {
    const ss = ready ? AU.sessions.filter((s) => s[0] === d) : [];
    return { minutes: ready ? D.listenMin[d] : null, db: ready ? D.headphone[d] : null, sessions: ss.length,
      devices: [...new Set(ss.map((s) => (DEV[s[5]] || {}).label))].filter(Boolean) };
  };
})();
