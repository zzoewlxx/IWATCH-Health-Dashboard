/* Every page is its own Hong Kong film: a title card with a line of voice-over written from the
   reader's own numbers, and scene headings in that film's manner. Colours, type and the rest of the
   look live in films.css. The headphone page (hearing.js) was the first film and builds its own. */
(function () {
  'use strict';
  const HD = window.HD;
  if (!HD || !HD.H) return;
  const { H, DAYS, N, D, el, num, pad, meanOf, countOf, firstLast, WEEKDAY, DOW } = HD;
  const W = H.workouts || [];
  const REPORTS = H.reports || [];
  const I = window.HEALTH_INTRADAY || {};
  const PARTIAL = DAYS.indexOf(H.meta.partialDay);

  // ------------------------------------------------------------------ words
  const ZH = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const zhNum = (n) => (n <= 10 ? ZH[n] : n < 20 ? '十' + (n % 10 ? ZH[n % 10] : '') : ZH[Math.floor(n / 10)] + '十' + (n % 10 ? ZH[n % 10] : ''));
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dot = (i) => DAYS[i].replace(/-/g, '.');
  const dateZh = (i) => `${+DAYS[i].slice(0, 4)} 年 ${+DAYS[i].slice(5, 7)} 月 ${+DAYS[i].slice(8, 10)} 日`;
  const dateEn = (i) => `${MONTHS_EN[+DAYS[i].slice(5, 7) - 1]} ${+DAYS[i].slice(8, 10)}, ${DAYS[i].slice(0, 4)}`;
  const mdZh = (i) => `${+DAYS[i].slice(5, 7)} 月 ${+DAYS[i].slice(8, 10)} 日`;
  const mdEn = (i) => `${MONTHS_EN[+DAYS[i].slice(5, 7) - 1].slice(0, 3)} ${+DAYS[i].slice(8, 10)}`;
  const PERIOD = (h) => (h < 5 ? '凌晨' : h < 8 ? '清晨' : h < 11 ? '上午' : h < 13 ? '中午' : h < 17 ? '下午' : h < 19 ? '傍晚' : '晚上');
  const wrap = (m) => ((Math.round(m) % 1440) + 1440) % 1440;
  function clockZh(m) {
    const t = wrap(m), h = Math.floor(t / 60), mm = t % 60;
    return `${PERIOD(h)} ${h <= 12 ? h : h - 12} 点` + (mm ? ` ${pad(mm)} 分` : '');
  }
  function clockEn(m) {
    const t = wrap(m), h = Math.floor(t / 60), mm = t % 60;
    return `${h % 12 || 12}:${pad(mm)} ${h < 12 ? 'am' : 'pm'}`;
  }
  const clock24 = (m) => { const t = wrap(m); return pad(Math.floor(t / 60)) + ':' + pad(t % 60); };
  /** hours -> "6 小时 45 分" / "6 h 45 min" */
  function hoursZh(h) { const m = Math.round(h * 60); return m < 60 ? m + ' 分钟' : Math.floor(m / 60) + ' 小时' + (m % 60 ? ' ' + (m % 60) + ' 分' : ''); }
  function hoursEn(h) { const m = Math.round(h * 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : ''); }
  /** 128400 -> "12.8 万" */
  const wan = (v) => (v >= 1e5 ? num(v / 1e4, v >= 1e6 ? 0 : 1) + ' 万' : num(v));
  const en = (v, dec = 0) => Number(v).toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: dec });
  const plural = (n, word) => `${en(n)} ${word}${n === 1 ? '' : 's'}`;
  /** "TraditionalStrengthTraining" -> "traditional strength training" */
  const typeEn = (key) => String(key || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

  /** how the voice-over names the chosen range */
  function phrase(ctx, ui) {
    switch (ui.state.preset) {
      case '30': return ['这 30 天', 'These 30 days'];
      case '90': return ['这 90 天', 'These 90 days'];
      case '180': return ['这半年', 'This past half year'];
      case '365': return ['这一年', 'This past year'];
      case 'all': return ['这些日子里', 'All this time'];
      default: return [`从 ${dateZh(ctx.a)} 到 ${dateZh(ctx.b)}`, `From ${dateEn(ctx.a)} to ${dateEn(ctx.b)}`];
    }
  }
  const mean = (key, a, b) => (D[key] ? meanOf(D[key], a, b) : null);
  function sum(key, a, b) {
    let s = 0, n = 0;
    for (let i = a; i <= b; i++) if (i !== PARTIAL && D[key] && D[key][i] != null) { s += D[key][i]; n++; }
    return n ? s : null;
  }
  const rangeTc = (ctx) => `${dot(ctx.a)} — ${dot(ctx.b)}`;
  /** a big figure on the title card: value, unit, and what it is */
  const fig = (v, u, k, word) => ({ v: [el('b', { text: v }), u ? el('small', { text: u }) : null], k, word });
  /** 6.75 h -> 6 小时 45 分, as big digits with small units */
  function figHM(hours, k) {
    if (hours == null) return fig('–', '', k);
    const m = Math.round(hours * 60);
    const v = m < 60 ? [el('b', { text: String(m) }), el('small', { text: '分' })]
      : [el('b', { text: num(Math.floor(m / 60)) }), el('small', { text: '小时' })].concat(m % 60 ? [el('b', { text: String(m % 60) }), el('small', { text: '分' })] : []);
    return { v, k };
  }

  // ------------------------------------------------------------------ section titles in English
  const SCENE_EN = {
    '关键趋势': 'KEY TRENDS', '逐月对比': 'MONTH BY MONTH', '每日活动': 'EVERY DAY', '能量与距离': 'ENERGY & DISTANCE',
    '时长与作息': 'HOURS & HABITS', '夜间生命体征': 'VITALS AT NIGHT', '恢复与体能': 'RECOVERY & FITNESS', '全天心率': 'AROUND THE CLOCK',
    '心电图': 'ECG', '训练量': 'VOLUME', '训练记录': 'THE LOG', '体成分': 'COMPOSITION', '最近状态': 'LATELY',
    '纪录与习惯': 'RECORDS & HABITS', '指标之间的关系': 'CONNECTIONS', '这一天': 'THIS DAY', '血氧': 'BLOOD OXYGEN',
    '步态与活动能力': 'GAIT & MOBILITY', '环境与习惯': 'SUN & WATER', '四个方面': 'FOUR SIDES', '长期变化': 'THE LONG VIEW',
    '这 7 天': 'SEVEN DAYS', '往期': 'PAST ISSUES', '建议出现的频率': 'HOW OFTEN', '换一个界线会怎样': 'OTHER LINES',
    '和你的标注对照': 'YOUR NOTES',
  };
  // 旺角卡门: the streets of Mong Kok, in the order the page walks them
  const STREETS = [['花园街', 'FA YUEN STREET'], ['弥敦道', 'NATHAN ROAD'], ['西洋菜街', 'SAI YEUNG CHOI STREET'], ['通菜街', 'TUNG CHOI STREET']];
  // 东邪西毒 is told in solar terms
  const TERMS = [['惊蛰', 'AWAKENING'], ['夏至', 'MIDSUMMER'], ['白露', 'WHITE DEW'], ['立冬', 'WINTER BEGINS']];
  const SEAL = ['壹', '贰', '叁', '肆', '伍', '陆'];

  // ------------------------------------------------------------------ pictures (original line drawings)
  const svg = (label, inner, box = '0 0 320 220') => `<svg viewBox="${box}" role="img" aria-label="${label}">${inner}</svg>`;
  const ART = {
    report: () => svg('一辆自行车',
      '<g class="a1" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="86" cy="152" r="44"/><circle cx="236" cy="152" r="44"/>' +
      '<path d="M86 152 136 96h74M136 96l26 56 48-56M86 152h76M210 96l26 56M200 80h22M126 86h22M136 96l-6-10"/></g>' +
      '<path class="a2" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M160 52c-6-10-22-8-22 4 0 10 14 18 22 24 8-6 22-14 22-24 0-12-16-14-22-4z"/>'),
    overview: () => {
      const b = [[18, 120, 26], [46, 84, 30], [78, 136, 18], [98, 60, 34], [134, 104, 22], [158, 36, 28], [188, 92, 30], [220, 128, 20], [242, 70, 32], [276, 112, 26]];
      let win = '';
      for (const [x, y, w] of b) for (let yy = y + 10; yy < 186; yy += 14) for (let xx = x + 6; xx < x + w - 4; xx += 9) if ((xx * 7 + yy * 3) % 5 < 2) win += `<rect x="${xx}" y="${yy}" width="3" height="5"/>`;
      return svg('天台上看到的城市',
        `<g class="a1" fill="none" stroke-width="2" stroke-linejoin="round">${b.map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${190 - y}"/>`).join('')}</g>` +
        `<g class="a3 fill">${win}</g>` +
        '<g class="a2" fill="none" stroke-width="3" stroke-linecap="round"><path d="M0 196h320M10 196v18M70 196v18M130 196v18M190 196v18M250 196v18M310 196v18M0 214h320"/></g>');
    },
    activity: () => svg('街上的霓虹招牌',
      '<g class="a3" fill="none" stroke-width="3" stroke-linecap="round"><path d="M40 20h250M80 20v14M168 20v14M252 20v14"/></g>' +
      '<g class="a1" fill="none" stroke-width="3" stroke-linejoin="round"><rect x="56" y="34" width="48" height="150" rx="4"/><rect x="144" y="34" width="48" height="118" rx="4"/><rect x="228" y="34" width="48" height="166" rx="4"/></g>' +
      '<g class="a2" font-size="34" font-weight="700" text-anchor="middle"><text x="80" y="88">步</text><text x="80" y="140">行</text>' +
      '<text x="168" y="88">每</text><text x="168" y="134">天</text><text x="252" y="88">走</text><text x="252" y="136">下</text><text x="252" y="184">去</text></g>'),
    sleep: (h) => svg('一块霓虹门牌',
      '<g class="a1" fill="none" stroke-width="3"><rect x="34" y="52" width="252" height="112" rx="10"/><rect x="44" y="62" width="232" height="92" rx="6" stroke-width="1.4"/></g>' +
      `<text class="a2 neon" x="160" y="136" text-anchor="middle" font-size="68">${h.sign}</text>` +
      '<path class="a3" fill="none" stroke-width="2.6" stroke-linecap="round" d="M268 172a18 18 0 1 0 14 30 14 14 0 1 1-14-30z"/>' +
      '<g class="a1" fill="none" stroke-width="2" stroke-linecap="round"><path d="M74 52 96 4M246 52 224 4M60 4h200"/></g>' +
      '<g class="a2" fill="none" stroke-width="1.6" stroke-linecap="round"><path d="M58 182h70M58 192h46"/></g>'),
    heart: () => svg('一盏瀑布灯和一段心电图',
      '<g class="a1" fill="none" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><path d="M112 34h96l26 92H86z"/><path d="M160 126v52M126 192h68"/></g>' +
      '<g class="a2" fill="none" stroke-width="2" stroke-linecap="round"><path d="M112 54c6 10 2 22 8 32s2 22 6 32M140 50c4 12 0 24 6 36s0 22 4 36M168 50c4 12 0 24 6 36s0 22 4 36M196 54c4 12 0 24 6 34s0 20 4 32"/></g>' +
      '<path class="a3" fill="none" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round" d="M0 206h60l10-18 12 34 14-62 14 58 10-12h40l8-10 10 10h142"/>'),
    workouts: () => svg('一笔墨圈和一方印',
      '<path class="a1" fill="none" stroke-width="12" stroke-linecap="round" d="M222 64a84 84 0 1 0 22 92"/>' +
      '<path class="a1" fill="none" stroke-width="5" stroke-linecap="round" opacity=".55" d="M238 168a84 84 0 0 1-30 30"/>' +
      '<rect class="a2 fill" x="226" y="128" width="62" height="62" rx="4"/>' +
      '<text class="a3" x="257" y="173" text-anchor="middle" font-size="40">练</text>'),
    body: () => svg('一件旗袍和一条软尺',
      '<path class="a1" fill="none" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" d="M146 26h28l4 16 22 8 6 42-14 4-4 30 8 70H124l8-70-4-30-14-4 6-42 22-8z"/>' +
      '<path class="a1" fill="none" stroke-width="2" stroke-linecap="round" d="M160 42v18M152 50l16 6M132 120h56"/>' +
      '<path class="a2" fill="none" stroke-width="7" stroke-linecap="round" d="M48 168c40-40 86 12 128-12s64-70 108-34"/>' +
      '<path class="a3" fill="none" stroke-width="1.6" d="M62 158l6 6M78 150l5 7M96 147l3 8M114 150l1 8M132 156l-1 8M150 160l-3 8M168 158l-4 7M186 150l-5 6M202 138l-5 6M218 124l-5 5M236 112l-4 6M254 108l-1 7M272 112l2 7"/>'),
    insights: () => svg('大漠、太阳和地平线',
      '<circle class="a1 fill" cx="214" cy="78" r="38"/>' +
      '<g class="a2" fill="none" stroke-width="3" stroke-linecap="round"><path d="M0 162c40-22 80-22 120 0s88 22 128 0 52-14 72-8M0 196c56-18 104-18 160 0s110 16 160-4"/></g>' +
      '<path class="a3" fill="none" stroke-width="2" stroke-linecap="round" d="M0 132h320"/>'),
    day: (h) => {
      let ticks = '';
      for (let k = 0; k < 60; k++) {
        const a = (k / 60) * Math.PI * 2, r0 = k % 5 ? 70 : 62, r1 = 76;
        ticks += `<path d="M${(160 + r0 * Math.sin(a)).toFixed(1)} ${(110 - r0 * Math.cos(a)).toFixed(1)}L${(160 + r1 * Math.sin(a)).toFixed(1)} ${(110 - r1 * Math.cos(a)).toFixed(1)}" stroke-width="${k % 5 ? 1.2 : 3}"/>`;
      }
      const hand = (frac, len) => `M160 110L${(160 + len * Math.sin(frac * Math.PI * 2)).toFixed(1)} ${(110 - len * Math.cos(frac * Math.PI * 2)).toFixed(1)}`;
      const m = h.minute, hr = (m / 60) % 12;
      return svg('一面挂钟',
        `<circle class="a1" cx="160" cy="110" r="88" fill="none" stroke-width="3"/><g class="a1" stroke-linecap="round">${ticks}</g>` +
        `<g class="a2" fill="none" stroke-linecap="round"><path d="${hand(hr / 12, 40)}" stroke-width="6"/><path d="${hand((m % 60) / 60, 62)}" stroke-width="4"/></g>` +
        `<path class="a3" d="${hand(0.98, 70)}" stroke-width="2" stroke-linecap="round"/><circle class="a3 fill" cx="160" cy="110" r="5"/>`);
    },
    more: () => svg('一张寄自海边的邮票',
      '<rect class="a1" x="56" y="22" width="208" height="170" rx="2" fill="none" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/>' +
      '<rect class="a1" x="72" y="38" width="176" height="138" rx="2" fill="none" stroke-width="2"/>' +
      '<circle class="a2 fill" cx="206" cy="74" r="16"/>' +
      '<g class="a2" fill="none" stroke-width="3" stroke-linecap="round"><path d="M118 150c4-30 0-58-10-78M108 72c-18-8-34-2-42 10M108 72c10-16 30-18 42-8M108 72c-4-18 6-30 20-34M108 72c-20 4-28 18-28 30"/></g>' +
      '<g class="a3" fill="none" stroke-width="2.6" stroke-linecap="round"><path d="M80 152c12-8 24-8 36 0s24 8 36 0 24-8 36 0 24 8 36 0M80 166c12-8 24-8 36 0s24 8 36 0 24-8 36 0 24 8 36 0"/></g>'),
    summary: () => {
      let wins = '';
      for (let r = 0; r < 9; r++) for (let c = 0; c < 8; c++) {
        const lit = (r * 5 + c * 3) % 7 === 0;
        wins += `<rect class="${lit ? 'a3 fill' : 'a2'}" x="${86 + c * 20}" y="${34 + r * 18}" width="12" height="9"${lit ? '' : ' fill="none" stroke-width="1.4"'}/>`;
      }
      return svg('屋邨的一排窗', '<rect class="a1" x="74" y="22" width="172" height="186" fill="none" stroke-width="3"/>' + wins +
        '<path class="a1" stroke-width="3" d="M40 208h240"/>');
    },
    backtest: () => svg('月亮和一只小盒子',
      '<circle class="a1" cx="208" cy="70" r="44" fill="none" stroke-width="3"/>' +
      '<g class="a1" fill="none" stroke-width="1.6"><circle cx="194" cy="58" r="8"/><circle cx="222" cy="86" r="6"/><circle cx="220" cy="54" r="3.5"/></g>' +
      '<g class="a3" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="3 6"><path d="M120 150 178 104M128 160l70-40M114 142l50-52"/></g>' +
      '<g class="a2" fill="none" stroke-width="3" stroke-linejoin="round"><path d="M70 150h80v48H70zM64 136h92v14H64z"/><path d="M110 150v48M102 170h16"/></g>'),
    notes: () => svg('一卷胶片',
      '<g class="a1" fill="none" stroke-width="2.4"><path d="M24 24h70M24 24v70M296 24h-70M296 24v70M24 196h70M24 196v-70M296 196h-70M296 196v-70"/>' +
      '<path d="M36 36h40M36 36v40M284 36h-40M284 36v40M36 184h40M36 184v-40M284 184h-40M284 184v-40" stroke-width="1.2"/></g>' +
      '<g class="a2" fill="none" stroke-width="3"><circle cx="160" cy="110" r="58"/><circle cx="160" cy="110" r="12"/>' +
      '<circle cx="160" cy="76" r="13"/><circle cx="192" cy="99" r="13"/><circle cx="180" cy="138" r="13"/><circle cx="140" cy="138" r="13"/><circle cx="128" cy="99" r="13"/></g>' +
      '<path class="a3" fill="none" stroke-width="3" stroke-linecap="round" d="M218 110c30 0 46 8 64 30"/>'),
  };

  // ------------------------------------------------------------------ the title cards, page by page
  const HERO = {
    report(ctx, ui) {
      if (!REPORTS.length) return null;
      const k = Math.max(0, Math.min(REPORTS.length - 1, ui.state.report == null ? REPORTS.length - 1 : ui.state.report));
      const r = REPORTS[k];
      const REC = { steady: 'recovery steady', mixed: 'recovery a little uneven', low: 'recovery on the low side', none: 'not enough nights yet for recovery' };
      const LOAD = { far_below: 'far less training than usual', below: 'less training than usual', steady: 'training as usual', above: 'more training than usual',
        far_above: 'far more training than usual', restart: 'training just restarted', rest: 'no training this week', new: 'training history still building' };
      const parts = [r.sleep.score != null ? `Sleep ${r.sleep.score}` : null, r.activity.score != null ? `activity ${r.activity.score}` : null,
        REC[r.recovery.state], LOAD[r.load.state]].filter(Boolean);
      return {
        tc: `第 ${k + 1} 期 · ${dot(r.start)} — ${dot(r.end)}`,
        kicker: `这一周 · THIS WEEK · ${r.sunday ? '周一到周日' : '最近 7 天'}`,
        name: `${mdZh(r.start)} – ${mdZh(r.end)}`,
        figures: [fig(r.sleep.score == null ? '–' : String(r.sleep.score), r.sleep.score == null ? '' : '分', '睡眠'),
          fig(r.activity.score == null ? '–' : String(r.activity.score), r.activity.score == null ? '' : '分', '日常活动'),
          fig(r.recovery.label, '', '恢复', true), fig(r.load.label, '', '训练负荷', true)],
        zh: r.headline,
        en: parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.' : '',
      };
    },
    overview(ctx, ui) {
      const [p, pe] = phrase(ctx, ui);
      const rhr = mean('rhr', ctx.a, ctx.b), hrv = mean('hrv', ctx.a, ctx.b), sl = mean('sleepTotal', ctx.a, ctx.b), st = mean('steps', ctx.a, ctx.b);
      const zh = [rhr != null && `静息心率平均 ${num(rhr)}`, hrv != null && `HRV ${num(hrv)} 毫秒`, sl != null && `每晚睡 ${hoursZh(sl)}`, st != null && `每天走 ${num(st)} 步`].filter(Boolean);
      const e = [rhr != null && `resting heart rate ${en(rhr)}`, hrv != null && `HRV ${en(hrv)} ms`, sl != null && `${hoursEn(sl)} of sleep a night`, st != null && `${en(st)} steps a day`].filter(Boolean);
      if (!zh.length) return null;
      return {
        tc: rangeTc(ctx), kicker: '天台 · FROM THE ROOFTOP', name: '全景',
        figures: [fig(rhr == null ? '–' : num(rhr), 'bpm', '静息心率'), fig(hrv == null ? '–' : num(hrv), 'ms', 'HRV'),
          figHM(sl, '每晚睡眠'), fig(st == null ? '–' : num(st), '步', '每天步数')],
        zh: `${p}，${zh.join('，')}。`, en: `${pe}: ${e.join(', ')}.`,
      };
    },
    activity(ctx, ui) {
      const [p, pe] = phrase(ctx, ui);
      const steps = sum('steps', ctx.a, ctx.b), km = sum('distance', ctx.a, ctx.b), avg = mean('steps', ctx.a, ctx.b);
      if (!steps) return null;
      return {
        tc: rangeTc(ctx), kicker: '街头 · ON THE STREETS', name: '每一步',
        figures: [fig(wan(steps).replace(' 万', ''), steps >= 1e5 ? '万步' : '步', '一共'), fig(km == null ? '–' : num(km), '公里', '步行 + 跑步'), fig(num(avg), '步', '平均每天')],
        zh: `${p}，我走了 ${wan(steps)}步` + (km ? `，合计 ${num(km)} 公里` : '') + `。平均每天 ${num(avg)} 步。`,
        en: `${pe} I walked ${en(steps)} steps` + (km ? ` — ${en(km)} km in all` : '') + `, ${en(avg)} a day.`,
      };
    },
    sleep(ctx, ui) {
      const [p, pe] = phrase(ctx, ui);
      const sl = mean('sleepTotal', ctx.a, ctx.b), bed = mean('bedtime', ctx.a, ctx.b), wake = mean('waketime', ctx.a, ctx.b);
      if (sl == null) return null;
      let short = 0, nights = 0;
      for (let i = ctx.a; i <= ctx.b; i++) if (D.sleepTotal[i] != null) { nights++; if (D.sleepTotal[i] < 6) short++; }
      return {
        tc: rangeTc(ctx), kicker: '夜车 · THE NIGHT TRAIN', name: '每晚一班车',
        sign: bed == null ? '--:--' : clock24(bed),
        figures: [figHM(sl, '平均每晚'), fig(bed == null ? '–' : clock24(bed), '', '入睡'), fig(wake == null ? '–' : clock24(wake), '', '醒来'), fig(String(short), `/ ${nights} 晚`, '不足 6 小时')],
        zh: bed == null || wake == null ? `${p}，我平均每晚睡 ${hoursZh(sl)}。`
          : `${p}，我通常在${clockZh(bed)}睡着，${clockZh(wake)}醒来。平均每晚 ${hoursZh(sl)}。`,
        en: bed == null || wake == null ? `${pe} I slept ${hoursEn(sl)} a night on average.`
          : `${pe} I usually fell asleep at ${clockEn(bed)} and woke at ${clockEn(wake)} — ${hoursEn(sl)} a night.`,
      };
    },
    heart(ctx, ui) {
      const [p, pe] = phrase(ctx, ui);
      const rhr = mean('rhr', ctx.a, ctx.b), hrv = mean('hrv', ctx.a, ctx.b), walk = mean('walkHr', ctx.a, ctx.b);
      if (rhr == null) return null;
      let beats = 0;
      for (let i = ctx.a; i <= ctx.b; i++) if (i !== PARTIAL && D.hrAvg[i] != null) beats += D.hrAvg[i] * 1440;
      const vo2 = firstLast(D.vo2max, ctx.a, ctx.b);
      return {
        tc: rangeTc(ctx), kicker: '心跳 · HEARTBEAT', name: '节拍',
        figures: [fig(num(rhr), 'bpm', '静息心率'), fig(hrv == null ? '–' : num(hrv), 'ms', 'HRV'), fig(walk == null ? '–' : num(walk), 'bpm', '步行心率'),
          fig(vo2 ? num(D.vo2max[vo2.last], 1) : '–', '', '最大摄氧量')],
        zh: `安静的时候，我的心一分钟跳 ${num(rhr)} 下。` + (beats ? `${p}，它一共跳了大约 ${wan(Math.round(beats / 1e4) * 1e4)}下。` : ''),
        en: `At rest my heart beats ${en(rhr)} times a minute.` + (beats ? ` ${pe} it beat about ${en(Math.round(beats / 1e5) / 10, 1)} million times.` : ''),
      };
    },
    workouts(ctx, ui) {
      const [p, pe] = phrase(ctx, ui);
      const ws = W.filter((w) => w.d >= ctx.a && w.d <= ctx.b);
      if (!ws.length) return { tc: rangeTc(ctx), kicker: '练功 · PRACTICE', name: '练功', figures: [], zh: `${p}，没有训练记录。`, en: `${pe}, no workouts were recorded.` };
      const min = ws.reduce((s, w) => s + w.min, 0);
      const by = new Map();
      for (const w of ws) by.set(w.type, (by.get(w.type) || 0) + w.min);
      const top = [...by.entries()].sort((x, y) => y[1] - x[1])[0][0];
      const topKey = (ws.find((w) => w.type === top) || {}).key;
      const days = new Set(ws.map((w) => w.d)).size;
      return {
        tc: rangeTc(ctx), kicker: '练功 · PRACTICE', name: '练功',
        figures: [fig(String(ws.length), '次', '训练'), figHM(min / 60, '一共'), fig(String(days), '天', '有训练的日子')],
        zh: `${p}，我练了 ${ws.length} 次，一共 ${hoursZh(min / 60)}。练得最多的是${top}。`,
        en: `${pe} I trained ${plural(ws.length, 'time')}, ${hoursEn(min / 60)} in all — mostly ${typeEn(topKey) || 'one kind of workout'}.`,
      };
    },
    body(ctx, ui) {
      const fl = firstLast(D.weight, ctx.a, ctx.b);
      const flAll = firstLast(D.weight, 0, ctx.b);
      if (!flAll) return null;
      const last = fl ? fl.last : flAll.last;
      const fat = D.bodyFat[last];
      const change = fl && fl.first !== fl.last ? D.weight[fl.last] - D.weight[fl.first] : null;
      const same = change != null && Math.abs(change) < 0.25;
      return {
        tc: rangeTc(ctx), kicker: '量身 · MADE TO MEASURE', name: '量体裁衣',
        figures: [fig(num(D.weight[last], 1), '公斤', '体重'), fig(fat == null ? '–' : num(fat, 1), '%', '体脂率'),
          fig(D.bmi[last] == null ? '–' : num(D.bmi[last], 1), '', 'BMI')],
        zh: `最近一次量身是 ${dateZh(last)}：${num(D.weight[last], 1)} 公斤` + (fat != null ? `，体脂 ${num(fat, 1)}%` : '') + '。' +
          (change == null ? '' : same ? `和 ${mdZh(fl.first)}那次差不多。` : `和 ${mdZh(fl.first)}那次相比，${change > 0 ? '多' : '少'}了 ${num(Math.abs(change), 1)} 公斤。`),
        en: `The last fitting was on ${dateEn(last)}: ${en(D.weight[last], 1)} kg` + (fat != null ? `, ${en(fat, 1)}% body fat` : '') + '.' +
          (change == null ? '' : same ? ` About the same as on ${mdEn(fl.first)}.` : ` ${en(Math.abs(change), 1)} kg ${change > 0 ? 'more' : 'less'} than on ${mdEn(fl.first)}.`),
      };
    },
    insights(ctx) {
      const rows = HD.baselineRows ? HD.baselineRows(ctx.b) : [];
      if (!rows.length) return { tc: rangeTc(ctx), kicker: '大漠 · THE DESERT', name: '看见', figures: [], zh: '数据还不够，看不出你自己的常态。', en: 'Not enough data yet to see what is usual for me.' };
      const inside = rows.filter((r) => r.state === 'in').length, out = rows.length - inside;
      return {
        tc: `${dot(Math.max(0, ctx.b - 6))} — ${dot(ctx.b)}`, kicker: '大漠 · THE DESERT', name: '看见',
        figures: [fig(String(inside), `/ ${rows.length}`, '在常态里'), fig(String(out), '项', '走出了常态')],
        zh: `最近 7 天，${rows.length} 项里有 ${inside} 项在我自己的常态里` + (out ? `，${out} 项走出了常态。` : '。'),
        en: `In the last 7 days, ${inside} of ${rows.length} measures stayed within my usual range` + (out ? `; ${out} moved outside it.` : '.'),
      };
    },
    day(ctx, ui) {
      const d = ui.state.day == null ? HD.lastIntradayDay() : ui.state.day;
      const flat = (I.hr || [])[d];
      let at = null;
      if (flat) for (let k = 0; k < flat.length; k += 2) if (flat[k] <= 899 && flat[k] >= 869) at = [flat[k], flat[k + 1]];
      const steps = D.steps[d];
      const exact = at && at[0] === 899;            // the minute before three, when the watch caught it
      const zh = at
        ? `${dateZh(d)}，${exact ? '下午 3 点之前的一分钟' : clockZh(at[0])}，我的心跳是 ${at[1]}。`
        : steps != null ? `${dateZh(d)}，我走了 ${num(steps)} 步。` : `${dateZh(d)}。`;
      const e = at
        ? `${dateEn(d)}. ${exact ? 'In the minute before 3 pm' : 'At ' + clockEn(at[0])}, my heart rate was ${at[1]}.`
        : steps != null ? `${dateEn(d)}. I walked ${en(steps)} steps.` : `${dateEn(d)}.`;
      return {
        tc: `${dot(d)} · ${WEEKDAY[DOW[d]]}`, kicker: '那一分钟 · THAT MINUTE', name: dateZh(d), minute: at ? at[0] : 899,
        figures: [fig(at ? String(at[1]) : '–', 'bpm', at ? clock24(at[0]) + ' 的心率' : '下午 3 点前没有心率'), fig(steps == null ? '–' : num(steps), '步', '这一天')],
        zh, en: e,
      };
    },
    more(ctx, ui) {
      const [p, pe] = phrase(ctx, ui);
      const sun = mean('daylight', ctx.a, ctx.b), water = mean('water', ctx.a, ctx.b), waterDays = countOf(D.water, ctx.a, ctx.b);
      const spo2 = mean('spo2', ctx.a, ctx.b), speed = mean('walkSpeed', ctx.a, ctx.b);
      const zh = [sun != null && `平均每天晒到 ${num(sun)} 分钟太阳`, spo2 != null && `血氧平均 ${num(spo2, 1)}%`, speed != null && `走路每小时 ${num(speed, 1)} 公里`].filter(Boolean);
      const e = [sun != null && `${en(sun)} minutes of daylight a day`, spo2 != null && `blood oxygen ${en(spo2, 1)}% on average`, speed != null && `walking at ${en(speed, 1)} km/h`].filter(Boolean);
      if (!zh.length) return null;
      return {
        tc: rangeTc(ctx), kicker: '明信片 · POSTCARD', name: '阳光、空气和水',
        figures: [fig(sun == null ? '–' : num(sun), '分钟', '每天的日照'), fig(spo2 == null ? '–' : num(spo2, 1), '%', '血氧'),
          water == null ? null : fig(num(water), '毫升', `饮水（${waterDays} 天有记录）`)].filter(Boolean),
        zh: `${p}，${zh.join('，')}。`, en: `${pe}: ${e.join(', ')}.`,
      };
    },
    summary() {
      if (!REPORTS.length) return null;
      const end = REPORTS[REPORTS.length - 1].end, a = Math.max(0, end - 89);
      return {
        tc: `${dot(a)} — ${dot(end)}`, kicker: '日与夜 · DAYS AND NIGHTS', name: '给医生的一页', figures: [],
        zh: '近三个月的日子，整理成一页。打印出来，带去给医生看。',
        en: 'Three months of days and nights on one page. Print it and bring it along.',
      };
    },
    backtest() {
      const list = REPORTS.filter((r) => r.sunday);
      if (!list.length) return null;
      return {
        tc: `${dot(list[0].end)} — ${dot(list[list.length - 1].end)}`, kicker: '月光宝盒 · THE MOONLIGHT BOX', name: '回到过去',
        figures: [fig(String(list.length), '期', '周报'), fig(String(list.filter((r) => r.tips.length).length), '期', '给过建议')],
        zh: `回到过去的 ${list.length} 期周报：每条建议出现过几次，换一条界线又会怎样。`,
        en: `Back through ${plural(list.length, 'weekly report')}: how often each suggestion came up, and what a different line would change.`,
      };
    },
    notes() {
      const m = H.meta;
      return {
        tc: `${dot(0)} — ${dot(N - 1)}`, kicker: '幕后 · BEHIND THE SCENES', name: '这部片是怎么拍的',
        figures: [fig(wan(m.records).replace(' 万', ''), m.records >= 1e5 ? '万条' : '条', '记录'), fig(num(N), '天', '覆盖'), fig(String((m.sources || []).length), '个', '数据来源')],
        zh: `${num(N)} 天，${wan(m.records)}条记录。下面是它们从哪里来、怎么算的。`,
        en: `${en(N)} days and ${en(m.records)} records. Here is where they came from and how they were counted.`,
      };
    },
  };

  // ------------------------------------------------------------------ the films
  const FILMS = {
    report: { title: '甜蜜蜜', en: 'Comrades, Almost a Love Story', year: 1996, scene: (n) => `第${zhNum(n)}章`, word: 'CHAPTER' },
    overview: { title: '无间道', en: 'Infernal Affairs', year: 2002, scene: (n) => `${n}/F`, word: 'LEVEL' },
    activity: { title: '旺角卡门', en: 'As Tears Go By', year: 1988, scene: (n) => (STREETS[n - 1] || [`第${zhNum(n)}条街`])[0], word: 'STREET', sceneEn: (n) => (STREETS[n - 1] || [])[1] },
    sleep: { title: '2046', en: '2046', year: 2004, scene: (n) => `第${zhNum(n)}站`, word: 'STOP' },
    heart: { title: '春光乍泄', en: 'Happy Together', year: 1997, scene: (n) => `第${zhNum(n)}拍`, word: 'BEAT' },
    workouts: { title: '一代宗师', en: 'The Grandmaster', year: 2013, scene: (n) => SEAL[n - 1] || zhNum(n), word: 'FORM' },
    body: { title: '花样年华', en: 'In the Mood for Love', year: 2000, scene: (n) => `第${zhNum(n)}幕`, word: 'ACT' },
    insights: { title: '东邪西毒', en: 'Ashes of Time', year: 1994, scene: (n) => (TERMS[n - 1] || [`第${zhNum(n)}节`])[0], word: 'SCENE', sceneEn: (n) => (TERMS[n - 1] || [])[1] },
    day: { title: '阿飞正传', en: 'Days of Being Wild', year: 1990, scene: (n) => `第${zhNum(n)}分钟`, word: 'MINUTE' },
    more: { title: '麦兜故事', en: 'My Life as McDull', year: 2001, scene: (n) => `明信片 ${pad(n)}`, word: 'POSTCARD' },
    summary: { title: '天水围的日与夜', en: 'The Way We Are', year: 2008, scene: (n) => `第${zhNum(n)}部分`, word: 'PART' },
    backtest: { title: '大话西游', en: 'A Chinese Odyssey', year: 1995, scene: (n) => `第${zhNum(n)}次回到过去`, word: 'BACK' },
    notes: { title: '阮玲玉', en: 'Center Stage', year: 1991, scene: (n) => `第${zhNum(n)}本`, word: 'REEL' },
  };
  HD.film = (id) => FILMS[id] || null;

  /** a scene heading in the page's film: its number, the title, and the title in English */
  HD.filmScene = (id, title, n) => {
    const f = FILMS[id];
    if (!f) return null;
    const enTitle = (f.sceneEn && f.sceneEn(n)) || SCENE_EN[title] || '';
    return el('h2', { class: 'fm-scene' },
      el('span', { class: 'no', text: f.scene(n) }),
      el('span', { class: 't', text: title }),
      el('span', { class: 'en', text: `${f.word} ${pad(n)}` + (enTitle ? ' · ' + enTitle : '') }),
      el('i', { class: 'rule' }));
  };

  /** "夜车 · THE NIGHT TRAIN · …": the Chinese word, its English line (styled apart), anything after */
  function kickerNode(text) {
    const [zh, enText, ...rest] = String(text || '').split(' · ');
    return el('div', { class: 'fm-kicker' }, el('span', { class: 'zh', text: zh }),
      enText ? [' · ', el('span', { class: 'en', text: enText })] : null, rest.map((x) => ' · ' + x));
  }
  /** the title card at the top of a page; null when the page has nothing to say yet */
  HD.filmHero = (id, ctx, ui) => {
    const f = FILMS[id], make = HERO[id];
    if (!f || !make) return null;
    const h = make(ctx, ui);
    if (!h) return null;
    const art = el('div', { class: 'fm-art', 'aria-hidden': 'true' });
    art.innerHTML = ART[id](h);
    return el('section', { class: 'fm-hero noprint', 'data-film': id },
      el('div', { class: 'fm-bar' },
        el('span', { class: 'fm-credit' }, el('i'), `致敬《${f.title}》 · ${f.en.toUpperCase()} · ${f.year}`),
        el('span', { class: 'fm-tc', text: h.tc || '' })),
      el('div', { class: 'fm-frame' },
        el('div', { class: 'fm-title' },
          kickerNode(h.kicker),
          el('h2', { class: 'fm-name', text: h.name }),
          h.figures && h.figures.length ? el('div', { class: 'fm-figs' }, h.figures.map((x) => el('div', { class: 'fm-fig' + (x.word ? ' word' : '') },
            el('div', { class: 'v' }, x.v), x.k ? el('div', { class: 'k', text: x.k }) : null))) : null),
        art),
      el('div', { class: 'fm-subs' }, el('p', { class: 'zh', text: h.zh }), h.en ? el('p', { class: 'en', text: h.en }) : null));
  };
})();
