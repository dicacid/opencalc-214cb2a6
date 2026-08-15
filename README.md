# Array Whisperer

# Building a Real Acoustic Toolkit Around d&b Hardware — Engineering Brief

**Context.** You've already built a competent, browser-only acoustic shell — generic line-array sub/source solver with ISO 9613-1 air absorption, A-weighting, dB SPL cube/balloon output, and a GUI clearly modelled on ArrayCalc's panel language. The cabinet dictionary is currently a placeholder of generic boxes; nothing in there is a real Y8, Y12, V-SUB, J-INFRA or D80. This brief maps exactly the work needed to make it predict and rig d&b systems accurately against publicly available information — and the precise spots to either triangulate from generic physics or stop and license d&b ArrayProcessing.

---

## 0. The IP Reality Check (do this first — it reshapes the build)

The pure physics of sound radiation (line-source sinc integration, complex pressure summation, ground reflection, ISO 9613-1 meteorological air absorption) is not licensable: it is textbook fluid mechanics, identical to what EASE Focus 3, Meyer MAPP, Adamson FIR-maker and dozens of open research tools compute [AFMG](https://www.afmg.eu/en/ease-focus) [Drupal HSET](https://drpress.org/ojs/index.php/HSET/article/download/18942/19005/39782). Where the legal line sits is between *physics* and *manufacturer tuning*: d&b's product-specific GLL "balloon" data is *intentionally* published by d&b so that third-party prediction tools (EASE, Focus 3, Soundvision, Adamson Blueprint, AFMG Theatre) can interoperate [AFMG GLL Format](https://www.afmg.eu/en/gll-loudspeaker-file-format) [Void Acoustics](https://voidacoustics.com/insights/technically-speaking-extended-gll-library/). What you absolutely do not clone:

| Asset | Status | What you do |
|-------|--------|-------------|
| Per-cabinet phase, magnitude & directivity balloons (1/3-octave, full sphere) | Public, distributed in d&b's GLL files | Import and consume — equivalent to EASE Focus 3 doing the same thing | 
| Mechanical rigging envelope (splay limits, frame loads) | Public, in rigging manuals | Implement exactly as documented |
| ArrayProcessing target curves and FIRs | Proprietary, licensed with ArrayCalc UI integration | Compute your own target curves from published frequency/balloon data |
| DS80 / ArrayProcessing OCA control surface | Closed network + AES70 extensions | Document the OCA entries, but do not reverse-engineer the payload format |
| D80 configuration DSP tunings per cab | Closed; stored inside the amp | Use only the published EQ and level values when the user tells you |
| "CUT", "HFC", "CPL" voicing curves | Trademarks named; equivalent curves are public | Implement equivalent shelving/parametric curves generically |

The distinction is straightforward in practice: your engine can *predict the SPL field of a d&b array using d&b's own published balloons in EASE GLL format*, the same way EASE Focus 3 does; you just don't replicate or expose d&b's ArrayProcessing turn-on function or the d&b-specific FIR presets that ArrayCalc generates [ArrayCalc product page](https://www.dbaudio.com/global/en/products/software/arraycalc/). That posture keeps you inside the published-data envelope and outside the soft-IP fog.

---

## 1. Audit of the Existing Shell

Your current code at `arraycalc.html` already has a surprisingly complete core:

**Acoustic solver** (`CABINETS` table through `pressureAt`):
- `airAlpha(f,T,RH,p)` — full ISO 9613-1 two-relaxation model [code lines 215–226], selectable with `env.airAbs = false`
- `aWeight(f)` — IEC 61672 standard A-weighting via the 12194² · f⁴ numerator and the standard pole/zero cascade
- `soundSpeed(t)` — Sutherland/Hardy temperature fit (`331.3·√(1+T/273.15)`)
- `voicingGain(fr,f)` — CUT, CPL, HFC shelving curves expressed as dB vs log₂ frequency
- `buildSource(src)` — exact mechanical geometry: walks the array face, accumulates splay angles, builds 3D frames per cabinet
- `refPressure(cabType,f,c)` — line-source sinc integral over K sub-segments at 16 m reference, segDir per cabinet
- `pressureAt(frames, p, f, env, ap)` — per-source arith + α·r attenuation + spherical spreading; back-cached through `prepFrames`

This is academically the right shape. The two places d&b's commercial engine would beat it:

1. **Full 3D balloon lookups** rather than the 2D `segDir(u)·pow(cos,0.35)` factorisation used in your code (`segDir` collapses the line-source integral to a single angular product). That factorisation is reasonable below ~4 kHz but over-simplifies above the first lobing threshold. The fix: replace `segDir(k,L,θ)` with a precomputed 3D balloon table loaded per cabinet from a .gsd or CSV.
2. **Ground reflection**. Your engine has none — ArrayCalc renders half-space free-field only by default; add an image-source reflection per cabinet.

**GUI** — panels, stepper fields, dark theme, black plot frame, tab strip — already matches d&b's visual language. You've avoided the trap of building it from scratch; treat this as a sub-system, not a rewrite.

---

## 2. The Acoustic Math — Where the Published Literature and Your Code Agree

The standard 2-D line-source derivation for a single box treats the box as K sub-segments, each at a position `z_s` along the cabinet face, with each segment contributing a complex pressure

```
p_s ≈ (1/r_s) · sinc(k·L_seg·sin θ_s /2) · cos θ_s · e^{-j k r_s}
```

to a far receiver at polar angle θ_s from the segment's on-axis [Drupal HSET](https://drpress.org/ojs/index.php/HSET/article/download/18942/19005/39782) [Medium — Ikarosilva](https://medium.com/@ikarosilva/mathematics-of-beam-forming-a518e59542ad). The cabinet-level superposition is the complex sum across segments; the array-level superposition is the same sum across frames. Your `refPressure` does exactly that — and uses `nSub(cab.h, λ)` segments with `seg = cab.h / K`, which is the canonical Christian Heil / d&b "Line Array Equation" formulation. Two strong, free confirmations:

- The 2010 article by pro-sound training on DLLs vs measurement agrees that *all* manufacturers using balloons push this same math; the difference is in dataset density, not the equation [Pro Sound Training](https://www.prosoundtraining.com/2010/03/10/whats-a-dll-line-array-predictions-vs-measurement-part-2/).
- EASE Focus 3, AFMG's free tool, is built around the same framework and is widely used in your industry [AFMG EASE Focus 3](https://www.afmg.eu/en/ease-focus). You're not doing anything new; you're doing the right thing.

What your `segDir` short-cut does — approximating per-box as `(sinc · cos^0.35)` — is correct for the −6 dB envelope on a real cabinet within ±30°, but it lifts the off-axis attenuation too slowly. Whenever you import a GLL balloon, the simplest fix is to interpolate the 3-D balloon at each frame's angle to the receiver and multiply the cabinet-level pressure. That replaces the analytical shape with real measurement.

```
function ball(P_table, θ_h, θ_v, f) {
  // P_table[band][fwθ][upθ] stored from .gsd import
  const i = nearestBand(f, 1/3oct);
  const ah = angularInterp(P_table[i], θ_h, θ_v);
  return ah;  // complex pressure magnitude * e^{-j phase}
}
```

This is the path taken by EASE Focus 3 and the entire GLL pipeline [AFMG GLL Format](https://www.afmg.eu/en/gll-loudspeaker-file-format).

---

## 3. Product-by-Product Data Sourcing

Each d&b box you slot into `CABINETS` needs:

| Product | Type / Kind | h (m) | H-cov | V-cov | Published f-ref / max SPL | Splay limits | Notes |
|---|---|---|---|---|---|---|---|
| **Y8** | 2-way passive, 2×8″ / 1.4″, 80° H | 0.34 | 80° | per-way | 54 Hz – 19 kHz; 134 dB SPLmax @ 1 m (D80) | 0°–7° | The Y-series manual gives exact panel-to-panel splay and pin angles [d&b Y8 product page](https://www.dbaudio.com/global/en/products/series/y-series/y8/) [Y8/Y12 Manual PDF](https://cdn.lightwaveproductions.co.uk/manuals/sound/speakers/d-b-y8-speaker-manual.pdf) |
| **Y12** | same family, 120° H | 0.34 | 120° | per-way | 54 Hz – 19 kHz; 137 dB SPLmax | 0°–14° | Wider horizontal; use the published H-cov in your dir factor |
| **V-SUB** | Active cardioid 18″ + 12″ passive radiator | 0.44 | 360° (cardioid) | 360° (cardioid in bass) | 37 Hz – 115/95 Hz; 137 dB @ 1 m D80 | stack-only | Cardioid index (-15 dB rear @ 80 Hz, gradually less rearward null above) [d&b V-SUB page](https://www.dbaudio.com/global/en/products/series/v-series/v-sub/) [V-SUB Manual PDF](http://www.jie-yun.com.tw/_equipment/1sound/data/d&b%20v-sub%20manual.pdf) |
| **J-INFRA** | Ground-stacked infra sub, 27 Hz extension | 0.84 (twin pack) | 360° | 360° | 27 Hz – 80 Hz; ground stack tuned pairs | no splay | Designed for 2× ground stacks; pairs deliver group delay matched to J-SUB [d&b J-INFRA product page](https://www.dbaudio.com/global/en/products/heritage/j-infra/) [J-INFRA Manual PDF](https://soundreferencenotes.com/srn-databases/speakerdb/manuals/d&b%20j-infra%20sub%20manual%202.2-en.pdf) |
| **D80** | 4-ch Class D amp/DSP | n/a | n/a | n/a | 4 × 4000 W @ 4 Ω, 100–240 V auto | n/a | Each ch: 10 s delay, 2×16-band PEQ, MAX-EQ inverted shelf, ArrayProcessing chain [d&b press release](https://www.dbaudio.com/global/en/about-db/press-news/press-releases-and-articles/14022014-the-db-audiotechnik-d80-amplifier/) [D80 Manual PDF](https://www.origintechnicalproductions.co.uk/support/sound/db/manuals/D80-User-Manual.pdf) |

The minimum set of fields you want for each box, beyond what your `CABINETS` table already tracks:

```
{
  id: 'Y8',
  family: 'Y-Series',
  kind: 'array',
  h, w, d, kg,
  hCov: 80, vCov: SPLAY-DRIVEN,
  splayMin: 0, splayMax: 7,
  lowCut: 54, hiCut: 18000,
  amp: 'D80', ampCh: 2,           // 2 amp channels per box (top HF, bottom LF)
  maxSplOct: {63:..., 125:..., 250:..., 500:..., 1000:..., 2000:..., 4000:..., 8000:...}, // from datasheet
  voicing: {cut: -12 shelf @ 120 Hz, cpl: -6 sh @, hfc: +2 sf @},  // generic equivalents
  balloons: [/* imported from .gsd, 27 angles × 9 bands × complex */],
  rig: {pinGrid: [0,1,2,3,4,5,6,7,...], splayLabels: [...]},
  apMode: 'Y8'   // tells your engine to apply Y-series target curves IF user opts in
}
```

The `balloons` array is what transforms this from a generic engine into a per-product engine. The .gsd format is well documented [Void Acoustics](https://voidacoustics.com/insights/technically-speaking-extended-gll-library/); for each 1/3-octave band you get N polar rows × M polar columns of complex pressure, run-length zlib-compressed inside the GLL archive (XML wrapper). EASE GLL Viewer (free, from AFMG/Q-SYS) can open and export them to .txt for parsing [Q-SYS EASE GLL Viewer](https://www.qsys.com/resources/software-and-firmware/loudspeakers/). Once imported, your existing `pressureAt` reframes with a balloon lookup per cabinet per receiver.

Where to grab each balloon:

- **Y8 / Y12** — d&b Y-Series manual PDF (linked above) plus the EASE GLL file shipped via d&b's download centre.
- **V-SUB** — the cardioid pattern is dual-band: front 18″ driver + rear 12″ passive radiator driven from the front through an internal cardioid delay/level DSP. That DSP is closed; the *measurement* of the resulting pattern is what is in the GLL file. Treat it the same.
- **J-INFRA** — large-format infrabass; GLL is single full-sphere pattern (360°), but with a long ground-stack coupling mask that you parameterise separately.
- **D80** — there is no "balloon" for an amp; the amp entry in your model is a *resource budget*: 4 channels, 4000 W each into 4 Ω, 4 Ω / 8 Ω / VCV mode topology (Dual Channel / 2-Way Active / Mix TOP/SUB), 10 s delay, plus a network interface entry.

---

## 4. Subwoofer Array Math — V-SUB, J-INFRA, Mixed Sub Arrays

V-SUB is a self-contained cardioid module — its cardioid pattern is fixed by internal DSP, no extra rigging math required once you correctly key the GLL pattern. The interesting work is **gradient stacks**:

- A typical V-SUB gradient stack is the so-called "in-line gradient": N forward-facing V-SUBS + N-1 reversed-and-delayed V-SUBS in the same vertical line, ~0.4 m spacing (the cabinet height), rear elements delayed by an inter-element delay matched to λ/4 at the desired crossover centre. d&b's default is 3 forward / 2 rear at 18 m spacing 80 Hz delay (the front to-back acoustic centre propagates effectively "backwards in time") [Front of House Magazine](https://fohonline.com/articles/tech-feature/cardioid-directional-subwoofer-arrays-part-1/).
- Mathematically you treat the rear elements as V-SUB instances with `cabs: [{splay:0, delay:N ms, mute:true, pol:-1}]` or, more usefully, three "phantom sources" pointing rearward. Since V-SUB is already internally cardioid, gradient stacks are an enhancement of cancellation, not the basic mechanism — but the configuration is widely used in festivals and you should match it.
- **End-fire** (Dave Rat's arc card) is `pol:−1, delay = distance/c` for the rear elements — useful when you have a single forward row [Sound Design Live](https://www.sounddesignlive.com/dave-rats-end-fire-adjustable-arc-subwoofer-array/). Your existing `buildSource → prepFrames → pressureAt` pipeline handles this directly: rear elements with the right delay and polarity just *integrate* against the front row through the normal complex sum. No new algorithm required.

J-INFRA is hard:

- J-INFRA is built for ground-stack only, must be paired with J-SUB above it to extend smoothly down. The published phase response of J-INFRA is internally compensated by the amp so the gradient between J-SUB and J-INFRA is continuous [J-INFRA Manual PDF](https://soundreferencenotes.com/srn-databases/speakerdb/manuals/d&b%20j-infra%20sub%20manual%202.2-en.pdf). Import as a separate cabinet with `kind:'sub', lowCut:27, hiCut:80, amp:'D80 groundstack mode'`.
- Mixer in the request: don't allow J-INFRA inside flown sub arrays. Add a UI constraint and validate it in buildSource.

Practical calc note: many festival SOs use **mixed patterns** — central V-SUB cardioid stacks + outer J-SUB/J-INFRA ground-stacked flanks. Your solver doesn't need any new math; it just needs to know the right GLL balloon per box and the right tuning delay between them. The user's job is to enforce the meeting-point delay between V-SUB and J-SUB toward the critical audience row, which is a numerical search in your SPL field — exactly the optimisation you're already doing.

---

## 5. The D80 —amp-model layer

The D80 adds three concerns: channel topology, DSP chain documentation, and resource budgeting. d&b's published specifications give you the model [D80 press release](https://www.dbaudio.com/global/en/about-db/press-news/press-releases-and-articles/14022014-the-db-audiotechnik-d80-amplifier/):

| Mode | Channels | Wiring | Typical use |
|---|---|---|---|
| Dual Channel | 4 independent | 4 line-level inputs | Tops / fills mixed per box |
| 2-Way Active | 2 cabinets split HF+LF | Y-cable | Y8, Y12, V8, V12 — the mode you'll be in 90% of the time |
| Mix TOP/SUB | 1 hybrid | internal | Subwoofer cabinets with built-in passive crossover |

The DSP chain per channel, in *output* order, is:

1. Input gain + matrix routing
2. 2×16-band parametric EQ (the user-facing "EQ" filter set)
3. Delay (0–10 s)
4. Cabinet-specific EQ voicings CUT / HFC / CPL — your existing `voicingGain` already models these
5. MAX-EQ (the system alignment EQ)
6. Level + limiter + ALC

```
const D80_MODES = {
  'Y8':  { mode: '2-Way Active', channels: 2, hf: {peq: [..], delayRange: [0, 10000]}, lf: {..}, total: 2 },
  'V-SUB':{ mode: 'Dual Channel', channels: 1, peq:[..], applique: 'CARD_VSUB' },
  'J-INFRA': { mode: 'Dual Channel', channels: 1, peq:[..], groundStack:true }
};
```

The rig count you care about is: `(boxes·channels) / 4 = amps`. Show this live in the GUI as boxes are added — that's the array-check your rigger will actually look at first thing on-site.

---

## 6. ArrayProcessing — the IP corner, and what to do instead

ArrayProcessing is d&b's headline feature: in ArrayCalc, the user enables AP and the software re-FIR-cooks the array's per-box curve so that (a) the overall frequency response over the audience area is flattened, (b) tonal balance is consistent front-to-back, and (c) rear radiation drops noticeably. The AP target curves and the per-box FIR coefficients are d&b proprietary [ArrayCalc 11.4 release](https://www.avnetwork.com/news/dandb-audiotechnik-releases-arraycalc-114what-to-know). What you should *not* do is reverse-engineer or reproduce them.

The legitimate route:

1. Compute the SPL field normally (as you already do).
2. Compute a *targeted* intermediate: spatial flatness metric and 1/3-octave average over audience rectangles.
3. Apply a *generic* box-to-box FIR bank based on (a) incremental gain, (b) incremental delay, (c) a low-shelf tilt — these are observable by anyone with a measurement mic and an SMAART copy, so their general shape is not IP. The user opts in by name (e.g. "Smooth field" / "Long throw" presets) defined by you, not by d&b.
4. Show the predicted gain and delay per box clearly. If a user wants d&b's actual AP turn-on, that's a paid add-on of d&b ArrayProcessing — point them to d&b. Your tool is the *first pass*; theirs is the *final mileage*.

This is consistent with what EASE Focus 3 does (no AP) and with what other independent tools do. Position it that way and you have nothing to apologise for.

---

## 7. NoizCalc engine — outdoor immission in ISO 9613-2

NoizCalc predicts far-field sound pressure from a system at receiver points (residential, property boundaries) across an outdoor map [d&b NoizCalc page](https://www.dbaudio.com/global/en/products/software/noizcalc/). The math is ISO 9613-2 — wind vector, ground factor, barrier attenuation, atmospheric stability, etc. — and is plainly accessible [NoizCalc 4.0 release](https://www.dbaudio.com/global/en/about-db/press/newsroom/20072023-db-unveils-noizcalc-40-an-advanced-noise-mitigation-tool-for-outdoor-events/).

What you'd add to your existing env block:

- 2-m receiver grid default (20 × 20 m up to 1 km)
- Wind direction + speed
- Ground factor `G` (0 hard, 1 soft)
- Frequency band altitude adapters
- A-weighting toggle for LAeq

Since you already compute `pressureAt(p, f, env, ap)` for arbitrary receiver points, the NoizCalc layer is just a *receiver grid* and an ISO 9613-2 atmospheric absorption / ground reflection correction table. Not months of work; one solid sprint of buildSource integration.

---

## 8. Rigging & safety validation

For festival use, this is the second big difference between a tool a rigger trusts and a pretty demo:

- **BGV-C1 wind loads**: pullback forces vary with splay, static moment, and sail area. d&b's rigging manuals publish the "load excess zone" chart; replicate the inputs and enforce red/yellow/green shading in the GUI.
- **Frame pinning**: for Y-series flats, arrays are limited to 24 boxes flown (depending on model). Your `splayMax` field already covers angles; add `qtyMax` and a `rigFrame: 'Y8-Frame'` reference.
- **Reaction at pick point**: a live tile showing "frame → motor load" at the proposed trim height; numeric, not a chart, because that's what the rigger needs to enter the lift plan.
- **Ground-stack validation**: forbid invalid splay sequences, forbid three-high J-INFRA stacks (it physically is rigid), enforce seismic-factor caution for outdoor stages.

d&b's free rigging manuals are the spec [Y-Series rigging manual](https://soundreferencenotes.com/srn-databases/speakerdb/manuals/d&b%20yi%20series%20rigging%20manual%201.2-en.pdf). Implement the input checks and you're done.

---

## 9. Engineering Roadmap — Native, Browser-First

Given the operational context (live events, on-site rigger use, intermittent connectivity, hostile environments), the build should *stay* in the browser. Each sprint ends in a shippable piece:

| # | Sprint | Deliverable | Verification |
|---|---|---|---|
| 1 | Replace `CABINETS` table | Y8/Y12/V-SUB/J-INFRA entries from public datasheets | Side-by-side SPL cube against published free-field dats |
| 2 | GLL pipeline | .gsd balloon importer, IndexedDB cache; pressureAt reads 3-D per-cabinet | Diff against EASE Focus 3 same rig, ±0.5 dB |
| 3 | Sub array presets | V-SUB gradient; J-INFRA + J-SUB gradient; Rat-arc; split-delay-fill | Diff card-rear ratio via simulation ≈ d&b FastPlane output |
| 4 | D80 model | Amp topology, channel mat, 16-band PEQ export | Sheet matches d&b R1 import `.dsd` if you choose to expose it |
| 5 | Ground reflection | Image-source per cabinet per receiver, f-dependent | Outdoor empty ovoid site; matches ISO 9613-2 doc example |
| 6 | NoizCalc layer | LAeq receiver grid + wind + ground | Compare against policy example: <5 dB at boundary |
| 7 | Rigging checker | splay/qty/wind per box; red/yellow/green; pullback | Manual test against d&b AppNote 1.7 examples |
| 8 | Optimiser | Generic box-FIR pass gain/delay/shelf; export arrays | Verify no proprietary AP dataset referenced |
| 9 | R1/OCA connector | WebSocket → AES70 (open control); surface live amp telemetry if VLAN | Lightweight playback equivalent of d&b R1 simulator |
| 10 | WebGPU SPL renderer | Heatmap shading ≥60 Hz redraw at 1920×1080 | Smoke on integrated GPU; power-metered |

No GPU sidecar. No node server. WebAssembly only where the sinc integral benefits from SIMD + native compile (e.g. the inner pressureAt loop, which can run 4× faster in WASM and stay in the browser).

---

## 10. Self-verifying acceptance test protocol

Embed this directly in CI and a `?test=1` boot flag, since that's how real engineering confidence gets baked in:

1. **Cabinet unit test** — for each cabinet, drive 1 W at 1 m → SPL field must be 0 dB at 1 m reference per `maxSplAt − voicingGain = 0`. Renderers must not amplify or attenuate.
2. **Band flatness** — verify SPL field Σf over an empty audience rect was smoother than input sum before generic optimisations (smoothing-1 ⟨LAeq π⟩ ≤ smoothing-0 — n is a meaningful statistical test).
3. **Sub gradient ratio** — at frontal 1/3-oct bands centred at 50 Hz, the rear-to-front pressure ratio for a populated V-SUB gradient stack ≤ −12 dB (matches public d&b cardioid index).
4. **Ground-reflection sanity** — at 100 Hz, half-space image source contributes 6 dB constructive at some heights; ensure your implementation lands between +5.5 and +6.5 dB.
5. **Rigging-check trip** — every prohibited splay ≥ splayMax flips UI to red and blocks export. Trippers are a hard assertion list.
6. **NoizCalc Lden** — match the worked example in ISO 9613-2:2006 §9 within ±1 dB on a known reference site.
7. **GLL parity** — load a third-party box whose GLL file is in the open dataset (QSC, EAW; both publish) and reproduce its published free-field curve to ±0.5 dB within 30 m.

If any of those breaks, the build doesn't ship the day. That's earned credibility — the kind that lets your rigger keep the tool open on-site without rolling their eyes.

---

## 11. Risk register you should keep in front of the team

- **ArrayProcessing naming**: don't call yours "ArrayProcessing" — pick a different name ("Smooth Array", "Spatial Tilt", etc.). Even innocent naming trips an OCS trigger.
- **GLL redistribution**: d&b's GLLs are licensed by d&b for third-party tool use, but you still cannot e.g. scrape them and re-host. Import them at runtime by having the user supply the file, or only ship a reference balloon table that summarises them.
- **d&b trademarked configuration names** ("CUT", "HFC", "CPL", "MAX-EQ", "ArrayProcessing"): render equivalent curves generically but do not name them as such in your export headers. If you do, only as advisory metadata.
- **LAG / MGP / OCA reverse engineering**: don't. The control surface spec (AES70 plus d&b extensions in DS10) is partially closed; document open OCA entries for monitoring only, never active controls.
- **Disclaimers**: the tool predicts free-field/in-air behaviour. It is not a substitute for an EAS-approved rigging plan, an in-venue measurement sweep, or council noise compliance. Put that language in the export footer.

---

## What's *not* in scope for v1

- AES70 network control — read-only monitoring would be a stretch goal; active control is firmly out until d&b exposes a public API.
- d&b ArrayProcessing turn-on — explicit non-goal, by IP design.
- A full EASE GLL file *editor*. You're a *consumer*, not a GLL producer. The producer side is AFMG's paid SpeakerLab; treat that as upstream [AFMG GLL Format](https://www.afmg.eu/en/gll-loudspeaker-file-format).

---

## Closing framing

You have the right shape of engine. The path to a faithful Y8 / Y12 / V-SUB / J-INFRA / D80 system planner is:

1. Replace the generic CABINETS with d&b-specific entries sourced from the PDF manuals and GLL balloons publicly distributed for EASE ingestion.
2. Extend `pressureAt` with per-cabinet 3-D balloon lookup (the only meaningful step beyond what you already do).
3. Add ground reflection, ISO 9613-2 propagation, and rigging validation.
4. Compute your own generic box-FIR for spatial smoothing — openly labelled, not "ArrayProcessing".
5. Wire the test protocol above into a CI gate so the tool never ships broken.

That's a build, not a clone. It's defensible, it's shippable, and it's the kind of engineering the festival industry actually wants next to ArrayCalc — not in front of it.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://opencalc.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/f664f60b-f2b7-4eb9-9616-60bc105dfd7a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
