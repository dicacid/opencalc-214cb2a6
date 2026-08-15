// @ts-nocheck
import { THIRD_OCT, OCT, MAP_BANDS, aWeight, airAlpha, soundSpeed } from "./env";
import { CABINETS, maxSplAt, voicingGain } from "./cabinets";
import { buildSource, buildAll, nSub, segDir, horizDir, vertPointDir } from "./geometry";

export const refCache = new Map();
export const REF_R = 16;
export function refPressure(cabType, f, c) {
  const key = cabType + '|' + f.toFixed(2);
  let v = refCache.get(key);
  if (v !== undefined) return v;
  const cab = CABINETS[cabType];
  const lambda = c / f, k = 2 * Math.PI / lambda;
  const K = nSub(cab.h, lambda), seg = cab.h / K;
  let re = 0, im = 0;
  for (let s = 0; s < K; s++) {
    const zs = (s + 0.5) * seg - cab.h / 2;
    const r = Math.hypot(REF_R, zs);
    const d = cab.kind === 'sub' ? 1 : segDir(k, seg, Math.atan2(zs, REF_R));
    re += (d / r) * Math.cos(-k * r); im += (d / r) * Math.sin(-k * r);
  }
  v = Math.hypot(re, im) * REF_R;
  refCache.set(key, v);
  return v;
}

/* ---------------- core prediction ----------------
   Per frequency the frames are prepared once (level, air absorption,
   sub source positions); the point loop then only does geometry.   */
export function prepFrames(frames, f, env, ap) {
  let m = frames._prep;
  if (!m) { m = new Map(); Object.defineProperty(frames, '_prep', { value: m, enumerable: false, configurable: true }); }
  const key = f + '|' + env.temp + '|' + env.humidity + '|' + (env.airAbs === false ? 0 : 1);
  const hit = m.get(key);
  if (hit && hit.ap === ap) return hit;
  const c = soundSpeed(env.temp);
  const lambda = c / f, k = 2 * Math.PI / lambda;
  const alpha = env.airAbs === false ? 0 : airAlpha(f, env.temp, env.humidity);
  const list = [];
  for (const fr of frames) {
    if (fr.mute) continue;
    const cab = fr.cab;
    let gain = fr.level + voicingGain(fr, f) + (ap ? ap(fr, f) : 0);
    if (fr.hpf && f < fr.hpf) gain -= 24 * Math.log2(fr.hpf / f);
    if (fr.lpf && f > fr.lpf) gain -= 24 * Math.log2(f / fr.lpf);
    const amp = fr.pol * Math.pow(10, (maxSplAt(cab, f) + gain) / 20) / refPressure(fr.cabType, f, c);
    if (Math.abs(amp) < 1e-9) continue;
    const K = nSub(cab.h, lambda);
    const pts = new Float64Array(K * 3);
    for (let s2 = 0; s2 < K; s2++) {
      const t = (s2 + 0.5) / K;
      pts[s2 * 3] = fr.topX + (fr.botX - fr.topX) * t;
      pts[s2 * 3 + 1] = fr.topY + (fr.botY - fr.topY) * t;
      pts[s2 * 3 + 2] = fr.topZ + (fr.botZ - fr.topZ) * t;
    }
    list.push({
      amp, K, pts, seg: cab.h / K, ex0: fr.ex[0], ex1: fr.ex[1],
      axEl: Math.atan2(fr.n[2], Math.hypot(fr.n[0], fr.n[1])),
      sub: cab.kind === 'sub', point: cab.kind === 'point', cab,
      ph0: -2 * Math.PI * f * fr.delay / 1000
    });
  }
  const out = { k, alpha, list, ap };
  m.set(key, out);
  return out;
}

export function pressureAt(frames, px, py, pz, f, env, ap) {
  const { k, alpha, list } = prepFrames(frames, f, env, ap);
  let re = 0, im = 0;
  for (let n = 0; n < list.length; n++) {
    const L = list[n], pts = L.pts;
    for (let s = 0; s < L.K; s++) {
      const dx = px - pts[s * 3], dy = py - pts[s * 3 + 1], dz = pz - pts[s * 3 + 2];
      const r = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 0.3);
      let D = 1;
      if (!L.sub) {
        const along = dx * L.ex0 + dy * L.ex1;
        const theta = Math.atan2(dz, along) - L.axEl;
        const phi = Math.atan2(dx * L.ex1 - dy * L.ex0, along);
        D = segDir(k, L.seg, theta) * horizDir(L.cab, phi);
        if (L.point) D *= vertPointDir(L.cab, theta);
      }
      const g = L.amp * D / r * Math.pow(10, -alpha * r / 20);
      const ph = -k * r + L.ph0;
      re += g * Math.cos(ph); im += g * Math.sin(ph);
    }
  }
  return [re, im];
}
export function splAt(frames, px, py, pz, f, env, ap) {
  const [re, im] = pressureAt(frames, px, py, pz, f, env, ap);
  const p = Math.hypot(re, im);
  return p > 0 ? 20 * Math.log10(p) : -60;
}
export function bandSpl(frames, px, py, pz, fc, env, ap, nAvg = 3) {
  let s = 0;
  for (let i = 0; i < nAvg; i++) {
    const f = nAvg === 1 ? fc : fc * Math.pow(2, (i - (nAvg - 1) / 2) / (6 * (nAvg - 1)));
    s += Math.pow(10, splAt(frames, px, py, pz, f, env, ap) / 10);
  }
  return 10 * Math.log10(s / nAvg);
}
export function broadband(frames, px, py, pz, env, ap, bands = MAP_BANDS, weighted = true) {
  let s = 0;
  for (const f of bands) s += Math.pow(10, (bandSpl(frames, px, py, pz, f, env, ap, 3) + (weighted ? aWeight(f) : 0)) / 10);
  return 10 * Math.log10(s);
}

/* ---------------- listening planes ----------------
   plane = { name, x, y, z, w, d, hFront, hBack, rot }
   x,y,z = P0 (near-left corner), w across, d deep, rot in degrees,
   hFront / hBack = height of the near and far edge above z.        */
export function planeCorners(p) {
  const a = p.rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const loc = [[0, 0, p.hFront], [p.w, 0, p.hFront], [p.w, p.d, p.hBack], [0, p.d, p.hBack]];
  return loc.map(([lx, ly, lz]) => [p.x + lx * ca - ly * sa, p.y + lx * sa + ly * ca, p.z + lz]);
}
export function planePoint(p, u, v) {   // u,v in 0..1
  const a = p.rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const lx = u * p.w, ly = v * p.d;
  return [p.x + lx * ca - ly * sa, p.y + lx * sa + ly * ca,
          p.z + p.hFront + (p.hBack - p.hFront) * v];
}
export function planeGrid(p, res) {
  const nu = Math.max(2, Math.round(p.w / res) + 1);
  const nv = Math.max(2, Math.round(p.d / res) + 1);
  return { nu, nv };
}

/* SPL mapping over a listening plane. mode: 'spl' | 'headroom' */
export function mapPlane(frames, plane, env, ap, opt) {
  const res = opt.res || 2, nAvg = opt.nAvg || 3;
  const { nu, nv } = planeGrid(plane, res);
  const ear = opt.ear ?? 1.7;
  const vals = new Float32Array(nu * nv);
  const bands = opt.band === 'bb' ? MAP_BANDS : [opt.band];
  const wgt = opt.band === 'bb';
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const [x, y, z] = planePoint(plane, nu === 1 ? 0 : i / (nu - 1), nv === 1 ? 0 : j / (nv - 1));
      vals[j * nu + i] = wgt
        ? bandsSum(frames, x, y, z + ear, env, ap, MAP_BANDS, nAvg)
        : bandSpl(frames, x, y, z + ear, opt.band, env, ap, nAvg);
    }
  }
  return { nu, nv, vals, plane };
}

export function bandsSum(frames, x, y, z, env, ap, bands, nAvg) {
  let s = 0;
  for (const f of bands) s += Math.pow(10, (bandSpl(frames, x, y, z, f, env, ap, nAvg) + aWeight(f)) / 10);
  return 10 * Math.log10(s);
}

export function planeStats(maps) {
  let mx = -1e9, mn = 1e9, sum = 0, n = 0;
  for (const m of maps) for (const v of m.vals) { mx = Math.max(mx, v); mn = Math.min(mn, v); sum += v; n++; }
  return { max: mx, min: mn, mean: sum / Math.max(n, 1), spread: mx - mn };
}

/* audience sample points along the depth centre line of every plane */
export function audienceLine(planes, n = 60, ear = 1.7) {
  const pts = [];
  for (const p of planes) {
    if (p.mute) continue;
    for (let j = 0; j < n; j++) {
      const v = j / (n - 1);
      const [x, y, z] = planePoint(p, 0.5, v);
      pts.push({ x, y, z: z + ear, plane: p, v, dist: Math.hypot(x, y) });
    }
  }
  return pts.sort((a, b) => a.dist - b.dist);
}

/* ---------------- ArrayProcessing ----------------
   Per-cabinet level shading plus air-absorption compensation, solved
   against the real coherent prediction over the listening planes.   */
export function makeArrayProcessing(frames, planes, env, strength = 1) {
  const pts = audienceLine(planes, 14);
  if (!pts.length || !frames.length) return null;
  const bands = [125, 500, 2000, 8000];
  const gains = new Float64Array(frames.length);
  const apFn = (fr) => gains[fr.idx] || 0;

  // which seats does each cabinet dominate?
  const solo = frames.map(fr => pts.map(p => {
    let s = 0;
    for (const f of bands) s += Math.pow(10, (bandSpl([fr], p.x, p.y, p.z, f, env, null, 1) + aWeight(f)) / 10);
    return 10 * Math.log10(s);
  }));
  const zones = frames.map(() => []);
  pts.forEach((_, pi) => {
    let best = 0, bl = -1e9;
    frames.forEach((fr, i) => { if (!fr.mute && solo[i][pi] > bl) { bl = solo[i][pi]; best = i; } });
    zones[best].push(pi);
  });

  const level = (p) => {
    let s = 0;
    for (const f of bands) s += Math.pow(10, (bandSpl(frames, p.x, p.y, p.z, f, env, apFn, 1) + aWeight(f)) / 10);
    return 10 * Math.log10(s);
  };
  for (let it = 0; it < 6; it++) {
    const L = pts.map(level);
    const target = L.reduce((a, b) => a + b, 0) / L.length;
    let moved = 0;
    frames.forEach((fr, i) => {
      if (!zones[i].length || fr.mute) return;
      const cur = zones[i].reduce((a, pi) => a + L[pi], 0) / zones[i].length;
      const step = Math.max(-3, Math.min(3, (target - cur) * 0.6 * strength));
      const before = gains[i];
      gains[i] = Math.max(-12, Math.min(3, gains[i] + step));
      moved += Math.abs(gains[i] - before);
    });
    if (moved < 0.3) break;
  }
  const top = Math.max(...gains);
  for (let i = 0; i < gains.length; i++) gains[i] = Math.max(-14, gains[i] - top);

  const zoneDist = frames.map((fr, i) => zones[i].length
    ? zones[i].reduce((a, pi) => a + Math.hypot(pts[pi].x - fr.cx, pts[pi].y - fr.cy, pts[pi].z - fr.cz), 0) / zones[i].length
    : null);
  const dMax = Math.max(1, ...zoneDist.filter(d => d != null));

  const fn = (fr, f) => {
    const d = zoneDist[fr.idx];
    const air = d == null ? 0 : Math.min(6, airAlpha(f, env.temp, env.humidity) * (dMax - d)) * strength;
    return (gains[fr.idx] || 0) + air;
  };
  fn.gains = gains; fn.zoneDist = zoneDist;
  return fn;
}

/* ---------------- automatic splay ---------------- */
export function autoSplay(src, planes, env, onStep) {
  const n = src.cabs.length;
  if (n < 2) return src;
  const cab = CABINETS[src.cabType];
  const pts = audienceLine(planes, 9);
  if (!pts.length) return src;
  const bands = [125, 500, 2000, 8000];
  const clamp = (v) => Math.max(cab.splayMin, Math.min(cab.splayMax, Math.round(v * 2) / 2));

  const cost = () => {
    const fr = buildSource(src);
    const L = pts.map(p => {
      let s = 0;
      for (const f of bands) s += Math.pow(10, (bandSpl(fr, p.x, p.y, p.z, f, env, null, 3) + aWeight(f)) / 10);
      return 10 * Math.log10(s);
    });
    const mean = L.reduce((a, b) => a + b, 0) / L.length;
    const sd = Math.sqrt(L.reduce((a, v) => a + (v - mean) ** 2, 0) / L.length);
    return (Math.max(...L) - Math.min(...L)) + 1.2 * sd - 0.08 * mean;
  };

  const saved = { tilt: src.tilt, sp: src.cabs.map(c => c.splay) };
  const c0 = cost();

  // geometric seed: aim each box, from its own place in the stack, at an
  // equal distance-weighted share of the audience
  const w = pts.map(p => 1 / Math.max(Math.hypot(p.x - src.x, p.y - src.y, p.z - src.z), 1));
  const tot = w.reduce((a, b) => a + b, 0), share = tot / n;
  const aims = []; let acc = 0, take = share / 2;
  pts.forEach((p, i) => { acc += w[i]; if (acc >= take && aims.length < n) { aims.push(p); take += share; } });
  while (aims.length < n) aims.push(pts[pts.length - 1]);
  aims.reverse();
  let px = src.x, py = src.y, pz = src.z, prev = null;
  const az = (src.azimuth || 0) * Math.PI / 180, ex = [Math.cos(az), Math.sin(az)];
  for (let i = 0; i < n; i++) {
    const p = aims[i];
    const along = (p.x - px) * ex[0] + (p.y - py) * ex[1];
    const want = -Math.atan2(p.z - pz, along) * 180 / Math.PI;
    let ang;
    if (!i) { ang = Math.max(-12, Math.min(55, want)); src.tilt = +ang.toFixed(1); }
    else { src.cabs[i].splay = clamp(want - prev); ang = prev + src.cabs[i].splay; }
    const a = -ang * Math.PI / 180;
    px += ex[0] * Math.sin(a) * cab.h; py += ex[1] * Math.sin(a) * cab.h; pz -= Math.cos(a) * cab.h;
    prev = ang;
  }
  const cand = [{ t: src.tilt, s: src.cabs.map(c => c.splay), c: cost() }, { t: saved.tilt, s: saved.sp, c: c0 }];
  const seedTilt = src.tilt;
  for (const shape of [1, 2, 3, 'ramp']) {
    const sp = src.cabs.map((c, i) => !i ? 0 : clamp(shape === 'ramp' ? 0.5 + (i / (n - 1)) * 7 : shape));
    src.tilt = seedTilt; sp.forEach((v, i) => src.cabs[i].splay = v);
    cand.push({ t: src.tilt, s: sp, c: cost() });
  }
  const best = cand.reduce((a, b) => b.c < a.c ? b : a);
  src.tilt = best.t; best.s.forEach((v, i) => src.cabs[i].splay = v);

  let cur = cost();
  const steps = [2, 1, 0.5];
  for (let pass = 0; pass < steps.length; pass++) {
    for (const s of [steps[pass], -steps[pass]]) {
      const old = src.tilt;
      src.tilt = +Math.max(-12, Math.min(55, old + s)).toFixed(1);
      const c2 = cost(); if (c2 < cur - 0.01) cur = c2; else src.tilt = old;
    }
    for (let i = 1; i < n; i++) {
      for (const s of [steps[pass], -steps[pass]]) {
        const old = src.cabs[i].splay, v = clamp(old + s);
        if (v === old) continue;
        src.cabs[i].splay = v;
        const c2 = cost(); if (c2 < cur - 0.01) cur = c2; else src.cabs[i].splay = old;
      }
    }
    if (onStep) onStep((pass + 1) / steps.length);
  }
  return src;
}

/* ---------------- rigging / mechanics ----------------
   Simple statics for a flown array on a two-point bumper: centre of
   gravity, resulting pick-point forces and load-limit check.        */
export function rigging(src) {
  const cab = CABINETS[src.cabType];
  const frames = buildSource(src);
  const n = frames.length;
  const weight = n * cab.kg;
  let mx = 0, mz = 0;
  for (const f of frames) {
    // cabinet centre of mass, roughly at the middle of its depth
    const along = (f.cx - src.x) * Math.cos((src.azimuth || 0) * Math.PI / 180)
      + (f.cy - src.y) * Math.sin((src.azimuth || 0) * Math.PI / 180);
    mx += (along - Math.cos(-f.angle * Math.PI / 180) * cab.d * 0.45) * cab.kg;
    mz += (f.cz - src.z) * cab.kg;
  }
  const cogX = weight ? mx / weight : 0;
  const cogZ = weight ? mz / weight : 0;
  // two pick points on the bumper, front and rear
  const front = 0.05, rear = -0.85;          // pick points on the bumper, metres from the array face
  const span = front - rear;
  const fRear = weight * 9.81 * (front - cogX) / span;
  const fFront = weight * 9.81 - fRear;
  const limit = 1250 * 9.81;                  // working load limit of one pick point, N
  return {
    n, weight, cogX, cogZ,
    forceFront: fFront, forceRear: fRear,
    loadPct: 100 * Math.max(fFront, fRear) / limit,
    length: n * cab.h,
    topAngle: frames.length ? frames[0].angle : 0,
    botAngle: frames.length ? frames[frames.length - 1].angle : 0,
    totalSplay: frames.reduce((a, f, i) => a + (i ? f.splay : 0), 0),
    ok: Math.max(fFront, fRear) < limit && frames.every((f, i) => !i || f.splay <= cab.splayMax)
  };
}

/* ---------------- sub arrays (horizontal plane) ---------------- */
export const SUB_MODES = { broadside: 'Broadside', cardioid: 'Cardioid', endfire: 'End-fire', arc: 'Arc', lr: 'L / R stacks' };
export function buildSubArray(cfg) {
  const c = soundSpeed(cfg.temp ?? 20), out = [];
  const n = cfg.count, sp = cfg.spacing, span = (n - 1) * sp;
  if (cfg.mode === 'broadside' || cfg.mode === 'arc') {
    for (let i = 0; i < n; i++) {
      const x = -span / 2 + i * sp;
      const bow = cfg.mode === 'arc' ? -Math.pow(x / (span / 2 || 1), 2) * cfg.arcDepth : 0;
      out.push({ x, y: bow, gain: 0, delayMs: 0, pol: 1 });
    }
  } else if (cfg.mode === 'lr') {
    const per = Math.max(1, Math.floor(n / 2));
    for (let s = 0; s < 2; s++) for (let i = 0; i < per; i++)
      out.push({ x: (s ? 1 : -1) * cfg.lrSpan / 2 + (i - (per - 1) / 2) * sp * 0.4, y: 0, gain: 0, delayMs: 0, pol: 1 });
  } else if (cfg.mode === 'endfire') {
    const rows = cfg.depth, per = Math.max(1, Math.floor(n / rows));
    const maxBack = (rows - 1) * cfg.efSpacing;
    for (let d = 0; d < rows; d++) {
      const back = d * cfg.efSpacing;
      for (let i = 0; i < per; i++)
        out.push({ x: -((per - 1) * sp) / 2 + i * sp, y: -back, gain: 0, delayMs: (maxBack - back) / c * 1000, pol: 1 });
    }
  } else {
    const pairs = Math.max(1, Math.floor(n / 2));
    for (let i = 0; i < pairs; i++) {
      const x = -((pairs - 1) * sp) / 2 + i * sp;
      out.push({ x, y: 0, gain: 0, delayMs: 0, pol: 1 });
      out.push({ x, y: -cfg.cardDepth, gain: cfg.cardGain, delayMs: cfg.cardDepth / c * 1000 + (cfg.cardDelay || 0), pol: -1 });
    }
  }
  return out;
}
export function subPolar(subs, f, env, radius = 60, steps = 181) {
  const k = 2 * Math.PI * f / soundSpeed(env.temp), out = [];
  for (let i = 0; i < steps; i++) {
    const ang = (i / (steps - 1)) * 360 - 180, a = ang * Math.PI / 180;
    const px = Math.sin(a) * radius, py = Math.cos(a) * radius;  // 0deg = towards audience (+y)
    let re = 0, im = 0;
    for (const s of subs) {
      const r = Math.max(Math.hypot(px - s.x, py - s.y), 0.5);
      const amp = s.pol * Math.pow(10, s.gain / 20) / r;
      const ph = -k * r - 2 * Math.PI * f * s.delayMs / 1000;
      re += amp * Math.cos(ph); im += amp * Math.sin(ph);
    }
    out.push({ ang, L: 20 * Math.log10(Math.max(Math.hypot(re, im), 1e-9)) });
  }
  const mx = Math.max(...out.map(o => o.L));
  return out.map(o => ({ ...o, rel: o.L - mx }));
}
export function frontToBack(subs, f, env) {
  const p = subPolar(subs, f, env, 60, 361);
  return p.find(o => Math.abs(o.ang) < 1).L - p.find(o => Math.abs(Math.abs(o.ang) - 180) < 1).L;
}

/* ---------------- NoizCalc handover ---------------- */
export function emissionSpectrum(frames, env, ap, cal) {
  const bands = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000];
  const A = [-39.4, -26.2, -16.1, -8.6, -3.2, 0, 1.2, 1.0, -1.1];
  const spec = bands.map(f => bandSpl(frames, cal.x, cal.y, cal.z, Math.max(f, 40), env, ap, 3));
  const ref = 10 * Math.log10(spec.reduce((a, L, i) => a + Math.pow(10, (L + A[i]) / 10), 0));
  return { bands, spec, refLevel: ref, shape: spec.map(L => +(L - ref).toFixed(1)) };
}

