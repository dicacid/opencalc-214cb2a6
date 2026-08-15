/* ==========================================================
   User cabinet library.

   Lets any user enter their own loudspeaker spec sheet (manually,
   from JSON, from CSV, or extracted from a datasheet) and use it in
   the prediction exactly like a built-in cabinet.
   ========================================================== */

import { CABINETS, CAB_LIST, type Cabinet, type CabinetKind } from "./cabinets";

export const SPL_BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000] as const;

export interface UserCabinet {
  key: string;
  name: string;
  manufacturer?: string;
  spec: Cabinet;
}

const LS_KEY = "arraycalc.userCabinets.v1";

const num = (v: unknown, d?: number): number | undefined => {
  if (v === null || v === undefined || v === "") return d;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) ? n : d;
};

export interface NormalizeResult {
  ok: boolean;
  errors: string[];
  cabinet?: UserCabinet;
}

/** Coerce an arbitrary raw record (form, JSON, CSV row, AI extraction) into a Cabinet. */
export function normalizeSpec(raw: Record<string, unknown>): NormalizeResult {
  const errors: string[] = [];
  const key = String(raw["key"] ?? raw["cab_key"] ?? raw["model"] ?? raw["name"] ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-");
  if (!key) errors.push("Model / key is required.");
  if (key.length > 24) errors.push("Model key must be 24 characters or fewer.");

  const manufacturer = String(raw["manufacturer"] ?? raw["brand"] ?? "").trim();
  const name = String(raw["name"] ?? key).trim();

  const kindRaw = String(raw["kind"] ?? "array").toLowerCase();
  const kind: CabinetKind = kindRaw.startsWith("sub")
    ? "sub"
    : kindRaw.startsWith("point")
      ? "point"
      : "array";

  const maxSplOct: Record<number, number> = {};
  for (const b of SPL_BANDS) {
    const v =
      num(raw[`spl${b}`]) ??
      num(raw[`spl_${b}`]) ??
      num((raw["maxSplOct"] as Record<string, unknown> | undefined)?.[String(b)]);
    if (v !== undefined) maxSplOct[b] = v;
  }
  if (Object.keys(maxSplOct).length < 2) {
    const flat = num(raw["splMax"]) ?? num(raw["maxSpl"]);
    if (flat !== undefined) {
      // A single published SPLmax figure: shape a plausible curve around it.
      const shape: Record<number, number> = {
        31.5: -18, 63: -12, 125: -4, 250: -1, 500: 0, 1000: 0, 2000: -1, 4000: -2, 8000: -5,
      };
      for (const b of SPL_BANDS) maxSplOct[b] = flat + shape[b]!;
    } else {
      errors.push("Provide SPLmax per octave band, or a single SPLmax figure.");
    }
  }

  const h = num(raw["h"] ?? raw["height"]);
  const w = num(raw["w"] ?? raw["width"]);
  const d = num(raw["d"] ?? raw["depth"]);
  const kg = num(raw["kg"] ?? raw["weight"]);
  const hCov = num(raw["hCov"] ?? raw["horizontalCoverage"], kind === "sub" ? 360 : undefined);
  const lowCut = num(raw["lowCut"] ?? raw["fLow"] ?? raw["lowFreq"]);

  if (!h || h <= 0) errors.push("Cabinet height (m) is required.");
  if (!w || w <= 0) errors.push("Cabinet width (m) is required.");
  if (!d || d <= 0) errors.push("Cabinet depth (m) is required.");
  if (!kg || kg <= 0) errors.push("Weight (kg) is required.");
  if (!hCov || hCov <= 0) errors.push("Horizontal coverage (°) is required.");
  if (!lowCut || lowCut <= 0) errors.push("Low cut-off frequency (Hz) is required.");

  if (errors.length) return { ok: false, errors };

  const mountingRaw = String(raw["mounting"] ?? (kind === "sub" ? "stacked" : "flown"));
  const spec: Cabinet = {
    series: manufacturer ? `${manufacturer} (user)` : "User library",
    family: manufacturer || "User",
    kind,
    h: h!,
    w: w!,
    d: d!,
    kg: kg!,
    hCov: hCov!,
    splayMin: num(raw["splayMin"], 0)!,
    splayMax: num(raw["splayMax"], kind === "array" ? 10 : 0)!,
    mounting: (["flown", "stacked", "stack-only"].includes(mountingRaw)
      ? (mountingRaw as "flown" | "stacked" | "stack-only")
      : "flown"),

    lowCut: lowCut!,
    amp: num(raw["amp"], 2)!,
    ampCh: num(raw["ampCh"] ?? raw["ampChannels"], kind === "array" ? 2 : 1)!,
    cardioid: raw["cardioid"] === true || String(raw["cardioid"] ?? "").toLowerCase() === "true",
    maxSplOct,
    balloons: null,
    estimated: true,
    source: (raw["source"] as string) || "User supplied spec sheet",
  };
  const vCov = num(raw["vCov"] ?? raw["verticalCoverage"]);
  if (vCov !== undefined) spec.vCov = vCov;
  const qtyMax = num(raw["qtyMax"]);
  if (qtyMax !== undefined) spec.qtyMax = qtyMax;
  const hiCut = num(raw["hiCut"] ?? raw["fHigh"] ?? raw["highFreq"]);
  if (hiCut !== undefined) spec.hiCut = hiCut;
  if (raw["rigFrame"]) spec.rigFrame = String(raw["rigFrame"]);
  if (raw["ampModel"]) spec.ampModel = String(raw["ampModel"]);
  if (raw["ampMode"]) spec.ampMode = String(raw["ampMode"]);


  return { ok: true, errors: [], cabinet: { key, name: name || key, manufacturer, spec } };
}

/* ---------------- registry ---------------- */
const registered = new Map<string, UserCabinet>();

export function registerCabinet(cab: UserCabinet): void {
  CABINETS[cab.key] = cab.spec;
  if (!CAB_LIST.includes(cab.key)) CAB_LIST.push(cab.key);
  registered.set(cab.key, cab);
}

export function unregisterCabinet(key: string): void {
  if (!registered.has(key)) return;
  registered.delete(key);
  delete CABINETS[key];
  const i = CAB_LIST.indexOf(key);
  if (i >= 0) CAB_LIST.splice(i, 1);
}

export const userCabinets = (): UserCabinet[] => [...registered.values()];
export const isUserCabinet = (key: string): boolean => registered.has(key);

/* ---------------- local persistence (offline cache) ---------------- */
export function saveLocal(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(userCabinets()));
  } catch {
    /* storage unavailable */
  }
}

export function loadLocal(): UserCabinet[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as UserCabinet[];
    list.forEach((c) => c?.key && c?.spec && registerCabinet(c));
    return userCabinets();
  } catch {
    return [];
  }
}

/* ---------------- JSON import / export ---------------- */
export function toJSON(list: UserCabinet[] = userCabinets()): string {
  return JSON.stringify({ format: "arraycalc-cabinets", version: 1, cabinets: list }, null, 1);
}

export function parseJSONLibrary(text: string): { cabinets: UserCabinet[]; errors: string[] } {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { cabinets: [], errors: ["File is not valid JSON."] };
  }
  const rows: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : (((data as Record<string, unknown>)["cabinets"] as Record<string, unknown>[]) ?? [
        data as Record<string, unknown>,
      ]);
  const cabinets: UserCabinet[] = [];
  rows.forEach((row, i) => {
    // Accept both the export shape ({key,name,spec}) and a flat spec object.
    const flat: Record<string, unknown> =
      row && typeof row === "object" && row["spec"]
        ? { ...(row["spec"] as Record<string, unknown>), key: row["key"], name: row["name"], manufacturer: row["manufacturer"] }
        : row;
    const res = normalizeSpec(flat);
    if (res.ok && res.cabinet) cabinets.push(res.cabinet);
    else errors.push(`Entry ${i + 1}: ${res.errors.join(" ")}`);
  });
  return { cabinets, errors };
}

/* ---------------- CSV import / export ---------------- */
export const CSV_COLUMNS = [
  "key", "name", "manufacturer", "kind", "h", "w", "d", "kg", "hCov", "vCov",
  "splayMin", "splayMax", "qtyMax", "mounting", "lowCut", "hiCut", "ampCh", "ampModel",
  ...SPL_BANDS.map((b) => `spl${b}`),
];

export function toCSV(list: UserCabinet[] = userCabinets()): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const c of list) {
    const s = c.spec;
    const row: Record<string, unknown> = {
      key: c.key, name: c.name, manufacturer: c.manufacturer ?? "", kind: s.kind,
      h: s.h, w: s.w, d: s.d, kg: s.kg, hCov: s.hCov, vCov: s.vCov ?? "",
      splayMin: s.splayMin, splayMax: s.splayMax, qtyMax: s.qtyMax ?? "",
      mounting: s.mounting ?? "", lowCut: s.lowCut, hiCut: s.hiCut ?? "",
      ampCh: s.ampCh ?? "", ampModel: s.ampModel ?? "",
    };
    for (const b of SPL_BANDS) row[`spl${b}`] = s.maxSplOct[b] ?? "";
    lines.push(CSV_COLUMNS.map((k) => `${row[k] ?? ""}`).join(","));
  }
  return lines.join("\n");
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseCSV(text: string): { cabinets: UserCabinet[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { cabinets: [], errors: ["CSV needs a header row and at least one cabinet."] };
  const header = splitCsvLine(lines[0]!).map((h) => h.trim());
  const cabinets: UserCabinet[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const raw: Record<string, unknown> = {};
    header.forEach((h, j) => { if (cells[j] !== undefined && cells[j] !== "") raw[h] = cells[j]; });
    const res = normalizeSpec(raw);
    if (res.ok && res.cabinet) cabinets.push(res.cabinet);
    else errors.push(`Row ${i + 1}: ${res.errors.join(" ")}`);
  }
  return { cabinets, errors };
}
