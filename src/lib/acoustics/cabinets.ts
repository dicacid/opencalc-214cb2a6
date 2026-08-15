/* ==========================================================
   Cabinet library.

   Data is taken from publicly published manufacturer datasheets and
   rigging manuals. Nothing proprietary is embedded here: no measured
   balloon data, no manufacturer FIR/processing presets. Values that
   could not be confirmed from a public document are flagged with
   `estimated: true` and are shown as approximate in the UI.

   `balloons` is a placeholder slot for user-supplied GLL/.gsd data in
   a later sprint; the solver treats `null` as "use the analytical
   line-source model".
   ========================================================== */

export type CabinetKind = "array" | "point" | "sub";
export type Mounting = "flown" | "stacked" | "stack-only";

export interface Cabinet {
  series: string;
  family?: string;
  kind: CabinetKind;
  h: number;
  w: number;
  d: number;
  kg: number;
  hCov: number;
  vCov?: number;
  splayMin: number;
  splayMax: number;
  qtyMax?: number;
  rigFrame?: string;
  mounting?: Mounting;
  lowCut: number;
  hiCut?: number;
  /** legacy: cabinets served per amplifier (kept for parts-list compatibility) */
  amp: number;
  /** amplifier channels consumed by one cabinet */
  ampCh?: number;
  ampModel?: string;
  ampMode?: string;
  cardioid?: boolean;
  maxSplOct: Record<number, number>;
  voicing?: { lowCut?: number; coupling?: number; hfComp?: number };
  balloons?: null;
  estimated?: boolean;
  source?: string;
}

const dbSource = "d&b audiotechnik published datasheet / rigging manual";

export const CABINETS: Record<string, Cabinet> = {
  /* ---------------- d&b Y-Series ---------------- */
  Y8: {
    series: "Y-Series",
    family: "Y",
    kind: "array",
    h: 0.34,
    w: 0.72,
    d: 0.44,
    kg: 34,
    hCov: 80,
    splayMin: 0,
    splayMax: 7,
    qtyMax: 24,
    rigFrame: "Y-Series flying frame",
    mounting: "flown",
    lowCut: 54,
    hiCut: 18000,
    amp: 2,
    ampCh: 2,
    ampModel: "D80",
    ampMode: "2-Way Active",
    maxSplOct: {
      63: 122,
      125: 132,
      250: 136,
      500: 138,
      1000: 138,
      2000: 137,
      4000: 136,
      8000: 133,
    },
    voicing: { lowCut: -12, coupling: 6, hfComp: 6 },
    balloons: null,
    estimated: true,
    source: dbSource + " (54 Hz – 19 kHz, 134 dB SPLmax @ 1 m; per-band figures approximate)",
  },
  Y12: {
    series: "Y-Series",
    family: "Y",
    kind: "array",
    h: 0.34,
    w: 0.72,
    d: 0.44,
    kg: 35,
    hCov: 120,
    splayMin: 0,
    splayMax: 14,
    qtyMax: 24,
    rigFrame: "Y-Series flying frame",
    mounting: "flown",
    lowCut: 54,
    hiCut: 18000,
    amp: 2,
    ampCh: 2,
    ampModel: "D80",
    ampMode: "2-Way Active",
    maxSplOct: {
      63: 123,
      125: 133,
      250: 137,
      500: 139,
      1000: 140,
      2000: 139,
      4000: 138,
      8000: 135,
    },
    voicing: { lowCut: -12, coupling: 6, hfComp: 6 },
    balloons: null,
    estimated: true,
    source: dbSource + " (54 Hz – 19 kHz, 137 dB SPLmax @ 1 m; per-band figures approximate)",
  },

  /* ---------------- d&b subwoofers ---------------- */
  "V-SUB": {
    series: "V-Series",
    family: "V",
    kind: "sub",
    h: 0.44,
    w: 1.05,
    d: 0.75,
    kg: 62,
    hCov: 360,
    splayMin: 0,
    splayMax: 0,
    mounting: "stacked",
    lowCut: 37,
    hiCut: 115,
    amp: 2,
    ampCh: 1,
    ampModel: "D80",
    ampMode: "Dual Channel",
    cardioid: true,
    maxSplOct: {
      31.5: 128,
      63: 138,
      125: 137,
      250: 118,
      500: 98,
      1000: 88,
      2000: 83,
      4000: 78,
      8000: 73,
    },
    balloons: null,
    estimated: true,
    source: dbSource + " (cardioid 18\" + passive radiator, 37 Hz – 115/95 Hz, 137 dB @ 1 m)",
  },
  "J-INFRA": {
    series: "J-Series",
    family: "J",
    kind: "sub",
    h: 0.84,
    w: 1.2,
    d: 1.0,
    kg: 152,
    hCov: 360,
    splayMin: 0,
    splayMax: 0,
    mounting: "stack-only",
    lowCut: 27,
    hiCut: 80,
    amp: 2,
    ampCh: 1,
    ampModel: "D80",
    ampMode: "Dual Channel (ground stack)",
    maxSplOct: {
      31.5: 138,
      63: 142,
      125: 122,
      250: 104,
      500: 94,
      1000: 86,
      2000: 80,
      4000: 75,
      8000: 70,
    },
    balloons: null,
    estimated: true,
    source: dbSource + " (infra sub, 27 Hz – 80 Hz, ground stack only, paired with J-SUB)",
  },

  /* ---------------- generic reference boxes ---------------- */
  XA12: {
    series: "Generic",
    kind: "array",
    h: 0.372,
    w: 1.34,
    d: 0.75,
    kg: 100,
    hCov: 90,
    splayMin: 0,
    splayMax: 14,
    qtyMax: 24,
    mounting: "flown",
    lowCut: 45,
    amp: 2,
    ampCh: 2,
    maxSplOct: {
      63: 133,
      125: 140,
      250: 143,
      500: 145,
      1000: 145,
      2000: 144,
      4000: 143,
      8000: 140,
    },
    balloons: null,
    estimated: true,
  },
  XA10: {
    series: "Generic",
    kind: "array",
    h: 0.324,
    w: 1.1,
    d: 0.66,
    kg: 70,
    hCov: 80,
    splayMin: 0,
    splayMax: 14,
    qtyMax: 24,
    mounting: "flown",
    lowCut: 50,
    amp: 2,
    ampCh: 2,
    maxSplOct: {
      63: 129,
      125: 137,
      250: 141,
      500: 143,
      1000: 143,
      2000: 142,
      4000: 141,
      8000: 138,
    },
    balloons: null,
    estimated: true,
  },
  MA8: {
    series: "Generic",
    kind: "array",
    h: 0.24,
    w: 0.86,
    d: 0.5,
    kg: 38,
    hCov: 90,
    splayMin: 0,
    splayMax: 16,
    qtyMax: 24,
    mounting: "flown",
    lowCut: 65,
    amp: 4,
    ampCh: 2,
    maxSplOct: {
      63: 121,
      125: 132,
      250: 137,
      500: 139,
      1000: 139,
      2000: 138,
      4000: 137,
      8000: 134,
    },
    balloons: null,
    estimated: true,
  },
  MA5: {
    series: "Generic",
    kind: "array",
    h: 0.17,
    w: 0.62,
    d: 0.36,
    kg: 17,
    hCov: 100,
    splayMin: 0,
    splayMax: 16,
    qtyMax: 24,
    mounting: "flown",
    lowCut: 90,
    amp: 4,
    ampCh: 2,
    maxSplOct: {
      63: 110,
      125: 124,
      250: 131,
      500: 134,
      1000: 135,
      2000: 134,
      4000: 132,
      8000: 129,
    },
    balloons: null,
    estimated: true,
  },
  P12: {
    series: "Generic point source",
    kind: "point",
    h: 0.6,
    w: 0.4,
    d: 0.45,
    kg: 30,
    hCov: 75,
    vCov: 40,
    splayMin: 0,
    splayMax: 30,
    lowCut: 60,
    amp: 4,
    ampCh: 1,
    maxSplOct: {
      63: 122,
      125: 132,
      250: 136,
      500: 138,
      1000: 139,
      2000: 138,
      4000: 137,
      8000: 133,
    },
    balloons: null,
    estimated: true,
  },
  P8: {
    series: "Generic point source",
    kind: "point",
    h: 0.46,
    w: 0.3,
    d: 0.34,
    kg: 17,
    hCov: 90,
    vCov: 60,
    splayMin: 0,
    splayMax: 40,
    lowCut: 75,
    amp: 4,
    ampCh: 1,
    maxSplOct: {
      63: 112,
      125: 126,
      250: 132,
      500: 134,
      1000: 135,
      2000: 134,
      4000: 133,
      8000: 129,
    },
    balloons: null,
    estimated: true,
  },
  "B2-SUB": {
    series: "Generic subwoofer",
    kind: "sub",
    h: 0.62,
    w: 1.2,
    d: 0.85,
    kg: 100,
    hCov: 360,
    splayMin: 0,
    splayMax: 0,
    mounting: "stacked",
    lowCut: 30,
    hiCut: 100,
    amp: 2,
    ampCh: 1,
    maxSplOct: {
      31.5: 136,
      63: 142,
      125: 140,
      250: 120,
      500: 100,
      1000: 90,
      2000: 85,
      4000: 80,
      8000: 75,
    },
    balloons: null,
    estimated: true,
  },
};

export const CAB_LIST = Object.keys(CABINETS);

/* ---------------- amplifier model ----------------
   The amplifier is a resource budget, not a radiator. Figures are the
   published D80 specification. */
export interface AmpModel {
  id: string;
  channels: number;
  powerPerCh: string;
  modes: string[];
  delayMs: number;
  peqBands: number;
}

export const AMPS: Record<string, AmpModel> = {
  D80: {
    id: "D80",
    channels: 4,
    powerPerCh: "4 × 4000 W @ 4 Ω",
    modes: ["Dual Channel", "2-Way Active", "Mix TOP/SUB"],
    delayMs: 10000,
    peqBands: 16,
  },
  D20: {
    id: "D20",
    channels: 4,
    powerPerCh: "4 × 1600 W @ 4 Ω",
    modes: ["Dual Channel", "2-Way Active", "Mix TOP/SUB"],
    delayMs: 10000,
    peqBands: 16,
  },
};

/** amplifier channels consumed by one cabinet of this type */
export const ampChannels = (cabType: string): number =>
  CABINETS[cabType]?.ampCh ?? 1;

/** amplifier model driving this cabinet type */
export const ampModelOf = (cabType: string): string =>
  CABINETS[cabType]?.ampModel ?? "D20";

/** how many amplifiers a quantity of cabinets needs */
export function ampsRequired(cabType: string, qty: number): number {
  const model = AMPS[ampModelOf(cabType)] ?? AMPS["D20"]!;
  return Math.ceil((qty * ampChannels(cabType)) / model.channels);
}

/* ---------------- validation ---------------- */
export interface RigIssue {
  level: "error" | "warn";
  msg: string;
}

export function validateSource(src: {
  cabType: string;
  kind?: string;
  mounting?: string;
  cabs?: { splay?: number }[];
  sub?: { count?: number; stack?: number };
}): RigIssue[] {
  const cab = CABINETS[src.cabType];
  const out: RigIssue[] = [];
  if (!cab) return out;
  const flown = src.mounting === "flown";
  if (flown && cab.mounting === "stack-only")
    out.push({ level: "error", msg: `${src.cabType} is ground-stack only and cannot be flown.` });
  if (flown && cab.kind === "sub" && cab.mounting === "stacked")
    out.push({ level: "warn", msg: `${src.cabType} is normally ground stacked.` });
  const cabs = src.cabs ?? [];
  cabs.forEach((c, i) => {
    if (!i) return;
    const s = c.splay ?? 0;
    if (s < cab.splayMin || s > cab.splayMax)
      out.push({
        level: "error",
        msg: `Cabinet ${i + 1}: splay ${s}° outside ${cab.splayMin}–${cab.splayMax}° for ${src.cabType}.`,
      });
  });
  const qty = src.kind === "sub" ? (src.sub?.count ?? 0) * (src.sub?.stack ?? 1) : cabs.length;
  if (cab.qtyMax && qty > cab.qtyMax)
    out.push({ level: "warn", msg: `${qty} × ${src.cabType} exceeds the published maximum of ${cab.qtyMax} per hang.` });
  if (src.cabType === "J-INFRA" && (src.sub?.stack ?? 1) > 2)
    out.push({ level: "error", msg: "J-INFRA ground stacks are limited to two high." });
  return out;
}

export function splayLimit(cabType: string): number {
  return CABINETS[cabType]?.splayMax ?? 14;
}

/* ---------------- SPL capability ---------------- */
export function maxSplAt(cab: Cabinet, f: number): number {
  const keys = Object.keys(cab.maxSplOct).map(Number).sort((a, b) => a - b);
  const lo = keys[0]!,
    hi = keys[keys.length - 1]!;
  let v = 0;
  if (f <= lo) v = cab.maxSplOct[lo]!;
  else if (f >= hi) v = cab.maxSplOct[hi]! - 6 * Math.log2(f / hi);
  else {
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i]!,
        b = keys[i + 1]!;
      if (f >= a && f <= b) {
        const t = Math.log2(f / a) / Math.log2(b / a);
        v = cab.maxSplOct[a]! * (1 - t) + cab.maxSplOct[b]! * t;
        break;
      }
    }
  }
  if (f < cab.lowCut) v += 24 * Math.log2(f / cab.lowCut);
  if (cab.hiCut && f > cab.hiCut) v -= 24 * Math.log2(f / cab.hiCut);
  return v;
}

/* Generic voicing filters: low cut, coupling compensation, HF compensation.
   These are ordinary shelving curves, not any manufacturer preset. */
export function voicingGain(
  fr: { cut?: boolean; cpl?: number; hfc?: number },
  f: number,
): number {
  let g = 0;
  if (fr.cut) g -= 12 * Math.max(0, Math.log2(160 / Math.max(f, 20)));
  if (fr.cpl) g += fr.cpl * Math.max(0, Math.min(1, Math.log2(400 / Math.max(f, 40)) / 3));
  if (fr.hfc) g += fr.hfc * Math.max(0, Math.min(1, Math.log2(Math.max(f, 500) / 2000) / 2));
  return g;
}
