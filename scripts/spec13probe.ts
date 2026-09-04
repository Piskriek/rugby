/**
 * SPEC_13 BASELINE PROBE — how forward are the passes, really?
 *
 * Usage:  npx vite-node scripts/spec13probe.ts [seconds] [difficulty] [seed...]
 *
 * Law 11 asks whether the ball left the thrower's hands forward RELATIVE TO
 * HIM. A flat pass thrown by a man running forward is legal; the same pass
 * thrown by a stationary man is not. The absolute direction the ball travels
 * over the ground is the wrong question, and it is the one a naive test asks.
 *
 * This probe measures the relative quantity on seeded runs, before anything
 * is changed (house rule 2: no threshold fiddling before measurement).
 *
 * THE MEASUREMENT, and why it is taken this way. The engine does not solve a
 * landing point — `solvePassTarget` is dead code, never called. `doPass` puts
 * the ball on the carrier and `upOpen` then flies it at a constant 13 m/s
 * ground speed toward where the receiver is RIGHT NOW, every frame, while the
 * receiver is steered to a point one metre ahead of the ball. So the flight is
 * a pursuit curve, the "landing point" does not exist until the catch, and the
 * only honest place to take the measurement is the moment of release:
 *
 *     v_ball  = PASS_SPEED · unit(receiver_at_release − carrier_at_release)
 *     v_man   = carrier's world velocity
 *     rel     = (v_ball − v_man) · dir          // m/s along the attack axis
 *
 * `rel > 0` is a throw-forward. `rel > tol` is one the referee would blow.
 *
 * Read-only. Nothing here moves a player or changes a decision.
 */
import { Director, NO_INPUT, MatchConfig } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

/** `upOpen` flies the ball at a constant 13 m/s ground speed (open.ts). */
const PASS_SPEED = 13;

const seconds = Number(process.argv[2] ?? 200);
const diff = Number(process.argv[3] ?? 3);
const argSeeds = process.argv.slice(4).map(Number).filter((n) => !Number.isNaN(n));
const list = argSeeds.length ? argSeeds : [1, 7, 13];

interface Sample {
  rel: number;          // m/s forward relative to the thrower — THE measurement
  absolute: number;     // m/s forward in world terms, for contrast
  manForward: number;   // m/s the thrower was carrying upfield
  displacement: number; // metres the receiver is ahead of the thrower
  distance: number;     // length of the pass, m
}

const all: Sample[] = [];
/** Flights in the air, so the net travel can be compared with the release. */
const inFlight = new Map<number, { z: number; x: number; man: number; t: number; rel: number }>();
const net: { relAtRelease: number; netRel: number; flight: number }[] = [];
let passes = 0;

for (const seed of list) {
  seedRng(seed);
  const cfg: MatchConfig = gateConfig(diff);
  const d = new Director(cfg);
  let wasLive = false;
  for (let i = 0; i < Math.ceil(seconds * 60) && !d.over; i++) {
    d.update(1 / 60, NO_INPUT, new Set());
    const s = d.op;
    const live = !!s?.ball.live;
    /* The catch: the ball was in flight and no longer is. Compare where it
     * landed with where a legal release says it should have. */
    if (!live && wasLive) {
      for (const [num, f] of inFlight) {
        const dz = (s?.ball.z ?? f.z) - f.z;
        const dir = (s?.dir ?? 1) >= 0 ? 1 : -1;
        const flight = Math.max(0.016, (s?.t ?? f.t) - f.t);
        net.push({
          relAtRelease: f.rel,
          /* metres the ball gained relative to the ground the thrower's legs
           * would have carried it in the same time */
          netRel: dz * dir - f.man * flight,
          flight,
        });
        inFlight.delete(num);
      }
    }
    /* The launch frame: the ball was not in flight before this update and is
     * now. `s.carrierNum` is still the thrower — it becomes the receiver only
     * on the catch — and `s.ball.x/z` is the release point. */
    if (live && !wasLive && s) {
      const car = d.L(s.attacking, s.carrierNum);
      const rec = d.L(s.attacking, s.pendingReceiver ?? s.carrierNum);
      const dir = s.dir >= 0 ? 1 : -1;
      const dx = rec.x - car.x, dz = rec.z - car.z;
      const dd = Math.hypot(dx, dz) || 1;
      const ballVz = (dz / dd) * PASS_SPEED;
      const manVz = car.vz;
      passes++;
      inFlight.set(d.t, { z: s.ball.z, x: s.ball.x, man: (manVz * dir), t: d.t, rel: (ballVz - manVz) * dir });
      all.push({
        rel: (ballVz - manVz) * dir,
        absolute: ballVz * dir,
        manForward: manVz * dir,
        displacement: dz * dir,
        distance: dd,
      });
    }
    wasLive = live;
  }
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};
const rel = all.map((x) => x.rel);
const fwd = rel.filter((r) => r > 0);

console.log(`\n=== SPEC_13 BASELINE — ${seconds}s × ${list.length} seeds at difficulty ${diff} ===`);
console.log(`  passes executed            ${passes}`);
console.log(`  forward relative to man    ${fwd.length}  (${(100 * fwd.length / Math.max(1, passes)).toFixed(1)}% of all passes)`);
console.log(`  rel (m/s)   min ${q(rel, 0).toFixed(2)}   p50 ${q(rel, 0.5).toFixed(2)}   p90 ${q(rel, 0.9).toFixed(2)}   p99 ${q(rel, 0.99).toFixed(2)}   max ${q(rel, 1).toFixed(2)}`);
console.log(`  thrower's own forward speed (m/s)  p50 ${q(all.map((x) => x.manForward), 0.5).toFixed(2)}   p90 ${q(all.map((x) => x.manForward), 0.9).toFixed(2)}`);
console.log(`  receiver ahead of thrower (m)      p50 ${q(all.map((x) => x.displacement), 0.5).toFixed(2)}   p90 ${q(all.map((x) => x.displacement), 0.9).toFixed(2)}`);

console.log(`\n  WHAT EACH TOLERANCE WOULD WHISTLE (per ${seconds}s × ${list.length} seeds, i.e. ~${(seconds * list.length / 400).toFixed(1)} matches)`);
for (const [name, tol] of [['STRICT', 0], ['NORMAL', 0.5], ['LENIENT', 1.5]] as const) {
  const blown = rel.filter((r) => r > tol).length;
  console.log(`     ${name.padEnd(8)} tol ${String(tol).padStart(4)} m/s  ->  ${String(blown).padStart(5)} whistles`
    + `   (${(blown / Math.max(1, (seconds * list.length) / 400)).toFixed(1)} per match)`);
}

const netRel = net.map((x) => x.netRel);
const legalReleaseForwardArrival = net.filter((x) => x.relAtRelease <= 0 && x.netRel > 0.5);
console.log(`\n  DID THE FLIGHT MANUFACTURE FORWARD TRAVEL? (${net.length} flights tracked to the catch)`);
console.log(`     net gain relative to the thrower's momentum (m)  p50 ${q(netRel, 0.5).toFixed(2)}   p90 ${q(netRel, 0.9).toFixed(2)}   max ${q(netRel, 1).toFixed(2)}`);
console.log(`     released LEGALLY but ARRIVED forward by >0.5 m: ${legalReleaseForwardArrival.length}`
  + `  (worst ${legalReleaseForwardArrival.length ? Math.max(...legalReleaseForwardArrival.map((x) => x.netRel)).toFixed(2) : '—'} m)`);

console.log(`\n  THE MOMENTUM DEFENCE — passes that look forward but are not`);
const absFwd = all.filter((x) => x.absolute > 0).length;
const legalButWorldForward = all.filter((x) => x.absolute > 0 && x.rel <= 0).length;
console.log(`     ball travelled forward over the ground: ${absFwd}`);
console.log(`     ...of those, LEGAL because the thrower's momentum carried it: ${legalButWorldForward}`);
console.log(`     a naive absolute-direction test would whistle ${absFwd} passes; the relative test whistles ${fwd.length}.`);
