/** Screening model for low-frequency subwoofer noise at a receptor.
 *  Logarithmic summation, geometric spreading, and user-entered corrections.
 *  Not an ISO 9613-2 terrain or meteorology model. */

export type Weighting = "A" | "C" | "Z";
export type SourceMode = "reference" | "power";
export type SumMode = "energy" | "coherent";
export type PropagationMode = "point" | "line";
export type AnalysisMode = "broadband" | "octave";

export const BAND_CENTRES = [31.5, 63, 125, 250] as const;
export type BandCentre = (typeof BAND_CENTRES)[number];

export const WEIGHTING: Record<Weighting, Record<BandCentre, number>> = {
  A: { 31.5: -39.4, 63: -26.2, 125: -16.1, 250: -8.6 },
  C: { 31.5: -3.0, 63: -0.8, 125: -0.2, 250: 0.0 },
  Z: { 31.5: 0, 63: 0, 125: 0, 250: 0 },
};

export function dbSum(levels: number[]): number {
  const finite = levels.filter(Number.isFinite);
  if (!finite.length) return Number.NaN;
  return 10 * Math.log10(finite.reduce((sum, level) => sum + 10 ** (level / 10), 0));
}

export interface SubwooferNoiseInput {
  analysisMode: AnalysisMode;
  sourceMode: SourceMode;
  referenceLevel: number;
  referenceDistance: number;
  inputWeighting: Weighting;
  sensitivity: number;
  power: number;
  sourceCount: number;
  sumMode: SumMode;
  receptorDistance: number;
  propagationMode: PropagationMode;
  directivityLoss: number;
  barrierLoss: number;
  facadeCorrection: number;
  uncertainty: number;
  criterion: number;
  criterionWeighting: Weighting;
  bands: Record<BandCentre, number>;
}

export interface SubwooferNoiseResult {
  sourceGain: number;
  spread: number;
  distanceLoss: number;
  correction: number;
  baseReference: number;
  broadband: number;
  broadbandWeighting: Weighting;
  receptorBands: Record<BandCentre, number>;
  octaveOverall: Record<Weighting, number>;
  activeWeighting: Weighting;
  predicted: number;
  margin: number;
  requiredDistance: number;
  lower: number;
  upper: number;
  cMinusA: number;
}

function safePositive(value: number, fallback = 1): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function predictSubwooferNoise(input: SubwooferNoiseInput): SubwooferNoiseResult {
  const count = Math.max(1, Math.round(safePositive(input.sourceCount, 1)));
  const sourceGain = (input.sumMode === "coherent" ? 20 : 10) * Math.log10(count);
  const spread = input.propagationMode === "point" ? 20 : 10;
  const targetDistance = safePositive(input.receptorDistance, 1);
  const refDistance =
    input.analysisMode === "octave"
      ? safePositive(input.referenceDistance, 1)
      : input.sourceMode === "power"
        ? 1
        : safePositive(input.referenceDistance, 1);
  const distanceLoss = spread * Math.log10(Math.max(targetDistance / refDistance, 1e-6));
  const correction =
    sourceGain -
    distanceLoss -
    Math.max(0, input.directivityLoss) -
    Math.max(0, input.barrierLoss) +
    input.facadeCorrection;

  const broadbandWeighting: Weighting = input.sourceMode === "power" ? "Z" : input.inputWeighting;
  const baseReference =
    input.analysisMode === "octave"
      ? dbSum(BAND_CENTRES.map((band) => input.bands[band]))
      : input.sourceMode === "power"
        ? input.sensitivity + 10 * Math.log10(safePositive(input.power, 1))
        : input.referenceLevel;
  const broadband = baseReference + correction;

  const receptorBands = Object.fromEntries(
    BAND_CENTRES.map((band) => [band, input.bands[band] + correction]),
  ) as Record<BandCentre, number>;

  const weighted = (weighting: Weighting) =>
    dbSum(BAND_CENTRES.map((band) => receptorBands[band] + WEIGHTING[weighting][band]));
  const octaveOverall = { A: weighted("A"), C: weighted("C"), Z: weighted("Z") };

  const activeWeighting = input.analysisMode === "broadband" ? broadbandWeighting : input.criterionWeighting;
  const predicted = input.analysisMode === "broadband" ? broadband : octaveOverall[activeWeighting];
  const margin = predicted - input.criterion;
  const requiredDistance = margin > 0 ? targetDistance * 10 ** (margin / spread) : targetDistance;

  return {
    sourceGain,
    spread,
    distanceLoss,
    correction,
    baseReference,
    broadband,
    broadbandWeighting,
    receptorBands,
    octaveOverall,
    activeWeighting,
    predicted,
    margin,
    requiredDistance,
    lower: predicted - Math.max(0, input.uncertainty),
    upper: predicted + Math.max(0, input.uncertainty),
    cMinusA: octaveOverall.C - octaveOverall.A,
  };
}
