# Tune the "Open air demo" default project

The audit items are all in-app operations, but the result must ship: the tuned state gets baked into `defaultProject()` so the demo always opens aligned, smoothed, splay-optimised and level-trimmed. No solver changes — only the demo's numbers.

## What gets tuned

1. **Delay alignment.** Every source gets its `delay` pre-set to the value `Align all to furthest` would produce against the reference point (0, 45, 1.7) at 20 °C: Main L/R, Sub array and Front fill all arrive together instead of spreading ~15 ms. After this, the Alignment tab's "required" column reads 0.00 ms on open, and the FOH magnitude ripple from arrival-time spread is gone.

2. **Spatial Smoothing on.** Main L and Main R and Out fill L/R ship with `ap.on = true` and a tuned `strength` (the AP1–AP3 slot stays at the default process). Strength is chosen by sweeping candidate values and keeping the one that lowers plane spread the most without pulling HF down more than a couple of dB — over-softening is checked on the magnitude response, not just the level plot.

3. **Auto splay, re-run after alignment.** Auto Splay runs on Main L/R and Out fill L/R against all three active planes (Front standing, Rear standing, Grandstand) with the corrected delays in place, and the resulting per-cabinet splay angles are written into the demo's cabinet arrays as literal values. Splays stay inside each cabinet's `splayMin`/`splayMax`.

4. **Fill trims.** Front fill and Out fill gains/tilts are adjusted to pull down the overlap hot zone at the Rear standing → Grandstand transition, then re-checked.

5. **Peak SPL trim.** Main L/R currently predicts ~131–132 dB direct. No venue limit was specified, so the demo is trimmed to a defensible **125 dB peak direct SPL** ceiling over the audience planes, with the loss made up by Out fill and Front fill level rather than by pushing the mains. If you have a real ordinance figure, say it and the ceiling changes.

## Verification (automated browser run)

A Playwright pass against the live preview drives the real UI and captures evidence:

- Open the demo, screenshot the 3D level plot, read the reported spread.
- Open the Alignment tab, confirm every "required" value reads 0.00 ms.
- Open the magnitude response at FOH, screenshot before/after to show the comb ripple smoothed.
- Read the rig-check and load-limit status on every array; all must pass.

Pass criteria: spread **under 10 dB** (from 23.4 dB), delays at 0.00 ms, rig and load checks green. If a tuning pass misses the spread target, splay/level candidates are iterated until it clears or I report the best achievable number with the reason.

The demo project is then saved (it also writes to local storage) so the verified state is what loads.

## Technical notes

- All edits land in `defaultProject()` and the `mkArray`/`mkSubs` call sites in `src/lib/arraycalc/app.ts`: literal `delay`, `gain`, `ap: { on, strength, slot }` and per-cabinet `splay` values.
- `mkArray` currently applies one uniform splay per array; the demo will pass an explicit per-cabinet splay list so the optimiser's result survives verbatim.
- Tuning values are computed by running the existing `autoSplay` / `makeArrayProcessing` / `alignAll` logic, not hand-guessed — the code path that produced them is the same one the buttons call.
- The project comment string is updated to describe the shipped state accurately.
