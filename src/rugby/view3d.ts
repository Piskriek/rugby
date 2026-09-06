/**
 * RugbyView3D — the 2026 engine's 3D viewport.
 *
 * This is NOT a renderer rewrite. It reuses the shipped WebGL layer verbatim —
 * `ThreeCanvas` (viewport + off-axis lens), `ThreeEnvironment` (pitch, fog,
 * uprights, boards) and `ThreePlayerManager` (the GLB squad, kit recolouring,
 * the clip state machine, the tackle timeline and the ball socket) — and
 * bridges the new `RugbySim` into it through a thin adapter.
 *
 * The only decoupling done was in ThreePlayerManager itself (its two legacy
 * value imports became local constants) so the new build does not pull the
 * 18k-line prototype back into the bundle.
 *
 * Coordinate bridge (engine → render). The legacy pitch is (x across, z
 * downfield); the new engine is (x downfield, y across). So:
 *   legacy rx  = engine p.y          (across)
 *   legacy rz  = engine p.x          (downfield)
 * and the camera follows the ball with the shipped `chaseCam` rig.
 */
import { ThreeCanvas } from '../render/ThreeCanvas';
import { ThreePlayerManager } from '../render/ThreePlayerManager';
import { chaseCam } from '../render/retro';
import type { View } from '../render/retro';
import type { RugbySim } from './engine';
import type { Player } from './types';

/** A minimal legacy-Actor-shaped record — everything ThreePlayerManager reads. */
interface FeedActor {
  id: number; team: 'A' | 'B' | 'REF'; num: number;
  rx: number; rz: number; rf: number; renderClip: string;
}

export class RugbyView3D {
  three: ThreeCanvas | null = null;
  players: ThreePlayerManager | null = null;
  ready = false;
  failed = false;

  private view: View = { w: 1, h: 1 };
  private actors: FeedActor[] = [];

  constructor(container: HTMLElement) {
    for (let i = 0; i < 30; i++) {
      this.actors.push({ id: 0, team: 'A', num: 0, rx: 0, rz: 0, rf: 1, renderClip: 'idle' });
    }
    try {
      this.three = new ThreeCanvas(container);
      this.players = new ThreePlayerManager(this.three);
      this.players.load().then(
        () => { this.ready = true; },
        (e) => { this.failed = true; console.error('[view3d] GLB load failed:', e); },
      );
      this.resize();
    } catch (e) {
      // no WebGL context — the 2D retro painter takes over in MatchScreen
      this.failed = true;
      this.three = null;
      this.players = null;
      console.error('[view3d] WebGL unavailable, falling back to 2D:', e);
    }
  }

  get dom(): HTMLCanvasElement | null { return this.three?.dom ?? null; }

  resize() {
    if (!this.three) return { w: this.view.w, h: this.view.h };
    const d = this.three.resize();
    this.view = { w: d.w || this.view.w, h: d.h || this.view.h };
    return d;
  }

  /** Step the bridge one frame. `dt` = wall-clock frame time (0 when paused). */
  update(sim: RugbySim, dt: number) {
    const three = this.three;
    const players = this.players;
    if (!three || !players) return;
    if (this.view.w === 0 || this.view.h === 0) this.resize();
    const w = three.dom.clientWidth || this.view.w;
    const h = three.dom.clientHeight || this.view.h;
    if (w !== this.view.w || h !== this.view.h) this.resize();
    const view = this.view;

    // The broadcast camera trails the attack, following the ball.
    const cam = chaseCam(view, {
      tx: sim.ball.y,
      tz: sim.ball.x,
      dir: sim.attackDir(sim.possession ?? 'A'),
      zoom: 0.35,
    });
    three.syncCamera(cam, view);

    if (this.ready) {
      this.buildActors(sim);
      const feed = this.buildFeed(sim);
      players.update(feed as never, view, cam, Math.min(dt, 0.05));
    }

    three.render();
  }

  dispose() {
    this.three?.dispose();
    this.three = null;
    this.players = null;
  }

  /* ---------------------------------------------------------- feed build -- */

  private buildActors(sim: RugbySim) {
    let i = 0;
    for (const p of sim.A.players) this.actors[i++] = actorFor(sim, p);
    for (const p of sim.B.players) this.actors[i++] = actorFor(sim, p);
    while (i < this.actors.length) {
      this.actors[i] = { ...this.actors[i], team: 'A', num: 0, rx: -100, rz: -100 };
      i++;
    }
  }

  private buildFeed(sim: RugbySim): Record<string, unknown> {
    const bd = sim.breakdown?.state ?? null;
    const phase = legacyPhase(sim);
    const ball = sim.ball;
    const carrier = sim.carrier();

    const feed: Record<string, unknown> = {
      actors: this.actors,
      phase,
      possession: sim.possession,
    };

    if (bd) {
      feed.bd = {
        hitKind: bd.hitKind,
        stage: bd.stage === 'IMPACT' || bd.stage === 'GROUND' ? 'CONTACT'
          : bd.stage === 'ARRIVE' || bd.stage === 'CLEANOUT' ? 'PLACE'
            : bd.stage === 'RUCK' ? 'RUCK' : 'RECYCLE',
        ball: { x: bd.ball.y, y: 0, z: bd.ball.x, placed: bd.ball.placed },
        players: bd.slots.map((s) => {
          const p = sim.player(s.id);
          return { role: s.role, num: p?.num ?? 0, team: s.side, x: p?.y ?? 0, z: p?.x ?? 0, down: (p?.down ?? 0) > 0 };
        }),
      };
    } else if (phase === 'MAUL' && sim.maul) {
      feed.ml = { yaw: 0, dir: sim.attackDir(sim.maul.side), ballRank: 1, x: sim.maul.y, z: sim.maul.x };
    } else if (phase === 'SCRUM' && sim.scrum) {
      feed.scrumAnchor = { x: sim.scrum.y, z: sim.scrum.x };
      feed.scrim = { ball: { x: 0, y: 0.05, z: 0, state: 'ON_GROUND' } };
    } else if (phase === 'LINEOUT' && sim.lineout) {
      feed.lo = { ball: { x: ball.y, y: ball.z, z: ball.x, state: 'ON_GROUND' } };
    } else if (phase === 'KICK') {
      feed.kk = { stage: 'FLIGHT', bx: ball.y, by: ball.z + 0.05, bz: ball.x };
    } else {
      // open play (and the rare loose-ball ruck / try): ball live or socketed
      feed.op = {
        ball: { live: ball.owner == null, x: ball.y, y: ball.z, z: ball.x },
        attacking: carrier ? carrier.side : (sim.possession ?? 'A'),
        carrierNum: carrier ? carrier.num : 0,
      };
    }

    return feed;
  }
}

/* ------------------------------------------------------------ clip logic -- */

function actorFor(sim: RugbySim, p: Player): FeedActor {
  return {
    id: p.id,
    team: p.side,
    num: p.num,
    rx: p.y,
    rz: p.x,
    rf: Math.cos(p.face) >= 0 ? 1 : -1,
    renderClip: clipFor(sim, p),
  };
}

function clipFor(sim: RugbySim, p: Player): string {
  const bd = sim.breakdown?.state;
  if (bd) {
    const slot = bd.slots.find((s) => s.id === p.id);
    if (!slot) return 'ready';
    switch (slot.role) {
      case 'CARRIER': return 'grounded';
      case 'TACKLER': return 'tackle';
      case 'FIRST_CLEARER': case 'CLEANER': return 'cleanout';
      case 'JACKAL': return 'jackal';
      case 'COUNTER': return 'ruck';
      default: return 'ready';
    }
  }
  switch (sim.phase) {
    case 'SCRUM':
      if (p.num <= 8) return 'scrumBind';
      if (p.num === 9) return 'nineSquat';
      return 'ready';
    case 'LINEOUT':
      if (p.num === 4 || p.num === 5) return 'jump';
      if (p.num === 2 && sim.lineout?.thrower === p.side) return 'lineoutThrow';
      return 'ready';
    case 'MAUL':
      return sim.maul?.bound.includes(p.id) ? 'maul' : 'ready';
    case 'TRY': {
      // the scorer celebrates with the slide; nearest man to the grounding point
      let best: Player | null = null, bestD = Infinity;
      const squad = p.side === 'A' ? sim.A.players : sim.B.players;
      for (const q of squad) {
        const d = Math.hypot(q.x - sim.ball.x, q.y - sim.ball.y);
        if (d < bestD) { bestD = d; best = q; }
      }
      return best === p ? 'try' : 'ready';
    }
  }
  if (p.down > 0) return 'grounded';
  const b = sim.ball;
  if (b.owner == null && b.last === p.id) {
    if (b.flight > 0) return 'kick';
    if (b.z > 0.05) return 'pass';
  }
  return 'idle';
}

/* -------------------------------------------------------------- phases --- */

function legacyPhase(sim: RugbySim): string {
  if (sim.breakdown?.state) return 'BREAKDOWN';
  switch (sim.phase) {
    case 'SCRUM': return 'SCRUM';
    case 'LINEOUT': return 'LINEOUT';
    case 'KICKOFF': case 'DROP_KICK': case 'PLACE_KICK': return 'KICK';
    case 'MAUL': return 'MAUL';
    default: return 'OPEN_PLAY';
  }
}
