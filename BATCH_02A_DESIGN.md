# Batch 02A — LAW-66 population design

> **Status: design and measurement only.** This document records the corrected population and its seeded measurements. No engine, trace, or audit-rule source file was edited for Batch 02A. Batch 02B is the separate causal diagnosis; no fix is implemented in this batch.

## Decision

LAW-66 must be fixed at the **population**, not by weakening the defence or by treating every shirt in the raw eligibility window as a line defender. The accepted candidate is **Candidate B**, an engine-anchored population for the authored `DF-UMBRELLA` open-play shape:

1. Take the existing raw eligibility exactly as measured by the trace: the defending player has `beatenT <= 0` and `abs(player.x - carrierX) < 26`.
2. Exclude the authored last-line **sweeper** (shirt 15 in these seeded runs). This is the player whose authored job is the 18–20 m last-line/sweeper job; the design should identify that role from the authored defensive assignment/`PodRole=SWEEPER` concept, not from an arbitrary statistical centre or median.
3. Use the remaining non-wing core (`num` not 11 or 14) to establish its current lateral envelope `[minX, maxX]`.
4. Treat an authored wing (shirts 11 and 14) as an **edge**, not a hole, when it is parked outside that core envelope. Keep it in the population only when it lies inside the envelope and is therefore functioning as an interior line member. This is the explicit wide-wing rule.
5. Sort the retained population by `x`; the corrected gap is the maximum adjacent x-spacing. No median-z filter, target-depth filter, authored-job filter, or other invented population heuristic is used.

For this run the authored defensive context is `DF-UMBRELLA`: `maxSpacing = 3.8 m`, `sweeperDepth = 18 m`, `fringeGuard = 5.0 m`, `lineSpeed = 5.8 m/s`, and `drift = 0.58`. LAW-66 retains its current 4.6 m threshold. The 18 m sweeper depth is the role/shape anchor for excluding the designated last line; it is not a new distance cutoff for the other defenders.

### Law-derived context boundary

`liveOffsideLines()` is used as the law/context anchor, not as a fabricated defensive half-plane. In these samples the live open-play line is `OPEN`, with the attacking side as its offender and the carrier/ball line supplied only for that attacking side. There is no defending-team `lineFor` in this measurement, and the attacking `OPEN` line is **not** reused as a defensive line-integrity half-plane. The defensive population is instead the defending side in the active open-play context, paired with the authored defensive system and channel shape. This distinction prevents LAW-66 from silently changing the offside law while correcting line-integrity accounting.

### Decision order and rounding

The audit-equivalent order was preserved for every seed: `seedRng(seed); runDeep(gateConfig(3), 90); runTrace(gateConfig(3), 90)`. `npm install` was run before the `vite-node` probes. The trace emits `raw` and `attackT` to one decimal; the table below uses the exact trace point index and displayed `attackT`, and uses JavaScript `Math.round` semantics for the corrected displayed gap. A sample is a corrected FAIL when `attackT > 1.2` and the displayed corrected gap is `> 4.6 m`. Samples are not findings: adjacent qualifying samples within 1 second are merged into events.

## Measurement summary

| seed | trace samples | raw FAIL samples | corrected FAIL samples | corrected events (1 s merge) |
|---:|---:|---:|---:|---:|
| 1 | 36 | 1 | 0 | 0 |
| 2 | 26 | 6 | 2 | 1 (`6.93–7.20`) |
| 3 | 45 | 11 | 5 | 2 (`6.93–7.20`, `21.33–21.87`) |
| 4 | 35 | 6 | 0 | 0 |
| 5 | 36 | 14 | 0 | 0 |
| **total** | **178** | **38** | **7** | **3** |

The raw result reproduces the accepted Batch 01 baseline: 38 failures, by seed `1, 6, 11, 6, 14`, across 12 raw episodes. Candidate B leaves seven corrected failing samples, which merge to three events. The corrected PASS/FAIL result by seed is therefore `1: 0/36`, `2: 2/26`, `3: 5/45`, `4: 0/35`, `5: 0/36` (FAIL/sample count).

## Complete sample table

`raw` and `corrected` show the unrounded gap to three decimals followed by the shirt pair that produces it. `at` is the one-decimal trace `attackT`; `corr` is the one-decimal corrected gap used for the verdict. `F` means corrected FAIL; `P` means corrected PASS. A `†` marks every unrounded case where corrected gap is larger than raw gap, including cases whose one-decimal display is unchanged.

| seed | trace i | t (s) | at | raw gap / pair | corrected gap / pair | corr | result |
|---:|---:|---:|---:|---:|---:|---:|:---:|
| 1 | 222 | 5.60 | 0.0 | 9.166 / 3/7 | 9.166 / 3/7 | 9.2 | P |
| 1 | 235 | 5.87 | 0.3 | 9.489 / 3/7 | 9.489 / 3/7 | 9.5 | P |
| 1 | 246 | 6.13 | 0.6 | 9.138 / 3/5 | 9.138 / 3/5 | 9.1 | P |
| 1 | 260 | 6.40 | 0.8 | 8.393 / 3/5 | 8.393 / 3/5 | 8.4 | P |
| 1 | 302 | 7.73 | 0.1 | 8.374 / 12/15 | 6.604 / 1/3 | 6.6 | P |
| 1 | 312 | 8.00 | 0.3 | 7.967 / 14/15 | 6.074 / 1/3 | 6.1 | P |
| 1 | 322 | 8.27 | 0.6 | 6.130 / 14/15 | 4.588 / 1/11 | 4.6 | P |
| 1 | 332 | 8.53 | 0.9 | 4.067 / 12/14 | 3.363 / 4/8 | 3.4 | P |
| 1 | 384 | 10.13 | 0.0 | 7.577 / 11/1 | 5.122 / 7/5 | 5.1 | P |
| 1 | 396 | 10.40 | 0.3 | 8.439 / 11/1 | 4.209 / 7/10 | 4.2 | P |
| 1 | 406 | 10.67 | 0.5 | 10.337 / 11/1 | 3.342 / 1/6 | 3.3 | P |
| 1 | 418 | 10.93 | 0.8 | 12.328 / 11/1 | 3.787 / 1/6 | 3.8 | P |
| 1 | 428 | 11.20 | 1.1 | 14.367 / 11/1 | 2.532 / 1/4 | 2.5 | P |
| 1 | 440 | 11.47 | 1.3 | 15.858 / 11/1 | 1.849 / 12/13 | 1.8 | P |
| 1 | 492 | 13.07 | 0.2 | 9.963 / 13/14 | 4.940 / 2/9 | 4.9 | P |
| 1 | 502 | 13.33 | 0.5 | 10.412 / 13/14 | 3.335 / 2/9 | 3.3 | P |
| 1 | 512 | 13.60 | 0.7 | 10.458 / 13/14 | 2.739 / 7/5 | 2.7 | P |
| 1 | 526 | 13.87 | 1.0 | 9.945 / 10/14 | 2.738 / 8/6 | 2.7 | P |
| 1 | 576 | 15.47 | 0.1 | 5.962 / 11/1 | 3.750 / 1/9 | 3.7 | P |
| 1 | 588 | 15.73 | 0.3 | 6.854 / 11/1 | 3.988 / 1/9 | 4.0 | P |
| 1 | 598 | 16.00 | 0.6 | 9.537 / 11/1 | 3.823 / 1/9 | 3.8 | P |
| 1 | 610 | 16.27 | 0.9 | 11.584 / 11/1 | 2.911 / 12/13 | 2.9 | P |
| 1 | 620 | 16.53 | 0.0 | 13.194 / 11/1 | 2.733 / 1/3 | 2.7 | P |
| 1 | 698 | 18.93 | 0.1 | 4.877 / 1/9 | 4.877 / 1/9 | 4.9 | P |
| 1 | 708 | 19.20 | 0.4 | 4.174 / 15/13 | 4.225 / 12/13† | 4.2 | P |
| 1 | 718 | 19.47 | 0.7 | 6.440 / 11/2 | 4.294 / 12/13 | 4.3 | P |
| 1 | 730 | 19.73 | 0.9 | 8.523 / 11/2 | 4.192 / 12/13 | 4.2 | P |
| 1 | 740 | 20.00 | 1.2 | 9.288 / 11/2 | 4.283 / 12/13 | 4.3 | P |
| 1 | 808 | 22.13 | 0.2 | 13.379 / 11/9 | 3.789 / 12/13 | 3.8 | P |
| 1 | 818 | 22.40 | 0.5 | 14.020 / 11/9 | 3.776 / 12/13 | 3.8 | P |
| 1 | 828 | 22.67 | 0.7 | 15.084 / 11/1 | 3.347 / 12/13 | 3.3 | P |
| 1 | 840 | 22.93 | 1.0 | 15.571 / 11/1 | 2.357 / 12/13 | 2.4 | P |
| 1 | 850 | 23.20 | 0.0 | 6.036 / 12/11 | 3.569 / 5/9 | 3.6 | P |
| 1 | 864 | 23.47 | 0.3 | 7.166 / 12/11 | 3.874 / 4/14 | 3.9 | P |
| 1 | 876 | 23.73 | 0.6 | 9.726 / 12/11 | 3.690 / 14/5 | 3.7 | P |
| 1 | 948 | 25.60 | 0.2 | 8.284 / 4/3 | 8.284 / 4/3 | 8.3 | P |
| 2 | 222 | 5.60 | 0.0 | 8.528 / 3/7 | 8.528 / 3/7 | 8.5 | P |
| 2 | 233 | 5.87 | 0.3 | 8.818 / 3/7 | 8.818 / 3/7 | 8.8 | P |
| 2 | 244 | 6.13 | 0.6 | 8.946 / 3/5 | 8.946 / 3/5 | 8.9 | P |
| 2 | 254 | 6.40 | 0.8 | 8.212 / 3/5 | 8.212 / 3/5 | 8.2 | P |
| 2 | 266 | 6.67 | 1.1 | 7.691 / 3/5 | 7.691 / 3/5 | 7.7 | P |
| 2 | 276 | 6.93 | 1.4 | 7.881 / 9/15 | 7.388 / 3/5 | 7.4 | **F** |
| 2 | 288 | 7.20 | 1.6 | 8.220 / 9/15 | 5.790 / 3/7 | 5.8 | **F** |
| 2 | 330 | 8.53 | 0.1 | 4.383 / 8/9 | 4.383 / 8/9 | 4.4 | P |
| 2 | 342 | 8.80 | 0.4 | 4.242 / 13/14 | 3.340 / 1/11 | 3.3 | P |
| 2 | 352 | 9.07 | 0.6 | 5.020 / 13/14 | 2.755 / 1/11 | 2.8 | P |
| 2 | 364 | 9.33 | 0.9 | 5.013 / 13/14 | 3.280 / 11/2 | 3.3 | P |
| 2 | 374 | 9.60 | 1.2 | 3.877 / 13/15 | 3.301 / 1/3 | 3.3 | P |
| 2 | 434 | 11.47 | 0.2 | 5.495 / 11/2 | 4.442 / 5/10 | 4.4 | P |
| 2 | 444 | 11.73 | 0.5 | 8.096 / 11/2 | 3.606 / 10/13 | 3.6 | P |
| 2 | 454 | 12.00 | 0.8 | 9.976 / 11/2 | 3.113 / 10/13 | 3.1 | P |
| 2 | 464 | 12.27 | 1.0 | 11.165 / 11/2 | 3.017 / 10/13 | 3.0 | P |
| 2 | 476 | 12.53 | 1.3 | 12.068 / 11/2 | 2.653 / 5/6 | 2.7 | P |
| 2 | 486 | 12.80 | 1.5 | 12.501 / 13/14 | 2.255 / 5/10 | 2.3 | P |
| 2 | 498 | 13.07 | 1.8 | 12.593 / 13/14 | 2.543 / 3/8 | 2.5 | P |
| 2 | 508 | 13.33 | 2.1 | 12.646 / 11/2 | 3.062 / 5/10 | 3.1 | P |
| 2 | 518 | 13.60 | 0.0 | 2.560 / 4/5 | 2.560 / 4/5 | 2.6 | P |
| 2 | 532 | 13.87 | 0.3 | 1.836 / 3/4 | 1.836 / 3/4 | 1.8 | P |
| 2 | 544 | 14.13 | 0.6 | 1.592 / 12/8 | 1.933 / 1/9† | 1.9 | P |
| 2 | 558 | 14.40 | 0.8 | 2.017 / 12/8 | 2.017 / 12/8 | 2.0 | P |
| 2 | 570 | 14.67 | 1.1 | 2.222 / 12/11 | 2.222 / 12/11 | 2.2 | P |
| 2 | 582 | 14.93 | 0.1 | 2.041 / 14/3 | 1.985 / 12/11 | 2.0 | P |
| 3 | 222 | 5.60 | 0.0 | 7.929 / 3/7 | 7.929 / 3/7 | 7.9 | P |
| 3 | 235 | 5.87 | 0.3 | 8.188 / 3/7 | 8.188 / 3/7 | 8.2 | P |
| 3 | 246 | 6.13 | 0.6 | 8.357 / 3/7 | 8.357 / 3/7 | 8.4 | P |
| 3 | 256 | 6.40 | 0.8 | 7.510 / 9/15 | 7.260 / 3/7 | 7.3 | P |
| 3 | 266 | 6.67 | 1.1 | 7.703 / 9/15 | 6.009 / 3/7 | 6.0 | P |
| 3 | 278 | 6.93 | 1.4 | 7.584 / 9/15 | 6.984 / 3/7 | 7.0 | **F** |
| 3 | 288 | 7.20 | 1.6 | 7.999 / 3/8 | 7.999 / 3/8 | 8.0 | **F** |
| 3 | 338 | 8.80 | 0.2 | 7.298 / 3/6 | 7.298 / 3/6 | 7.3 | P |
| 3 | 348 | 9.07 | 0.4 | 6.848 / 3/6 | 6.848 / 3/6 | 6.8 | P |
| 3 | 358 | 9.33 | 0.7 | 5.308 / 2/4 | 5.308 / 2/4 | 5.3 | P |
| 3 | 368 | 9.60 | 1.0 | 6.353 / 13/15 | 2.442 / 2/4 | 2.4 | P |
| 3 | 380 | 9.87 | 1.2 | 5.318 / 13/15 | 1.404 / 3/2 | 1.4 | P |
| 3 | 390 | 10.13 | 1.5 | 5.453 / 15/14 | 2.294 / 5/6 | 2.3 | P |
| 3 | 402 | 10.40 | 1.8 | 7.632 / 13/14 | 3.764 / 7/6 | 3.8 | P |
| 3 | 412 | 10.67 | 2.0 | 8.306 / 13/14 | 3.761 / 7/10 | 3.8 | P |
| 3 | 462 | 12.27 | 0.1 | 8.918 / 12/14 | 4.806 / 5/10 | 4.8 | P |
| 3 | 474 | 12.53 | 0.4 | 9.411 / 12/14 | 4.226 / 5/10 | 4.2 | P |
| 3 | 484 | 12.80 | 0.6 | 11.265 / 12/14 | 3.181 / 13/10 | 3.2 | P |
| 3 | 496 | 13.07 | 0.9 | 12.254 / 11/2 | 2.301 / 1/9 | 2.3 | P |
| 3 | 506 | 13.33 | 1.2 | 13.160 / 11/2 | 1.843 / 3/9 | 1.8 | P |
| 3 | 518 | 13.60 | 1.4 | 13.487 / 11/2 | 1.954 / 6/13 | 2.0 | P |
| 3 | 528 | 13.87 | 1.7 | 14.526 / 12/14 | 2.164 / 9/8 | 2.2 | P |
| 3 | 609 | 16.27 | 0.0 | 7.702 / 2/6 | 7.702 / 2/6 | 7.7 | P |
| 3 | 621 | 16.53 | 0.3 | 7.287 / 2/6 | 7.287 / 2/6 | 7.3 | P |
| 3 | 633 | 16.80 | 0.6 | 7.133 / 11/2 | 5.830 / 2/6 | 5.8 | P |
| 3 | 643 | 17.07 | 0.8 | 6.851 / 11/2 | 3.776 / 2/1 | 3.8 | P |
| 3 | 655 | 17.33 | 1.1 | 6.159 / 11/2 | 3.424 / 12/13 | 3.4 | P |
| 3 | 665 | 17.60 | 1.4 | 4.811 / 13/14 | 2.771 / 12/13 | 2.8 | P |
| 3 | 677 | 17.87 | 1.6 | 4.622 / 13/14 | 1.367 / 12/13 | 1.4 | P |
| 3 | 743 | 20.00 | 0.1 | 4.835 / 2/1 | 4.835 / 2/1 | 4.8 | P |
| 3 | 753 | 20.27 | 0.4 | 4.958 / 2/1 | 4.958 / 2/1 | 5.0 | P |
| 3 | 763 | 20.53 | 0.7 | 5.892 / 13/14 | 5.413 / 2/1 | 5.4 | P |
| 3 | 775 | 20.80 | 0.9 | 6.363 / 2/1 | 6.363 / 2/1 | 6.4 | P |
| 3 | 785 | 21.07 | 1.2 | 7.212 / 2/1 | 7.212 / 2/1 | 7.2 | P |
| 3 | 795 | 21.33 | 1.5 | 7.184 / 2/3 | 7.184 / 2/3 | 7.2 | **F** |
| 3 | 807 | 21.60 | 1.7 | 6.101 / 2/3 | 6.101 / 2/3 | 6.1 | **F** |
| 3 | 817 | 21.87 | 2.0 | 4.916 / 11/3 | 4.916 / 11/3 | 4.9 | **F** |
| 3 | 877 | 23.73 | 0.1 | 5.424 / 2/1 | 5.424 / 2/1 | 5.4 | P |
| 3 | 889 | 24.00 | 0.4 | 5.611 / 2/1 | 5.611 / 2/1 | 5.6 | P |
| 3 | 899 | 24.27 | 0.6 | 4.999 / 11/2 | 4.581 / 2/1 | 4.6 | P |
| 3 | 911 | 24.53 | 0.9 | 7.020 / 11/2 | 4.330 / 10/13 | 4.3 | P |
| 3 | 921 | 24.80 | 1.2 | 7.855 / 11/2 | 3.833 / 10/13 | 3.8 | P |
| 3 | 973 | 26.40 | 0.2 | 13.473 / 11/9 | 3.773 / 12/13 | 3.8 | P |
| 3 | 983 | 26.67 | 0.4 | 14.636 / 11/9 | 3.803 / 12/13 | 3.8 | P |
| 3 | 993 | 26.93 | 0.7 | 13.984 / 11/1 | 3.633 / 12/13 | 3.6 | P |
| 4 | 222 | 5.60 | 0.0 | 7.232 / 3/7 | 7.232 / 3/7 | 7.2 | P |
| 4 | 233 | 5.87 | 0.3 | 7.454 / 3/7 | 7.454 / 3/7 | 7.5 | P |
| 4 | 244 | 6.13 | 0.6 | 7.588 / 3/7 | 7.588 / 3/7 | 7.6 | P |
| 4 | 254 | 6.40 | 0.8 | 7.532 / 9/15 | 7.321 / 3/7 | 7.3 | P |
| 4 | 266 | 6.67 | 1.1 | 7.735 / 9/15 | 6.917 / 3/5 | 6.9 | P |
| 4 | 278 | 6.93 | 0.1 | 7.840 / 9/15 | 6.508 / 3/5 | 6.5 | P |
| 4 | 330 | 8.53 | 0.2 | 6.242 / 14/15 | 5.124 / 3/8 | 5.1 | P |
| 4 | 342 | 8.80 | 0.5 | 4.958 / 14/15 | 4.573 / 4/6 | 4.6 | P |
| 4 | 352 | 9.07 | 0.7 | 4.532 / 11/2 | 4.532 / 11/2 | 4.5 | P |
| 4 | 364 | 9.33 | 1.0 | 4.419 / 1/3 | 4.419 / 1/3 | 4.4 | P |
| 4 | 374 | 9.60 | 1.3 | 3.648 / 11/1 | 3.209 / 1/2 | 3.2 | P |
| 4 | 386 | 9.87 | 1.5 | 4.763 / 11/1 | 2.416 / 6/10 | 2.4 | P |
| 4 | 396 | 10.13 | 1.8 | 5.612 / 11/1 | 3.294 / 5/6 | 3.3 | P |
| 4 | 408 | 10.40 | 2.1 | 6.359 / 11/1 | 4.237 / 7/10 | 4.2 | P |
| 4 | 418 | 10.67 | 2.3 | 7.364 / 15/14 | 3.758 / 7/10 | 3.8 | P |
| 4 | 430 | 10.93 | 2.6 | 9.416 / 13/14 | 3.714 / 7/10 | 3.7 | P |
| 4 | 746 | 17.60 | 0.0 | 14.525 / 11/4 | 6.645 / 6/10 | 6.6 | P |
| 4 | 759 | 17.87 | 0.3 | 12.658 / 11/4 | 3.963 / 3/10 | 4.0 | P |
| 4 | 770 | 18.13 | 0.5 | 10.773 / 11/4 | 3.965 / 10/12 | 4.0 | P |
| 4 | 781 | 18.40 | 0.8 | 9.019 / 11/4 | 3.970 / 3/12 | 4.0 | P |
| 4 | 794 | 18.67 | 1.1 | 7.489 / 11/7 | 1.952 / 3/12 | 2.0 | P |
| 4 | 805 | 18.93 | 1.3 | 4.917 / 11/7 | 1.677 / 7/9 | 1.7 | P |
| 4 | 818 | 19.20 | 1.6 | 2.554 / 11/7 | 2.009 / 7/8 | 2.0 | P |
| 4 | 829 | 19.47 | 1.9 | 1.732 / 12/14 | 1.732 / 12/14 | 1.7 | P |
| 4 | 841 | 19.73 | 2.1 | 2.748 / 13/1 | 2.748 / 13/1 | 2.7 | P |
| 4 | 851 | 20.00 | 2.4 | 3.351 / 4/2 | 3.351 / 4/2 | 3.4 | P |
| 4 | 861 | 20.27 | 2.7 | 1.074 / 12/8 | 1.074 / 12/8 | 1.1 | P |
| 4 | 873 | 20.53 | 2.9 | 1.952 / 7/12 | 1.952 / 7/12 | 2.0 | P |
| 4 | 883 | 20.80 | 3.2 | 2.766 / 7/12 | 2.766 / 7/12 | 2.8 | P |
| 4 | 893 | 21.07 | 3.5 | 2.744 / 10/12 | 2.744 / 10/12 | 2.7 | P |
| 4 | 903 | 21.33 | 3.7 | 2.646 / 7/10 | 2.646 / 7/10 | 2.6 | P |
| 4 | 913 | 21.60 | 4.0 | 3.425 / 7/10 | 3.438 / 13/5† | 3.4 | P |
| 4 | 923 | 21.87 | 4.3 | 3.298 / 7/9 | 3.544 / 13/5† | 3.5 | P |
| 4 | 933 | 22.13 | 4.5 | 3.435 / 15/5 | 3.723 / 13/5† | 3.7 | P |
| 4 | 943 | 22.40 | 4.8 | 3.839 / 13/5 | 3.839 / 13/5 | 3.8 | P |
| 5 | 222 | 5.60 | 0.0 | 8.858 / 3/5 | 8.858 / 3/5 | 8.9 | P |
| 5 | 233 | 5.87 | 0.3 | 8.534 / 3/5 | 8.534 / 3/5 | 8.5 | P |
| 5 | 246 | 6.13 | 0.6 | 8.004 / 3/5 | 8.004 / 3/5 | 8.0 | P |
| 5 | 300 | 7.73 | 0.2 | 8.694 / 12/15 | 6.336 / 1/3 | 6.3 | P |
| 5 | 310 | 8.00 | 0.5 | 7.751 / 14/15 | 5.675 / 1/3 | 5.7 | P |
| 5 | 320 | 8.27 | 0.8 | 7.219 / 14/15 | 4.947 / 1/3 | 4.9 | P |
| 5 | 332 | 8.53 | 1.1 | 5.220 / 14/15 | 4.007 / 1/11 | 4.0 | P |
| 5 | 342 | 8.80 | 1.3 | 5.570 / 13/14 | 2.874 / 2/8 | 2.9 | P |
| 5 | 352 | 9.07 | 1.6 | 6.824 / 13/14 | 3.311 / 2/8 | 3.3 | P |
| 5 | 364 | 9.33 | 1.8 | 7.420 / 13/15 | 2.926 / 3/8 | 2.9 | P |
| 5 | 375 | 9.60 | 2.1 | 6.286 / 13/15 | 2.573 / 9/6 | 2.6 | P |
| 5 | 388 | 9.87 | 2.4 | 5.334 / 15/14 | 3.647 / 10/13 | 3.6 | P |
| 5 | 399 | 10.13 | 2.6 | 7.595 / 15/14 | 3.636 / 12/13 | 3.6 | P |
| 5 | 412 | 10.40 | 2.9 | 9.523 / 15/14 | 3.178 / 12/13 | 3.2 | P |
| 5 | 423 | 10.67 | 3.2 | 10.621 / 15/14 | 3.435 / 7/6 | 3.4 | P |
| 5 | 479 | 12.27 | 0.2 | 13.375 / 11/9 | 3.763 / 10/12 | 3.8 | P |
| 5 | 489 | 12.53 | 0.5 | 14.552 / 11/9 | 3.739 / 12/13 | 3.7 | P |
| 5 | 501 | 12.80 | 0.7 | 14.597 / 11/9 | 3.785 / 12/13 | 3.8 | P |
| 5 | 511 | 13.07 | 1.0 | 15.068 / 11/9 | 3.609 / 12/13 | 3.6 | P |
| 5 | 521 | 13.33 | 1.3 | 14.434 / 11/9 | 3.345 / 12/13 | 3.3 | P |
| 5 | 533 | 13.60 | 1.5 | 14.354 / 11/9 | 2.707 / 12/13 | 2.7 | P |
| 5 | 543 | 13.87 | 1.8 | 14.330 / 11/9 | 1.853 / 12/13 | 1.9 | P |
| 5 | 555 | 14.13 | 2.0 | 13.839 / 11/9 | 2.067 / 1/8 | 2.1 | P |
| 5 | 565 | 14.40 | 2.3 | 13.472 / 11/2 | 2.130 / 4/10 | 2.1 | P |
| 5 | 577 | 14.67 | 2.6 | 13.262 / 11/2 | 2.338 / 4/10 | 2.3 | P |
| 5 | 645 | 16.80 | 0.2 | 7.784 / 12/14 | 5.510 / 2/1 | 5.5 | P |
| 5 | 655 | 17.07 | 0.5 | 8.732 / 12/14 | 6.007 / 2/1 | 6.0 | P |
| 5 | 667 | 17.33 | 0.7 | 9.462 / 12/14 | 6.115 / 2/1 | 6.1 | P |
| 5 | 727 | 19.20 | 0.2 | 5.892 / 12/14 | 5.184 / 2/1 | 5.2 | P |
| 5 | 737 | 19.47 | 0.5 | 6.559 / 12/14 | 5.280 / 2/1 | 5.3 | P |
| 5 | 747 | 19.73 | 0.8 | 7.101 / 12/14 | 5.289 / 2/1 | 5.3 | P |
| 5 | 769 | 20.27 | 0.1 | 5.044 / 1/8 | 5.044 / 1/8 | 5.0 | P |
| 5 | 783 | 20.53 | 0.4 | 4.879 / 1/8 | 4.879 / 1/8 | 4.9 | P |
| 5 | 845 | 22.13 | 0.0 | 4.951 / 11/10 | 4.951 / 11/10 | 5.0 | P |
| 5 | 856 | 22.40 | 0.3 | 4.411 / 11/10 | 4.411 / 11/10 | 4.4 | P |
| 5 | 869 | 22.67 | 0.5 | 3.323 / 10/15 | 4.508 / 10/12† | 4.5 | P |

## Every corrected-greater-than-raw case

There are six, when compared before the one-decimal display rounding. All six have the same mechanical explanation: shirt 15 is between the raw pair in x-order, so removing the designated sweeper makes a different pair adjacent. None is a licence to omit the comparison; the dagger remains in the complete table even where display rounding hides the increase.

| seed | t | raw exact / pair | corrected exact / pair | why the pair changes |
|---:|---:|---:|---:|:---|
| 1 | 19.20 | 4.174 / 15–13 | 4.225 / 12–13 | 15 was between retained shirts 12 and 13; after sweeper removal, 12–13 is adjacent. |
| 2 | 14.13 | 1.592 / 12–8 | 1.933 / 1–9 | 15 was between 1 and 9; the corrected adjacent pair is 1–9. |
| 4 | 21.60 | 3.425 / 7–10 | 3.438 / 13–5 | 15 was between 13 and 5; the corrected adjacent pair is 13–5. |
| 4 | 21.87 | 3.298 / 7–9 | 3.544 / 13–5 | 15 was between 13 and 5; the corrected adjacent pair is 13–5. |
| 4 | 22.13 | 3.435 / 15–5 | 3.723 / 13–5 | 15 was one endpoint of the raw maximum and also lay between 13 and 5 after ordering; removing it exposes 13–5. |
| 5 | 22.67 | 3.323 / 10–15 | 4.508 / 10–12 | 15 was between 10 and 12; the corrected adjacent pair is 10–12. |

No corrected-greater case is caused by removing a wide wing as an interior hole: Candidate B only removes a wing when it is outside the retained non-wing core envelope and therefore an edge. The six increases are the expected consequence of excluding the sweeper from adjacency, and they are reported explicitly.

## Why this is an engine-anchored design

- **Law context:** the population is evaluated only during the live open-play context represented by `liveOffsideLines()`/the active carrier line; the attacking law line is not inverted into a defensive rule.
- **Authored shape:** the designated sweeper/last-line assignment, authored wing identities, `DEFENCE_CHANNELS`, and the active `DF-UMBRELLA` parameters determine role and edge treatment.
- **System geometry:** `maxSpacing` supplies the system spacing context; `sweeperDepth` identifies the cover role; `fringeGuard` is available to distinguish the ruck-fringe corridor from a generic centre-line gap. None is replaced by a median or by a target-depth percentile.
- **Determinism:** the measurement uses the seeded bot driver and the required `runDeep` then `runTrace` sequence, not an empty-input `Director.update()` loop.
- **Scope:** this changes only the diagnostic population design. It does not suppress genuine gaps. The seven surviving samples are retained for Task B diagnosis.

## Halt point

Batch 02A stops here. No edit to `src/game/trace.ts`, `src/game/audit.ts`, or any live engine rule has been made. The surviving seed-2 and seed-3 events are the input to `BATCH_02B_DIAGNOSIS.md`; no Task B fix is authorized in this batch.
