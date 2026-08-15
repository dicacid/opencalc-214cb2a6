// @ts-nocheck
import { CABINETS } from "./cabinets";

/* ---------------- array geometry ----------------
   src = { type:'array'|'point'|'sub', cabType, x, y, z, azimuth, tilt,
           mounting:'flown'|'stacked', cabs:[{splay,level,delay,cut,cpl,hfc,mute}] }
   Frames are built down the face of the array, exactly as the
   mechanical stack behaves.                                            */
export function buildSource(src) {
  const out = [];
  const cab = CABINETS[src.cabType];
  const az = (src.azimuth || 0) * Math.PI / 180;
  const ex = [Math.cos(az), Math.sin(az)];    // horizontal on-axis direction (x,y)
  let angle = src.tilt;
  let topX = src.x, topY = src.y, topZ = src.z;
  for (let i = 0; i < src.cabs.length; i++) {
    const c = src.cabs[i];
    if (i > 0) angle += (c.splay || 0);
    const a = -angle * Math.PI / 180;
    // on-axis unit vector in 3D
    const n = [ex[0] * Math.cos(a), ex[1] * Math.cos(a), Math.sin(a)];
    // "down the face" unit vector
    const fdown = [ex[0] * Math.sin(a), ex[1] * Math.sin(a), -Math.cos(a)];
    const botX = topX + fdown[0] * cab.h, botY = topY + fdown[1] * cab.h, botZ = topZ + fdown[2] * cab.h;
    out.push({
      i, src, cab, cabType: src.cabType, angle, n, fdown, ex,
      topX, topY, topZ, botX, botY, botZ,
      cx: (topX + botX) / 2, cy: (topY + botY) / 2, cz: (topZ + botZ) / 2,
      level: (c.level || 0) + (src.gain || 0),
      delay: (c.delay || 0) + (src.delay || 0),
      cut: !!c.cut, cpl: c.cpl || 0, hfc: c.hfc || 0,
      mute: !!c.mute || !!src.mute, splay: c.splay || 0,
      pol: (c.pol || 1) * (src.pol || 1), hpf: src.hpf || 0, lpf: src.lpf || 0
    });
    topX = botX; topY = botY; topZ = botZ;
  }
  return out;
}
export function buildAll(sources) {
  const frames = [];
  for (const s of sources) for (const f of buildSource(s)) { f.idx = frames.length; frames.push(f); }
  return frames;
}

export const nSub = (h, lambda) => Math.max(3, Math.min(20, Math.ceil(h / (lambda * 0.25))));
export function segDir(k, L, theta) {
  const u = k * L * 0.5 * Math.sin(theta);
  const d = Math.abs(u) < 1e-9 ? 1 : Math.sin(u) / u;
  const ct = Math.cos(theta);
  return ct <= 0 ? Math.abs(d) * 0.03 : Math.abs(d) * Math.pow(ct, 0.35);
}
/* horizontal pattern: flat inside the nominal coverage, then rolling off */
export function horizDir(cab, phi) {
  const half = (cab.hCov || 90) / 2 * Math.PI / 180;
  if (cab.hCov >= 359) return 1;
  const t = Math.abs(phi) / half;
  if (t <= 1) return Math.pow(10, (-1.2 * t * t) / 20);
  return Math.pow(10, -Math.min(26, 6 + 14 * (t - 1)) / 20);
}
export function vertPointDir(cab, theta) {
  const half = (cab.vCov || 40) / 2 * Math.PI / 180;
  const t = Math.abs(theta) / half;
  if (t <= 1) return 1;
  return Math.pow(10, -Math.min(24, 12 * (t - 1)) / 20);
}
