/* Environment & weighting — ported verbatim from the original single-file tool.
   aWeight: IEC 61672 A-weighting. airAlpha: ISO 9613-1 two-relaxation air absorption. */
export const THIRD_OCT = [40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];
export const OCT = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
export const MAP_BANDS = [125, 500, 2000, 8000];

export function aWeight(f: number): number {
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 ** 2) /
    ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return 20 * Math.log10(ra) + 2.0;
}

export function airAlpha(f: number, tempC = 20, rh = 60, pressureKPa = 101.325): number {
  const T = tempC + 273.15, T0 = 293.15, T01 = 273.16, pa = pressureKPa, pr = 101.325;
  const psat = Math.pow(10, -6.8346 * Math.pow(T01 / T, 1.261) + 4.6151);
  const h = rh * psat / (pa / pr);
  const frO = (pa / pr) * (24 + 4.04e4 * h * (0.02 + h) / (0.391 + h));
  const frN = (pa / pr) * Math.pow(T / T0, -0.5) *
    (9 + 280 * h * Math.exp(-4.17 * (Math.pow(T0 / T, 1 / 3) - 1)));
  const f2 = f * f;
  return 8.686 * f2 * (1.84e-11 * (pr / pa) * Math.sqrt(T / T0) +
    Math.pow(T / T0, -2.5) * (
      0.01275 * Math.exp(-2239.1 / T) / (frO + f2 / frO) +
      0.1068 * Math.exp(-3352.0 / T) / (frN + f2 / frN)));
}
export const soundSpeed = (t: number) => 331.3 * Math.sqrt(1 + t / 273.15);
