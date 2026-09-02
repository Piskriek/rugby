import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
let s = 3 >>> 0 || 1;
const dt = 1 / 60;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const G = globalThis as unknown as { dives?: number };
G.dives = [];
let minToLine = 99, tries = 0, entries = 0, inRed = false, team: 'A' | 'B' = 'A';
for (let m = 0; m < 3; m++) {
  const d = new Director(gateConfig(3));
  let guard = 60 * 800;
  while (!d.over && guard-- > 0) {
    if (d.op) {
      if (!inRed && d.op.toLine < 24) { inRed = true; team = d.op.attacking; entries++; }
      if (inRed && d.op.attacking === team) minToLine = Math.min(minToLine, d.op.toLine);
      if (inRed && (d.op.attacking !== team || d.op.toLine > 30)) inRed = false;
    }
    const t0 = d.events.filter((e) => e.kind === 'TRY').length;
    d.update(dt, NO_INPUT, new Set());
    if (d.events.filter((e) => e.kind === 'TRY').length > t0) tries++;
  }
}
const launched = Array.isArray(G.dives) ? G.dives : [];
for (const l of launched) console.log('  ', l);
console.log(`dives launched: ${launched.length}, entries ${entries}, tries ${tries}, closest toLine ${minToLine.toFixed(2)}`);
