# SPEC_10 Baseline — per-family re-measurement (Phase 1 output)

Rule audit: 4 difficulties x 5 seeds x 90s episodes (20 cells, 291 non-PASS results). Realism audit: 5 full matches per difficulty. Watchdog trips 0, teleports 0 across all cells.

## Layer A — rule-audit families (sorted by FAIL count)

| family | rules seen | FAIL | WARN | FAIL d0 | d3 | d6 | d9 | worst fail/1k pts | top rule | exemplar |
|---|---|---|---|---|---|---|---|---|---|---|
| DEFENSIVE_LINE | 1 | 162 | 0 | 24 | 42 | 51 | 45 | 10.3 (d6) | LAW-66 | 7.4 m hole in the defensive line |
| PLAYERS_AIRBORNE | 2 | 22 | 0 | 2 | 9 | 10 | 1 | 2.0 (d6) | UX-58 | the receiving side has nobody near the drop |
| PLAYERS_POS | 4 | 4 | 94 | 2 | 1 | 0 | 1 | 0.4 (d0) | LAW-17 | 2 of the kicking team ahead of the ball at the restart |
| CAMERA | 2 | 4 | 2 | 0 | 1 | 3 | 0 | 0.6 (d6) | UX-23 | ball off screen — the player cannot see the ball |
| BALL | 1 | 3 | 0 | 0 | 0 | 1 | 2 | 0.4 (d9) | LAW-41 | ball travelling backwards relative to the kick |

## Layer B — realism families (values per difficulty; range and worst grade)

| metric | d0 | d3 | d6 | d9 | range | worst |
|---|---|---|---|---|---|---|
| POINTS PER TEAM | 19.2 | 18.6 | 10.3 | 17.5 | 12 .. 34 | LOW |
| TRIES PER TEAM | 2.0 | 1.5 | 0.7 | 1.5 | 1 .. 6 | LOW |
| TACKLES PER TEAM | 54.6 | 54.5 | 55.5 | 52.8 | 90 .. 220 | LOW |
| RUCKS PER MATCH | 79.8 | 81.8 | 79.8 | 77.0 | 120 .. 200 | LOW |
| SCRUMS PER MATCH | 8.2 | 6.8 | 8.2 | 8.4 | 14 .. 20 | LOW |
| LINEOUTS PER MATCH | 9.0 | 10.0 | 14.6 | 8.2 | 20 .. 28 | LOW |
| PENALTIES PER MATCH | 22.8 | 20.8 | 24.2 | 22.2 | 14 .. 28 | REALISTIC |
| PASSES PER MATCH | 168.2 | 151.8 | 143.8 | 182.2 | 180 .. 340 | LOW |
| KICKS FROM HAND | 33.4 | 36.2 | 33.4 | 31.6 | 30 .. 70 | REALISTIC |
| METRES CARRIED PER TEAM | 382.8 | 375.1 | 354.9 | 396.3 | 250 .. 800 | REALISTIC |
| LINE BREAKS PER TEAM | 3.8 | 4.6 | 3.3 | 4.9 | 2 .. 16 | REALISTIC |
| TURNOVERS PER MATCH | 6.0 | 4.6 | 6.4 | 6.2 | 10 .. 32 | LOW |
| POSSESSION SPLIT (% OF MAX) | 48.2 | 46.5 | 51.5 | 43.5 | 40 .. 60 | REALISTIC |
| OFFLOADS PER MATCH | 4.4 | 4.4 | 6.2 | 4.8 | 4 .. 30 | REALISTIC |
| OFFSIDE PENALTIES PER TEAM | 3.9 | 4.2 | 5.0 | 5.4 | 2 .. 4 | HIGH |
| P90 TARGET-SLOT DRIFT (M) | 0.3 | 0.3 | 0.3 | 2.8 | 0 .. 2.5 | HIGH |

Realism score d0: 60% (9/15)
Realism score d3: 53% (8/15)
Realism score d6: 40% (6/15)
Realism score d9: 60% (9/15)

