/**
 * T-80 — multi-body compliant latch probe.
 *
 * Plays full seeded matches headless and reads the LatchSystem telemetry at
 * every breakdown exit. Acceptance questions, answered with numbers:
 *   - do bodies bind, and do the binds HOLD (joint age, break reasons)?
 *   - does the pile compress without clipping (max penetration <= radius)?
 *   - is the solver stable (instability frames, NaN resets)?
 *   - does the ruck contest MOVE by net force (ball displacement)?
 *   - do gate rejects / unbound entrants happen (legality is real)?
 *
 * Usage: npx vite-node scripts/t80probe.ts [matches] [seedBase]
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const matches = Number(process.argv[2] ?? 2);
const seedBase = Number(process.argv[3] ?? 100);
const dt = 1 / 60;

for (let m = 0; m < matches; m++) {
  seedRng(seedBase + m * 17);
  const d = new Director(gateConfig(3));
  let ep = 0, withBind = 0, epTackle = 0, epRuck = 0;
  let maxAge = 0, maxStrain = 0, maxPen = 0, maxForce = 0, maxTorque = 0;
  let instab = 0, gateRejects = 0, skipped = 0, ballDisp = 0, jarring = 0;
  let wPair = '', wSnap = { ax: 0, az: 0, bx: 0, bz: 0, va: 0, vb: 0 };
  let frameJoints = 0;
  const releases = new Map<string, number>();
  const ages: number[] = [];
  let inEp = false;
  let eAge = 0, eTackle = false, eRuck = false;
  let guard = 60 * 500;
  while (!d.over && guard-- > 0) {
    d.update(dt, NO_INPUT, new Set());
    const S = d.latches;
    const live = d.bd !== undefined && S.bodies.length > 0;
    if (live) {
      if (!inEp) { inEp = true; eAge = 0; eTackle = false; eRuck = false; }
      const n = S.bindCounts();
      if (n.tackle > 0) eTackle = true;
      if (n.ruck > 0) eRuck = true;
      for (const j of S.joints) {
        eAge = Math.max(eAge, j.age);
        maxStrain = Math.max(maxStrain, j.strain);
        maxForce = Math.max(maxForce, Math.hypot(j.force.x, j.force.y, j.force.z));
        maxTorque = Math.max(maxTorque, j.torque);
      }
      if (S.metrics.maxPenetration > maxPen) {
        maxPen = S.metrics.maxPenetration;
        wPair = S.metrics.worstPair;
        wSnap = S.metrics.worstSnap;
      }
      instab += S.metrics.instabilityFrames;
      gateRejects += S.metrics.gateRejects;
      skipped += S.metrics.skippedBinds;
      const ball = S.byKind('BALL');
      if (ball && d.bd) {
        ballDisp = Math.max(ballDisp, Math.hypot(ball.x - d.bd.contactX, ball.z - d.bd.contactZ));
      }
      for (const b of S.bodies) {
        if (Math.hypot(b.vx, b.vz) > 8.5) jarring++;
        if (!Number.isFinite(b.x + b.z + b.vx + b.vz)) console.log('  [probe] NON-FINITE body', b.kind, b.num);
      }
      frameJoints += S.joints.length;
    } else if (inEp) {
      inEp = false;
      ep++;
      if (eTackle || eRuck) withBind++;
      if (eTackle) epTackle++;
      if (eRuck) epRuck++;
      for (const [k, v] of Object.entries(S.metrics.releases)) releases.set(k, (releases.get(k) ?? 0) + v);
      if (eTackle && !eRuck) ages.push(eAge);   // tackle-only bind hold time
    }
  }
  const rel = [...releases.entries()].map(([k, v]) => `${k}=${v}`).join(' ');
  const epJoints = ep ? (frameJoints / ep) : 0;
  const aa = [...ages].sort((a, b) => a - b);
  const q = (f: number) => aa.length ? aa[Math.min(aa.length - 1, Math.floor(aa.length * f))].toFixed(2) : '0';
  console.log(`match ${m + 1} seed=${seedBase + m * 17}:`);
  console.log(`  breakdowns=${ep} withBinds=${withBind} (${ep ? ((withBind / ep) * 100).toFixed(0) : 0}%) tackleBindEps=${epTackle} ruckBindEps=${epRuck}`);
  console.log(`  joints/breakdown-avg=${epJoints.toFixed(2)} tackleBindAge p50=${q(0.5)}s p90=${q(0.9)}s max=${q(1)}s`);
  console.log(`  maxStrain=${maxStrain.toFixed(2)} maxForce=${Math.round(maxForce)}N maxTorque=${Math.round(maxTorque)}Nm`);
  console.log(`  maxPen=${maxPen.toFixed(3)}m (worst=${wPair} @ (${wSnap.ax.toFixed(1)},${wSnap.az.toFixed(1)})<->(${wSnap.bx.toFixed(1)},${wSnap.bz.toFixed(1)}) v=${wSnap.va.toFixed(1)}/${wSnap.vb.toFixed(1)})`);
  console.log(`  maxBallDisp=${ballDisp.toFixed(3)}m instab=${instab} jarring=${jarring}`);
  console.log(`  gateRejects=${gateRejects} skippedBinds=${skipped} releases: ${rel}`);
}
