/* Tabs, cards, stat tiles, filters. */
(function () {
  'use strict';
  const HD = window.HD;
  if (!HD || !HD.H) return;
  const { H, DAYS, N, D, el, num, clock, hm, mins, signed, buckets, meanOf, countOf, firstLast, rolling, theme,
    trend, multiLine, stackTrend, shortSource, WEEKDAY, DOW } = HD;
  const W = H.workouts;
  const main = document.getElementById('main');

  // ------------------------------------------------------------------ state
  const PRESETS = [['30', '30 天'], ['90', '90 天'], ['180', '半年'], ['365', '1 年'], ['all', '全部']];
  const GRANS = [['day', '日'], ['week', '周'], ['month', '月']];
  const state = { tab: (H.reports || []).length ? 'report' : 'overview', a: 0, b: N - 1, preset: '90', gran: 'day', day: null, report: null };
  const store = {
    load() { try { return JSON.parse(localStorage.getItem('hd.state') || '{}'); } catch (e) { return {}; } },
    save() { try { localStorage.setItem('hd.state', JSON.stringify({ preset: state.preset, gran: state.gran })); } catch (e) { /* private mode */ } },
  };
  function applyPreset(p, keepGran) {
    state.preset = p;
    state.b = N - 1;
    state.a = p === 'all' ? 0 : Math.max(0, N - +p);
    if (!keepGran) state.gran = state.b - state.a + 1 > 200 ? 'week' : 'day';
  }
  function context() {
    const bk = buckets(state.a, state.b, state.gran);
    return { a: state.a, b: state.b, gran: state.gran, bk, labels: bk.map((x) => x.label), T: theme(), n: state.b - state.a + 1 };
  }

  // ------------------------------------------------------------------ cards
  let live = [];                                   // echarts instances on the current tab
  const observer = new ResizeObserver((entries) => {
    for (const e of entries) { const c = window.echarts.getInstanceByDom(e.target); if (c) c.resize(); }
  });
  function mountChart(node, option) {
    const chart = window.echarts.init(node, null, { renderer: 'canvas' });
    chart.setOption(option, true);
    live.push(chart);
    observer.observe(node);
    return chart;
  }
  function renderTable(t, tall) {
    const wrap = el('div', { class: 'tablewrap' + (tall ? ' tall' : '') });
    const cap = 500;
    wrap.append(el('table', null,
      el('thead', null, el('tr', null, t.cols.map((c) => el('th', { text: c })))),
      el('tbody', null, t.rows.slice(0, cap).map((r) => el('tr', null, r.map((c) => el('td', { text: c == null ? '–' : c })))))));
    if (t.rows.length > cap) wrap.append(el('div', { class: 'desc', style: 'padding:8px 10px', text: `仅显示最近 ${cap} 行，共 ${t.rows.length} 行。缩小时间范围可查看更早的数据。` }));
    return wrap;
  }
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function gotoDay(date) {
    state.day = HD.indexOfDate(date);
    state.tab = 'day';
    history.replaceState(null, '', '#day');
    window.scrollTo(0, 0);
    renderTab();
  }
  /** click a day on any date-axis chart (or a calendar cell) to open that day */
  function enableDrill(chart, plot) {
    plot.style.cursor = 'pointer';
    chart.on('click', (p) => {
      const v = p && p.value;
      if (Array.isArray(v) && typeof v[0] === 'string' && DATE_RE.test(v[0])) gotoDay(v[0]);
    });
    chart.getZr().on('click', (e) => {
      const opt = chart.getOption();
      if (!opt.xAxis || !opt.xAxis.length || !opt.xAxis[0].data) return;
      const pt = [e.offsetX, e.offsetY];
      let inside = false;
      try { inside = chart.containPixel({ gridIndex: 0 }, pt); } catch (err) { inside = false; }
      if (!inside) return;
      const label = opt.xAxis[0].data[Math.round(chart.convertFromPixel({ gridIndex: 0 }, pt)[0])];
      if (typeof label === 'string' && DATE_RE.test(label)) gotoDay(label);
    });
  }
  /** spec: { title, desc, span, h, build } */
  function card(spec, ctx) {
    const r = spec.build(ctx);
    const height = (typeof spec.h === 'function' ? spec.h(ctx) : spec.h) || 230;
    const root = el('section', { class: 'card' + (spec.span ? ' s' + spec.span : '') });
    const tools = el('div', { class: 'tools' });
    const desc = typeof spec.desc === 'function' ? spec.desc(ctx) : spec.desc;
    root.append(el('div', { class: 'card-head' },
      el('div', null, el('h3', { text: spec.title }), desc && el('p', { class: 'desc', text: desc })), tools));
    if (!r || r.empty) {
      root.append(el('div', { class: 'empty', style: `min-height:${Math.min(height, 160)}px`, text: spec.emptyText || '这个时间范围内没有数据' }));
      return root;
    }
    if (r.node) { root.append(r.node); return root; }
    if (r.note) root.append(el('p', { class: 'desc note', text: r.note }));
    const plot = el('div', { class: 'plot', style: `height:${height}px`, role: 'img', 'aria-label': spec.title });
    let chart = null;
    if (r.legend) {
      const lg = el('div', { class: 'legend' });
      for (const item of r.legend) {
        const s = el('span', { style: 'cursor:pointer', title: '点击显示 / 隐藏' },
          el('i', { class: item.line ? 'line' : item.wash ? 'wash' : '', style: 'background:' + item.color }), item.name);
        s.addEventListener('click', () => {
          if (!chart) return;
          chart.dispatchAction({ type: 'legendToggleSelect', name: item.name });
          s.style.opacity = s.style.opacity === '0.4' ? '1' : '0.4';
        });
        lg.append(s);
      }
      root.append(lg);
    }
    root.append(plot);
    if (r.table) {
      let box = null;
      const btn = el('button', { class: 'mini', type: 'button', 'aria-pressed': 'false', text: '表格' });
      btn.addEventListener('click', () => {
        if (box) { box.remove(); box = null; btn.setAttribute('aria-pressed', 'false'); return; }
        box = renderTable(r.table);
        root.append(box);
        btn.setAttribute('aria-pressed', 'true');
      });
      tools.append(btn);
    }
    queueMicrotask(() => { chart = mountChart(plot, r.option); if (r.drill) enableDrill(chart, plot); });
    return root;
  }
  const grid = (ctx, specs) => el('div', { class: 'grid' }, specs.map((s) => card(s, ctx)));
  let sceneNo = 0;                                 // section headings count up on each page, like scenes
  /** a section heading: a scene in the page's film when it has one */
  const section = (title) => (HD.filmScene && HD.film(state.tab) && HD.filmScene(state.tab, title, ++sceneNo))
    || el('h2', { class: 'section-title', text: title });
  /** what the weekly report (report.js) needs from this file */
  const ui = {
    state, card, section, gotoDay,
    showReport(i) { state.report = i; state.tab = 'report'; history.replaceState(null, '', '#report'); window.scrollTo(0, 0); renderTab(); },
    goto(id) { state.tab = id; history.replaceState(null, '', '#' + id); window.scrollTo(0, 0); renderTab(); },
    /** open the notes tab at one entry of the evidence table (or at the table itself) */
    gotoRef(id) {
      state.tab = 'notes';
      history.replaceState(null, '', '#notes');
      renderTab(() => {
        const row = id && document.querySelector(`details.ref[data-id="${id}"]`);
        const target = row || document.getElementById('reference');
        if (row) row.open = true;
        if (target) window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - 110);   // clear the sticky tab bar
      });
    },
  };

  // ------------------------------------------------------------------ stat tiles
  const NOISE = (H.noise || {}).keys || {}, NOISE_Z = (H.noise || {}).z || 1.96;
  /**
   * The smallest change that is more than everyday ups and downs (reference.json noise_band):
   * two single readings, or two averages over n1 and n2 days.
   */
  function noiseBand(key, mode, n1, n2) {
    const t = NOISE[key];
    if (!t) return null;
    return mode === 'latest' ? NOISE_Z * Math.SQRT2 * t[0] : NOISE_Z * t[0] * Math.sqrt(1 / n1 + 1 / n2);
  }
  /**
   * o: { key, label, unit, dec, fmt, better:'up'|'down'|null, mode:'mean'|'latest', deltaFmt, bandFmt, sparse }
   * mean   -> average over the range, compared with the equally long period before it
   * latest -> latest reading in the range, compared with the first reading in the range
   * A change inside the wearer's everyday spread reads "持平", whatever its sign.
   */
  function kpi(o, ctx) {
    const arr = D[o.key], L = ctx.n, pa = ctx.a - L, pb = ctx.a - 1;
    const fmt = o.fmt || ((v) => num(v, o.dec || 0));
    let value = null, delta = null, note = '', band = null;
    if (o.mode === 'latest') {
      const fl = firstLast(arr, ctx.a, ctx.b);
      if (fl) {
        value = arr[fl.last];
        note = '最新 ' + DAYS[fl.last].slice(5);
        if (fl.first !== fl.last) {
          delta = value - arr[fl.first];
          note = '区间内变化（自 ' + DAYS[fl.first].slice(5) + '）';
          band = noiseBand(o.key, 'latest');
        }
      }
    } else {
      const n1 = countOf(arr, ctx.a, ctx.b), n2 = pa >= 0 ? countOf(arr, pa, pb) : 0;
      if (n1 >= 1) value = meanOf(arr, ctx.a, ctx.b);
      if (value != null && pa >= 0 && n2 >= Math.min(3, L)) {
        delta = value - meanOf(arr, pa, pb);
        note = '较前 ' + L + ' 天';
        band = noiseBand(o.key, 'mean', n1, n2);
      }
    }
    const tile = el('div', { class: 'tile' });
    tile.append(el('div', { class: 'k', text: o.label }));
    const v = el('div', { class: 'v', text: value == null ? '–' : fmt(value) });
    if (value != null && o.unit) v.append(el('small', { text: o.unit }));
    tile.append(v);
    const d = el('div', { class: 'd' });
    if (value == null) d.textContent = '该范围内无数据';
    else if (delta == null) d.textContent = note || (o.mode === 'latest' ? '' : '此前没有可比数据');
    else {
      const eps = 0.5 * Math.pow(10, -(o.dec || 0));
      const tiny = Math.abs(delta) < (o.eps || eps);
      const calm = !tiny && band != null && Math.abs(delta) < band;      // real numbers, everyday size
      const flat = tiny || calm;
      const up = delta > 0;
      const cls = flat || !o.better ? 'flat' : (up ? 'up' : 'down') === o.better ? 'good' : 'bad';
      const change = o.deltaFmt ? o.deltaFmt(delta) : signed(delta, o.dec || 0) + (o.unit ? ' ' + o.unit : '');
      const text = flat ? '持平' : (up ? '▲ ' : '▼ ') + change;
      const spread = band == null ? '' : o.bandFmt ? o.bandFmt(band) : num(band, o.dec || 0) + (o.unit ? ' ' + o.unit : '');
      const title = band == null ? null : `变化 ${change}；超过 ${spread} 才算超出你的日常起伏`;
      d.append(el('b', { class: cls, text, title }), ' ' + note + (calm ? ' · 在日常起伏内' : ''));
    }
    tile.append(d);
    const smooth = rolling(o.key, 7, o.sparse ? 1 : 3);
    const cur = smooth.slice(ctx.a, ctx.b + 1), prev = pa >= 0 ? smooth.slice(pa, pb + 1) : [];
    const sp = HD.sparkline(prev, cur);
    if (sp) tile.append(sp);
    return tile;
  }
  function plainTile(label, value, unit, note) {
    const tile = el('div', { class: 'tile' }, el('div', { class: 'k', text: label }));
    const v = el('div', { class: 'v', text: value });
    if (unit) v.append(el('small', { text: unit }));
    tile.append(v, el('div', { class: 'd', text: note || '' }));
    return tile;
  }
  const tiles = (ctx, list) => el('div', { class: 'tiles' }, list.map((o) => (o.nodeType ? o : kpi(o, ctx))));
  Object.assign(ui, {
    kpi, plainTile, tiles, mountChart,
    /** re-render the current tab where it is (used by pages with their own controls) */
    refresh: () => renderTab(),
    setPreset(p) { applyPreset(p, true); store.save(); renderTab(); },
    setRange(a, b) { state.a = Math.min(a, b); state.b = Math.max(a, b); state.preset = 'custom'; renderTab(); },
  });

  const K = {
    rhr: { key: 'rhr', label: '静息心率', unit: 'bpm', dec: 1, better: 'down' },
    hrv: { key: 'hrv', label: '心率变异性（HRV）', unit: 'ms', dec: 1, better: 'up' },
    sleep: { key: 'sleepTotal', label: '睡眠时长', fmt: hm, better: 'up', eps: 1 / 60, deltaFmt: (v) => signed(v * 60) + ' 分', bandFmt: (v) => num(v * 60) + ' 分' },
    bed: { key: 'bedtime', label: '平均入睡时间', fmt: clock, eps: 1, deltaFmt: (v) => (v > 0 ? '晚 ' : '早 ') + num(Math.abs(v)) + ' 分', bandFmt: (v) => num(v) + ' 分' },
    wake: { key: 'waketime', label: '平均醒来时间', fmt: clock, eps: 1, deltaFmt: (v) => (v > 0 ? '晚 ' : '早 ') + num(Math.abs(v)) + ' 分', bandFmt: (v) => num(v) + ' 分' },
    steps: { key: 'steps', label: '日均步数', unit: '步', dec: 0, better: 'up' },
    active: { key: 'activeKcal', label: '日均活动能量', unit: '千卡', dec: 0, better: 'up' },
    exercise: { key: 'exerciseMin', label: '日均锻炼时间', unit: '分', dec: 0, better: 'up' },
    mod: { key: 'modMin', label: '日均中等强度', unit: '分', dec: 0, better: 'up' },
    vig: { key: 'vigMin', label: '日均高强度', unit: '分', dec: 0, better: 'up' },
    stand: { key: 'standHours', label: '日均站立小时', unit: '小时', dec: 1, better: 'up' },
    distance: { key: 'distance', label: '日均步行 + 跑步', unit: '公里', dec: 2, better: 'up' },
    total: { key: 'totalKcal', label: '日均总消耗', unit: '千卡', dec: 0 },
    weight: { key: 'weight', label: '体重', unit: 'kg', dec: 1, mode: 'latest', sparse: true },
    fat: { key: 'bodyFat', label: '体脂率', unit: '%', dec: 1, mode: 'latest', sparse: true },
    lean: { key: 'lean', label: '去脂体重', unit: 'kg', dec: 1, mode: 'latest', sparse: true },
    bmi: { key: 'bmi', label: 'BMI', dec: 1, mode: 'latest', sparse: true },
    vo2: { key: 'vo2max', label: '最大摄氧量（VO₂max）', unit: 'ml/kg·min', dec: 1, mode: 'latest', better: 'up', sparse: true },
    deep: { key: 'deepPct', label: '深睡占比', unit: '%', dec: 1, better: 'up' },
    rem: { key: 'remPct', label: '快速眼动占比', unit: '%', dec: 1 },
    awake: { key: 'sleepAwake', label: '夜间清醒', unit: '分', dec: 0, better: 'down' },
    sleepHr: { key: 'sleepHr', label: '睡眠平均心率', unit: 'bpm', dec: 1, better: 'down' },
    walkHr: { key: 'walkHr', label: '步行平均心率', unit: 'bpm', dec: 0, better: 'down' },
    resp: { key: 'resp', label: '睡眠呼吸频率', unit: '次/分', dec: 1 },
    spo2: { key: 'spo2', label: '血氧饱和度', unit: '%', dec: 1 },
  };

  function workoutTiles(ctx) {
    const cur = HD.workoutsIn(ctx.a, ctx.b), L = ctx.n;
    const prev = ctx.a - L >= 0 ? HD.workoutsIn(ctx.a - L, ctx.a - 1) : null;
    const sum = (ws, k) => ws.reduce((s, w) => s + (w[k] || 0), 0);
    const hrs = cur.filter((w) => w.hrAvg);
    const cmp = prev ? `前 ${L} 天：${prev.length} 次 · ${hm(sum(prev, 'min') / 60)}` : '';
    return [
      plainTile('训练次数', String(cur.length), '次', cmp),
      plainTile('训练总时长', cur.length ? hm(sum(cur, 'min') / 60) : '–', '', cur.length ? '平均每次 ' + mins(sum(cur, 'min') / cur.length) : ''),
      plainTile('每周训练', cur.length ? num(cur.length / (L / 7), 1) : '–', '次', cur.length ? '每周 ' + mins(sum(cur, 'min') / (L / 7)) : ''),
      plainTile('训练消耗合计', cur.length ? num(sum(cur, 'kcal')) : '–', '千卡', cur.length ? '平均每次 ' + num(sum(cur, 'kcal') / cur.length) + ' 千卡' : ''),
      plainTile('训练平均心率', hrs.length ? num(sum(hrs, 'hrAvg') / hrs.length) : '–', 'bpm', hrs.length ? '最高 ' + Math.max(...hrs.map((w) => w.hrMax || 0)) + ' bpm' : ''),
    ];
  }

  // ------------------------------------------------------------------ shared card specs
  const c1 = (T) => T.s[0], c2 = (T) => T.s[1];
  const C = {
    steps: { title: '步数', desc: '多设备重叠时段已去重，不会重复计数', build: trend({ key: 'steps', name: '步数', unit: '步', form: 'bar', eras: true }) },
    active: { title: '活动能量', desc: '相对「活动」圆环目标', build: trend({ key: 'activeKcal', name: '活动能量', unit: '千卡', form: 'bar', goalKey: 'moveGoal', eras: true }) },
    exercise: { title: '锻炼时间', desc: '相对「锻炼」圆环目标', build: trend({ key: 'exerciseMin', name: '锻炼时间', unit: '分', form: 'bar', goalKey: 'exerciseGoal' }) },
    stand: { title: '站立小时', desc: '相对「站立」圆环目标', build: trend({ key: 'standHours', name: '站立', unit: '小时', dec: 1, form: 'bar', goalKey: 'standGoal' }) },
    rhr: { title: '静息心率', desc: '越低通常代表心肺恢复越好；换设备后的数值不可直接比较', build: trend({ key: 'rhr', name: '静息心率', unit: 'bpm', dec: 1, eras: true, baseline: true }) },
    hrv: { title: '心率变异性（HRV，SDNN）', desc: '个人基线内越高通常代表恢复越好', build: trend({ key: 'hrv', name: 'HRV', unit: 'ms', dec: 1, baseline: true }) },
    weight: { title: '体重', build: trend({ key: 'weight', name: '体重', unit: 'kg', dec: 1, sparse: true, minN: 1 }) },
    vo2: { title: '最大摄氧量（VO₂max）', desc: '手表在户外步行 / 跑步 / 徒步后估算，更新较稀疏' + (HD.vo2Band() ? '；浅色带是同龄同性别中间一半的人' : ''), build: trend({ key: 'vo2max', name: 'VO₂max', unit: 'ml/kg·min', dec: 1, sparse: true, roll: 0, band: HD.vo2Band(),
      // keep the whole band on the axis, so the readings show where they sit in it
      yMin: HD.vo2Band() ? (v) => 5 * Math.floor((Math.min(v.min, HD.vo2Band()[0]) - 1) / 5) : undefined,
      yMax: HD.vo2Band() ? (v) => 5 * Math.ceil((Math.max(v.max, HD.vo2Band()[1]) + 1) / 5) : undefined }) },
    sleepStages: { title: '睡眠时长与分期', desc: '按醒来日期统计，包含小睡', span: 12, h: 260, build: HD.sleepStages },
  };

  // ------------------------------------------------------------------ intensity (the watch's METs)
  const AD = (H.analysis || {}).daily || {};
  const refParams = (id) => ((((H.reference || {}).indicators || []).find((x) => x.id === id)) || {}).params || {};
  const lastIn = (arr, a, b) => { for (let i = b; i >= a; i--) if (arr && arr[i] != null) return i; return null; };
  function intensitySection(ctx) {
    if (!D.modMin || !D.modMin.some((v) => v != null)) return [];
    const pa = refParams('activity_minutes'), pp = refParams('activity_pattern');
    const [lo, hi] = pa.moderate_min || [150, 300], weight = pa.vigorous_weight || 2, burst = pp.burst_minutes || [1, 3];
    return [
      section('强度'),
      grid(ctx, [
        { title: '每天的中高强度', desc: `手表估算的用力程度（MET）：${pa.moderate_met}–${pa.vigorous_met} 为中等强度，${pa.vigorous_met} 以上为高强度；基本没戴表的日子留空`, span: 12,
          build: stackTrend({ parts: [{ key: 'modMin', name: '中等强度', color: c1 }, { key: 'vigMin', name: '高强度', color: c2 }], unit: '分' }) },
        {
          title: '每周中高强度', desc: `近 7 天合计，1 分钟高强度按 ${weight} 分钟算；浅色带是世卫组织推荐的每周 ${lo}–${hi} 分钟`,
          build: (c) => {
            const out = trend({ key: 'mvpa7', values: AD.mvpa7, name: '中高强度', unit: '分', roll: 0, band: [lo, hi, `每周 ${lo}–${hi} 分钟`] })(c);
            const i = lastIn(AD.mvpa7, c.a, c.b);
            if (!out.empty && i != null) {
              const spread = AD.mvpa7[i] >= lo && AD.topShare7[i] != null && AD.topShare7[i] >= (pp.top_share || 0.5);
              out.note = `截至 ${DAYS[i].slice(5)}：近 7 天 ${num(AD.mvpa7[i])} 分钟（中等 ${num(AD.mod7[i])} + 高强度 ${num(AD.vig7[i])} × ${weight}）` +
                (spread ? `，${num(100 * AD.topShare7[i])}% 集中在两天里完成。研究发现，每周达标时集中练和分散练获益相近` : '');
            }
            return out;
          },
        },
        { title: '生活里的高强度片段', desc: `训练以外持续 ${burst[0]}–${burst[1]} 分钟的高强度，比如快步爬几层楼、小跑赶车。研究里每天 3 次左右，就和明显更低的心血管风险相关`,
          build: trend({ key: 'vigBursts', name: '高强度片段', unit: '次', form: 'bar' }) },
      ]),
    ];
  }

  /** the weekly rhythm of body weight, with a plain verdict and the size of everyday ups and downs */
  function weightRhythm(ctx) {
    const out = HD.weekdayRhythm({ key: 'weight', unit: 'kg', dec: 2 })(ctx);
    if (out.empty) return out;
    const te = NOISE.weight ? NOISE.weight[0] : null;
    const days = WEEKDAY.filter((_, i) => out.clear[i]);
    out.note = (days.length ? `${days.join('、')}和前后几天的差别，按同时比较 7 天的严格标准也站得住。`
      : '你的记录里看不出明显的星期节律（同时比较 7 天，用了更严的标准）。') +
      (te ? `平时每次称重的起伏约 ±${num(te, 2)} kg，两次单独称重相差 ${num(NOISE_Z * Math.SQRT2 * te, 1)} kg 以内，都可能只是起伏。` : '') +
      '研究发现，周末之后偏重、工作日慢慢回落是正常的节律，不是长胖。';
    return out;
  }

  // ------------------------------------------------------------------ rings
  function ringMeters(ctx) {
    let days = 0, move = 0, ex = 0, st = 0, all = 0;
    for (let i = ctx.a; i <= ctx.b; i++) {
      if (D.exerciseMin[i] == null || D.activeKcal[i] == null) continue;
      days++;
      const m = D.moveGoal[i] != null && D.activeKcal[i] >= D.moveGoal[i];
      const e = D.exerciseMin[i] >= (D.exerciseGoal[i] || 30);
      const s = D.standHours[i] != null && D.standHours[i] >= (D.standGoal[i] || 12);
      move += m; ex += e; st += s; all += m && e && s;
    }
    if (!days) return { empty: true };
    const row = (name, n) => el('div', { class: 'meter' },
      el('div', { class: 'row' }, el('span', { text: name }),
        el('span', null, el('b', { text: num(100 * n / days) + '%' }), el('span', { class: 'n', text: `${n} / ${days} 天` }))),
      el('div', { class: 'bar', role: 'img', 'aria-label': `${name} ${num(100 * n / days)}%` }, el('i', { style: `width:${100 * n / days}%` })));
    return { node: el('div', { class: 'meters' }, row('活动（千卡达标）', move), row('锻炼（分钟达标）', ex), row('站立（小时达标）', st), row('三环全部合上', all)) };
  }

  // ------------------------------------------------------------------ tables
  function monthlyTable(ctx) {
    const bk = buckets(ctx.a, ctx.b, 'month');
    const m = (k, b) => meanOf(D[k], b.i0, b.i1);
    // [header, value(bucket), formatter, shade?]
    const cols = [
      ['步数', (b) => m('steps', b), (v) => num(v), true],
      ['活动千卡', (b) => m('activeKcal', b), (v) => num(v), true],
      ['锻炼分钟', (b) => m('exerciseMin', b), (v) => num(v), true],
      ['睡眠', (b) => m('sleepTotal', b), hm, true],
      ['入睡', (b) => m('bedtime', b), clock, false],
      ['静息心率', (b) => m('rhr', b), (v) => num(v, 1), true],
      ['HRV', (b) => m('hrv', b), (v) => num(v, 1), true],
      ['体重', (b) => m('weight', b), (v) => num(v, 1), true],
      ['体脂 %', (b) => m('bodyFat', b), (v) => num(v, 1), true],
      ['训练', (b) => W.filter((w) => w.d >= b.i0 && w.d <= b.i1).length || null, (v) => v + ' 次', true],
    ];
    const vals = cols.map((c) => bk.map((b) => c[1](b)));
    const range = vals.map((col) => {
      const xs = col.filter((v) => v != null);
      return xs.length > 1 ? [Math.min(...xs), Math.max(...xs)] : null;
    });
    const wrap = el('div', { class: 'tablewrap tall', style: 'border-top:0;margin-top:6px' });
    wrap.append(el('table', null,
      el('thead', null, el('tr', null, ['月份', ...cols.map((c) => c[0])].map((c) => el('th', { text: c })))),
      el('tbody', null, bk.map((b, r) => el('tr', null, el('td', { text: b.label }), cols.map((c, k) => {
        const v = vals[k][r];
        if (v == null) return el('td', { class: 'dim', text: '–' });
        const rg = range[k];
        const t = c[3] && rg && rg[1] > rg[0] ? (v - rg[0]) / (rg[1] - rg[0]) : null;
        return el('td', { text: c[2](v), style: t == null ? null : `background:color-mix(in srgb, var(--series-1) ${Math.round(3 + 22 * t)}%, transparent)` });
      }))).reverse())));
    return { node: wrap };
  }
  function workoutTypeTable(ctx) {
    const ws = HD.workoutsIn(ctx.a, ctx.b);
    if (!ws.length) return { empty: true };
    const by = new Map();
    for (const w of ws) {
      const g = by.get(w.type) || { n: 0, min: 0, kcal: 0, hr: 0, hrN: 0 };
      g.n++; g.min += w.min; g.kcal += w.kcal || 0;
      if (w.hrAvg) { g.hr += w.hrAvg; g.hrN++; }
      by.set(w.type, g);
    }
    const rows = [...by.entries()].sort((p, q) => q[1].min - p[1].min);
    const wrap = el('div', { class: 'tablewrap', style: 'border-top:0;margin-top:6px' });
    wrap.append(el('table', null,
      el('thead', null, el('tr', null, ['类型', '次数', '总时长', '平均时长', '平均心率', '总消耗'].map((c) => el('th', { text: c })))),
      el('tbody', null, rows.map(([type, g]) => el('tr', null,
        el('td', null, el('span', { class: 'swatch', style: 'background:' + HD.typeColor(type, ctx.T) }), type),
        el('td', { text: g.n }), el('td', { text: hm(g.min / 60) }), el('td', { text: mins(g.min / g.n) }),
        el('td', { text: g.hrN ? num(g.hr / g.hrN) + ' bpm' : '–' }), el('td', { text: num(g.kcal) + ' 千卡' }))))));
    return { node: wrap };
  }
  function workoutList(ctx) {
    const ws = HD.workoutsIn(ctx.a, ctx.b).slice().reverse();
    if (!ws.length) return { empty: true };
    const cols = ['日期', '开始', '类型', '时长', '活动千卡', '平均心率', '最高心率', '距离', '强度（MET）', '体感评分'];
    const wrap = el('div', { class: 'tablewrap tall', style: 'border-top:0;margin-top:6px' });
    wrap.append(el('table', null,
      el('thead', null, el('tr', null, cols.map((c, i) => el('th', { class: i === 2 ? 'l' : '', text: c })))),
      el('tbody', null, ws.map((w) => el('tr', null,
        el('td', { text: DAYS[w.d] }), el('td', { text: w.time }),
        el('td', { class: 'l' }, el('span', { class: 'swatch', style: 'background:' + HD.typeColor(w.type, ctx.T) }), w.type),
        el('td', { text: mins(w.min) }), el('td', { text: num(w.kcal) }), el('td', { text: num(w.hrAvg) }), el('td', { text: num(w.hrMax) }),
        el('td', { text: w.dist ? num(w.dist, 2) + ' 公里' : '–' }), el('td', { text: num(w.mets, 1) }), el('td', { text: w.effort == null ? '–' : num(w.effort) }))))));
    return { node: wrap };
  }

  // ------------------------------------------------------------------ ECG
  function ecgCard(ctx) {
    const recs = H.ecg || [];
    if (!recs.length) return { empty: true };
    const plot = el('div', { class: 'plot', style: 'height:260px', role: 'img', 'aria-label': '心电图波形' });
    const info = el('p', { class: 'desc', style: 'margin-top:10px' });
    const pick = el('div', { class: 'ecg-pick' });
    let chart = null;
    const show = (k) => {
      const r = recs[k];
      [...pick.children].forEach((b, i) => b.setAttribute('aria-pressed', i === k ? 'true' : 'false'));
      info.textContent = `${r.date} ${r.time} · 分类：${r.cls} · 估算心率 ${r.hr == null ? '–' : r.hr + ' bpm'} · ${r.sec} 秒 · ${r.fs} Hz · ${r.lead}` + (r.symptoms ? ` · 症状：${r.symptoms}` : '');
      const opt = HD.ecgOption(r, ctx.T);
      if (chart) chart.setOption(opt, true); else chart = mountChart(plot, opt);
    };
    recs.forEach((r, k) => pick.append(el('button', { class: 'ghost', type: 'button', text: `${r.date} ${r.time}`, onclick: () => show(k) })));
    queueMicrotask(() => show(recs.length - 1));
    return { node: el('div', null, pick, info, plot, el('p', { class: 'desc', text: '默认显示前 10 秒：滚轮缩放，拖动下方滑块查看全部 30 秒。分类结果来自 Apple Watch，估算心率由本看板根据 R 波间距计算。' })) };
  }

  // ------------------------------------------------------------------ single day
  function chartCard(title, desc, option, h, span, legend, emptyText) {
    const root = el('section', { class: 'card' + (span ? ' s' + span : '') });
    root.append(el('div', { class: 'card-head' }, el('div', null, el('h3', { text: title }), desc && el('p', { class: 'desc', text: desc }))));
    if (!option) { root.append(el('div', { class: 'empty', text: emptyText || '这一天没有数据' })); return root; }
    if (legend) root.append(el('div', { class: 'legend' }, legend.map((x) => el('span', null, el('i', { style: 'background:' + x.color }), x.name))));
    const plot = el('div', { class: 'plot', style: `height:${h}px`, role: 'img', 'aria-label': title });
    root.append(plot);
    queueMicrotask(() => mountChart(plot, option));
    return root;
  }
  function baseNote(key, d, dec) {
    const B = HD.baseline(key), v = D[key][d];
    if (B.mean[d] == null || v == null) return '';
    const lo = B.mean[d] - B.sd[d], hi = B.mean[d] + B.sd[d];
    return `基线 ${num(lo, dec)}–${num(hi, dec)}` + (v > hi ? '，偏高' : v < lo ? '，偏低' : '，在范围内');
  }
  function sleepBar(d, T) {
    if (D.sleepTotal[d] == null) return null;
    const parts = [
      ['深睡', D.sleepDeep[d], T.stage.deep, '#ffffff'], ['核心', D.sleepCore[d], T.stage.core, '#ffffff'],
      ['快速眼动', D.sleepRem[d], T.stage.rem, '#0b0b0b'], ['未分期', D.sleepUnspec[d], T.n1, '#ffffff'],
      ['清醒', D.sleepAwake[d] == null ? null : D.sleepAwake[d] / 60, T.stage.awake, '#ffffff'],
    ].filter((x) => x[1]);
    const total = parts.reduce((t, x) => t + x[1], 0);
    const bar = el('div', { class: 'segbar', role: 'img', 'aria-label': parts.map((x) => x[0] + ' ' + hm(x[1])).join('，') },
      parts.map((x) => el('div', { style: `flex:${x[1]} 1 0;background:${x[2]};color:${x[3]}`, title: x[0] + ' ' + hm(x[1]) },
        x[1] / total >= 0.12 ? hm(x[1]) : '')));
    return el('div', null, bar,
      el('div', { class: 'legend' }, parts.map((x) => el('span', null, el('i', { style: 'background:' + x[2] }), x[0] + (x[1] / total < 0.12 ? ' ' + hm(x[1]) : '')))),
      el('p', { class: 'desc', style: 'margin-top:10px', text: `入睡 ${clock(D.bedtime[d])} · 醒来 ${clock(D.waketime[d])} · 睡眠合计 ${hm(D.sleepTotal[d])}` +
        (D.sleepEff[d] != null ? ` · 效率 ${num(D.sleepEff[d], 1)}%` : '') + (D.sleepHr[d] != null ? ` · 睡眠心率 ${num(D.sleepHr[d], 1)} bpm` : '') }));
  }
  function dayTab(ctx) {
    if (state.day == null) state.day = HD.lastIntradayDay();
    const d = state.day, T = ctx.T;
    const input = el('input', { type: 'date', value: DAYS[d], min: DAYS[0], max: DAYS[N - 1], 'aria-label': '日期' });
    input.addEventListener('change', () => { if (input.value) { state.day = HD.indexOfDate(input.value); renderTab(); } });
    const go = (to) => () => { state.day = Math.max(0, Math.min(N - 1, to)); renderTab(); };
    const zone = (H.meta.timezones.find((z) => DAYS[d] >= z.from && DAYS[d] <= z.to) || {}).tz;
    const bar = el('div', { class: 'daybar' },
      el('button', { class: 'ghost', type: 'button', text: '← 前一天', onclick: go(d - 1), disabled: d === 0 }),
      input,
      el('button', { class: 'ghost', type: 'button', text: '后一天 →', onclick: go(d + 1), disabled: d === N - 1 }),
      el('button', { class: 'ghost', type: 'button', text: '最新', onclick: go(HD.lastIntradayDay()) }),
      el('span', { class: 'span', text: WEEKDAY[DOW[d]] + (zone ? ' · ' + zone : '') + (DAYS[d] === H.meta.partialDay ? ' · 导出当天，数据不完整' : '') }));
    const mark = (H.annotations || []).find((e) => e.d === d);
    const marks = mark && el('div', { class: 'daytags' },
      el('span', { class: 'lbl', text: '你的标注' }), mark.tags.map((t) => el('span', { class: 'pill', text: t })),
      mark.note && el('span', { text: mark.note }));
    const v = (k) => D[k][d];
    const tile = (label, value, unit, note) => plainTile(label, value == null ? '–' : value, value == null ? '' : unit, note);
    const tl = [
      tile('步数', v('steps') == null ? null : num(v('steps')), '步', v('distance') != null ? num(v('distance'), 2) + ' 公里' : ''),
      tile('活动能量', v('activeKcal') == null ? null : num(v('activeKcal')), '千卡', v('moveGoal') != null ? '目标 ' + num(v('moveGoal')) : ''),
      tile('锻炼时间', v('exerciseMin') == null ? null : num(v('exerciseMin')), '分', v('standHours') != null ? '站立 ' + v('standHours') + ' 小时' : ''),
      tile('昨夜睡眠', v('sleepTotal') == null ? null : hm(v('sleepTotal')), '', v('bedtime') != null ? clock(v('bedtime')) + ' – ' + clock(v('waketime')) : ''),
      tile('静息心率', v('rhr') == null ? null : num(v('rhr')), 'bpm', baseNote('rhr', d, 0)),
      tile('HRV', v('hrv') == null ? null : num(v('hrv'), 1), 'ms', baseNote('hrv', d, 0)),
      tile('心率范围', v('hrMin') == null ? null : v('hrMin') + ' – ' + v('hrMax'), 'bpm', v('hrAvg') != null ? '全天平均 ' + num(v('hrAvg')) : ''),
    ];
    if (v('weight') != null) tl.push(tile('体重', num(v('weight'), 1), 'kg', v('bodyFat') != null ? '体脂 ' + num(v('bodyFat'), 1) + '%' : ''));
    const ls = HD.dayListenStats ? HD.dayListenStats(d) : null;
    const listened = !!(ls && ls.minutes);
    if (listened) {
      tl.push(tile('耳机', hm(ls.minutes / 60), '', [ls.db != null ? '平均 ' + num(ls.db, 1) + ' 分贝' : '', ls.sessions ? ls.sessions + ' 次' : '']
        .filter(Boolean).join(' · ')));
    }
    const stageLegend = [['深睡', T.stage.deep], ['核心', T.stage.core], ['快速眼动', T.stage.rem], ['清醒', T.stage.awake], ['训练', T.ink2]]
      .concat(listened ? [['耳机', T.s[2]]] : [])
      .map(([name, color]) => ({ name, color }));
    const cards = [
      chartCard('全天心率', '每分钟的平均心率（当地时间）。下方的色带是睡眠分期、训练' + (listened ? '和耳机收听' : '时段'), HD.dayHeart(d, T),
        listened ? 360 : 340, 12, stageLegend, '这一天没有心率数据'),
    ];
    if (listened) {
      cards.push(chartCard('当天耳机音量', `每一段是一条音量记录（当地时间）· ${ls.devices.join('、') || '耳机'} · 合计 ${hm(ls.minutes / 60)}`,
        HD.dayVolume(d, T), 190, 12, null, '这一天没有用耳机'));
    }
    cards.push(chartCard('每小时步数', null, HD.daySteps(d, T), 200, 6, null, '这一天没有步数数据'));
    const sb = sleepBar(d, T);
    cards.push(el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('div', null, el('h3', { text: '昨夜睡眠构成' }), el('p', { class: 'desc', text: '记在醒来这一天' }))),
      sb || el('div', { class: 'empty', text: '这一天没有睡眠分期数据' })));
    const ws = W.filter((w) => w.d === d);
    if (ws.length) {
      cards.push(el('section', { class: 'card s12' }, el('div', { class: 'card-head' }, el('div', null, el('h3', { text: '当天训练' }))),
        el('div', { class: 'tablewrap', style: 'border-top:0;margin-top:6px' }, el('table', null,
          el('thead', null, el('tr', null, ['类型', '开始', '时长', '活动千卡', '平均心率', '最高心率', '距离'].map((c) => el('th', { text: c })))),
          el('tbody', null, ws.map((w) => el('tr', null, [w.type, w.time, mins(w.min), num(w.kcal), num(w.hrAvg), num(w.hrMax), w.dist ? num(w.dist, 2) + ' 公里' : '–'].map((c) => el('td', { text: c })))))))));
    }
    return [bar, marks, el('div', { class: 'tiles' }, tl), section('这一天'), el('div', { class: 'grid' }, cards)].filter(Boolean);
  }
  const SC = (title, x, y, lag) => ({ title, span: 4, h: 250, emptyText: '有效数据不足 20 天', build: HD.scatter({ x, y, lag }) });
  const AX = {
    sleep: { key: 'sleepTotal', name: '睡眠时长', unit: '小时', dec: 1 },
    hrv: { key: 'hrv', name: 'HRV', unit: 'ms', dec: 1 },
    rhr: { key: 'rhr', name: '静息心率', unit: 'bpm', dec: 0 },
    bed: { key: 'bedtime', name: '入睡时间', fmt: clock, interval: 120, min: (v) => Math.floor(v.min / 120) * 120, max: (v) => Math.ceil(v.max / 120) * 120 },
    deep: { key: 'sleepDeep', name: '深睡时长', unit: '小时', dec: 2 },
    active: { key: 'activeKcal', name: '活动能量', unit: '千卡', dec: 0 },
    sleepHr: { key: 'sleepHr', name: '睡眠心率', unit: 'bpm', dec: 1 },
    steps: { key: 'steps', name: '步数', unit: '步', dec: 0 },
  };
  function insightsTab(ctx) {
    return [
      section('最近状态'),
      grid(ctx, [{ title: '相对个人基线', desc: '所选范围最后 7 天的均值，对比此前 28 天你自己的常态', span: 12, emptyText: '数据不足，无法建立基线（需要此前 28 天里至少 10 天有数据）', build: HD.baselineStatus }]),
      section('这算真的变化吗'),
      grid(ctx, [{ title: '多大的变化才算数', desc: '按你自己最近一年的起伏来算，不受上方时间范围影响', span: 12, emptyText: '数据还不够：每项至少要有 20 对相邻的读数', build: HD.noiseTable }]),
      section('你自己的对照'),
      ...HD.contrastNodes(ui),
      section('纪录与习惯'),
      grid(ctx, [
        { title: '个人纪录', desc: '所选时间范围内', build: HD.records },
        { title: '连续天数', desc: '所选时间范围内；「当前」算到最后一个完整的日子', build: HD.streaks },
      ]),
      section('指标之间的关系'),
      el('div', { class: 'callout', text: '每个点是一天。r 是相关系数（−1 到 +1），黑线是整体趋势；括号里是 95% 区间（按整周重抽样，因为相邻几天彼此相像），区间跨过 0 就说还看不出关系。相关不等于因果：比如训练多的日子睡眠心率高，可能只是因为训练本身。有效数据少于 20 天的不显示。' }),
      grid(ctx, [
        SC('睡眠时长 与 当天 HRV', AX.sleep, AX.hrv),
        SC('睡眠时长 与 当天静息心率', AX.sleep, AX.rhr),
        SC('入睡时间 与 深睡时长', AX.bed, AX.deep),
        SC('活动能量 与 当晚睡眠心率', AX.active, AX.sleepHr, 1),
        SC('活动能量 与 次日 HRV', AX.active, AX.hrv, 1),
        SC('步数 与 当晚睡眠时长', AX.steps, AX.sleep, 1),
      ]),
    ];
  }

  // ------------------------------------------------------------------ tabs
  const TABS = [
    { id: 'report', name: '周报', noFilters: true, render: (ctx) => HD.reportTab(ctx, ui) },
    {
      id: 'overview', name: '总览', render(ctx) {
        return [
          tiles(ctx, [K.rhr, K.hrv, K.sleep, K.bed, K.steps, K.active, K.exercise, K.weight, K.fat, K.vo2, ...workoutTiles(ctx).slice(0, 1)]),
          section('关键趋势'),
          grid(ctx, [C.rhr, C.hrv, C.sleepStages, C.steps, C.weight]),
          section('逐月对比'),
          grid(ctx, [{ title: '月度均值', desc: '每个指标取当月所有有数据日子的平均值；训练为当月次数。底色越深代表该列数值越大（只表示大小，不代表好坏）', span: 12, build: monthlyTable }]),
        ];
      },
    },
    {
      id: 'activity', name: '活动', render(ctx) {
        const hasEffort = !!(D.modMin && D.modMin.some((v) => v != null));
        return [
          tiles(ctx, [K.steps, K.active, K.exercise].concat(hasEffort ? [K.mod, K.vig] : [], [K.stand, K.distance, K.total])),
          section('每日活动'),
          grid(ctx, [
            C.steps, C.active, C.exercise, C.stand,
            { title: '圆环达标率', desc: '所选范围内佩戴手表的日子里，合上圆环的比例', build: ringMeters },
            { title: '一周各天的步数', desc: '所选范围内，按星期几取平均', build: HD.weekdayBars({ key: 'steps', name: '步数', unit: '步' }) },
            { title: '步数日历', desc: '每格一天，颜色越深步数越多', span: 12, h: HD.calendarHeight, build: HD.calendar({ key: 'steps', name: '步数', unit: '步', zero: true }) },
          ]),
          ...intensitySection(ctx),
          section('能量与距离'),
          grid(ctx, [
            { title: '每日总消耗', desc: '静息能量 + 活动能量', span: 12, build: stackTrend({ parts: [{ key: 'basalKcal', name: '静息能量', color: (T) => T.soft }, { key: 'activeKcal', name: '活动能量', color: c2 }], unit: '千卡', totalKey: 'totalKcal', eras: 'basalKcal' }) },
            { title: '步行 + 跑步距离', build: trend({ key: 'distance', name: '距离', unit: '公里', dec: 2, form: 'bar', eras: true }) },
            { title: '爬楼层数', build: trend({ key: 'flights', name: '爬楼', unit: '层', form: 'bar' }) },
          ]),
        ];
      },
    },
    {
      id: 'sleep', name: '睡眠', render(ctx) {
        return [
          tiles(ctx, [K.sleep, K.bed, K.wake, K.deep, K.rem, K.awake, K.sleepHr]),
          section('时长与作息'),
          grid(ctx, [
            C.sleepStages,
            { title: '作息时间线', desc: (c) => (c.n <= 150 ? '每晚一条：从上到下是入睡到醒来，颜色是睡眠分期（当地时间）' : '每晚一条：入睡到醒来（当地时间）。范围缩到 150 天以内可看到分期'), span: 12, h: 340, build: HD.sleepTimeline },
            { title: '入睡与醒来时间', desc: '日视图为 7 日均值；越平越规律', build: multiLine({ series: [{ key: 'bedtime', name: '入睡', color: c1 }, { key: 'waketime', name: '醒来', color: c2 }], fmt: clock, axisFmt: clock, interval: 120, yMin: (v) => Math.floor(v.min / 120) * 120, yMax: (v) => Math.ceil(v.max / 120) * 120 }) },
            { title: '分期占比', desc: '占睡眠总时长的比例；日视图为 7 日均值', build: multiLine({ series: [{ key: 'deepPct', name: '深睡', color: (T) => T.stage.deep }, { key: 'corePct', name: '核心', color: (T) => T.stage.core }, { key: 'remPct', name: '快速眼动', color: (T) => T.stage.rem }], dec: 1, unit: '%', zero: true, axisFmt: (v) => v + '%' }) },
            { title: '夜间清醒时长', desc: '入睡后到最终醒来之间', build: trend({ key: 'sleepAwake', name: '清醒', unit: '分', form: 'bar' }) },
            { title: '睡眠效率', desc: '睡着的时间 ÷ 整段睡眠时段', build: trend({ key: 'sleepEff', name: '睡眠效率', unit: '%', dec: 1, yMax: 100 }) },
            { title: '睡眠时长日历', desc: '每格一晚（记在醒来那天），颜色越深睡得越久', span: 12, h: HD.calendarHeight, build: HD.calendar({ key: 'sleepTotal', name: '睡眠时长', fmt: hm }) },
          ]),
          section('夜间生命体征'),
          grid(ctx, [
            { title: '睡眠心率：和平时比', span: 12, h: 240, emptyText: '需要先积累 14 晚以上的睡眠心率',
              desc: '每晚的睡眠心率减去此前最多 90 晚的中位数。连续 2 晚高出 4 次/分以上，周报会提一句；它和“多项体征同时偏离”各算各的',
              build: HD.nightHrRise },
            { title: '睡眠平均心率', span: 4, build: trend({ key: 'sleepHr', name: '睡眠心率', unit: 'bpm', dec: 1, eras: true, baseline: true }) },
            { title: '睡眠期间 HRV', span: 4, build: trend({ key: 'sleepHrv', name: 'HRV', unit: 'ms', dec: 1, baseline: true }) },
            { title: '呼吸频率', span: 4, build: trend({ key: 'resp', name: '呼吸频率', unit: '次/分', dec: 1, eras: true, baseline: true }) },
            { title: '手腕温度', desc: '睡眠时的手腕皮肤温度', span: 4, build: trend({ key: 'wristTemp', name: '手腕温度', unit: '°C', dec: 2, baseline: true }) },
            { title: '睡眠血氧', span: 4, build: trend({ key: 'sleepSpo2', name: '血氧', unit: '%', dec: 1, baseline: true }) },
            { title: '呼吸紊乱', desc: 'Apple Watch 估算的每小时次数，越低越好', span: 4, build: trend({ key: 'breathDist', name: '呼吸紊乱', unit: '次/时', dec: 1, form: 'bar' }) },
          ]),
        ];
      },
    },
    {
      id: 'heart', name: '心脏', render(ctx) {
        return [
          tiles(ctx, [K.rhr, K.hrv, K.walkHr, K.sleepHr, K.vo2]),
          section('恢复与体能'),
          grid(ctx, [C.rhr, C.hrv,
            { title: '步行平均心率', build: trend({ key: 'walkHr', name: '步行心率', unit: 'bpm', dec: 0 }) },
            C.vo2,
            { title: 'VO₂max 的同龄参照', desc: '和同龄同性别的人比，大概在什么位置；不受上方时间范围影响', span: 12, emptyText: '还没有 VO₂max 读数：戴着手表做户外步行、跑步或徒步后会有', build: HD.vo2Peers(ui) }]),
          section('全天心率'),
          grid(ctx, [
            { title: '每日心率范围', desc: '竖条是当天最低到最高，线是全天平均（按 5 分钟分箱，避免运动时的密集采样拉高均值）', span: 12, h: 260, build: HD.hrRange },
            { title: '一天中各时段的心率', desc: '每格是该小时的平均心率（当地时间）。夜间颜色越浅说明睡眠心率越低', span: 12, h: 300, build: HD.hrHeatmap },
          ]),
          section('心电图'),
          grid(ctx, [{ title: '心电图记录', desc: `共 ${(H.ecg || []).length} 份，不受上方时间范围影响`, span: 12, build: ecgCard }]),
        ];
      },
    },
    {
      id: 'workouts', name: '训练', render(ctx) {
        return [
          tiles(ctx, workoutTiles(ctx)),
          section('训练量'),
          grid(ctx, [
            { title: (ctx.gran === 'month' ? '每月' : '每周') + '训练时长', desc: '按训练类型堆叠', span: 12, h: 260, build: HD.workoutVolume },
            { title: '心率区间用时', desc: '区间 1 最轻松，区间 5 最高强度（区间边界由手表按你的心率设定）', build: HD.workoutZones },
            { title: '按类型汇总', build: workoutTypeTable },
            { title: '训练日历', desc: '每格一天，颜色越深当天训练越久', span: 12, h: HD.calendarHeight, build: HD.calendar({ values: HD.workoutMinutes, name: '训练时长', fmt: mins, zero: true }) },
          ]),
          section('训练记录'),
          grid(ctx, [{ title: '全部训练', desc: '最近的在最上面', span: 12, build: workoutList }]),
        ];
      },
    },
    {
      id: 'body', name: '身体', render(ctx) {
        return [
          tiles(ctx, [K.weight, K.fat, K.lean, K.bmi]),
          section('体成分'),
          grid(ctx, [
            C.weight,
            { title: '体脂率', build: trend({ key: 'bodyFat', name: '体脂率', unit: '%', dec: 1, sparse: true, minN: 1 }) },
            { title: '去脂体重', build: trend({ key: 'lean', name: '去脂体重', unit: 'kg', dec: 1, sparse: true, minN: 1 }) },
            { title: '脂肪量', desc: '体重 × 体脂率', build: trend({ key: 'fatMass', name: '脂肪量', unit: 'kg', dec: 1, sparse: true, minN: 1 }) },
            { title: 'BMI', build: trend({ key: 'bmi', name: 'BMI', dec: 1, sparse: true, minN: 1, band: [18.5, 23.9, '中国成人正常范围 18.5–23.9'] }) },
            { title: '一周里的体重起伏', emptyText: '称重的次数还不够看出星期节律', build: weightRhythm,
              desc: '每次称重和前后三天其他称重的平均差多少，按星期几平均；竖线是 95% 范围。看最近一年，不受上方时间范围影响' },
          ]),
        ];
      },
    },
    { id: 'hearing', name: '耳机', noFilters: true, render: (ctx) => HD.hearingTab(ctx, ui) },
    { id: 'insights', name: '洞察', render: insightsTab },
    { id: 'day', name: '单日', noFilters: true, render: dayTab },
    {
      id: 'more', name: '更多', render(ctx) {
        return [
          section('血氧'),
          grid(ctx, [
            { title: '血氧饱和度', desc: '全天读数的日均值', build: trend({ key: 'spo2', name: '血氧', unit: '%', dec: 1, band: [95, 100, '常见正常范围 95–100%'] }) },
            { title: '每日最低血氧读数', desc: '单次低读数常由佩戴松动或手臂姿势造成，看趋势而不是单点', build: trend({ key: 'spo2Min', name: '最低血氧', unit: '%', dec: 0 }) },
          ]),
          section('步态与活动能力'),
          grid(ctx, [
            { title: '步行速度', span: 4, build: trend({ key: 'walkSpeed', name: '步行速度', unit: '公里/时', dec: 2 }) },
            { title: '步长', span: 4, build: trend({ key: 'stepLen', name: '步长', unit: '厘米', dec: 1 }) },
            { title: '步行稳定性', span: 4, build: trend({ key: 'steadiness', name: '稳定性', unit: '%', dec: 1, sparse: true, roll: 0 }) },
            { title: '双脚支撑时间占比', desc: '越低通常代表平衡越好', span: 4, build: trend({ key: 'dblSupport', name: '双支撑', unit: '%', dec: 1 }) },
            { title: '步行不对称', desc: '左右步速不一致的时间占比', span: 4, build: trend({ key: 'asym', name: '不对称', unit: '%', dec: 1 }) },
            { title: '六分钟步行距离（估算）', span: 4, build: trend({ key: 'sixMin', name: '六分钟步行', unit: '米', sparse: true, roll: 0 }) },
            { title: '上楼速度', build: trend({ key: 'stairUp', name: '上楼速度', unit: '米/秒', dec: 2 }) },
            { title: '下楼速度', build: trend({ key: 'stairDown', name: '下楼速度', unit: '米/秒', dec: 2 }) },
          ]),
          section('环境与习惯'),
          grid(ctx, [
            { title: '日照时间', build: trend({ key: 'daylight', name: '日照', unit: '分', form: 'bar' }) },
            { title: '饮水量', desc: '仅在有记录的日子', build: trend({ key: 'water', name: '饮水', unit: '毫升', form: 'bar', roll: 0 }) },
          ]),
          el('p', { class: 'desc', style: 'margin-top:14px' }, '耳机音量、收听习惯和听力测试在 ',
            el('button', { class: 'link', type: 'button', text: '耳机', onclick: () => ui.goto('hearing') }), ' 页。'),
        ];
      },
    },
    { id: 'summary', name: '小结', noFilters: true, render: (ctx) => HD.summaryTab(ctx, ui) },
    { id: 'backtest', name: '回测', noFilters: true, render: (ctx) => HD.backtestTab(ctx, ui) },
    { id: 'notes', name: '数据说明', noFilters: true, render: notes },
  ];

  // ------------------------------------------------------------------ reference table
  /** The evidence table (pipeline/reference.json): one fold-out row per indicator. */
  function referenceNodes() {
    const R = H.reference;
    if (!R) return [el('div', { class: 'callout', text: '当前的看板数据是旧版本生成的，还没有这张表。重新运行一次更新即可。' })];
    const sources = (list) => el('ul', { class: 'srcs' }, list.map((s) => el('li', null,
      el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.cite }),
      el('div', { text: s.finding }),
      el('div', { class: 'how', text: R.checked[s.checked] || s.checked }))));
    const grade = (g) => el('span', { class: 'pill', title: R.grades[g], text: '证据 ' + g });
    const row = (ind) => el('details', { class: 'ref', 'data-id': ind.id },
      el('summary', null, el('b', { text: ind.name }), grade(ind.grade), el('span', { class: 'rng', text: ind.range })),
      el('div', { class: 'ref-body' },
        el('p', null, el('b', { text: '怎么算：' }), ind.method),
        el('p', null, el('b', { text: `证据 ${ind.grade}：` }), R.grades[ind.grade] + '。' + ind.grade_note),
        ind.caveats.length ? el('p', null, el('b', { text: '留意：' })) : null,
        ind.caveats.length ? el('ul', null, ind.caveats.map((c) => el('li', { text: c }))) : null,
        el('p', null, el('b', { text: '出处：' })),
        sources(ind.sources)));
    const out = [
      el('p', { id: 'reference', text: R.about }),
      el('ul', null, R.principles.map((p) => el('li', { text: p }))),
      el('p', { class: 'ref-legend' }, Object.keys(R.grades).map((g) => el('span', null, el('span', { class: 'pill', text: '证据 ' + g }), ' ' + R.grades[g]))),
    ];
    for (const g in R.groups) {
      const items = R.indicators.filter((ind) => ind.group === g);
      if (!items.length) continue;
      out.push(el('h4', { class: 'ref-group', text: R.groups[g] }), ...items.map(row));
    }
    if (R.scores) {
      out.push(el('h4', { class: 'ref-group', text: '周报里的分数' }), el('p', { text: R.scores.about }), el('p', { text: R.scores.note }));
      for (const key of ['sleep', 'activity']) {
        const s = R.scores[key];
        if (!s) continue;
        out.push(el('details', { class: 'ref' },
          el('summary', null, el('b', { text: s.label + '分' }), el('span', { class: 'rng', text: s.parts.map((p) => `${p.label} ${p.max} 分`).join(' + ') })),
          el('div', { class: 'ref-body' }, el('ul', null, s.parts.map((p) => el('li', null, el('b', { text: p.label + '：' }), p.rule))))));
      }
    }
    out.push(el('h4', { class: 'ref-group', text: '没有采用的指标' }),
      ...R.excluded.map((x) => el('details', { class: 'ref' },
        el('summary', null, el('b', { text: x.name }), el('span', { class: 'rng', text: x.reason })),
        el('div', { class: 'ref-body' }, el('p', null, el('b', { text: '出处：' })), sources(x.sources)))));
    return out;
  }

  // ------------------------------------------------------------------ notes
  function notes(ctx) {
    const m = H.meta, ck = m.checks || {};
    const how = { metadata: '设备记录', inferred: '自动推断', override: '手动指定', default: '默认' };
    const simpleTable = (cols, rows) => {
      const wrap = el('div', { class: 'tablewrap tall', style: 'border-top:0;margin-top:6px' });
      wrap.append(el('table', null,
        el('thead', null, el('tr', null, cols.map((c) => el('th', { class: 'l', text: c })))),
        el('tbody', null, rows.map((r) => el('tr', null, r.map((c) => el('td', { class: 'l', text: c })))))));
      return wrap;
    };
    const eraRows = [];
    const eraNames = { steps: '步数', activeKcal: '活动能量', hrAvg: '心率', rhr: '静息心率', sleepTotal: '睡眠', resp: '呼吸频率', weight: '体重', spo2: '血氧', hrv: 'HRV' };
    for (const k in eraNames) for (const r of (m.eras || {})[k] || []) eraRows.push([eraNames[k], r.from + ' → ' + r.to, shortSource(r.src), r.days + ' 天']);
    const sexWord = { male: '男', female: '女' }[m.profile.sex] || '';
    const profile = [sexWord, m.profile.age != null ? m.profile.age + ' 岁' : '', m.profile.heightCm ? m.profile.heightCm + ' cm' : ''].filter(Boolean).join(' · ');
    const box = el('div', { class: 'grid' });
    const add = (title, span, ...kids) => box.append(el('section', { class: 'card s' + span }, el('div', { class: 'card-head' }, el('h3', { text: title })), el('div', { class: 'notes' }, kids)));

    add('这份数据', 6,
      el('ul', null,
        el('li', null, '来源文件：', el('b', { text: m.exportFile })),
        el('li', { text: `导出时间 ${m.exportDate}，看板生成于 ${m.generatedAt}` }),
        el('li', { text: `共 ${num(m.records)} 条记录，覆盖 ${m.firstDay} → ${m.lastDay}（${N} 天）` }),
        profile && el('li', { text: '健康 App 中的个人资料：' + profile }),
        el('li', { text: `${m.partialDay} 是导出当天，步数、能量、心率范围等全天累计值不完整，已从该日剔除；昨夜睡眠等已完成的数据保留。` }),
        el('li', { text: (H.annotations || []).length
          ? `你标注了 ${H.annotations.length} 天（来自 标注.csv），在「单日」页可以看到。`
          : '想记下生病、饮酒、熬夜这样的日子，把 标注.example.csv 复制为 标注.csv 填写，下次更新时会读进来。' })),
      (m.warnings || []).map((w) => el('div', { class: 'callout', text: w })));

    add('准确性核对', 6,
      el('ul', null,
        ck.steps && el('li', { text: `步数：各设备直接相加为 ${num(ck.steps.rawTotal)} 步，去掉重叠时段后为 ${num(ck.steps.dedupTotal)} 步（去除了 ${ck.steps.removedPct}% 的重复计数）。` }),
        ck.activeEnergy && el('li', { text: `对账：把去重后的活动能量按天汇总，与 Apple 自己保存的每日汇总逐日比较，中位偏差 ${ck.activeEnergy.medianDiffPct}%，${ck.activeEnergy.within2pct}% 的天数偏差在 2% 以内（共 ${ck.activeEnergy.days} 天）。这同时验证了去重规则和时区还原。` }),
        el('li', { text: '活动能量、锻炼分钟、站立小时优先采用 Apple 的每日汇总值；没有汇总的日子才用去重后的记录求和。' })));

    add('计算方法', 12,
      el('ul', null,
        el('li', null, el('b', { text: '多设备去重：' }), '同一时刻有多个来源时，按 Apple Watch → iPhone → 其他 App 的优先级取值；低优先级记录与高优先级重叠的那部分时间按比例扣除。可在 config.json 的 source_priority 中调整顺序。'),
        el('li', null, el('b', { text: '时区：' }), '导出文件把所有时间统一写成导出时手机所在时区。看板根据睡眠 / 训练记录里的时区信息还原你当时所在地；没有时区信息的时段，用 Apple 每日汇总反推（哪个时区的"一天"能对上汇总值）。所有按天统计和作息时间都是当地时间。'),
        el('li', null, el('b', { text: '睡眠：' }), '一个"睡眠日"是当地时间前一天 18:00 到当天 18:00，记在醒来那天，包含小睡。入睡 / 醒来取当晚最长的一段睡眠。同一晚有多个来源时，优先采用带分期的来源。只有"卧床"记录的夜晚（手机或第三方 App 的估计）单独标灰，不计入睡眠时长。'),
        el('li', null, el('b', { text: '心率：' }), '全天平均按 5 分钟分箱后再平均，避免训练时每几秒一次的密集采样把均值拉高。睡眠心率只统计处于睡着状态的时段。'),
        el('li', null, el('b', { text: '趋势线：' }), '日视图中的粗线是过去 7 天的滑动平均（至少 3 天有数据才画）；周 / 月视图是该周 / 月内有数据日子的平均值，周从周一开始，范围两端的周 / 月取整周 / 整月。'),
        el('li', null, el('b', { text: '换设备：' }), '图上的竖线标出某项指标的主要数据来源发生变化的日期。不同设备的算法不同（尤其是静息心率、睡眠分期），跨竖线两侧的数值不宜直接比较。'),
        el('li', null, el('b', { text: '个人基线：' }), '每一天的基线范围是此前 28 天（至少 10 天有数据）的均值 ± 1 个标准差，不包含当天，所以每个数值都是和你自己的过去比。「洞察」页用所选范围最后 7 天的均值，对比再往前的 28 天。'),
        el('li', null, el('b', { text: '关联分析：' }), '皮尔逊相关系数，每个点是一天；「当晚」「次日」表示把后一天的数值对到前一天。95% 区间按整周（7 个点一组）重抽样 400 次得到，因为相邻几天彼此相像，逐天重抽样会让区间显得过窄；区间跨过 0 就说还看不出关系。有效数据少于 20 天不计算。相关不等于因果。'),
        el('li', null, el('b', { text: '睡眠心率连续偏高：' }), '每晚睡着时段的平均心率，减去此前最多 90 晚的中位数（至少 14 晚）。高出 4 次/分以上的夜晚算偏高；连续 2 晚偏高，周报会提一句，中间缺 1 晚数据不打断。和“多项夜间体征同时偏离”是两条独立的规则，两边的结果都会显示。'),
        el('li', null, el('b', { text: '活动强度：' }), 'Apple Watch 戴着时持续记录用力程度（PhysicalEffort，单位 MET）。3 到 6 MET 算中等强度，6 MET 及以上算高强度，周报里 1 分钟高强度按 2 分钟算；当天记录覆盖不到 40% 的时间按没戴表处理。没有这类记录的设备，改用锻炼分钟。'),
        el('li', null, el('b', { text: '这算真的变化吗：' }), '每项指标最近一年里相邻两次读数之差的标准差 ÷ √2 是它的典型误差。指标卡上的涨跌，只有超过 1.96 × 典型误差 × √(1/n₁ + 1/n₂)（两段的平均值）或 1.96 × √2 × 典型误差（两个单独读数）才显示箭头，否则显示“持平”。周报的分数，用此前 12 期相邻两期之差的 1.96 个标准差作界线。'),
        el('li', null, el('b', { text: '你自己的对照：' }), '把有某种情况的夜晚和没有的夜晚分两组比平均值，周末和工作日分开比再合并；区间用自助法重抽样 2,000 次，每组至少 8 晚；所有比较一起做 Benjamini–Hochberg 校正（错误发现率 10%）。'),
        el('li', null, el('b', { text: 'VO₂max 同龄参照：' }), '最近一次读数之前 30 天内读数的平均，在 FRIEND 2015 跑步机测试的同龄同性别百分位表里线性插值；Apple 健康 App 的心肺适能分级用的也是这份参照。'),
        el('li', null, el('b', { text: '耳机：' }), 'iPhone 和 iPad 用耳机播放媒体时记录耳机里的音量（电话不计入），每条记录是一段时间和它的平均分贝。收听时长把重叠的记录只算一次；平均音量按时长做能量平均；声音剂量按 WHO 与国际电信联盟的安全收听标准，80 分贝听 40 小时为 100%，每高 3 分贝时间减半，取往前 7 天的合计。中间停顿不超过 5 分钟、用同一副耳机的记录算作一次收听。耳机型号来自记录里的设备信息，其中的蓝牙地址不会保存。'),
        el('li', null, el('b', { text: '单日详情：' }), '心率按分钟取平均，步数按小时汇总（已去重），都是当地时间。睡眠色带把跨午夜的一晚按日历日切开显示。')),
      el('div', { class: 'callout', text: '本看板只做数据整理与展示，参考范围为通用健康指引，不构成医疗诊断或建议。如有不适或数值持续异常，请咨询医生。' }));

    add('参考区间与出处', 12, ...referenceNodes());

    add('所在时区', 6, simpleTable(['起', '止', '时区', '依据'], m.timezones.map((t) => [t.from, t.to, t.tz, how[t.how] || t.how])));
    add('各指标的主要数据来源', 6, simpleTable(['指标', '时间段', '来源', '有数据'], eraRows));
    add('导出文件中的全部记录类型', 12,
      simpleTable(['类型', '条数', '最早', '最近', '单位', '来源'],
        m.inventory.map((r) => [r.type, num(r.n), r.first, r.last, r.unit || '–', r.sources.map(shortSource).join('、')])));
    return [box];
  }

  // ------------------------------------------------------------------ rendering
  /** `after` runs once the new tab is laid out (used to scroll to something inside it) */
  function renderTab(after) {
    const y = window.scrollY;
    main.style.minHeight = main.offsetHeight + 'px';
    observer.disconnect();
    for (const c of live) c.dispose();
    live = [];
    main.textContent = '';
    const tab = TABS.find((t) => t.id === state.tab) || TABS[0];
    document.body.dataset.tab = tab.id;                // lets a page restyle the whole screen: every page is its own film
    const film = HD.film ? HD.film(tab.id) : null;
    if (film) document.body.dataset.film = tab.id; else delete document.body.dataset.film;
    HD.resetTheme();                                   // chart colours follow the page
    const ctx = context();
    sceneNo = 0;
    const hero = film ? HD.filmHero(tab.id, ctx, ui) : null;
    if (hero) main.append(hero);
    for (const node of tab.render(ctx)) if (node) main.append(node);
    document.getElementById('filters').style.display = tab.noFilters ? 'none' : '';
    requestAnimationFrame(() => {
      main.style.minHeight = '';
      window.scrollTo(0, y);
      if (typeof after === 'function') after();
    });
    syncControls();
  }
  function syncControls() {
    for (const b of document.querySelectorAll('#tabs .tab')) b.setAttribute('aria-selected', b.dataset.id === state.tab ? 'true' : 'false');
    for (const b of document.querySelectorAll('#presets button')) b.setAttribute('aria-pressed', b.dataset.id === state.preset ? 'true' : 'false');
    for (const b of document.querySelectorAll('#grans button')) b.setAttribute('aria-pressed', b.dataset.id === state.gran ? 'true' : 'false');
    document.getElementById('dateFrom').value = DAYS[state.a];
    document.getElementById('dateTo').value = DAYS[state.b];
    document.getElementById('spanInfo').textContent = `${state.b - state.a + 1} 天` + (state.gran === 'day' ? ' · 点击图上某一天可查看单日详情' : '');
  }

  // ------------------------------------------------------------------ boot
  // ?range=365&gran=week in the address bar overrides the remembered view (every page is a night film; there is no theme switch)
  const saved = store.load();
  const qs = new URLSearchParams(location.search);
  for (const k of ['range', 'gran']) {
    if (qs.get(k)) saved[k === 'range' ? 'preset' : k] = qs.get(k);
  }
  applyPreset(PRESETS.some((p) => p[0] === saved.preset) ? saved.preset : '90', false);
  if (GRANS.some((g) => g[0] === saved.gran)) state.gran = saved.gran;
  if (TABS.some((t) => t.id === location.hash.slice(1))) state.tab = location.hash.slice(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(qs.get('day') || '')) state.day = HD.indexOfDate(qs.get('day'));
  if (/^\d{4}-\d{2}-\d{2}$/.test(qs.get('week') || '')) state.report = HD.reportIndex(qs.get('week'));

  const m = H.meta;
  document.getElementById('subtitle').textContent =
    `${m.firstDay} → ${m.lastDay} · ${N} 天 · 导出于 ${m.exportDate} · 看板更新于 ${m.generatedAt}`;

  const tabsEl = document.getElementById('tabs');
  for (const t of TABS) {
    tabsEl.append(el('button', {
      class: 'tab', type: 'button', role: 'tab', 'data-id': t.id, text: t.name,
      onclick: () => { state.tab = t.id; history.replaceState(null, '', '#' + t.id); window.scrollTo(0, 0); renderTab(); },
    }));
  }
  const presetsEl = document.getElementById('presets');
  for (const [id, name] of PRESETS) {
    presetsEl.append(el('button', { type: 'button', 'data-id': id, text: name, onclick: () => { applyPreset(id, false); store.save(); renderTab(); } }));
  }
  const gransEl = document.getElementById('grans');
  for (const [id, name] of GRANS) {
    gransEl.append(el('button', { type: 'button', 'data-id': id, text: name, onclick: () => { state.gran = id; store.save(); renderTab(); } }));
  }
  const from = document.getElementById('dateFrom'), to = document.getElementById('dateTo');
  from.min = to.min = DAYS[0];
  from.max = to.max = DAYS[N - 1];
  const onDate = () => {
    if (!from.value || !to.value) return;
    let a = HD.indexOfDate(from.value), b = HD.indexOfDate(to.value);
    if (a > b) [a, b] = [b, a];
    state.a = a; state.b = b; state.preset = 'custom';
    renderTab();
  };
  from.addEventListener('change', onDate);
  to.addEventListener('change', onDate);
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (id !== state.tab && TABS.some((t) => t.id === id)) { state.tab = id; renderTab(); }
  });
  renderTab();
})();
