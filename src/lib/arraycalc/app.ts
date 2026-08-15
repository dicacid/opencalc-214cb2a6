// @ts-nocheck
/* Application shell ported from the original single-file tool.
   DOM-driven by design: the port keeps the imperative renderer intact so
   predicted SPL output is bit-identical to the pre-port engine. */
import { P } from "../acoustics";
import { AMPS, ampChannels, ampModelOf, ampsRequired, validateSource } from "../acoustics/cabinets";
import { cabinetDialog, initCabinetLibrary } from "./cabinetLibrary";


const {CABINETS, CAB_LIST, MAP_BANDS, OCT, REF_R, SUB_MODES, THIRD_OCT, aWeight, airAlpha, audienceLine, autoSplay, bandSpl, bandsSum, broadband, buildAll, buildSource, buildSubArray, emissionSpectrum, frontToBack, horizDir, makeArrayProcessing, mapPlane, maxSplAt, nSub, planeCorners, planeGrid, planePoint, planeStats, prepFrames, pressureAt, refCache, refPressure, rigging, segDir, soundSpeed, splAt, subPolar, vertPointDir, voicingGain} = P;

/* ---- app ---- */
/* ==========================================================
   ArrayCalc clone — application shell and views
   Layout follows the real ArrayCalc: menu bar, icon toolbar,
   tab bar, three dense columns of panels with black plots.
   ========================================================== */

/* ---------------- helpers ---------------- */
let ROOT = null;
const scope = () => ROOT || document;
const $ = (s, r) => (r || scope()).querySelector(s);
const $$ = (s, r) => [...(r || scope()).querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (v, d = 1) => (v == null || isNaN(v)) ? '--' : v.toFixed(d);
const pnum = (s) => { const v = parseFloat(String(s).replace(',', '.')); return isNaN(v) ? 0 : v; };
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
const COLORS = ['#e04b3c', '#4aa3e0', '#eab036', '#5ec269', '#b976d6', '#e07f3c', '#4fc4c0', '#d64f8f'];

let uid = 1;
const nextId = () => uid++;

/* ---------------- default project ---------------- */
function mkArray(name, cabType, n, x, y, z, az, tilt, color, opts = {}) {
  return {
    id: nextId(), name, color, group: opts.group || 1, kind: 'array', cabType,
    x, y, z, azimuth: az, tilt, mounting: opts.mounting || 'flown',
    gain: opts.gain || 0, delay: opts.delay || 0, mute: false, pol: 1,
    hpf: opts.hpf || 0, lpf: opts.lpf || 0, ap: { on: false, strength: 1, slot: 1 },
    cabs: Array.from({ length: n }, (_, i) => ({
      splay: i ? (opts.splay ?? 2) : 0, level: 0, delay: 0,
      cut: false, cpl: 0, hfc: 0, mute: false
    }))
  };
}
function mkSubs(name, cabType, color, cfg) {
  return {
    id: nextId(), name, color, group: 2, kind: 'sub', cabType,
    x: 0, y: -1.5, z: 0, azimuth: 90, tilt: 0, mounting: 'stacked',
    gain: 0, delay: 0, mute: false, pol: 1, hpf: 0, lpf: 100,
    ap: { on: false, strength: 1, slot: 0 },
    sub: Object.assign({ mode: 'cardioid', count: 12, spacing: 1.3, stack: 2, depth: 3, efSpacing: 1.2, cardDepth: 1.0, cardGain: -3, cardDelay: 0, arcDepth: 2, lrSpan: 18 }, cfg),
    cabs: []
  };
}

const S = {
  project: { name: 'Open air demo', venue: 'Festival field', author: 'array expert', date: new Date().toISOString().slice(0, 10), comments: 'Main hangs 12 x Y8 per side.\nCardioid V-SUB array across the stage front.\nAuto splay run against all three listening planes.' },
  env: { temp: 20, humidity: 60, airAbs: true, pressure: 101.325 },
  sources: [],
  planes: [],
  ref: { x: 0, y: 45, z: 1.7 },
  sel: 0, tab: 'arrays', band: 'bb', res: 'med',
  view: { az: 32, el: 26, zoom: 1 },
  drive: { mode: 'programme', crest: 18, target: 100 },
  apCache: new Map(),
  clip: null
};

function defaultProject() {
  uid = 1;
  S.sources = [
    mkArray('Main L', 'Y8', 12, -11, 0, 13, 100, 3, COLORS[0], { splay: 2, hpf: 90 }),
    mkArray('Main R', 'Y8', 12, 11, 0, 13, 80, 3, COLORS[1], { splay: 2, hpf: 90 }),
    mkArray('Out fill L', 'Y12', 8, -17, 1, 11, 128, 6, COLORS[2], { splay: 4, group: 3, hpf: 90 }),
    mkArray('Out fill R', 'Y12', 8, 17, 1, 11, 52, 6, COLORS[3], { splay: 4, group: 3, hpf: 90 }),
    mkSubs('Sub array', 'V-SUB', COLORS[4], {}),
    mkArray('Front fill', 'P8', 3, 0, 2, 1.6, 90, 22, COLORS[5], { splay: 0, group: 4, mounting: 'stacked', hpf: 100, gain: -6 })
  ];
  S.sources[2].mute = false;
  S.planes = [
    { id: nextId(), name: 'Front standing', x: -24, y: 6, z: 0, w: 48, d: 30, hFront: 0, hBack: 0, rot: 0, mute: false },
    { id: nextId(), name: 'Rear standing', x: -30, y: 36, z: 0, w: 60, d: 34, hFront: 0, hBack: 1.5, rot: 0, mute: false },
    { id: nextId(), name: 'Grandstand', x: -30, y: 70, z: 0, w: 60, d: 16, hFront: 2.0, hBack: 9.0, rot: 0, mute: false }
  ];
  S.sel = 0; S.apCache.clear();
}

/* ---------------- model access ---------------- */
const sel = () => S.sources[S.sel];
const activePlanes = () => S.planes.filter(p => !p.mute);

/* expand a source into engine sources (sub arrays become one source per box) */
function expand(src) {
  if (src.kind !== 'sub') return [src];
  const cfg = Object.assign({}, src.sub, { temp: S.env.temp });
  const pos = P.buildSubArray(cfg);
  const cab = P.CABINETS[src.cabType];
  const out = [];
  const a = (src.azimuth - 90) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  for (const p of pos) {
    for (let s = 0; s < (src.sub.stack || 1); s++) {
      out.push({
        kind: 'sub', cabType: src.cabType,
        x: src.x + p.x * ca - p.y * sa, y: src.y + p.x * sa + p.y * ca, z: src.z + s * cab.h,
        azimuth: src.azimuth, tilt: 0, mounting: 'stacked', pol: p.pol,
        gain: (src.gain || 0) + p.gain, delay: (src.delay || 0) + p.delayMs,
        mute: src.mute, hpf: src.hpf, lpf: src.lpf,
        cabs: [{ splay: 0, level: 0, delay: 0, cut: false, cpl: 0, hfc: 0 }]
      });
    }
  }
  return out;
}
function frames(only) {
  const list = (only ? [only] : S.sources).filter(s => !s.mute).flatMap(expand);
  return P.buildAll(list);
}
function apFor(src) {
  if (!src || !src.ap || !src.ap.on) return null;
  let fn = S.apCache.get(src.id);
  if (!fn) {
    const fr = P.buildAll(expand(src));
    fn = P.makeArrayProcessing(fr, activePlanes(), S.env, src.ap.strength) || (() => 0);
    S.apCache.set(src.id, fn);
  }
  return fn;
}
/* combined AP applied across all frames: each frame carries its own source's AP */
function apGlobal() {
  const map = new Map();
  for (const s of S.sources) if (s.ap && s.ap.on && !s.mute) map.set(s.id, apFor(s));
  if (!map.size) return null;
  return (fr, f) => {
    const fn = map.get(fr.srcId);
    if (!fn) return 0;
    const g = fr.idx; fr.idx = fr.lidx ?? fr.idx;      // AP gains are indexed per source
    const v = fn(fr, f); fr.idx = g;
    return v;
  };
}
/* tag frames with their originating source so the global AP can find them */
function framesTagged() {
  const out = [];
  for (const s of S.sources) {
    if (s.mute) continue;
    const fr = P.buildAll(expand(s));
    for (const f of fr) { f.srcId = s.id; f.lidx = f.idx; f.idx = out.length; out.push(f); }
  }
  return out;
}
function invalidate(src) {
  if (src) S.apCache.delete(src.id); else S.apCache.clear();
  cache.line = null; cache.map = null;
}
const cache = { line: null, map: null };

/* ---------------- widgets ---------------- */
function row(label, inner) { return `<div class="r"><label>${label}</label>${inner}</div>`; }
function num(path, o = {}) {
  const st = o.step ?? 1, d = o.dec ?? 1, w = o.w ?? 66;
  return row(o.label, `<input class="fld num" data-num="${path}" data-dec="${d}" data-step="${st}"`
    + ` data-min="${o.min ?? -1e6}" data-max="${o.max ?? 1e6}" style="width:${w}px">`
    + (o.unit ? `<span class="unit">${o.unit}</span>` : '')
    + (o.nostep ? '' : `<span class="step"><button data-step-="${path}">&minus;</button><button data-step+="${path}">+</button></span>`));
}
function txt(path, o = {}) {
  return `<div class="r"><label style="flex:0 0 ${o.lw || 74}px">${o.label}</label>`
    + `<input class="fld wide" data-txt="${path}"></div>`;
}
function sel_(path, opts, o = {}) {
  const options = opts.map(v => Array.isArray(v) ? v : [v, v])
    .map(([val, lab]) => `<option value="${val}">${lab}</option>`).join('');
  return row(o.label, `<select class="fld ${o.wide ? 'wide' : ''}" data-sel="${path}" style="width:${o.w || 96}px">${options}</select>`);
}
function chk(path, o = {}) {
  return row(o.label, `<input type="checkbox" class="chk" data-chk="${path}">`);
}
function panel(title, body, o = {}) {
  return `<div class="panel ${o.flex ? 'flex' : ''}" ${o.style ? `style="${o.style}"` : ''}>`
    + `<div class="hd">${title}${o.right ? `<span class="r">${o.right}</span>` : ''}</div>`
    + `<div class="bd" ${o.bodyStyle ? `style="${o.bodyStyle}"` : ''}>${body}</div></div>`;
}
function plotPanel(id, cap, o = {}) {
  return `<div class="panel flex" ${o.style ? `style="${o.style}"` : ''}>`
    + (o.title ? `<div class="hd">${o.title}${o.right ? `<span class="r">${o.right}</span>` : ''}</div>` : '')
    + `<div class="plot"><canvas id="${id}"></canvas>`
    + (cap ? `<div class="cap">${cap}</div>` : '')
    + (o.hint ? `<div class="hint">${o.hint}</div>` : '')
    + (o.legend ? `<div class="legend">${o.legend}</div>` : '')
    + `</div></div>`;
}

/* path get / set: "env.temp", "sel.x", "cab.3.splay", "plane.2.w" */
function resolve(path) {
  const p = path.split('.');
  if (p[0] === 'sel') return [sel(), p[1]];
  if (p[0] === 'cab') return [sel().cabs[+p[1]], p[2]];
  if (p[0] === 'sub') return [sel().sub, p[1]];
  if (p[0] === 'ap') return [sel().ap, p[1]];
  if (p[0] === 'plane') return [S.planes[+p[1]], p[2]];
  if (p[0] === 'align') return [S.sources[+p[1]], 'delay'];
  if (p[0] === 'lvl') return [S.sources[+p[1]], 'gain'];
  if (p[0] === 'mute') return [S.sources[+p[1]], 'mute'];
  let o = S;
  for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
  return [o, p[p.length - 1]];
}
const getP = (path) => { const [o, k] = resolve(path); return o ? o[k] : undefined; };
function setP(path, v) {
  const [o, k] = resolve(path); if (!o) return;
  o[k] = v;
  const s = path.startsWith('cab.') || path.startsWith('sel.') || path.startsWith('sub.') || path.startsWith('ap.') ? sel() : null;
  invalidate(s);
}
function syncFields(root = scope()) {
  $$('[data-num]', root).forEach(el => {
    if (el === document.activeElement) return;
    el.value = fmt(getP(el.dataset.num), +el.dataset.dec);
  });
  $$('[data-txt]', root).forEach(el => { if (el !== document.activeElement) el.value = getP(el.dataset.txt) ?? ''; });
  $$('[data-sel]', root).forEach(el => { el.value = getP(el.dataset.sel); });
  $$('[data-chk]', root).forEach(el => { el.checked = !!getP(el.dataset.chk); });
}

/* ---------------- application shell ---------------- */
const TABS = [['venue', 'Venue'], ['arrays', 'Arrays'], ['alignment', 'Alignment'],
['plot3d', '3D plot'], ['rigging', 'Rigging plot'], ['parts', 'Parts list']];

const ICON = {
  open: '<path d="M1 3h5l1.5 2H14v8H1z"/>', save: '<path d="M2 2h9l3 3v9H2z"/><path d="M5 2v4h5V2M4 14V9h8v5"/>',
  print: '<path d="M4 6V2h8v4M4 12H2V6h12v6h-2M4 9h8v5H4z"/>',
  add: '<path d="M8 3v10M3 8h10"/>', del: '<path d="M4 4l8 8M12 4l-8 8"/>',
  splay: '<path d="M2 8h5l6-4M7 8l6 4"/>', copy: '<path d="M3 3h7v7H3z"/><path d="M6 12h7V5"/>',
  paste: '<path d="M4 3h8v11H4z"/><path d="M6 3V1.5h4V3"/>', ap: '<path d="M2 12l3-6 3 3 3-7 3 10"/>',
  help: '<path d="M6 6a2 2 0 113 1.7c-.7.4-1 .8-1 1.8M8 12.5v.5"/><circle cx="8" cy="8" r="6.5"/>',
  noiz: '<circle cx="8" cy="8" r="2"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2M4 4l1.5 1.5M12 12l-1.5-1.5M12 4l-1.5 1.5M4 12l1.5-1.5"/>'
};
const tbtn = (id, icon, label) => `<button class="tbtn" data-act="${id}"><svg viewBox="0 0 16 16">${ICON[icon]}</svg>${label}</button>`;

const MENUS = {
  File: [['New project', 'Ctrl+N', 'new'], ['Open…', 'Ctrl+O', 'open'], ['Save project', 'Ctrl+S', 'save'], null,
  ['Export parts list (CSV)', '', 'csv'], ['Export to NoizCalc…', '', 'noiz']],
  View: [['Venue', '', 'tab:venue'], ['Arrays', '', 'tab:arrays'], ['Alignment', '', 'tab:alignment'],
  ['3D plot', '', 'tab:plot3d'], ['Rigging plot', '', 'tab:rigging'], ['Parts list', '', 'tab:parts']],
  Array: [['Add array', '', 'add'], ['Delete array', 'Del', 'del'], ['Copy array', 'Ctrl+C', 'copy'],
  ['Paste array', 'Ctrl+V', 'paste'], null, ['Auto splay', 'F5', 'splay'], ['Compute Spatial Smoothing', 'F6', 'ap']],
  Extras: [['Cabinet library…', '', 'cabinets'], ['Room settings…', '', 'room'], ['Reset all levels', '', 'reset'], ['Mute all', '', 'muteall']],
  Help: [['About this tool', '', 'about']]
};

function shell() {
  const menus = Object.keys(MENUS).map(m => `<div class="m" data-menu="${m}">${m}</div>`).join('');
  const pops = Object.entries(MENUS).map(([m, items]) => `<div class="menu-pop" data-pop="${m}">` +
    items.map(it => it ? `<div data-act="${it[2]}">${it[0]}<span>${it[1]}</span></div>` : '<div class="sep"></div>').join('') +
    '</div>').join('');
  return `<div class="menubar">${menus}${pops}</div>
  <div class="toolbar">
    ${tbtn('open', 'open', 'Open')}${tbtn('save', 'save', 'Save')}${tbtn('csv', 'print', 'Parts list')}
    <span class="tsep"></span>
    ${tbtn('add', 'add', 'Add array')}${tbtn('del', 'del', 'Delete array')}
    ${tbtn('copy', 'copy', 'Copy array')}${tbtn('paste', 'paste', 'Paste array')}
    <span class="tsep"></span>
    ${tbtn('splay', 'splay', 'Auto splay')}${tbtn('ap', 'ap', 'Spatial Smoothing')}
    <span class="tsep"></span>
    ${tbtn('cabinets', 'add', 'Cabinets')}${tbtn('noiz', 'noiz', 'To NoizCalc')}${tbtn('about', 'help', 'Help')}
  </div>
  <div class="tabbar">
    ${TABS.map(([k, l]) => `<div class="tab" data-tab="${k}">${l}</div>`).join('')}
    <div class="spring"></div>
    <div class="meta"><span>Project <b id="mProj"></b></span><span>Venue <b id="mVen"></b></span>
      <span id="mDate"></span><span><b id="mAuth"></b></span><span>Array Planner V1.2</span></div>
  </div>
  <div class="work" id="work"></div>
  <div class="statusbar">
    <span id="stSel"></span><span id="stSys"></span><span id="stRig"></span><span class="sp"></span>
    <span id="stCalc"></span><span id="stEnv"></span>
  </div>`;
}

/* ==========================================================
   views
   ========================================================== */
const BANDS_SEL = [['bb', 'Broadband A'], [63, '63 Hz'], [125, '125 Hz'], [250, '250 Hz'], [500, '500 Hz'],
[1000, '1 kHz'], [2000, '2 kHz'], [4000, '4 kHz'], [8000, '8 kHz'], [12500, '12.5 kHz']];

function sourceList() {
  return `<div class="list" style="max-height:132px">` + S.sources.map((s, i) => {
    const n = s.kind === 'sub' ? s.sub.count * (s.sub.stack || 1) : s.cabs.length;
    return `<div class="lrow ${i === S.sel ? 'on' : ''}" data-src="${i}">
      <span class="sw" style="background:${s.color}"></span>
      <span class="nm">${s.name}</span>
      <span style="color:var(--ink-mute)">GR${s.group}</span>
      <span style="width:26px;text-align:right">${n}</span>
      <button class="mute ${s.mute ? 'on' : ''}" data-mute="${i}">M</button></div>`;
  }).join('') + `</div>
  <div class="r" style="margin-top:4px;gap:3px">
    <button class="btn sm" data-act="add">Add</button>
    <button class="btn sm" data-act="del">Delete</button>
    <button class="btn sm" data-act="copy">Copy</button>
    <button class="btn sm" data-act="paste">Paste</button></div>`;
}

function sourcePanel() {
  const s = sel(); if (!s) return '';
  const cabs = P.CAB_LIST.map(c => [c, `${c}  (${P.CABINETS[c].series})`]);
  let b = '';
  b += sel_('sel.cabType', cabs, { label: 'System', wide: true, w: 132 });
  b += sel_('sel.mounting', [['flown', 'flown'], ['stacked', 'stacked']], { label: 'Mounting', w: 92 });
  b += num('sel.x', { label: 'Position x', unit: 'm', step: 0.5, dec: 2 });
  b += num('sel.y', { label: 'Position y', unit: 'm', step: 0.5, dec: 2 });
  b += num('sel.z', { label: s.mounting === 'flown' ? 'Frame height front' : 'Stack height', unit: 'm', step: 0.25, dec: 2 });
  b += num('sel.azimuth', { label: 'Horizontal setting', unit: '°', step: 1, dec: 1 });
  if (s.kind !== 'sub') b += num('sel.tilt', { label: 'Frame angle', unit: '°', step: 0.5, dec: 1 });
  b += num('sel.gain', { label: 'Level', unit: 'dB', step: 0.5, dec: 1 });
  b += num('sel.delay', { label: 'Delay (abs.)', unit: 'ms', step: 0.5, dec: 2 });
  b += num('sel.hpf', { label: 'High pass', unit: 'Hz', step: 5, dec: 0 });

  if (s.kind === 'sub') {
    b += `<div class="sub">Sub array</div>`;
    b += sel_('sub.mode', Object.entries(P.SUB_MODES), { label: 'Mode', w: 110 });
    b += num('sub.count', { label: 'Cabinets', step: 1, dec: 0, min: 2, max: 40 });
    b += num('sub.spacing', { label: 'Spacing', unit: 'm', step: 0.05, dec: 2 });
    b += num('sub.stack', { label: 'Stacked high', step: 1, dec: 0, min: 1, max: 4 });
    if (s.sub.mode === 'cardioid') {
      b += num('sub.cardDepth', { label: 'Rear box offset', unit: 'm', step: 0.05, dec: 2 });
      b += num('sub.cardGain', { label: 'Rear box level', unit: 'dB', step: 0.5, dec: 1 });
      b += num('sub.cardDelay', { label: 'Rear box delay', unit: 'ms', step: 0.1, dec: 2 });
    }
    if (s.sub.mode === 'endfire') {
      b += num('sub.depth', { label: 'Rows deep', step: 1, dec: 0, min: 2, max: 6 });
      b += num('sub.efSpacing', { label: 'Row spacing', unit: 'm', step: 0.05, dec: 2 });
    }
    if (s.sub.mode === 'arc') b += num('sub.arcDepth', { label: 'Arc depth', unit: 'm', step: 0.1, dec: 2 });
    if (s.sub.mode === 'lr') b += num('sub.lrSpan', { label: 'L / R distance', unit: 'm', step: 0.5, dec: 1 });
    return b;
  }

  b += `<div class="sub">Spatial Smoothing</div>`;
  b += `<div class="r"><label>Enable</label><input type="checkbox" class="chk" data-chk="ap.on">
        <button class="btn sm" data-act="ap">Process</button>
        <select class="fld" data-sel="ap.slot" style="width:56px">
          <option value="1">AP 1</option><option value="2">AP 2</option><option value="3">AP 3</option></select></div>`;
  b += num('ap.strength', { label: 'Strength', step: 0.1, dec: 1, min: 0, max: 1.5 });
  b += `<div class="sub">TOPs</div>`;
  b += `<div class="r"><label title="generic low-cut shelf">Low cut</label><button class="btn sm" data-all="cut">all on</button>
        <button class="btn sm" data-all="cutoff">all off</button></div>`;
  b += `<div class="r"><label title="generic coupling compensation">Coupling</label><button class="btn sm" data-all="cpl-">&minus;</button>
        <span style="width:38px;text-align:right" id="cplAll">${fmt(avgOf('cpl'), 1)}</span>
        <button class="btn sm" data-all="cpl+">+</button></div>`;
  b += `<div class="r"><label title="generic HF compensation shelf">HF comp</label><button class="btn sm" data-all="hfc-">&minus;</button>
        <span style="width:38px;text-align:right" id="hfcAll">${fmt(avgOf('hfc'), 1)}</span>
        <button class="btn sm" data-all="hfc+">+</button></div>`;
  return b;
}
const avgOf = (k) => { const s = sel(); return s && s.cabs.length ? s.cabs.reduce((a, c) => a + (c[k] || 0), 0) / s.cabs.length : 0; };

function cabinetTable() {
  const s = sel();
  if (!s || s.kind === 'sub') {
    if (!s) return '';
    const pos = P.buildSubArray(Object.assign({}, s.sub, { temp: S.env.temp }));
    return `<table class="grid"><thead><tr><th style="width:22px">#</th><th>x [m]</th><th>y [m]</th>
      <th>Level</th><th>Delay</th><th>Pol</th></tr></thead><tbody>` +
      pos.map((p, i) => `<tr><td class="lbl">${i + 1}</td><td style="padding:0 4px">${fmt(p.x, 2)}</td>
        <td style="padding:0 4px">${fmt(p.y, 2)}</td><td style="padding:0 4px">${fmt(p.gain, 1)}</td>
        <td style="padding:0 4px">${fmt(p.delayMs, 2)}</td><td class="c">${p.pol < 0 ? '&minus;' : '+'}</td></tr>`).join('') +
      `</tbody></table>`;
  }
  const fr = P.buildSource(s);
  return `<table class="grid"><thead><tr>
    <th style="width:18px">GR</th><th style="width:42px">Type</th><th style="width:36px">Splay</th>
    <th style="width:36px">Level</th><th style="width:26px">L-Cut</th><th style="width:32px">Cpl</th>
    <th style="width:32px">HF</th><th style="width:34px">Abs °</th><th style="width:38px">Delay</th>
    <th style="width:20px">M</th></tr></thead><tbody>` +
    s.cabs.map((c, i) => `<tr class="${i === 0 ? '' : ''}">
      <td class="lbl">${i + 1}</td>
      <td class="lbl" style="color:var(--ink)">${s.cabType}</td>
      <td>${i ? `<input class="${(c.splay || 0) > P.CABINETS[s.cabType].splayMax || (c.splay || 0) < P.CABINETS[s.cabType].splayMin ? 'bad' : ''}" data-num="cab.${i}.splay" data-dec="1" data-step="0.5" data-min="0" data-max="${P.CABINETS[s.cabType].splayMax}">` : '<span style="padding-right:4px;color:var(--ink-mute)">—</span>'}</td>
      <td><input data-num="cab.${i}.level" data-dec="1" data-step="0.5" data-min="-24" data-max="6"></td>
      <td class="c"><input type="checkbox" class="chk" data-chk="cab.${i}.cut"></td>
      <td><input data-num="cab.${i}.cpl" data-dec="1" data-step="0.5" data-min="0" data-max="6"></td>
      <td><input data-num="cab.${i}.hfc" data-dec="1" data-step="0.5" data-min="0" data-max="6"></td>
      <td style="padding:0 4px;color:var(--ink-dim)">${fmt(fr[i].angle, 1)}</td>
      <td><input data-num="cab.${i}.delay" data-dec="2" data-step="0.1" data-min="0" data-max="200"></td>
      <td class="c"><input type="checkbox" class="chk" data-chk="cab.${i}.mute"></td></tr>`).join('') +
    `</tbody></table>`;
}

function loadPanel() {
  const s = sel();
  if (!s) return '';
  if (s.kind === 'sub') {
    const n = s.sub.count * (s.sub.stack || 1), kg = n * P.CABINETS[s.cabType].kg;
    return `<div class="r"><span class="led ok"></span><label style="flex:0 0 auto;color:#fff;font-weight:700">Ground stacked</label>
      <span class="unit">no rigging load</span></div>
      <div class="r"><label>Cabinets</label><span>${n}</span></div>
      <div class="r"><label>Total weight</label><span>${Math.round(kg)} kg</span></div>
      <div class="r"><label>Array width</label><span>${fmt((s.sub.count - 1) * s.sub.spacing, 2)} m</span></div>`;
  }
  const r = P.rigging(s);
  const cls = r.loadPct > 100 ? 'bad' : r.loadPct > 85 ? 'warn' : '';
  return `<div class="r"><span class="led ${r.ok ? 'ok' : 'bad'}"></span>
      <label style="flex:0 0 auto;color:#fff;font-weight:700">${r.ok ? 'Load OK' : 'Load exceeded'}</label>
      <div class="bar ${cls}"><i style="width:${clamp(r.loadPct, 0, 100)}%"></i><span>${fmt(r.loadPct, 0)} % of load limit</span></div></div>
    <div class="r"><label>Total weight</label><span>${Math.round(r.weight)} kg</span>
      <label style="text-align:right">No. of cabinets</label><span>${r.n}</span></div>
    <div class="r"><label>Array length</label><span>${fmt(r.length, 2)} m</span>
      <label style="text-align:right">Total splay</label><span>${fmt(r.totalSplay, 1)} °</span></div>
    <div class="r"><label>Centre of gravity</label><span>${fmt(r.cogX, 2)} / ${fmt(r.cogZ, 2)} m</span>
      <label style="text-align:right">Top / bottom</label><span>${fmt(r.topAngle, 1)} / ${fmt(r.botAngle, 1)} °</span></div>`;
}

function pickPanel() {
  const s = sel(); if (!s || s.kind === 'sub') return '';
  const r = P.rigging(s);
  const kg = (n) => `${Math.round(n / 9.81)} kg`;
  return `<div style="display:flex;gap:14px;justify-content:center;text-align:center">
    <div><div style="color:var(--ink-dim);margin-bottom:2px">Rear pick</div>
      <div class="fld num" style="width:74px;display:inline-block">${kg(r.forceRear)}</div></div>
    <div><div style="color:var(--ink-dim);margin-bottom:2px">Front pick</div>
      <div class="fld num" style="width:74px;display:inline-block">${kg(r.forceFront)}</div></div>
    <div><div style="color:var(--ink-dim);margin-bottom:2px">Bridle load</div>
      <div class="fld num" style="width:74px;display:inline-block">${kg(r.forceFront + r.forceRear)}</div></div></div>`;
}

function settingsStrip() {
  return `<div style="display:flex;gap:10px;align-items:flex-start">
    <div style="flex:1">
      ${sel_('res', [['low', 'low'], ['med', 'medium'], ['high', 'high']], { label: 'Resolution', w: 78 })}
      ${chk('env.airAbs', { label: 'Air absorption' })}
      ${sel_('band', BANDS_SEL, { label: 'Signal selection', w: 96 })}
    </div>
    <div style="flex:1">
      ${num('env.temp', { label: 'Temperature', unit: '°C', step: 1, dec: 1 })}
      ${num('env.humidity', { label: 'Humidity', unit: '%', step: 5, dec: 0, min: 5, max: 100 })}
      ${num('ref.y', { label: 'FOH distance', unit: 'm', step: 1, dec: 1 })}
    </div></div>`;
}

/* ---------------- Arrays tab ---------------- */
function viewArrays() {
  const s = sel();
  return `<div class="col" style="flex:0 0 330px">
      ${panel('Project settings', txt('project.name', { label: 'Project', lw: 52 })
        + txt('project.venue', { label: 'Venue', lw: 52 }) + txt('project.author', { label: 'Author', lw: 52 }))}
      ${panel('Sources', sourceList())}
      ${panel(s ? s.name : 'Source', sourcePanel(), { right: s ? `GR${s.group}` : '' })}
      ${panel('All cabinets', cabinetTable(), { flex: true, bodyStyle: 'padding:0' })}
    </div>
    <div class="col" style="flex:0 0 330px">
      ${panel('Load', loadPanel())}
      ${plotPanel('cvArray', `${s ? s.name : ''}: Array view`, { legend: '<span style="color:#e8c33a">&#9679;</span> centre of gravity &nbsp; <span style="color:#54c1e8">&#9679;</span> pick points' })}
      ${panel('Rigging', pickPanel())}
      ${panel('Comments', `<textarea class="fld wide" data-txt="project.comments" style="height:52px;text-align:left;resize:none"></textarea>`)}
    </div>
    <div class="col" style="flex:1 1 auto">
      ${plotPanel('cvTop', 'Top view', { hint: 'plan, coverage &minus;6 dB' })}
      ${plotPanel('cvProfile', `${s ? s.name : ''}: Profile at ${s ? fmt(s.tilt, 0) : 0}° aiming`)}
      ${plotPanel('cvSpl', 'Direct sound level vs. distance / dB SPL')}
      ${panel('Calculation settings', settingsStrip())}
    </div>`;
}

/* ---------------- Venue tab ---------------- */
function planeTable() {
  return `<table class="grid"><thead><tr><th style="width:96px" class="lbl">Listening plane</th>
    <th>x [m]</th><th>y [m]</th><th>z [m]</th><th>Width</th><th>Depth</th>
    <th>h front</th><th>h back</th><th>Rot °</th><th style="width:22px">M</th></tr></thead><tbody>` +
    S.planes.map((p, i) => `<tr><td class="lbl"><input data-txt="plane.${i}.name" style="text-align:left"></td>
      <td><input data-num="plane.${i}.x" data-dec="1" data-step="1"></td>
      <td><input data-num="plane.${i}.y" data-dec="1" data-step="1"></td>
      <td><input data-num="plane.${i}.z" data-dec="1" data-step="0.5"></td>
      <td><input data-num="plane.${i}.w" data-dec="1" data-step="1" data-min="1"></td>
      <td><input data-num="plane.${i}.d" data-dec="1" data-step="1" data-min="1"></td>
      <td><input data-num="plane.${i}.hFront" data-dec="2" data-step="0.25"></td>
      <td><input data-num="plane.${i}.hBack" data-dec="2" data-step="0.25"></td>
      <td><input data-num="plane.${i}.rot" data-dec="1" data-step="1"></td>
      <td class="c"><input type="checkbox" class="chk" data-chk="plane.${i}.mute"></td></tr>`).join('') +
    `</tbody></table>`;
}
function viewVenue() {
  const tot = S.planes.filter(p => !p.mute).reduce((a, p) => a + p.w * p.d, 0);
  return `<div class="col" style="flex:0 0 300px">
      ${panel('Room settings', num('env.temp', { label: 'Temperature', unit: '°C', step: 1, dec: 1 })
    + num('env.humidity', { label: 'Humidity', unit: '%', step: 5, dec: 0 })
    + num('env.pressure', { label: 'Air pressure', unit: 'kPa', step: 1, dec: 2 })
    + chk('env.airAbs', { label: 'Air absorption' })
    + row('Speed of sound', `<span class="unit">${fmt(P.soundSpeed(S.env.temp), 1)} m/s</span>`))}
      ${panel('Reference point (FOH)', num('ref.x', { label: 'x', unit: 'm', step: 1, dec: 2 })
      + num('ref.y', { label: 'y', unit: 'm', step: 1, dec: 2 })
      + num('ref.z', { label: 'Listening height', unit: 'm', step: 0.1, dec: 2 }))}
      ${panel('Audience', row('Listening planes', `<span>${S.planes.length}</span>`)
        + row('Total area', `<span>${Math.round(tot)} m²</span>`)
        + `<div class="r" style="gap:3px"><button class="btn sm" data-act="planeAdd">Add plane</button>
           <button class="btn sm" data-act="planeDel">Delete last</button>
           <button class="btn sm" data-act="venuePreset">Preset…</button></div>`)}
      ${panel('Sources', sourceList(), { flex: true })}
    </div>
    <div class="col" style="flex:1">
      ${panel('Listening planes', planeTable(), { bodyStyle: 'padding:0' })}
      ${plotPanel('cvVenueTop', 'Top view — venue', { hint: 'planes, sources and coverage' })}
    </div>
    <div class="col" style="flex:1">
      ${plotPanel('cvVenueSide', 'Side view — section on the venue centre line')}
      ${plotPanel('cvVenue3d', '3D wireframe', { hint: 'drag to rotate' })}
    </div>`;
}

/* ---------------- Alignment tab ---------------- */
function viewAlignment() {
  const c = P.soundSpeed(S.env.temp);
  const rows = S.sources.map((s, i) => {
    const d = Math.hypot(S.ref.x - s.x, S.ref.y - s.y, S.ref.z - s.z);
    return { i, s, d, t: d / c * 1000 };
  });
  const tMax = Math.max(...rows.map(r => r.t));
  return `<div class="col" style="flex:0 0 320px">
      ${panel('Reference point', num('ref.x', { label: 'x', unit: 'm', step: 1, dec: 2 })
    + num('ref.y', { label: 'y', unit: 'm', step: 1, dec: 2 })
    + num('ref.z', { label: 'z', unit: 'm', step: 0.1, dec: 2 })
    + `<div class="r" style="gap:3px"><button class="btn sm" data-act="alignAll">Align all to furthest</button>
       <button class="btn sm" data-act="alignClear">Clear delays</button></div>`)}
      ${panel('Sources', sourceList())}
      ${panel('Notes', `<div style="color:var(--ink-dim);line-height:1.5">
        Delay times are referred to the arrival of the furthest source at the
        reference point. Applied delay is the absolute delay of each source;
        the alignment column shows what would be needed for coincident arrival.</div>`, { flex: true })}
    </div>
    <div class="col" style="flex:1">
      ${panel('Delay alignment', `<table class="grid"><thead><tr>
        <th class="lbl" style="width:110px">Source</th><th>Distance [m]</th><th>Arrival [ms]</th>
        <th>Required [ms]</th><th>Applied [ms]</th><th>Level [dB]</th><th>Mute</th></tr></thead><tbody>` +
    rows.map(r => `<tr class="${r.i === S.sel ? 'on' : ''}" data-src="${r.i}">
          <td class="lbl" style="color:${r.s.color}">${r.s.name}</td>
          <td style="padding:0 4px">${fmt(r.d, 2)}</td>
          <td style="padding:0 4px">${fmt(r.t, 2)}</td>
          <td style="padding:0 4px;color:var(--accent)">${fmt(tMax - r.t, 2)}</td>
          <td><input data-num="align.${r.i}" data-dec="2" data-step="0.1" data-min="0" data-max="300"></td>
          <td><input data-num="lvl.${r.i}" data-dec="1" data-step="0.5" data-min="-24" data-max="6"></td>
          <td class="c"><input type="checkbox" class="chk" data-chk="mute.${r.i}"></td></tr>`).join('') +
    `</tbody></table>`, { bodyStyle: 'padding:0' })}
      ${plotPanel('cvArrival', 'Arrival times at the reference point / ms')}
      ${plotPanel('cvResp', 'Magnitude response at the reference point / dB')}
    </div>`;
}

/* ---------------- 3D plot ---------------- */
function viewPlot3d() {
  return `<div class="col" style="flex:0 0 268px">
      ${panel('Plot settings', sel_('band', BANDS_SEL, { label: 'Frequency band', w: 104 })
    + sel_('res', [['low', 'low (3 m)'], ['med', 'medium (2 m)'], ['high', 'high (1 m)']], { label: 'Resolution', w: 104 })
    + num('view.az', { label: 'View rotation', unit: '°', step: 5, dec: 0 })
    + num('view.el', { label: 'View elevation', unit: '°', step: 5, dec: 0 })
    + num('ref.z', { label: 'Listening height', unit: 'm', step: 0.1, dec: 2 })
    + `<div class="r"><button class="btn primary wide" data-act="calc3d">Calculate</button></div>`)}
      ${panel('Statistics', `<div id="stats3d" style="color:var(--ink-dim)">not calculated</div>`)}
      ${panel('Colour scale', `<div id="scale3d"></div>`)}
      ${panel('Sources', sourceList(), { flex: true })}
    </div>
    <div class="col" style="flex:1">
      ${plotPanel('cv3d', 'Level distribution on the listening planes', { hint: 'drag to rotate' })}
    </div>`;
}

/* ---------------- Rigging plot ---------------- */
function viewRigging() {
  const s = sel();
  if (!s || s.kind === 'sub') {
    return `<div class="col" style="flex:0 0 300px">${panel('Sources', sourceList(), { flex: true })}</div>
      <div class="col" style="flex:1">${panel('Rigging', '<div style="color:var(--ink-dim)">Ground stacked source — no rigging plot.</div>', { flex: true })}</div>`;
  }
  const r = P.rigging(s), fr = P.buildSource(s);
  return `<div class="col" style="flex:0 0 300px">
      ${panel('Sources', sourceList())}
      ${panel('Load', loadPanel())}
      ${panel('Pick points', pickPanel() + `<div class="r" style="margin-top:6px"><label>Working load limit</label><span>1250 kg / point</span></div>`)}
      ${panel('Angles', `<table class="grid"><thead><tr><th class="lbl">#</th><th>Splay °</th><th>Absolute °</th>
        <th>Front z [m]</th></tr></thead><tbody>` + fr.map((f, i) =>
    `<tr><td class="lbl">${i + 1}</td><td style="padding:0 4px">${i ? fmt(f.splay, 1) : '—'}</td>
       <td style="padding:0 4px">${fmt(f.angle, 1)}</td><td style="padding:0 4px">${fmt(f.topZ, 2)}</td></tr>`).join('')
    + `</tbody></table>`, { flex: true, bodyStyle: 'padding:0' })}
    </div>
    <div class="col" style="flex:1">
      ${plotPanel('cvRig', `${s.name}: Rigging plot`, { hint: 'forces at the pick points, cabinet angles to scale' })}
    </div>`;
}

/* ---------------- Parts list ---------------- */
function partsData() {
  const cabs = new Map(), amps = new Map();
  let kg = 0;
  for (const s of S.sources) {
    const n = s.kind === 'sub' ? s.sub.count * (s.sub.stack || 1) : s.cabs.length;
    cabs.set(s.cabType, (cabs.get(s.cabType) || 0) + n);
    kg += n * P.CABINETS[s.cabType].kg;
  }
  let ampCh = 0;
  for (const [type, n] of cabs) {
    const model = ampModelOf(type);
    const key = `${model} amplifier (${AMPS[model].channels} ch)`;
    amps.set(key, (amps.get(key) || 0) + ampsRequired(type, n));
    ampCh += n * ampChannels(type);
  }
  const rig = [];
  for (const s of S.sources) {
    if (s.kind === 'sub' || s.mounting !== 'flown') continue;
    rig.push([`${s.cabType} flying frame`, 1]);
    rig.push([`${s.cabType} pick-up bar`, 1]);
    rig.push([`1 t chain hoist (${s.name})`, 2]);
  }
  return { cabs, amps, rig, kg, ampCh };
}
function viewParts() {
  const d = partsData();
  const tbl = (title, rows, unit = '') => `<table class="grid"><thead><tr>
    <th class="lbl" style="width:70%">${title}</th><th>Qty</th>${unit ? `<th>${unit}</th>` : ''}</tr></thead><tbody>` +
    rows.map(([a, b, c]) => `<tr><td class="lbl" style="color:var(--ink)">${a}</td>
      <td style="padding:0 6px">${b}</td>${unit ? `<td style="padding:0 6px">${c}</td>` : ''}</tr>`).join('') + `</tbody></table>`;
  return `<div class="col" style="flex:1">
      ${panel('Loudspeakers', tbl('Cabinet', [...d.cabs].map(([t, n]) => [`${t} — ${P.CABINETS[t].series}`, n, `${Math.round(n * P.CABINETS[t].kg)} kg`]), 'Weight'), { bodyStyle: 'padding:0' })}
      ${panel('Amplification', tbl('Device', [...d.amps]), { bodyStyle: 'padding:0' })}
      ${panel('Rigging hardware', tbl('Item', d.rig), { flex: true, bodyStyle: 'padding:0' })}
    </div>
    <div class="col" style="flex:1">
      ${panel('Summary', row('Total cabinets', `<span>${[...d.cabs.values()].reduce((a, b) => a + b, 0)}</span>`)
    + row('Total loudspeaker weight', `<span>${Math.round(d.kg)} kg</span>`)
    + row('Amplifier channels in use', `<span>${d.ampCh}</span>`)
    + row('Amplifiers required', `<span>${[...d.amps.values()].reduce((a, b) => a + b, 0)}</span>`)
    + row('Listening planes', `<span>${S.planes.length}</span>`)
    + `<div class="r" style="gap:4px;margin-top:6px"><button class="btn sm" data-act="csv">Export CSV</button>
       <button class="btn sm" data-act="noiz">Export to NoizCalc</button></div>`)}
      ${panel('Project', txt('project.name', { label: 'Project' }) + txt('project.venue', { label: 'Venue' })
      + txt('project.author', { label: 'Author' }) + txt('project.date', { label: 'Date' }))}
      ${panel('Per source', `<table class="grid"><thead><tr><th class="lbl">Source</th><th>System</th><th>Qty</th>
        <th>Weight</th><th>Mounting</th></tr></thead><tbody>` + S.sources.map(s => {
        const n = s.kind === 'sub' ? s.sub.count * (s.sub.stack || 1) : s.cabs.length;
        return `<tr><td class="lbl" style="color:${s.color}">${s.name}</td><td style="padding:0 4px">${s.cabType}</td>
          <td style="padding:0 4px">${n}</td><td style="padding:0 4px">${Math.round(n * P.CABINETS[s.cabType].kg)} kg</td>
          <td style="padding:0 4px">${s.mounting}</td></tr>`;
      }).join('') + `</tbody></table>`, { flex: true, bodyStyle: 'padding:0' })}
    </div>`;
}

/* ==========================================================
   canvas helpers
   ========================================================== */
function ctxOf(cv) {
  if (!cv) return null;
  const r = cv.getBoundingClientRect();
  const w = Math.max(60, Math.round(r.width)), h = Math.max(40, Math.round(r.height));
  const k = dpr();
  if (cv.width !== w * k || cv.height !== h * k) { cv.width = w * k; cv.height = h * k; }
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  ctx.font = '10px "Segoe UI",Arial,sans-serif';
  ctx.lineJoin = 'round';
  return { ctx, w, h };
}
function mapper(w, h, pad, bx) {
  const sx = (w - pad.l - pad.r) / Math.max(bx.w, 0.001);
  const sy = (h - pad.t - pad.b) / Math.max(bx.h, 0.001);
  const s = Math.min(sx, sy);
  const ox = pad.l + ((w - pad.l - pad.r) - bx.w * s) / 2;
  const oy = pad.t + ((h - pad.t - pad.b) - bx.h * s) / 2;
  return {
    s, X: (x) => ox + (x - bx.x) * s, Y: (y) => oy + (bx.y + bx.h - y) * s,
    inv: (px, py) => [bx.x + (px - ox) / s, bx.y + bx.h - (py - oy) / s]
  };
}
function mapperXY(w, h, pad, bx) {
  const sx = (w - pad.l - pad.r) / Math.max(bx.w, 1e-6);
  const sy = (h - pad.t - pad.b) / Math.max(bx.h, 1e-6);
  return {
    sx, sy, s: sx,
    X: (x) => pad.l + (x - bx.x) * sx,
    Y: (y) => h - pad.b - (y - bx.y) * sy,
    inv: (px, py) => [bx.x + (px - pad.l) / sx, bx.y + (h - pad.b - py) / sy]
  };
}
function grid(ctx, w, h, m, bx, step, o = {}) {
  ctx.save();
  ctx.strokeStyle = o.color || '#22282c'; ctx.lineWidth = 1;
  ctx.fillStyle = o.label || '#5c666d';
  const x0 = Math.ceil(bx.x / step) * step, y0 = Math.ceil(bx.y / step) * step;
  for (let x = x0; x <= bx.x + bx.w + 1e-6; x += step) {
    const px = Math.round(m.X(x)) + .5;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    if (o.labels !== false) ctx.fillText(String(Math.round(x)), px + 2, h - 3);
  }
  for (let y = y0; y <= bx.y + bx.h + 1e-6; y += step) {
    const py = Math.round(m.Y(y)) + .5;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    if (o.labels !== false) ctx.fillText(String(Math.round(y)), 3, py - 2);
  }
  ctx.restore();
}
function splColor(v, lo, hi) {
  const t = clamp((v - lo) / Math.max(hi - lo, 0.001), 0, 1);
  const stops = [[0, 20, 32, 90], [.14, 20, 90, 190], [.30, 30, 180, 200], [.45, 40, 180, 80],
  [.60, 190, 200, 40], [.74, 235, 150, 30], [.88, 220, 60, 40], [1, 170, 30, 90]];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const u = (t - a[0]) / (b[0] - a[0]);
      return `rgb(${Math.round(a[1] + (b[1] - a[1]) * u)},${Math.round(a[2] + (b[2] - a[2]) * u)},${Math.round(a[3] + (b[3] - a[3]) * u)})`;
    }
  }
  return '#fff';
}
function scaleBar(ctx, w, h, m, unit = 'm') {
  const targetPx = 90;
  const raw = targetPx / m.s;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = [1, 2, 5, 10].map(k => k * pow).reduce((a, b) => Math.abs(b - raw) < Math.abs(a - raw) ? b : a);
  const px = n * m.s;
  const x = w - px - 12, y = h - 12;
  ctx.save(); ctx.strokeStyle = '#9aa4ab'; ctx.fillStyle = '#9aa4ab'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 4); ctx.stroke();
  ctx.textAlign = 'center'; ctx.fillText(`${n} ${unit}`, x + px / 2, y - 5); ctx.restore();
}

/* section geometry of a source in its own aiming plane */
function sectionFrames(src) {
  const cab = P.CABINETS[src.cabType];
  const fr = P.buildSource(src);
  return fr.map(f => {
    const th = f.angle * Math.PI / 180;
    const ax = Math.cos(th), az = -Math.sin(th);          // on-axis direction in section
    const dx = -Math.sin(th), dz = -Math.cos(th);          // down the face
    const along = (p) => (p[0] - src.x) * f.ex[0] + (p[1] - src.y) * f.ex[1];
    const t = [along([f.topX, f.topY]), f.topZ];
    const b = [t[0] + dx * cab.h, t[1] + dz * cab.h];
    return {
      f, t, b, ax, az, cab,
      quad: [t, b, [b[0] - ax * cab.d, b[1] - az * cab.d], [t[0] - ax * cab.d, t[1] - az * cab.d]]
    };
  });
}

/* ---------------- array view ---------------- */
function paintArrayView(cv) {
  const c = ctxOf(cv); if (!c) return; const { ctx, w, h } = c;
  const s = sel(); if (!s) return;
  if (s.kind === 'sub') return paintSubTop(ctx, w, h, s);
  const sec = sectionFrames(s);
  const xs = sec.flatMap(q => q.quad.map(p => p[0])), zs = sec.flatMap(q => q.quad.map(p => p[1]));
  const bx = { x: Math.min(...xs) - 1.2, y: Math.min(...zs) - 0.8, w: 0, h: 0 };
  bx.w = Math.max(...xs) + 1.2 - bx.x; bx.h = Math.max(...zs) + 1.4 - bx.y;
  const m = mapper(w, h, { l: 26, r: 10, t: 14, b: 18 }, bx);
  grid(ctx, w, h, m, bx, bx.h > 8 ? 2 : 1);
  // bumper
  const top = sec[0];
  ctx.strokeStyle = '#8f9aa2'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(m.X(top.t[0] + 0.12), m.Y(top.t[1] + 0.18)); ctx.lineTo(m.X(top.t[0] - 0.95), m.Y(top.t[1] + 0.18)); ctx.stroke();
  // cabinets
  sec.forEach((q, i) => {
    ctx.beginPath();
    q.quad.forEach((p, k) => k ? ctx.lineTo(m.X(p[0]), m.Y(p[1])) : ctx.moveTo(m.X(p[0]), m.Y(p[1])));
    ctx.closePath();
    ctx.fillStyle = q.f.mute ? '#3a3f43' : (i % 2 ? '#3a5f7d' : '#33566f');
    ctx.fill();
    ctx.strokeStyle = '#9fb6c6'; ctx.lineWidth = 1; ctx.stroke();
    // on-axis marker
    ctx.strokeStyle = 'rgba(230,200,60,.45)';
    const mid = [(q.t[0] + q.b[0]) / 2, (q.t[1] + q.b[1]) / 2];
    ctx.beginPath(); ctx.moveTo(m.X(mid[0]), m.Y(mid[1]));
    ctx.lineTo(m.X(mid[0] + q.ax * 0.9), m.Y(mid[1] + q.az * 0.9)); ctx.stroke();
  });
  // pick points and centre of gravity
  const r = P.rigging(s);
  const picks = [[0.05, 'front'], [-0.85, 'rear']];
  ctx.fillStyle = '#54c1e8';
  picks.forEach(([off]) => {
    const px = m.X(off), py = m.Y(top.t[1] + 0.18);
    ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill();
  });
  ctx.fillStyle = '#e8c33a';
  ctx.beginPath(); ctx.arc(m.X(r.cogX), m.Y(top.t[1] + r.cogZ), 3.5, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(232,195,58,.5)'; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(m.X(r.cogX), m.Y(top.t[1] + 0.2)); ctx.lineTo(m.X(r.cogX), m.Y(top.t[1] + r.cogZ)); ctx.stroke();
  ctx.setLineDash([]);
  scaleBar(ctx, w, h, m);
}
function paintSubTop(ctx, w, h, s) {
  const pos = P.buildSubArray(Object.assign({}, s.sub, { temp: S.env.temp }));
  const cab = P.CABINETS[s.cabType];
  const xs = pos.map(p => p.x), ys = pos.map(p => p.y);
  const bx = { x: Math.min(...xs) - 2, y: Math.min(...ys) - 2, w: 0, h: 0 };
  bx.w = Math.max(...xs) + 2 - bx.x; bx.h = Math.max(...ys) + 3 - bx.y;
  const m = mapper(w, h, { l: 24, r: 10, t: 14, b: 18 }, bx);
  grid(ctx, w, h, m, bx, 2);
  pos.forEach(p => {
    const x = m.X(p.x), y = m.Y(p.y);
    ctx.fillStyle = p.pol < 0 ? '#7d4d8f' : '#3a5f7d';
    ctx.fillRect(x - cab.w / 2 * m.s, y - cab.d / 2 * m.s, cab.w * m.s, cab.d * m.s);
    ctx.strokeStyle = '#9fb6c6'; ctx.strokeRect(x - cab.w / 2 * m.s, y - cab.d / 2 * m.s, cab.w * m.s, cab.d * m.s);
    if (p.delayMs > 0.01) {
      ctx.fillStyle = '#e8c33a'; ctx.textAlign = 'center';
      ctx.fillText(fmt(p.delayMs, 1), x, y + 3);
    }
  });
  ctx.textAlign = 'left'; ctx.fillStyle = '#8d979e';
  ctx.fillText('audience  ↑', 8, 14);
  scaleBar(ctx, w, h, m);
}

/* ---------------- top view ---------------- */
function venueBox(margin = 8) {
  const xs = [], ys = [];
  for (const p of S.planes) for (const c of P.planeCorners(p)) { xs.push(c[0]); ys.push(c[1]); }
  for (const s of S.sources) { xs.push(s.x); ys.push(s.y); }
  xs.push(S.ref.x); ys.push(S.ref.y);
  if (!xs.length) { xs.push(-20, 20); ys.push(-10, 60); }
  const x = Math.min(...xs) - margin, y = Math.min(...ys) - margin;
  return { x, y, w: Math.max(...xs) + margin - x, h: Math.max(...ys) + margin - y };
}
function paintTop(cv, opt = {}) {
  const c = ctxOf(cv); if (!c) return; const { ctx, w, h } = c;
  const taken = [];
  const label = (text, x, y, col) => {
    const tw = ctx.measureText(text).width;
    const box = [x, y - 9, x + tw, y + 2];
    for (const t of taken) if (!(box[2] < t[0] || box[0] > t[2] || box[3] < t[1] || box[1] > t[3])) return;
    taken.push(box);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - 2, y - 9, tw + 4, 11);
    ctx.fillStyle = col; ctx.fillText(text, x, y);
  };
  const bx = venueBox();
  const m = mapper(w, h, { l: 22, r: 8, t: 14, b: 18 }, bx);
  grid(ctx, w, h, m, bx, bx.w > 120 ? 20 : 10);
  // stage
  ctx.fillStyle = 'rgba(120,130,140,.18)'; ctx.strokeStyle = '#6e7981';
  ctx.fillRect(m.X(-9), m.Y(2), 18 * m.s, 8 * m.s); ctx.strokeRect(m.X(-9), m.Y(2), 18 * m.s, 8 * m.s);
  ctx.fillStyle = '#6e7981'; ctx.textAlign = 'center'; ctx.fillText('STAGE', m.X(0), m.Y(-2.4));
  ctx.textAlign = 'left';
  // listening planes
  S.planes.forEach((p) => {
    const cor = P.planeCorners(p);
    ctx.beginPath();
    cor.forEach((q, i) => i ? ctx.lineTo(m.X(q[0]), m.Y(q[1])) : ctx.moveTo(m.X(q[0]), m.Y(q[1])));
    ctx.closePath();
    ctx.fillStyle = p.mute ? 'rgba(80,80,80,.10)' : 'rgba(200,60,50,.10)';
    ctx.fill();
    ctx.strokeStyle = p.mute ? '#4a4f54' : '#c8483c'; ctx.lineWidth = 1.3; ctx.stroke();
    label(p.name, m.X(cor[0][0]) + 4, m.Y(cor[0][1]) - 4, p.mute ? '#61686e' : '#d98079');
  });
  // sources with horizontal coverage
  S.sources.forEach((s, i) => {
    const cab = P.CABINETS[s.cabType];
    const px = m.X(s.x), py = m.Y(s.y);
    if (s.kind === 'sub') {
      const pos = P.buildSubArray(Object.assign({}, s.sub, { temp: S.env.temp }));
      const a = (s.azimuth - 90) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      ctx.fillStyle = s.mute ? '#4a4f54' : s.color;
      pos.forEach(p => {
        const X = m.X(s.x + p.x * ca - p.y * sa), Y = m.Y(s.y + p.x * sa + p.y * ca);
        ctx.fillRect(X - Math.max(2, cab.w / 2 * m.s), Y - Math.max(1.5, cab.d / 2 * m.s),
          Math.max(4, cab.w * m.s), Math.max(3, cab.d * m.s));
      });
      return;
    }
    const az = s.azimuth * Math.PI / 180, half = (cab.hCov / 2) * Math.PI / 180;
    const reach = Math.max(bx.w, bx.h) * 0.9;
    if (!s.mute) {
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(az - half) * reach * m.s, py - Math.sin(az - half) * reach * m.s);
      ctx.lineTo(px + Math.cos(az + half) * reach * m.s, py - Math.sin(az + half) * reach * m.s);
      ctx.closePath();
      ctx.fillStyle = hexA(s.color, .08); ctx.fill();
      ctx.strokeStyle = hexA(s.color, .55); ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(az - half) * reach * m.s, py - Math.sin(az - half) * reach * m.s);
      ctx.lineTo(px, py);
      ctx.lineTo(px + Math.cos(az + half) * reach * m.s, py - Math.sin(az + half) * reach * m.s);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = hexA(s.color, .9);
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(az) * reach * m.s * .5, py - Math.sin(az) * reach * m.s * .5); ctx.stroke();
    }
    ctx.fillStyle = s.mute ? '#4a4f54' : s.color;
    ctx.fillRect(px - 4, py - 4, 8, 8);
    if (i === S.sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.strokeRect(px - 6, py - 6, 12, 12); }
    label(s.name, px + 8, py - 6, i === S.sel ? '#ffffff' : '#c6ced4');
  });
  // FOH
  const fx = m.X(S.ref.x), fy = m.Y(S.ref.y);
  ctx.strokeStyle = '#e8c33a'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(fx, fy, 5, 0, 7); ctx.moveTo(fx - 8, fy); ctx.lineTo(fx + 8, fy);
  ctx.moveTo(fx, fy - 8); ctx.lineTo(fx, fy + 8); ctx.stroke();
  ctx.fillStyle = '#e8c33a'; ctx.fillText('FOH', fx + 9, fy + 11);
  scaleBar(ctx, w, h, m);
  cv._map = m;
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ---------------- profile / section ---------------- */
function paintProfile(cv, opt = {}) {
  const c = ctxOf(cv); if (!c) return; const { ctx, w, h } = c;
  const s = sel(); if (!s) return;
  const ex = [Math.cos(s.azimuth * Math.PI / 180), Math.sin(s.azimuth * Math.PI / 180)];
  // audience profile along the aiming direction
  const prof = [];
  const pts = P.audienceLine(activePlanes(), 40, 0);
  for (const p of pts) {
    const along = (p.x - s.x) * ex[0] + (p.y - s.y) * ex[1];
    if (along > 0) prof.push([along, p.z]);
  }
  prof.sort((a, b) => a[0] - b[0]);
  const far = prof.length ? prof[prof.length - 1][0] : 80;
  const zTop = Math.max(s.z + 2, ...prof.map(p => p[1] + 3));
  const bx = { x: -6, y: Math.min(-1, ...prof.map(p => p[1] - 1)), w: far + 10, h: 0 };
  bx.h = zTop - bx.y;
  const m = mapper(w, h, { l: 22, r: 8, t: 12, b: 16 }, bx);
  grid(ctx, w, h, m, bx, far > 90 ? 20 : 10);
  // ground and audience planes
  ctx.strokeStyle = '#5d666c'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(m.X(bx.x), m.Y(0)); ctx.lineTo(m.X(bx.x + bx.w), m.Y(0)); ctx.stroke();
  if (prof.length) {
    ctx.beginPath(); ctx.moveTo(m.X(prof[0][0]), m.Y(prof[0][1]));
    for (const p of prof) ctx.lineTo(m.X(p[0]), m.Y(p[1]));
    ctx.lineTo(m.X(prof[prof.length - 1][0]), m.Y(bx.y)); ctx.lineTo(m.X(prof[0][0]), m.Y(bx.y));
    ctx.closePath(); ctx.fillStyle = 'rgba(200,60,50,.13)'; ctx.fill();
    ctx.strokeStyle = '#c8483c'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(m.X(prof[0][0]), m.Y(prof[0][1]));
    for (const p of prof) ctx.lineTo(m.X(p[0]), m.Y(p[1]));
    ctx.stroke();
  }
  if (s.kind === 'sub') { scaleBar(ctx, w, h, m); return; }
  // coverage rays per cabinet
  const sec = sectionFrames(s);
  const reach = far + 6;
  sec.forEach((q, i) => {
    if (q.f.mute) return;
    const mid = [(q.t[0] + q.b[0]) / 2, (q.t[1] + q.b[1]) / 2];
    const th = q.f.angle * Math.PI / 180;
    const hue = 200 - (i / Math.max(sec.length - 1, 1)) * 200;
    ctx.strokeStyle = `hsla(${hue},70%,55%,.75)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(m.X(mid[0]), m.Y(mid[1]));
    ctx.lineTo(m.X(mid[0] + Math.cos(th) * reach), m.Y(mid[1] - Math.sin(th) * reach)); ctx.stroke();
  });
  // array outline
  sec.forEach(q => {
    ctx.beginPath();
    q.quad.forEach((p, k) => k ? ctx.lineTo(m.X(p[0]), m.Y(p[1])) : ctx.moveTo(m.X(p[0]), m.Y(p[1])));
    ctx.closePath(); ctx.fillStyle = '#33566f'; ctx.fill();
    ctx.strokeStyle = '#a8bcc9'; ctx.lineWidth = 1; ctx.stroke();
  });
  scaleBar(ctx, w, h, m);
}

/* ---------------- direct sound level vs distance ---------------- */
function levelCurves() {
  if (cache.line) return cache.line;
  const planes = activePlanes();
  const pts = P.audienceLine(planes, S.res === 'high' ? 60 : S.res === 'low' ? 22 : 36, S.ref.z);
  const fr = framesTagged(), ap = apGlobal();
  const bands = S.band === 'bb' ? P.MAP_BANDS : [S.band];
  const series = bands.map(f => ({
    f, pts: pts.map(p => ({
      d: Math.hypot(p.x, p.y, p.z), L: P.bandSpl(fr, p.x, p.y, p.z, f, S.env, ap, 3)
    }))
  }));
  const bb = pts.map(p => ({ d: Math.hypot(p.x, p.y, p.z), L: P.broadband(fr, p.x, p.y, p.z, S.env, ap) }));
  cache.line = { pts, series, bb };
  return cache.line;
}
function paintSpl(cv) {
  const c = ctxOf(cv); if (!c) return; const { ctx, w, h } = c;
  const L = levelCurves();
  const all = L.series.flatMap(s => s.pts.map(p => p.L)).concat(L.bb.map(p => p.L));
  const hi = Math.ceil(Math.max(...all) / 5) * 5 + 2, lo = hi - 40;
  const dMax = Math.max(...L.bb.map(p => p.d)) + 4;
  const bx = { x: 0, y: lo, w: dMax, h: hi - lo };
  const m = mapperXY(w, h, { l: 30, r: 10, t: 16, b: 30 }, bx);
  ctx.strokeStyle = '#22282c'; ctx.fillStyle = '#5c666d';
  for (let v = lo; v <= hi; v += 5) {
    const py = Math.round(m.Y(v)) + .5;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    ctx.fillText(String(v), 3, py - 2);
  }
  const dStep = dMax > 120 ? 20 : 10;
  for (let d = 0; d <= dMax; d += dStep) {
    const px = Math.round(m.X(d)) + .5;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    ctx.fillText(`${d}`, px + 2, h - 3);
  }
  const cols = ['#4aa3e0', '#5ec269', '#eab036', '#e04b3c', '#b976d6'];
  L.series.forEach((s, i) => {
    ctx.strokeStyle = cols[i % cols.length]; ctx.lineWidth = 1.4;
    ctx.beginPath();
    s.pts.forEach((p, k) => k ? ctx.lineTo(m.X(p.d), m.Y(p.L)) : ctx.moveTo(m.X(p.d), m.Y(p.L)));
    ctx.stroke();
  });
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.8;
  ctx.beginPath();
  L.bb.forEach((p, k) => k ? ctx.lineTo(m.X(p.d), m.Y(p.L)) : ctx.moveTo(m.X(p.d), m.Y(p.L)));
  ctx.stroke();
  // legend
  let lx = 44;
  const items = L.series.map((s, i) => [s.f >= 1000 ? `${s.f / 1000} kHz` : `${s.f} Hz`, cols[i % cols.length]])
    .concat([['broadband A', '#ffffff']]);
  const ly = h - 20;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(38, ly - 9, w - 60, 13);
  items.forEach(([lab, col]) => {
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lx, ly - 3); ctx.lineTo(lx + 14, ly - 3); ctx.stroke();
    ctx.fillStyle = '#b9c1c7'; ctx.fillText(lab, lx + 17, ly);
    lx += 24 + ctx.measureText(lab).width;
  });
  const spread = Math.max(...L.bb.map(p => p.L)) - Math.min(...L.bb.map(p => p.L));
  ctx.fillStyle = '#8d979e'; ctx.textAlign = 'right';
  ctx.fillText(`spread ${fmt(spread, 1)} dB · max ${fmt(Math.max(...L.bb.map(p => p.L)), 1)} dB · distance in m`, w - 6, 12);
  ctx.textAlign = 'left';
}

/* ---------------- alignment plots ---------------- */
function paintArrival(cv) {
  const c = ctxOf(cv); if (!c) return; const { ctx, w, h } = c;
  const cs = P.soundSpeed(S.env.temp);
  const rows = S.sources.map(s => ({
    s, t: Math.hypot(S.ref.x - s.x, S.ref.y - s.y, S.ref.z - s.z) / cs * 1000 + (s.delay || 0)
  }));
  const tMax = Math.max(10, ...rows.map(r => r.t)) * 1.12;
  const m = mapperXY(w, h, { l: 84, r: 46, t: 12, b: 18 }, { x: 0, y: 0, w: tMax, h: Math.max(rows.length, 1) });
  ctx.strokeStyle = '#22282c';
  for (let t = 0; t <= tMax; t += tMax > 200 ? 50 : tMax > 80 ? 20 : 10) {
    const px = Math.round(m.X(t)) + .5;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h - 14); ctx.stroke();
    ctx.fillStyle = '#5c666d'; ctx.fillText(`${Math.round(t)} ms`, px + 2, h - 3);
  }
  const bh = (h - 30) / Math.max(rows.length, 1);
  rows.forEach((r, i) => {
    const y = 12 + i * bh;
    ctx.fillStyle = '#b9c1c7'; ctx.fillText(r.s.name, 4, y + bh * .62);
    ctx.fillStyle = r.s.mute ? '#4a4f54' : hexA(r.s.color, .75);
    ctx.fillRect(m.X(0), y + bh * .2, Math.max(1, m.X(r.t) - m.X(0)), bh * .55);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${fmt(r.t, 2)}`, m.X(r.t) + 4, y + bh * .62);
  });
}
function paintResp(cv) {
  const c = ctxOf(cv); if (!c) return; const { ctx, w, h } = c;
  const fr = framesTagged(), ap = apGlobal();
  const fs = [], L = [];
  for (let i = 0; i <= 60; i++) {
    const f = 40 * Math.pow(10, i / 60 * Math.log10(16000 / 40));
    fs.push(f); L.push(P.splAt(fr, S.ref.x, S.ref.y, S.ref.z, f, S.env, ap));
  }
  const hi = Math.ceil(Math.max(...L) / 5) * 5 + 3, lo = hi - 45;
  const m = mapperXY(w, h, { l: 28, r: 10, t: 12, b: 18 }, { x: Math.log10(40), y: lo, w: Math.log10(16000 / 40), h: hi - lo });
  ctx.strokeStyle = '#22282c'; ctx.fillStyle = '#5c666d';
  for (const f of [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]) {
    const px = Math.round(m.X(Math.log10(f))) + .5;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h - 13); ctx.stroke();
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, px + 2, h - 3);
  }
  for (let v = lo; v <= hi; v += 5) {
    const py = Math.round(m.Y(v)) + .5;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    ctx.fillText(String(v), 2, py - 2);
  }
  ctx.strokeStyle = '#5ec269'; ctx.lineWidth = 1.5; ctx.beginPath();
  fs.forEach((f, i) => i ? ctx.lineTo(m.X(Math.log10(f)), m.Y(L[i])) : ctx.moveTo(m.X(Math.log10(f)), m.Y(L[i])));
  ctx.stroke();
}

/* ---------------- 3D plot ---------------- */
function proj3(x, y, z, o) {
  const a = o.az * Math.PI / 180, e = o.el * Math.PI / 180;
  const X = x * Math.cos(a) + y * Math.sin(a);
  const D = -x * Math.sin(a) + y * Math.cos(a);
  return [X, z * Math.cos(e) + D * Math.sin(e), D];
}
function compute3d(cb) {
  const res = S.res === 'high' ? 1 : S.res === 'low' ? 3 : 2;
  const nAvg = S.res === 'low' ? 2 : 3;
  const fr = framesTagged(), ap = apGlobal();
  const t0 = Date.now();
  const maps = activePlanes().map(p => P.mapPlane(fr, p, S.env, ap, { band: S.band, res, nAvg, ear: S.ref.z }));
  cache.map = { maps, band: S.band, res, ms: Date.now() - t0, stats: P.planeStats(maps) };
  if (cb) cb();
}
function paint3d(cv) {
  const c = ctxOf(cv); if (!c) return; const { ctx, w, h } = c;
  const M = cache.map;
  if (!M) {
    ctx.fillStyle = '#5c666d'; ctx.textAlign = 'center';
    ctx.fillText('press Calculate to map the listening planes', w / 2, h / 2); ctx.textAlign = 'left'; return;
  }
  const o = S.view;
  const pts = [];
  for (const m of M.maps) for (const q of P.planeCorners(m.plane)) pts.push(proj3(q[0], q[1], q[2], o));
  for (const s of S.sources) pts.push(proj3(s.x, s.y, s.z, o));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const bx = { x: Math.min(...xs) - 3, y: Math.min(...ys) - 3, w: 0, h: 0 };
  bx.w = Math.max(...xs) + 3 - bx.x; bx.h = Math.max(...ys) + 3 - bx.y;
  const m2 = mapper(w, h, { l: 10, r: 10, t: 16, b: 12 }, bx);
  const lo = Math.floor(M.stats.max - 24), hi = Math.ceil(M.stats.max);
  // cells, painter's algorithm back to front
  const cells = [];
  for (const mp of M.maps) {
    const { nu, nv, vals, plane } = mp;
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => {
        const [x, y, z] = P.planePoint(plane, a / (nu - 1), b / (nv - 1));
        return proj3(x, y, z, o);
      });
      const v = (vals[j * nu + i] + vals[j * nu + i + 1] + vals[(j + 1) * nu + i] + vals[(j + 1) * nu + i + 1]) / 4;
      cells.push({ q, v, d: (q[0][2] + q[2][2]) / 2 });
    }
  }
  cells.sort((a, b) => b.d - a.d);
  for (const cl of cells) {
    ctx.beginPath();
    cl.q.forEach((p, i) => i ? ctx.lineTo(m2.X(p[0]), m2.Y(p[1])) : ctx.moveTo(m2.X(p[0]), m2.Y(p[1])));
    ctx.closePath();
    ctx.fillStyle = splColor(cl.v, lo, hi); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = .6; ctx.stroke();
  }
  // plane outlines and labels
  for (const mp of M.maps) {
    const cor = P.planeCorners(mp.plane).map(q => proj3(q[0], q[1], q[2], o));
    ctx.beginPath();
    cor.forEach((p, i) => i ? ctx.lineTo(m2.X(p[0]), m2.Y(p[1])) : ctx.moveTo(m2.X(p[0]), m2.Y(p[1])));
    ctx.closePath(); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#c6ced4'; ctx.fillText(mp.plane.name, m2.X(cor[0][0]) + 3, m2.Y(cor[0][1]) - 3);
  }
  // sources
  for (const s of S.sources) {
    const p = proj3(s.x, s.y, s.z, o);
    const g = proj3(s.x, s.y, 0, o);
    ctx.strokeStyle = 'rgba(180,190,197,.5)'; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(m2.X(p[0]), m2.Y(p[1])); ctx.lineTo(m2.X(g[0]), m2.Y(g[1])); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = s.mute ? '#4a4f54' : s.color;
    ctx.fillRect(m2.X(p[0]) - 3, m2.Y(p[1]) - 3, 6, 6);
  }
  ctx.fillStyle = '#8d979e';
  ctx.fillText(`${S.band === 'bb' ? 'broadband A' : S.band + ' Hz'} · ${M.ms} ms · scale ${lo}…${hi} dB`, 8, h - 5);
}
function scale3dHtml() {
  const M = cache.map;
  if (!M) return '<div style="color:var(--ink-mute)">—</div>';
  const lo = Math.floor(M.stats.max - 24), hi = Math.ceil(M.stats.max);
  let out = '';
  for (let v = hi; v > lo; v -= 3) {
    out += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:1px">
      <i style="width:26px;height:10px;display:inline-block;background:${splColor(v - 1.5, lo, hi)}"></i>
      <span style="color:var(--ink-dim)">${v - 3} … ${v} dB</span></div>`;
  }
  return out;
}

/* ---------------- rigging plot ---------------- */
function paintRig(cv) {
  const c = ctxOf(cv); if (!c) return; const { ctx, w, h } = c;
  const s = sel(); if (!s || s.kind === 'sub') return;
  const sec = sectionFrames(s), r = P.rigging(s);
  const xs = sec.flatMap(q => q.quad.map(p => p[0])), zs = sec.flatMap(q => q.quad.map(p => p[1]));
  const bx = { x: Math.min(...xs) - 2, y: Math.min(...zs) - 1.5, w: 0, h: 0 };
  bx.w = Math.max(...xs) + 2.5 - bx.x; bx.h = Math.max(...zs) + 3.5 - bx.y;
  const m = mapper(w, h, { l: 34, r: 14, t: 16, b: 20 }, bx);
  grid(ctx, w, h, m, bx, 1);
  const topZ = sec[0].t[1];
  // motors and bumper
  const picks = [[0.05, r.forceFront, 'Front'], [-0.85, r.forceRear, 'Rear']];
  ctx.strokeStyle = '#93a0a8'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(m.X(0.15), m.Y(topZ + 0.2)); ctx.lineTo(m.X(-0.95), m.Y(topZ + 0.2)); ctx.stroke();
  picks.forEach(([off, F, lab]) => {
    const px = m.X(off), py = m.Y(topZ + 0.2);
    ctx.strokeStyle = '#54c1e8'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, m.Y(bx.y + bx.h)); ctx.stroke();
    ctx.fillStyle = '#54c1e8'; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#e6e9eb';
    ctx.fillText(`${lab} ${Math.round(F / 9.81)} kg`, px + 6, m.Y(bx.y + bx.h) + 12);
  });
  sec.forEach((q, i) => {
    ctx.beginPath();
    q.quad.forEach((p, k) => k ? ctx.lineTo(m.X(p[0]), m.Y(p[1])) : ctx.moveTo(m.X(p[0]), m.Y(p[1])));
    ctx.closePath(); ctx.fillStyle = '#33566f'; ctx.fill();
    ctx.strokeStyle = '#a8bcc9'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#c6ced4';
    ctx.fillText(`${i + 1}`, m.X(q.quad[3][0]) - 14, (m.Y(q.t[1]) + m.Y(q.b[1])) / 2 + 3);
    ctx.fillStyle = '#8d979e';
    ctx.fillText(`${fmt(q.f.angle, 1)}°`, m.X(q.t[0]) + 8, (m.Y(q.t[1]) + m.Y(q.b[1])) / 2 + 3);
  });
  // centre of gravity
  ctx.fillStyle = '#e8c33a';
  ctx.beginPath(); ctx.arc(m.X(r.cogX), m.Y(topZ + r.cogZ), 4, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(232,195,58,.45)'; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(m.X(r.cogX), m.Y(topZ + 0.4)); ctx.lineTo(m.X(r.cogX), m.Y(bx.y)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#e8c33a'; ctx.fillText('CoG', m.X(r.cogX) + 6, m.Y(topZ + r.cogZ) - 5);
  ctx.fillStyle = '#b9c1c7';
  ctx.fillText(`${r.n} x ${s.cabType}   ${Math.round(r.weight)} kg   array length ${fmt(r.length, 2)} m   ${fmt(r.loadPct, 0)} % of load limit`, 8, h - 8);
  scaleBar(ctx, w, h, m);
}

/* ---------------- venue plots ---------------- */
function paintVenueSide(cv) {
  const c = ctxOf(cv); if (!c) return; const { ctx, w, h } = c;
  const pts = P.audienceLine(S.planes.filter(p => !p.mute), 40, 0)
    .map(p => [p.y, p.z]).sort((a, b) => a[0] - b[0]);
  const zMax = Math.max(16, ...S.sources.map(s => s.z + 2), ...pts.map(p => p[1] + 3));
  const yMax = Math.max(40, ...pts.map(p => p[0])) + 8;
  const bx = { x: -12, y: -2, w: yMax + 12, h: zMax + 2 };
  const m = mapper(w, h, { l: 24, r: 8, t: 12, b: 16 }, bx);
  grid(ctx, w, h, m, bx, 10);
  ctx.strokeStyle = '#5d666c';
  ctx.beginPath(); ctx.moveTo(m.X(bx.x), m.Y(0)); ctx.lineTo(m.X(bx.x + bx.w), m.Y(0)); ctx.stroke();
  if (pts.length) {
    ctx.beginPath(); ctx.moveTo(m.X(pts[0][0]), m.Y(pts[0][1]));
    for (const p of pts) ctx.lineTo(m.X(p[0]), m.Y(p[1]));
    ctx.strokeStyle = '#c8483c'; ctx.lineWidth = 1.6; ctx.stroke();
  }
  for (const s of S.sources) {
    const n = s.kind === 'sub' ? 1 : s.cabs.length;
    const cab = P.CABINETS[s.cabType];
    ctx.fillStyle = s.mute ? '#4a4f54' : s.color;
    ctx.fillRect(m.X(s.y) - 3, m.Y(s.z) - Math.max(3, n * cab.h * m.s), 6, Math.max(6, n * cab.h * m.s));
    ctx.fillStyle = '#c6ced4'; ctx.fillText(s.name, m.X(s.y) + 6, m.Y(s.z) - 4);
  }
  const fx = m.X(S.ref.y), fy = m.Y(S.ref.z);
  ctx.strokeStyle = '#e8c33a'; ctx.beginPath(); ctx.arc(fx, fy, 4, 0, 7); ctx.stroke();
  ctx.fillStyle = '#e8c33a'; ctx.fillText('FOH', fx + 6, fy - 4);
  scaleBar(ctx, w, h, m);
}
function paintVenue3d(cv) {
  const c = ctxOf(cv); if (!c) return; const { ctx, w, h } = c;
  const o = S.view;
  const all = [];
  for (const p of S.planes) for (const q of P.planeCorners(p)) all.push(proj3(q[0], q[1], q[2], o));
  for (const s of S.sources) { all.push(proj3(s.x, s.y, s.z, o)); all.push(proj3(s.x, s.y, 0, o)); }
  if (!all.length) return;
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const bx = { x: Math.min(...xs) - 3, y: Math.min(...ys) - 3, w: 0, h: 0 };
  bx.w = Math.max(...xs) + 3 - bx.x; bx.h = Math.max(...ys) + 3 - bx.y;
  const m = mapper(w, h, { l: 8, r: 8, t: 12, b: 12 }, bx);
  S.planes.forEach(p => {
    const cor = P.planeCorners(p).map(q => proj3(q[0], q[1], q[2], o));
    ctx.beginPath();
    cor.forEach((q, i) => i ? ctx.lineTo(m.X(q[0]), m.Y(q[1])) : ctx.moveTo(m.X(q[0]), m.Y(q[1])));
    ctx.closePath();
    ctx.fillStyle = p.mute ? 'rgba(90,95,100,.15)' : 'rgba(200,60,50,.16)'; ctx.fill();
    ctx.strokeStyle = p.mute ? '#4a4f54' : '#c8483c'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#b9c1c7'; ctx.fillText(p.name, m.X(cor[0][0]) + 3, m.Y(cor[0][1]) - 3);
  });
  S.sources.forEach(s => {
    const p = proj3(s.x, s.y, s.z, o), g = proj3(s.x, s.y, 0, o);
    ctx.strokeStyle = 'rgba(180,190,197,.45)'; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(m.X(p[0]), m.Y(p[1])); ctx.lineTo(m.X(g[0]), m.Y(g[1])); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = s.mute ? '#4a4f54' : s.color;
    ctx.fillRect(m.X(p[0]) - 3, m.Y(p[1]) - 3, 6, 6);
  });
  const f = proj3(S.ref.x, S.ref.y, S.ref.z, o);
  ctx.strokeStyle = '#e8c33a'; ctx.beginPath(); ctx.arc(m.X(f[0]), m.Y(f[1]), 4, 0, 7); ctx.stroke();
}

/* ==========================================================
   render / paint dispatch
   ========================================================== */
const VIEWS = { venue: viewVenue, arrays: viewArrays, alignment: viewAlignment, plot3d: viewPlot3d, rigging: viewRigging, parts: viewParts };
let painting = false;

function render() {
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === S.tab));
  $('#work').innerHTML = (VIEWS[S.tab] || viewArrays)();
  syncFields();
  $('#mProj').textContent = S.project.name;
  $('#mVen').textContent = S.project.venue;
  $('#mDate').textContent = S.project.date;
  $('#mAuth').textContent = S.project.author;
  const s = sel();
  $('#stSel').textContent = s ? `Selected: ${s.name}` : '';
  $('#stSys').textContent = s ? `${s.kind === 'sub' ? s.sub.count * (s.sub.stack || 1) : s.cabs.length} x ${s.cabType}` : '';
  const issues = S.sources.flatMap(src => validateSource(src));
  const errs = issues.filter(i => i.level === 'error');
  const amps = partsData();
  $('#stRig').innerHTML =
    `<span title="amplifier channels / 4 per D80">Amps ${[...amps.amps.values()].reduce((a, b) => a + b, 0)}`
    + ` &middot; ${amps.ampCh} ch</span>`
    + (issues.length
      ? ` <span style="color:${errs.length ? 'var(--bad)' : 'var(--warn)'}" title="${issues.map(i => i.msg.replace(/"/g, '')).join(' | ')}">`
        + `${errs.length ? '\u25cf ' + errs.length + ' rigging error' + (errs.length > 1 ? 's' : '') : '\u25cf ' + issues.length + ' warning' + (issues.length > 1 ? 's' : '')}</span>`
      : ' <span style="color:var(--ok)">\u25cf rig checks pass</span>');
  $('#stEnv').textContent = `${fmt(S.env.temp, 0)} °C · ${fmt(S.env.humidity, 0)} % rH · c = ${fmt(P.soundSpeed(S.env.temp), 1)} m/s`;
  if ($('#scale3d')) $('#scale3d').innerHTML = scale3dHtml();
  if ($('#stats3d')) $('#stats3d').innerHTML = cache.map
    ? `<div class="r"><label>Maximum</label><span>${fmt(cache.map.stats.max, 1)} dB</span></div>
       <div class="r"><label>Minimum</label><span>${fmt(cache.map.stats.min, 1)} dB</span></div>
       <div class="r"><label>Mean</label><span>${fmt(cache.map.stats.mean, 1)} dB</span></div>
       <div class="r"><label>Spread</label><span style="color:#e8c33a">${fmt(cache.map.stats.spread, 1)} dB</span></div>
       <div class="r"><label>Calculation</label><span>${cache.map.ms} ms</span></div>`
    : '<span style="color:var(--ink-mute)">not calculated</span>';
  paint();
}
function paint() {
  if (painting) return;
  painting = true;
  requestAnimationFrame(() => {
    painting = false;
    const t0 = Date.now();
    try {
      if (S.tab === 'arrays') { paintArrayView($('#cvArray')); paintTop($('#cvTop')); paintProfile($('#cvProfile')); paintSpl($('#cvSpl')); }
      else if (S.tab === 'venue') { paintTop($('#cvVenueTop')); paintVenueSide($('#cvVenueSide')); paintVenue3d($('#cvVenue3d')); }
      else if (S.tab === 'alignment') { paintArrival($('#cvArrival')); paintResp($('#cvResp')); }
      else if (S.tab === 'plot3d') paint3d($('#cv3d'));
      else if (S.tab === 'rigging') paintRig($('#cvRig'));
    } catch (e) { console.error(e); }
    const st = $('#stCalc'); if (st) st.textContent = `prediction ${Date.now() - t0} ms`;
  });
}
function repaintSoft() { cache.line = null; paint(); }

/* ==========================================================
   actions
   ========================================================== */
function busy(msg, fn) {
  const st = $('#stCalc'); if (st) st.textContent = msg;
  setTimeout(() => { fn(); }, 30);
}
function addSource() {
  const s = mkArray(`Array ${S.sources.length + 1}`, 'XA12', 8, 0, 0, 12, 90, 3, COLORS[S.sources.length % COLORS.length], { splay: 3, hpf: 90 });
  S.sources.push(s); S.sel = S.sources.length - 1; invalidate(); render();
}
function delSource() {
  if (S.sources.length <= 1) return;
  S.sources.splice(S.sel, 1); S.sel = clamp(S.sel, 0, S.sources.length - 1); invalidate(); render();
}
function copySource() { S.clip = JSON.parse(JSON.stringify(sel())); flash('Array copied'); }
function pasteSource() {
  if (!S.clip) return flash('Clipboard empty');
  const s = JSON.parse(JSON.stringify(S.clip));
  s.id = nextId(); s.name = s.name + ' copy'; s.x = -s.x;
  s.azimuth = 180 - s.azimuth;
  S.sources.push(s); S.sel = S.sources.length - 1; invalidate(); render();
}
function runSplay() {
  const s = sel();
  if (!s || s.kind === 'sub') return flash('Select an array');
  busy('auto splay running…', () => {
    const t0 = Date.now();
    P.autoSplay(s, activePlanes(), S.env);
    invalidate(s); render();
    flash(`Auto splay done in ${Date.now() - t0} ms`);
  });
}
function runAP() {
  const s = sel();
  if (!s || s.kind === 'sub') return flash('Select an array');
  busy('Spatial Smoothing…', () => {
    S.apCache.delete(s.id);
    s.ap.on = true;
    apFor(s);
    invalidate(); render();
    flash('Spatial Smoothing applied');
  });
}
function flash(msg) {
  const st = $('#stCalc'); if (!st) return;
  st.textContent = msg; st.style.color = '#e8c33a';
  setTimeout(() => { st.style.color = ''; }, 2200);
}
function alignAll() {
  const c = P.soundSpeed(S.env.temp);
  const t = S.sources.map(s => Math.hypot(S.ref.x - s.x, S.ref.y - s.y, S.ref.z - s.z) / c * 1000);
  const tMax = Math.max(...t);
  S.sources.forEach((s, i) => s.delay = +(tMax - t[i]).toFixed(2));
  invalidate(); render(); flash('Sources aligned to the furthest arrival');
}
function csvExport() {
  const d = partsData();
  let out = 'Section,Item,Qty,Detail\n';
  for (const [t, n] of d.cabs) out += `Loudspeakers,${t},${n},${P.CABINETS[t].series} — ${Math.round(n * P.CABINETS[t].kg)} kg\n`;
  for (const [t, n] of d.amps) out += `Amplification,${t},${n},\n`;
  for (const [t, n] of d.rig) out += `Rigging,${t},${n},\n`;
  out += `Summary,Total weight,${Math.round(d.kg)},kg\n`;
  out += `Summary,Amplifier channels,${d.ampCh},\n`;
  out += `Disclaimer,,,"Free-field direct-sound prediction only. Not a substitute for an approved rigging plan, an in-venue measurement sweep, or noise compliance assessment. Cabinet data from published datasheets; not affiliated with or endorsed by d&b audiotechnik."\n`;
  download(`${S.project.name.replace(/\W+/g, '-')}-parts.csv`, out, 'text/csv');
}
function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime || 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
function saveProject() {
  const data = { project: S.project, env: S.env, sources: S.sources, planes: S.planes, ref: S.ref, drive: S.drive };
  download(`${S.project.name.replace(/\W+/g, '-')}.acx.json`, JSON.stringify(data, null, 1));
  try { localStorage.setItem('arraycalc.project', JSON.stringify(data)); } catch (e) { }
  flash('Project saved');
}
function openProject() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        Object.assign(S, { project: d.project, env: d.env, sources: d.sources, planes: d.planes, ref: d.ref });
        if (d.drive) S.drive = d.drive;
        S.sel = 0; uid = 1000; invalidate(); render(); flash('Project loaded');
      } catch (e) { alert('Could not read that project file.'); }
    };
    r.readAsText(f);
  };
  inp.click();
}

/* ---------------- NoizCalc export ---------------- */
function noizDialog() {
  const fr = framesTagged(), ap = apGlobal();
  const em = P.emissionSpectrum(fr, S.env, ap, S.ref);
  const dist = Math.hypot(S.ref.x, S.ref.y, S.ref.z);
  const html = `<div class="dlg">
    <div class="hd">Export emission data to NoizCalc<span class="x" data-close>&#10005;</span></div>
    <div class="bd" style="width:430px">
      <div class="r"><label>Calibration point</label><span>x ${fmt(S.ref.x, 1)} · y ${fmt(S.ref.y, 1)} · z ${fmt(S.ref.z, 2)} m</span></div>
      <div class="r"><label>Distance from origin</label><span>${fmt(dist, 1)} m</span></div>
      <div class="r"><label>Peak capability, A weighted</label><span>${fmt(em.refLevel, 1)} dB(A)</span></div>
      <div class="sub">Drive level</div>
      <div class="r"><label>Mode</label>
        <select class="fld" data-sel="drive.mode" style="width:180px">
          <option value="peak">Peak capability (worst case)</option>
          <option value="programme">Programme Leq (peak &minus; crest)</option>
          <option value="target">Target level at the calibration point</option></select></div>
      <div class="r"><label>Crest factor</label><input class="fld num" data-num="drive.crest" data-dec="1" data-step="1" data-min="0" data-max="30"><span class="unit">dB</span></div>
      <div class="r"><label>Target Leq at FOH</label><input class="fld num" data-num="drive.target" data-dec="1" data-step="1" data-min="70" data-max="115"><span class="unit">dB(A)</span></div>
      <div class="r" style="margin-top:6px"><label>Exported emission level</label>
        <span id="emOut" style="color:#e8c33a;font-weight:700"></span></div>
      <div style="color:var(--ink-mute);margin-top:6px;line-height:1.5">
        NoizCalc reads this level and the octave band shape as the stage emission
        at its calibration point. Programme Leq is the realistic choice for a
        noise study; peak capability is the absolute worst case.</div>
    </div>
    <div class="ft"><button class="btn" data-close>Cancel</button>
      <button class="btn primary" data-act="noizGo">Export</button></div></div>`;
  const back = document.createElement('div');
  back.className = 'dlg-back open'; back.innerHTML = html;
  scope().appendChild(back);
  const upd = () => {
    const L = driveLevel(em.refLevel);
    $('#emOut').textContent = `${fmt(L, 1)} dB(A) at ${fmt(dist, 0)} m`;
  };
  back.addEventListener('input', () => { syncBack(back); upd(); });
  back.addEventListener('change', () => { syncBack(back); upd(); });
  back.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-close') || e.target === back) back.remove();
    if (e.target.dataset.act === 'noizGo') { noizExport(em, dist); back.remove(); }
  });
  syncFields(back); upd();
}
function syncBack(root) {
  $$('[data-num]', root).forEach(el => setP(el.dataset.num, pnum(el.value)));
  $$('[data-sel]', root).forEach(el => setP(el.dataset.sel, el.value));
}
function driveLevel(peak) {
  if (S.drive.mode === 'peak') return peak;
  if (S.drive.mode === 'programme') return peak - S.drive.crest;
  return S.drive.target;
}
function noizExport(em, dist) {
  const L = driveLevel(em.refLevel);
  const payload = {
    tool: 'arraycalc-clone', version: 2,
    name: S.project.name, refLevel: +L.toFixed(1), peakRefLevel: +em.refLevel.toFixed(1),
    calDist: +dist.toFixed(1), bands: em.bands, spectrum: em.shape,
    drive: JSON.parse(JSON.stringify(S.drive)),
    note: `Emission at the ArrayCalc calibration point (${fmt(S.ref.x, 1)}, ${fmt(S.ref.y, 1)}, ${fmt(S.ref.z, 2)})`
  };
  try { localStorage.setItem('arraycalc.emission', JSON.stringify(payload)); } catch (e) { }
  download('arraycalc-emission.json', JSON.stringify(payload, null, 1));
  flash(`Exported ${fmt(L, 1)} dB(A) at ${fmt(dist, 0)} m to NoizCalc`);
}
function aboutDialog() {
  const back = document.createElement('div');
  back.className = 'dlg-back open';
  back.innerHTML = `<div class="dlg"><div class="hd">About<span class="x" data-close>&#10005;</span></div>
    <div class="bd" style="width:430px;line-height:1.6">
      <b>Array Planner</b> — an independent, browser based line array simulator whose
      workflow resembles desktop system-design tools.<br><br>
      Prediction is direct sound only, by coherent complex summation of cabinet
      sub sources, with ISO 9613-1 air absorption. Cabinet entries are built from
      publicly published datasheets and rigging manuals; they contain <b>no</b> measured
      balloon data and no manufacturer processing presets, so absolute levels and
      off-axis behaviour are indicative until GLL data is imported.<br><br>
      This tool predicts free-field behaviour. It is not a substitute for an approved
      rigging plan, an in-venue measurement sweep, or council noise compliance.<br><br>
      Not affiliated with or endorsed by d&amp;b audiotechnik. Product names are the
      trademarks of their owners.</div>
    <div class="ft"><button class="btn primary" data-close>Close</button></div></div>`;
  scope().appendChild(back);
  back.addEventListener('click', e => { if (e.target.hasAttribute('data-close') || e.target === back) back.remove(); });
}
function venuePreset() {
  const names = ['Flat open air field', 'Raked arena bowl', 'Theatre stalls + balcony', 'Stadium end stage'];
  const pick = prompt('Venue preset:\n1 ' + names[0] + '\n2 ' + names[1] + '\n3 ' + names[2] + '\n4 ' + names[3], '1');
  const i = parseInt(pick, 10);
  const P0 = (n, x, y, z, w, d, hf, hb) => ({ id: nextId(), name: n, x, y, z, w, d, hFront: hf, hBack: hb, rot: 0, mute: false });
  if (i === 1) S.planes = [P0('Front standing', -24, 6, 0, 48, 30, 0, 0), P0('Rear standing', -30, 36, 0, 60, 34, 0, 1.5), P0('Grandstand', -30, 70, 0, 60, 16, 2, 9)];
  else if (i === 2) S.planes = [P0('Floor', -18, 8, 0, 36, 26, 0, 0), P0('Lower bowl', -26, 34, 0, 52, 20, 2, 11), P0('Upper bowl', -30, 56, 0, 60, 16, 14, 24)];
  else if (i === 3) S.planes = [P0('Stalls', -12, 5, 0, 24, 22, 0, 3.5), P0('Balcony', -12, 24, 0, 24, 12, 7, 12)];
  else if (i === 4) S.planes = [P0('Pitch', -30, 8, 0, 60, 50, 0, 0), P0('Lower tier', -46, 58, 0, 92, 22, 2, 14), P0('Upper tier', -50, 82, 0, 100, 20, 20, 36)];
  else return;
  invalidate(); render();
}

/* ==========================================================
   events
   ========================================================== */
function act(id) {
  if (id.startsWith('tab:')) { S.tab = id.slice(4); render(); return; }
  const map = {
    new: () => { defaultProject(); invalidate(); render(); },
    open: openProject, save: saveProject, csv: csvExport, noiz: noizDialog,
    add: addSource, del: delSource, copy: copySource, paste: pasteSource,
    splay: runSplay, ap: runAP, about: aboutDialog,
    cabinets: () => cabinetDialog(scope() === document ? document.body : scope()), alignAll, venuePreset,
    alignClear: () => { S.sources.forEach(s => s.delay = 0); invalidate(); render(); },
    room: () => { S.tab = 'venue'; render(); },
    reset: () => { S.sources.forEach(s => { s.gain = 0; s.cabs.forEach(c => { c.level = 0; c.cpl = 0; c.hfc = 0; c.cut = false; }); }); invalidate(); render(); },
    muteall: () => { const any = S.sources.some(s => !s.mute); S.sources.forEach(s => s.mute = any); invalidate(); render(); },
    calc3d: () => busy('calculating…', () => { compute3d(); render(); }),
    planeAdd: () => {
      const last = S.planes[S.planes.length - 1];
      S.planes.push({ id: nextId(), name: `Plane ${S.planes.length + 1}`, x: last ? last.x : -20, y: last ? last.y + last.d : 10, z: 0, w: last ? last.w : 40, d: 20, hFront: last ? last.hBack : 0, hBack: last ? last.hBack + 2 : 0, rot: 0, mute: false });
      invalidate(); render();
    },
    planeDel: () => { if (S.planes.length > 1) { S.planes.pop(); invalidate(); render(); } }
  };
  if (map[id]) map[id]();
}

function bindGlobal() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    const menu = t.closest?.('[data-menu]');
    $$('.menu-pop').forEach(p => { if (!menu || p.dataset.pop !== menu.dataset.menu) p.classList.remove('open'); });
    $$('.menubar .m').forEach(m => m.classList.remove('open'));
    if (menu) {
      const pop = $(`[data-pop="${menu.dataset.menu}"]`);
      pop.classList.toggle('open'); menu.classList.add('open');
      pop.style.left = menu.offsetLeft + 'px';
      return;
    }
    const a = t.closest?.('[data-act]');
    if (a) { act(a.dataset.act); $$('.menu-pop').forEach(p => p.classList.remove('open')); return; }
    const tab = t.closest?.('[data-tab]');
    if (tab) { S.tab = tab.dataset.tab; render(); return; }
    const mu = t.closest?.('[data-mute]');
    if (mu) { const i = +mu.dataset.mute; S.sources[i].mute = !S.sources[i].mute; invalidate(); render(); return; }
    const sr = t.closest?.('[data-src]');
    if (sr) { S.sel = +sr.dataset.src; render(); return; }
    const up = t.closest?.('[data-step\\+]'), dn = t.closest?.('[data-step-]');
    if (up || dn) {
      const el = up || dn, path = el.getAttribute(up ? 'data-step+' : 'data-step-');
      const inp = $(`[data-num="${path}"]`);
      const st = inp ? +inp.dataset.step : 1;
      const v = (getP(path) || 0) + (up ? st : -st);
      const min = inp ? +inp.dataset.min : -1e6, max = inp ? +inp.dataset.max : 1e6;
      setP(path, clamp(+v.toFixed(4), min, max));
      syncFields(); afterEdit(path);
    }
    const all = t.closest?.('[data-all]');
    if (all) {
      const s = sel(), k = all.dataset.all;
      if (k === 'cut') s.cabs.forEach(c => c.cut = true);
      if (k === 'cutoff') s.cabs.forEach(c => c.cut = false);
      if (k === 'cpl+') s.cabs.forEach(c => c.cpl = clamp((c.cpl || 0) + 0.5, 0, 6));
      if (k === 'cpl-') s.cabs.forEach(c => c.cpl = clamp((c.cpl || 0) - 0.5, 0, 6));
      if (k === 'hfc+') s.cabs.forEach(c => c.hfc = clamp((c.hfc || 0) + 0.5, 0, 6));
      if (k === 'hfc-') s.cabs.forEach(c => c.hfc = clamp((c.hfc || 0) - 0.5, 0, 6));
      invalidate(s); render();
    }
  });
  const onEdit = (e) => {
    const el = e.target;
    if (el.dataset.num !== undefined) { setP(el.dataset.num, clamp(pnum(el.value), +el.dataset.min, +el.dataset.max)); afterEdit(el.dataset.num); }
    else if (el.dataset.txt !== undefined) { setP(el.dataset.txt, el.value); afterEdit(el.dataset.txt); }
    else if (el.dataset.sel !== undefined) { setP(el.dataset.sel, isNaN(+el.value) ? el.value : +el.value); afterEdit(el.dataset.sel, true); }
    else if (el.dataset.chk !== undefined) { setP(el.dataset.chk, el.checked); afterEdit(el.dataset.chk, true); }
  };
  document.addEventListener('input', onEdit);
  document.addEventListener('change', (e) => { if (e.target.dataset.sel !== undefined || e.target.dataset.chk !== undefined) onEdit(e); });
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Enter') e.target.blur();
      return;
    }
    if (e.key === 'F5') { e.preventDefault(); runSplay(); }
    if (e.key === 'F6') { e.preventDefault(); runAP(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveProject(); }
  });
  window.addEventListener('resize', () => paint());
  // drag to rotate the 3D views
  let drag = null;
  document.addEventListener('mousedown', (e) => {
    const cv = e.target.closest?.('canvas');
    if (cv && (cv.id === 'cv3d' || cv.id === 'cvVenue3d')) drag = { x: e.clientX, y: e.clientY, az: S.view.az, el: S.view.el };
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    S.view.az = drag.az + (e.clientX - drag.x) * 0.4;
    S.view.el = clamp(drag.el + (e.clientY - drag.y) * 0.3, 5, 89);
    syncFields(); paint();
  });
  document.addEventListener('mouseup', () => { drag = null; });
}
let editTimer = null;
function afterEdit(path, structural) {
  const heavy = structural || path.includes('cabType') || path.includes('mode') || path.includes('count')
    || path.includes('stack') || path.includes('mounting') || path === 'band' || path === 'res';
  cache.line = null;
  clearTimeout(editTimer);
  editTimer = setTimeout(() => { if (heavy) render(); else paint(); }, heavy ? 10 : 140);
}

/* ==========================================================
   boot
   ========================================================== */
export function bootArrayCalc(root) {
  ROOT = root;
  root.innerHTML = shell();
  defaultProject();
  bindGlobal();
  render();
  setTimeout(() => paint(), 120);
  void initCabinetLibrary(() => { invalidate(); render(); });
}


