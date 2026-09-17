import { useMemo, useState } from "react";

type Weighting = "A" | "C" | "Z";
type SourceMode = "reference" | "power";
type SumMode = "energy" | "coherent";
type PropagationMode = "point" | "line";
type AnalysisMode = "broadband" | "octave";

const BAND_CENTRES = [31.5, 63, 125, 250] as const;
type BandCentre = (typeof BAND_CENTRES)[number];

const WEIGHTING: Record<Weighting, Record<BandCentre, number>> = {
  A: { 31.5: -39.4, 63: -26.2, 125: -16.1, 250: -8.6 },
  C: { 31.5: -3.0, 63: -0.8, 125: -0.2, 250: 0.0 },
  Z: { 31.5: 0, 63: 0, 125: 0, 250: 0 },
};

function dbSum(levels: number[]) {
  const finite = levels.filter(Number.isFinite);
  if (!finite.length) return Number.NaN;
  return 10 * Math.log10(finite.reduce((sum, level) => sum + 10 ** (level / 10), 0));
}

function safePositive(value: number, fallback = 1) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function fmt(value: number, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function NumericField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <label className="sn-field">
      <span className="sn-label">{label}</span>
      <span className="sn-input-wrap">
        <input
          type="number"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {unit ? <span className="sn-unit">{unit}</span> : null}
      </span>
      {hint ? <span className="sn-hint">{hint}</span> : null}
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="sn-field">
      <span className="sn-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
      {hint ? <span className="sn-hint">{hint}</span> : null}
    </label>
  );
}

export function SubwooferNoiseCalculator() {
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("broadband");
  const [sourceMode, setSourceMode] = useState<SourceMode>("reference");
  const [referenceLevel, setReferenceLevel] = useState(115);
  const [referenceDistance, setReferenceDistance] = useState(1);
  const [inputWeighting, setInputWeighting] = useState<Weighting>("C");
  const [sensitivity, setSensitivity] = useState(99);
  const [power, setPower] = useState(2000);
  const [sourceCount, setSourceCount] = useState(8);
  const [sumMode, setSumMode] = useState<SumMode>("energy");
  const [receptorDistance, setReceptorDistance] = useState(100);
  const [propagationMode, setPropagationMode] = useState<PropagationMode>("point");
  const [directivityLoss, setDirectivityLoss] = useState(0);
  const [barrierLoss, setBarrierLoss] = useState(0);
  const [facadeCorrection, setFacadeCorrection] = useState(0);
  const [uncertainty, setUncertainty] = useState(3);
  const [criterion, setCriterion] = useState(75);
  const [criterionWeighting, setCriterionWeighting] = useState<Weighting>("C");
  const [bands, setBands] = useState<Record<BandCentre, number>>({
    31.5: 106,
    63: 115,
    125: 111,
    250: 96,
  });

  const result = useMemo(() => {
    const count = Math.max(1, Math.round(safePositive(sourceCount, 1)));
    const sourceGain = (sumMode === "coherent" ? 20 : 10) * Math.log10(count);
    const spread = propagationMode === "point" ? 20 : 10;
    const targetDistance = safePositive(receptorDistance, 1);
    const refDistance = sourceMode === "power" ? 1 : safePositive(referenceDistance, 1);
    const distanceLoss = spread * Math.log10(Math.max(targetDistance / refDistance, 1e-6));
    const correction = sourceGain - distanceLoss - Math.max(0, directivityLoss) - Math.max(0, barrierLoss) + facadeCorrection;

    const baseReference = sourceMode === "power"
      ? sensitivity + 10 * Math.log10(safePositive(power, 1))
      : referenceLevel;
    const broadband = baseReference + correction;

    const receptorBands = Object.fromEntries(
      BAND_CENTRES.map((band) => [band, bands[band] + correction]),
    ) as Record<BandCentre, number>;

    const weighted = (weighting: Weighting) => dbSum(
      BAND_CENTRES.map((band) => receptorBands[band] + WEIGHTING[weighting][band]),
    );

    const octaveOverall = {
      A: weighted("A"),
      C: weighted("C"),
      Z: weighted("Z"),
    };

    const activeWeighting = analysisMode === "broadband" ? inputWeighting : criterionWeighting;
    const predicted = analysisMode === "broadband" ? broadband : octaveOverall[activeWeighting];
    const margin = predicted - criterion;
    const requiredDistance = margin > 0
      ? targetDistance * 10 ** (margin / spread)
      : targetDistance;

    return {
      sourceGain,
      spread,
      distanceLoss,
      correction,
      baseReference,
      broadband,
      receptorBands,
      octaveOverall,
      activeWeighting,
      predicted,
      margin,
      requiredDistance,
      lower: predicted - Math.max(0, uncertainty),
      upper: predicted + Math.max(0, uncertainty),
      cMinusA: octaveOverall.C - octaveOverall.A,
    };
  }, [
    analysisMode,
    sourceMode,
    referenceLevel,
    referenceDistance,
    inputWeighting,
    sensitivity,
    power,
    sourceCount,
    sumMode,
    receptorDistance,
    propagationMode,
    directivityLoss,
    barrierLoss,
    facadeCorrection,
    uncertainty,
    criterion,
    criterionWeighting,
    bands,
  ]);

  const chart = useMemo(() => {
    const minDistance = Math.max(1, sourceMode === "power" ? 1 : safePositive(referenceDistance, 1));
    const maxDistance = Math.max(500, safePositive(receptorDistance, 100) * 2);
    const points = Array.from({ length: 42 }, (_, index) => {
      const t = index / 41;
      const distance = minDistance * (maxDistance / minDistance) ** t;
      const delta = result.spread * Math.log10(distance / safePositive(receptorDistance, 1));
      return { distance, level: result.predicted - delta };
    });
    const yValues = points.map((point) => point.level).concat([criterion]);
    const yMax = Math.ceil(Math.max(...yValues) / 5) * 5 + 5;
    const yMin = Math.floor(Math.min(...yValues) / 5) * 5 - 5;
    const x = (distance: number) => 44 + (Math.log10(distance / minDistance) / Math.log10(maxDistance / minDistance)) * 616;
    const y = (level: number) => 18 + ((yMax - level) / Math.max(1, yMax - yMin)) * 182;
    const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.distance).toFixed(1)},${y(point.level).toFixed(1)}`).join(" ");
    return { points, path, x, y, minDistance, maxDistance, yMin, yMax };
  }, [result.predicted, result.spread, receptorDistance, referenceDistance, sourceMode, criterion]);

  const nearCriterion = Math.abs(result.margin) <= Math.max(0, uncertainty);
  const status = result.margin > 0 ? "over" : nearCriterion ? "near" : "under";

  return (
    <main className="sn-page" aria-label="Subwoofer noise calculator">
      <header className="sn-hero">
        <div>
          <p className="sn-kicker">Environmental noise planning</p>
          <h1>Subwoofer Noise</h1>
          <p>Estimate low-frequency sound at a receptor, test distance and mitigation scenarios, and compare against a criterion you supply from the event permit, venue condition or acoustic report.</p>
        </div>
        <div className="sn-warning">
          <strong>Planning / screening only.</strong>
          <span>No universal legal limit is built in. Low-frequency propagation is strongly affected by array directivity, terrain, weather and local regulation. Confirm critical predictions with measurement or a qualified acoustic consultant.</span>
        </div>
      </header>

      <div className="sn-layout">
        <section className="sn-controls" aria-label="Calculator inputs">
          <div className="sn-panel">
            <div className="sn-panel-title">1. Analysis</div>
            <SelectField
              label="Input format"
              value={analysisMode}
              onChange={(value) => setAnalysisMode(value as AnalysisMode)}
              options={[["broadband", "Broadband level"], ["octave", "Low-frequency octave bands"]]}
              hint="Use octave bands when you have 31.5/63/125/250 Hz data and need A/C/Z-weighted totals."
            />
          </div>

          <div className="sn-panel">
            <div className="sn-panel-title">2. Source</div>
            {analysisMode === "broadband" ? (
              <>
                <SelectField
                  label="Source input"
                  value={sourceMode}
                  onChange={(value) => setSourceMode(value as SourceMode)}
                  options={[["reference", "Known SPL at reference distance"], ["power", "Sensitivity + amplifier power"]]}
                />
                {sourceMode === "reference" ? (
                  <>
                    <NumericField label="Reference level" value={referenceLevel} onChange={setReferenceLevel} unit={`dB${inputWeighting}`} step={0.5} />
                    <NumericField label="Reference distance" value={referenceDistance} onChange={setReferenceDistance} unit="m" min={0.1} step={0.1} />
                    <SelectField label="Reference weighting" value={inputWeighting} onChange={(value) => setInputWeighting(value as Weighting)} options={[["A", "dBA"], ["C", "dBC"], ["Z", "dBZ / flat"]]} />
                  </>
                ) : (
                  <>
                    <NumericField label="Sensitivity" value={sensitivity} onChange={setSensitivity} unit="dB @ 1W/1m" step={0.5} />
                    <NumericField label="Amplifier power" value={power} onChange={setPower} unit="W" min={1} step={50} hint="Simple electrical-power estimate. Real maximum SPL is limited by loudspeaker compression, DSP and manufacturer ratings." />
                    <div className="sn-inline-note">Sensitivity + power is treated as an unweighted planning estimate; use a measured or manufacturer reference level where possible.</div>
                  </>
                )}
              </>
            ) : (
              <div className="sn-band-grid">
                {BAND_CENTRES.map((band) => (
                  <NumericField
                    key={band}
                    label={`${band} Hz`}
                    value={bands[band]}
                    onChange={(value) => setBands((current) => ({ ...current, [band]: value }))}
                    unit="dB"
                    step={0.5}
                  />
                ))}
                <NumericField label="Reference distance" value={referenceDistance} onChange={setReferenceDistance} unit="m" min={0.1} step={0.1} />
              </div>
            )}

            <NumericField label="Number of identical subs" value={sourceCount} onChange={setSourceCount} min={1} step={1} />
            <SelectField
              label="Summation assumption"
              value={sumMode}
              onChange={(value) => setSumMode(value as SumMode)}
              options={[["energy", "+10 log10(N), spatial / energy sum"], ["coherent", "+20 log10(N), coherent upper bound"]]}
              hint="Real sub arrays interfere spatially. Use the coherent option only as a conservative on-axis upper bound, not as an array-model substitute."
            />
          </div>

          <div className="sn-panel">
            <div className="sn-panel-title">3. Propagation to receptor</div>
            <NumericField label="Receptor distance" value={receptorDistance} onChange={setReceptorDistance} unit="m" min={0.1} step={1} />
            <SelectField
              label="Geometric spreading"
              value={propagationMode}
              onChange={(value) => setPropagationMode(value as PropagationMode)}
              options={[["point", "Point-source far field · 6 dB / doubling"], ["line", "Cylindrical approximation · 3 dB / doubling"]]}
              hint="The point-source model is the safer general screening default once the array is in its far field."
            />
            <NumericField label="Off-axis / array attenuation" value={directivityLoss} onChange={setDirectivityLoss} unit="dB" min={0} step={0.5} />
            <NumericField label="Barrier / ground attenuation" value={barrierLoss} onChange={setBarrierLoss} unit="dB" min={0} step={0.5} hint="Do not assume large low-frequency barrier benefit without project-specific evidence." />
            <NumericField label="Facade correction" value={facadeCorrection} onChange={setFacadeCorrection} unit="dB" step={0.5} hint="Enter 0 for free-field prediction; only add a facade correction when your criterion/assessment method requires it." />
            <NumericField label="Prediction uncertainty" value={uncertainty} onChange={setUncertainty} unit="± dB" min={0} step={0.5} />
          </div>

          <div className="sn-panel">
            <div className="sn-panel-title">4. Screening criterion</div>
            <NumericField label="User-supplied criterion" value={criterion} onChange={setCriterion} unit={`dB${result.activeWeighting}`} step={0.5} />
            <SelectField
              label="Criterion weighting"
              value={analysisMode === "broadband" ? inputWeighting : criterionWeighting}
              onChange={(value) => setCriterionWeighting(value as Weighting)}
              options={[["A", "dBA"], ["C", "dBC"], ["Z", "dBZ / flat"]]}
              disabled={analysisMode === "broadband"}
              hint={analysisMode === "broadband" ? "Broadband criteria must use the same weighting as the supplied broadband source level." : "Choose the metric specified by the permit, consent condition or acoustic report."}
            />
          </div>
        </section>

        <section className="sn-results" aria-live="polite">
          <div className="sn-result-grid">
            <article className="sn-result-card sn-primary">
              <span>Predicted receptor level</span>
              <strong>{fmt(result.predicted)} dB{result.activeWeighting}</strong>
              <small>{fmt(result.lower)}–{fmt(result.upper)} dB{result.activeWeighting} with entered uncertainty</small>
            </article>
            <article className={`sn-result-card sn-status ${status}`}>
              <span>Criterion margin</span>
              <strong>{result.margin >= 0 ? "+" : ""}{fmt(result.margin)} dB</strong>
              <small>{status === "over" ? "Prediction is above the supplied criterion." : status === "near" ? "Prediction is within the uncertainty band of the criterion." : "Prediction is below the supplied criterion."}</small>
            </article>
            <article className="sn-result-card">
              <span>Distance loss</span>
              <strong>{fmt(result.distanceLoss)} dB</strong>
              <small>{propagationMode === "point" ? "20 log10(r/r₀)" : "10 log10(r/r₀)"}</small>
            </article>
            <article className="sn-result-card">
              <span>Source-count gain</span>
              <strong>+{fmt(result.sourceGain)} dB</strong>
              <small>{sumMode === "energy" ? "Energy / spatial sum assumption" : "Coherent upper-bound assumption"}</small>
            </article>
          </div>

          <div className="sn-panel sn-chart-panel">
            <div className="sn-panel-title">Level vs distance</div>
            <svg className="sn-chart" viewBox="0 0 680 230" role="img" aria-label="Predicted sound level versus distance">
              <rect x="44" y="18" width="616" height="182" className="sn-chart-bg" />
              {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                const level = chart.yMax - (chart.yMax - chart.yMin) * t;
                const y = 18 + 182 * t;
                return <g key={t}><line x1="44" y1={y} x2="660" y2={y} className="sn-grid-line" /><text x="38" y={y + 4} textAnchor="end">{Math.round(level)}</text></g>;
              })}
              <line x1="44" y1={chart.y(criterion)} x2="660" y2={chart.y(criterion)} className="sn-criterion-line" />
              <path d={chart.path} className="sn-level-line" />
              <circle cx={chart.x(safePositive(receptorDistance, 1))} cy={chart.y(result.predicted)} r="4" className="sn-point" />
              <text x="44" y="220">{fmt(chart.minDistance, 0)} m</text>
              <text x="660" y="220" textAnchor="end">{fmt(chart.maxDistance, 0)} m</text>
              <text x="652" y={Math.max(30, chart.y(criterion) - 5)} textAnchor="end" className="sn-criterion-label">criterion {fmt(criterion)} dB{result.activeWeighting}</text>
            </svg>
          </div>

          {analysisMode === "octave" ? (
            <div className="sn-panel">
              <div className="sn-panel-title">Low-frequency spectrum at receptor</div>
              <div className="sn-octave-table" role="table" aria-label="Octave band levels at receptor">
                <div className="sn-octave-head" role="row"><span>Band</span><span>Level</span><span>A-weighted</span><span>C-weighted</span></div>
                {BAND_CENTRES.map((band) => (
                  <div className="sn-octave-row" role="row" key={band}>
                    <span>{band} Hz</span>
                    <strong>{fmt(result.receptorBands[band])}</strong>
                    <span>{fmt(result.receptorBands[band] + WEIGHTING.A[band])}</span>
                    <span>{fmt(result.receptorBands[band] + WEIGHTING.C[band])}</span>
                  </div>
                ))}
              </div>
              <div className="sn-weighted-totals">
                <div><span>Overall A</span><strong>{fmt(result.octaveOverall.A)} dBA</strong></div>
                <div><span>Overall C</span><strong>{fmt(result.octaveOverall.C)} dBC</strong></div>
                <div><span>Overall Z</span><strong>{fmt(result.octaveOverall.Z)} dBZ</strong></div>
                <div><span>C − A</span><strong>{fmt(result.cMinusA)} dB</strong></div>
              </div>
            </div>
          ) : null}

          <div className="sn-panel">
            <div className="sn-panel-title">Scenario readout</div>
            <dl className="sn-breakdown">
              <div><dt>Reference source level</dt><dd>{fmt(result.baseReference)} dB</dd></div>
              <div><dt>Source-count adjustment</dt><dd>+{fmt(result.sourceGain)} dB</dd></div>
              <div><dt>Geometric spreading</dt><dd>−{fmt(result.distanceLoss)} dB</dd></div>
              <div><dt>Off-axis / array attenuation</dt><dd>−{fmt(Math.max(0, directivityLoss))} dB</dd></div>
              <div><dt>Barrier / ground attenuation</dt><dd>−{fmt(Math.max(0, barrierLoss))} dB</dd></div>
              <div><dt>Facade correction</dt><dd>{facadeCorrection >= 0 ? "+" : ""}{fmt(facadeCorrection)} dB</dd></div>
            </dl>
            {result.margin > 0 ? (
              <div className="sn-action-callout">
                Under the selected spreading assumption and with all other corrections held constant, the receptor would need to be about <strong>{fmt(result.requiredDistance, 0)} m</strong> away to reach the entered criterion by distance alone.
              </div>
            ) : (
              <div className="sn-action-callout safe">The central prediction is below the entered criterion. Keep the uncertainty range and local permit method in the decision.</div>
            )}
          </div>

          <div className="sn-method-note">
            <strong>Method boundary:</strong> This calculator handles logarithmic source summation, geometric spreading, optional octave-band A/C/Z weighting and user-entered corrections. It deliberately does not pretend to model full ISO 9613-2 terrain/meteorology, phase/directivity lobes, diffraction, ground impedance or jurisdiction-specific penalties. Use the Array Planner for detailed system geometry and a project noise model / measurements for compliance work.
          </div>
        </section>
      </div>
    </main>
  );
}
