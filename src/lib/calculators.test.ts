import { describe, expect, test } from "bun:test";
import {
  CABINETS,
  aWeight,
  airAlpha,
  ampChannels,
  ampModelOf,
  ampsRequired,
  buildAll,
  buildSource,
  buildSubArray,
  frontToBack,
  horizDir,
  maxSplAt,
  nSub,
  planePoint,
  rigging,
  segDir,
  soundSpeed,
  splayLimit,
  splAt,
  validateSource,
  voicingGain,
} from "./acoustics";
import { normalizeSpec, parseJSONLibrary, registerCabinet, unregisterCabinet } from "./acoustics/customCabinets";
import { predictSubwooferNoise } from "./acoustics/subwooferNoise";
import { fromR3F, orientationToR3F, toFeet, toR3F } from "./arraycalc/coords";

const env = { temp: 20, humidity: 50, airAbs: true };

function y8Source(count: number, splays: number[] = []) {
  return {
    cabType: "Y8",
    x: 0,
    y: 0,
    z: 8,
    azimuth: 0,
    tilt: 0,
    gain: 0,
    cabs: Array.from({ length: count }, (_, i) => ({
      splay: splays[i] ?? 0,
      level: 0,
      delay: 0,
    })),
  };
}

describe("acoustic environment", () => {
  test("sound speed follows the temperature fit", () => {
    expect(soundSpeed(0)).toBeCloseTo(331.3, 5);
    expect(soundSpeed(20)).toBeCloseTo(331.3 * Math.sqrt(1 + 20 / 273.15), 5);
    expect(soundSpeed(20)).toBeGreaterThan(soundSpeed(0));
  });

  test("A-weighting is near 0 dB at 1 kHz and attenuates low frequencies", () => {
    expect(aWeight(1000)).toBeCloseTo(0, 0);
    expect(aWeight(63)).toBeLessThan(-20);
    expect(aWeight(63)).toBeLessThan(aWeight(1000));
  });

  test("ISO 9613-1 air absorption rises with frequency", () => {
    const low = airAlpha(125, 20, 50);
    const mid = airAlpha(1000, 20, 50);
    const high = airAlpha(8000, 20, 50);
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });
});

describe("amplifier budget", () => {
  test("Y8 uses two D80 channels and rounds amplifiers up", () => {
    expect(ampChannels("Y8")).toBe(2);
    expect(ampModelOf("Y8")).toBe("D80");
    expect(ampsRequired("Y8", 1)).toBe(1);
    expect(ampsRequired("Y8", 2)).toBe(1);
    expect(ampsRequired("Y8", 3)).toBe(2);
    expect(ampsRequired("Y8", 8)).toBe(4);
  });

  test("unknown cabinets fall back to one channel on a four-channel amp", () => {
    expect(ampsRequired("NOT-A-CABINET", 4)).toBe(1);
    expect(ampsRequired("NOT-A-CABINET", 5)).toBe(2);
  });
});

describe("rigging checks", () => {
  test("rejects splay past the published Y8 limit and flown stack-only boxes", () => {
    const splay = validateSource({
      cabType: "Y8",
      mounting: "flown",
      cabs: [{ splay: 0 }, { splay: 10 }],
    });
    expect(splay.some((issue) => issue.level === "error" && issue.msg.includes("splay"))).toBe(true);
    expect(splayLimit("Y8")).toBe(7);

    const flownInfra = validateSource({
      cabType: "J-INFRA",
      kind: "sub",
      mounting: "flown",
      sub: { count: 2, stack: 1 },
    });
    expect(flownInfra.some((issue) => issue.level === "error" && issue.msg.includes("ground-stack"))).toBe(true);

    const stackedInfra = validateSource({
      cabType: "J-INFRA",
      kind: "sub",
      mounting: "stacked",
      sub: { count: 1, stack: 3 },
    });
    expect(stackedInfra.some((issue) => issue.msg.includes("two high"))).toBe(true);
  });

  test("static pick-point check tracks cabinet weight and total splay", () => {
    const src = y8Source(4, [0, 2, 2, 3]);
    const rig = rigging(src);
    expect(rig.n).toBe(4);
    expect(rig.weight).toBeCloseTo(4 * CABINETS["Y8"]!.kg, 5);
    expect(rig.length).toBeCloseTo(4 * 0.34, 5);
    expect(rig.totalSplay).toBe(7);
    expect(rig.forceFront + rig.forceRear).toBeCloseTo(rig.weight * 9.81, 4);
    expect(typeof rig.ok).toBe("boolean");
  });
});

describe("array geometry and SPL", () => {
  test("on-axis directivity is unity and a straight hang steps down by cabinet height", () => {
    expect(segDir(1, 0.1, 0)).toBeCloseTo(1, 5);
    expect(horizDir({ hCov: 360 }, 1.2)).toBe(1);
    const c = soundSpeed(20);
    expect(nSub(0.34, c / 1000)).toBeGreaterThanOrEqual(3);

    const frames = buildSource(y8Source(3));
    expect(frames).toHaveLength(3);
    const [top, mid, bottom] = frames;
    if (!top || !mid || !bottom) throw new Error("expected three cabinets");
    expect(top.cz).toBeCloseTo(8 - 0.17, 5);
    expect(mid.cz).toBeCloseTo(top.cz - 0.34, 5);
    expect(bottom.topZ).toBeCloseTo(mid.botZ, 5);
  });

  test("level falls with distance and voicing shelves behave as shelving filters", () => {
    const frames = buildAll([y8Source(2, [0, 2])]);
    const near = splAt(frames, 0, 10, 7.5, 1000, env, null);
    const far = splAt(frames, 0, 40, 7.5, 1000, env, null);
    expect(Number.isFinite(near)).toBe(true);
    expect(near).toBeGreaterThan(far);
    expect(near - far).toBeGreaterThan(6);

    expect(voicingGain({ cut: true }, 40)).toBeCloseTo(-24, 5);
    expect(voicingGain({ hfc: 6 }, 8000)).toBeCloseTo(6, 5);
    expect(voicingGain({ cpl: 6 }, 50)).toBeGreaterThan(0);
    expect(voicingGain({}, 1000)).toBe(0);
  });

  test("published octave SPL is used inside the band and rolled off below cutoff", () => {
    const y8 = CABINETS["Y8"]!;
    expect(maxSplAt(y8, 1000)).toBe(138);
    expect(maxSplAt(y8, 27)).toBeCloseTo(122 - 24, 5);
  });

  test("listening-plane coordinates honour rotation", () => {
    const point = planePoint({ x: 1, y: 2, z: 0, w: 10, d: 4, hFront: 0, hBack: 2, rot: 90 }, 1, 0);
    expect(point[0]).toBeCloseTo(1, 5);
    expect(point[1]).toBeCloseTo(12, 5);
    expect(point[2]).toBeCloseTo(0, 5);
  });
});

describe("subwoofer arrays", () => {
  test("end-fire delays the front row by the propagation time of the array depth", () => {
    const subs = buildSubArray({
      mode: "endfire",
      count: 4,
      spacing: 1.2,
      depth: 2,
      efSpacing: 1.7,
      temp: 20,
    });
    expect(subs).toHaveLength(4);
    const front = subs.filter((s: { y: number }) => s.y === 0);
    const rear = subs.filter((s: { y: number }) => s.y === -1.7);
    expect(front).toHaveLength(2);
    expect(rear).toHaveLength(2);
    const frontBox = front[0];
    const rearBox = rear[0];
    if (!frontBox || !rearBox) throw new Error("expected end-fire rows");
    expect(rearBox.delayMs).toBeCloseTo(0, 5);
    expect(frontBox.delayMs).toBeCloseTo((1.7 / soundSpeed(20)) * 1000, 4);
  });

  test("a delayed reversed rear element is louder toward the audience than behind the stack", () => {
    const subs = buildSubArray({
      mode: "cardioid",
      count: 2,
      spacing: 2,
      temp: 20,
      cardDepth: 1.2,
      cardGain: 0,
      cardDelay: 0,
    });
    const ratio = frontToBack(subs, 63, env);
    expect(ratio).toBeGreaterThan(3);
  });
});

describe("subwoofer noise screening", () => {
  const base = {
    analysisMode: "broadband" as const,
    sourceMode: "reference" as const,
    referenceLevel: 115,
    referenceDistance: 1,
    inputWeighting: "C" as const,
    sensitivity: 99,
    power: 2000,
    sourceCount: 8,
    sumMode: "energy" as const,
    receptorDistance: 100,
    propagationMode: "point" as const,
    directivityLoss: 0,
    barrierLoss: 0,
    facadeCorrection: 0,
    uncertainty: 3,
    criterion: 75,
    criterionWeighting: "C" as const,
    bands: { 31.5: 106, 63: 115, 125: 111, 250: 96 },
  };

  test("energy sum and spherical spreading match 10 log N and 20 log r", () => {
    const result = predictSubwooferNoise(base);
    expect(result.sourceGain).toBeCloseTo(10 * Math.log10(8), 6);
    expect(result.distanceLoss).toBeCloseTo(40, 6);
    expect(result.predicted).toBeCloseTo(115 + result.sourceGain - 40, 6);
    expect(result.activeWeighting).toBe("C");
    expect(result.upper - result.lower).toBeCloseTo(6, 6);
  });

  test("amplifier power is converted at 1 m and coherent summation uses 20 log N", () => {
    const result = predictSubwooferNoise({
      ...base,
      sourceMode: "power",
      sumMode: "coherent",
      sourceCount: 4,
      receptorDistance: 1,
    });
    expect(result.baseReference).toBeCloseTo(99 + 10 * Math.log10(2000), 6);
    expect(result.sourceGain).toBeCloseTo(20 * Math.log10(4), 6);
    expect(result.distanceLoss).toBeCloseTo(0, 6);
    expect(result.broadbandWeighting).toBe("Z");
  });

  test("cylindrical spreading is 3 dB per doubling", () => {
    const result = predictSubwooferNoise({
      ...base,
      sourceCount: 1,
      propagationMode: "line",
      receptorDistance: 2,
    });
    expect(result.spread).toBe(10);
    expect(result.distanceLoss).toBeCloseTo(10 * Math.log10(2), 6);
  });
});

describe("user cabinet import", () => {
  test("normalizes a flat spec and rejects an empty record", () => {
    const bad = normalizeSpec({});
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);

    const good = normalizeSpec({
      key: "box 1",
      name: "Box 1",
      manufacturer: "Example",
      kind: "array",
      h: 0.4,
      w: 0.8,
      d: 0.5,
      kg: 30,
      hCov: 90,
      lowCut: 60,
      splMax: 130,
    });
    expect(good.ok).toBe(true);
    expect(good.cabinet?.key).toBe("BOX-1");
    expect(good.cabinet?.spec.maxSplOct[1000]).toBe(130);
    expect(good.cabinet?.spec.ampCh).toBe(2);
  });

  test("round-trips a JSON library without leaving the cabinet registered", () => {
    const parsed = parseJSONLibrary(
      JSON.stringify({
        cabinets: [
          {
            key: "TEST-CAB",
            name: "Test Cab",
            manufacturer: "Example",
            spec: {
              kind: "point",
              h: 0.5,
              w: 0.5,
              d: 0.4,
              kg: 20,
              hCov: 90,
              lowCut: 70,
              maxSplOct: { 500: 120, 1000: 124 },
            },
          },
        ],
      }),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.cabinets).toHaveLength(1);
    const cab = parsed.cabinets[0]!;
    registerCabinet(cab);
    expect(CABINETS["TEST-CAB"]).toBe(cab.spec);
    unregisterCabinet("TEST-CAB");
    expect(CABINETS["TEST-CAB"]).toBeUndefined();
  });
});

describe("render coordinates", () => {
  test("solver Z-up maps to three.js Y-up and back", () => {
    expect(toR3F([1, 2, 3])).toEqual([1, 3, -2]);
    expect(fromR3F(toR3F([4, -5, 6]))).toEqual([4, -5, 6]);
    expect(toFeet(1)).toBeCloseTo(3.280839895, 6);
    const euler = orientationToR3F(90, 10);
    expect(euler[0]).toBeCloseTo((10 * Math.PI) / 180, 6);
    expect(euler[1]).toBeCloseTo(Math.PI / 2, 6);
  });
});
