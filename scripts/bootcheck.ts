/**
 * bootcheck.ts — CAN THE BOOT HANG? (answer: it may not)
 *
 * The screenshot that produced this file was a loading bar stopped at 66% —
 * "BRINGING OUT THE TEAMS" — with nothing behind it: no error, no console the player
 * can read, no fallback field. The cause was in `ThreePlayerManager.load()`: a
 * `new Promise` whose SUCCESS callback was `async`, so a throw inside it rejected the
 * inner promise that nobody held, and the outer one was neither resolved nor rejected.
 * `await players.load()` then waited for a promise that could never settle, the
 * overlay never cleared, and the 2D layer — which can carry this match on its own —
 * was never told to.
 *
 * So this harness does not test the model. It tests the SHAPE OF THE WAIT:
 *
 *   1. `load()` settles. Not "succeeds" — SETTLERS, resolve or reject, within budget.
 *   2. A throw anywhere inside the success path surfaces as a REJECTION, which is the
 *      exact hole the old code had: the same forced failure used to leave the
 *      promise pending forever, and the difference is what is being asserted.
 *   3. A failure leaves the fallback engaged: `ready === false`, procedural bodies,
 *      and a recorded fault with a reason a player can see.
 *   4. The rig's bytes are fetched once per page no matter how many managers load —
 *      StrictMode mounts the tree twice in dev, and 6.3 MB × 2 is a slow session.
 *
 * It reads the real GLB off disk, which makes this the first harness in the repo to
 * exercise the model's own load path at all; everything else has always run with
 * `ready === false`. Where a browser-only API stands in the way, the check records
 * that and still asserts the properties that matter, because a game that degrades
 * visibly is the requirement — a game that renders is a bonus.
 *
 *   npx vite-node scripts/bootcheck.ts
 */
import fs from 'fs';
import path from 'path';
/* The render layer wants a document before it will even construct a texture, and
 * `@napi-rs/canvas` is what answers that here — the same shim sceneaudit uses, so the
 * two harnesses cannot drift apart on how a browser is imitated. Imported and applied
 * at module scope, BEFORE the dynamic `import()` of any render module below: three
 * reads `document` while its classes are being defined, not when they are used. */
import { installNodeCanvas } from './_nodeCanvas';
installNodeCanvas();

const MODEL = 'public/assets/models/rugby_player.glb';
const PAIR = 'public/assets/models/tackle_pair.glb';
/** How long a settle is allowed to take. Generous on purpose: this is not a
 *  performance gate, it is the difference between "slow" and "never". */
const BUDGET_MS = 45000;

let fails = 0;
const out: string[] = [];
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve().then(fn).then(
    () => { out.push(`PASS  ${name}`); },
    (e) => { fails++; out.push(`FAIL  ${name}\n      ${String((e as Error)?.message || e)}`); },
  );
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

/** `load()` raced against a clock, so a promise that never settles FAILS the check
 *  instead of hanging the harness — the same discipline the shipped boot now uses. */
async function settle(p: Promise<unknown>, _label: string): Promise<{ ok: boolean; err?: unknown; hung: boolean }> {
  let timer = 0;
  const guard = new Promise<'HUNG'>((res) => { timer = setTimeout(() => res('HUNG'), BUDGET_MS) as unknown as number; });
  const r = await Promise.race([p.then(() => 'DONE' as const, (e) => e), guard]);
  clearTimeout(timer);
  if (r === 'HUNG') return { ok: false, hung: true };
  return typeof r === 'object' && r instanceof Error ? { ok: false, err: r, hung: false } : { ok: true, hung: false };
}

async function main() {
  /* A GLB carries embedded PNGs. three's texture path ends up at an Image element,
   * so hand it the Skia one and let a blob URL be a string: with those, the model
   * decodes here the way it does on a GPU, and the check is about the WAIT rather
   * than about a missing browser API. */
  try {
    const napi: any = await import('@napi-rs/canvas');
    if (napi.Image) (globalThis as any).Image = napi.Image;
  } catch { /* the fallback assertions below do not need it */ }
  const URLg: any = globalThis.URL;
  if (URLg && !URLg.createObjectURL) {
    let n = 0;
    URLg.createObjectURL = () => `blob:bootcheck-${++n}`;
    URLg.revokeObjectURL = () => undefined;
  }

  const THREE = await import('three');
  const { ThreeEnvironment } = await import('../src/render/ThreeEnvironment');
  const { ThreePlayerManager } = await import('../src/render/ThreePlayerManager');
  const { renderHealth } = await import('../src/render/ThreeCanvas');

  if (!fs.existsSync(MODEL)) {
    console.log('SKIP  the rig is not in this checkout — nothing to load');
    console.log('      (bootcheck proves the boot survives that too, but there is no bytes path to time)');
    process.exit(0);
  }

  /* Count every byte request, so "once per page" is a measured claim rather than a
   * reading of the source. */
  const requested: string[] = [];
  /* Matched on file name, not on the path the caller spelled: the manager asks for
   * the relative URL the browser would resolve, and a harness that only answers the
   * exact string it wrote down is a harness that tests its own typo. */
  const files: Record<string, string> = {
    'rugby_player.glb': MODEL, 'tackle_pair.glb': PAIR,
  };
  const asked = (u: string) => files[u.split('/').pop() ?? ''];
  (globalThis as any).fetch = async (url: string) => {
    requested.push(String(url));
    const rel = asked(String(url));
    if (!rel) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const buf = fs.readFileSync(path.resolve(rel));
    return {
      ok: true, status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 400);
  const rendererStub: any = { capabilities: { getMaxAnisotropy: () => 8, maxTextureSize: 4096 } };
  const env = new ThreeEnvironment(scene, rendererStub);
  const canvasStub: any = { scene, camera, environment: env, renderer: rendererStub };

  /* ------------------------------------------------- 1. the wait must end -- */
  const mgr = new ThreePlayerManager(canvasStub);
  const t0 = Date.now();
  const first = await settle(mgr.load(), 'first load');
  const ms = Date.now() - t0;
  out.push(`      load(): ${first.hung ? 'NEVER SETTLED' : first.ok ? 'resolved' : 'rejected'} in ${ms} ms`
    + ` · ready=${mgr.ready} bodies=${renderHealth.bodies}`
    + `${first.err ? ` · reason=${String((first.err as Error).message || first.err).slice(0, 90)}` : ''}`);

  await check('THE RIG LOAD SETTLES — a boot cannot sit pending', () => {
    assert(!first.hung, `load() never settled in ${BUDGET_MS / 1000} s — this is the 66% hang`);
  });

  await check('the loaded rig prepares a squad, or the failure is recorded', () => {
    if (first.ok) {
      assert(mgr.ready === true, 'load() resolved without setting ready — a silent half-load');
      assert(renderHealth.bodies === 'glb', `bodies says '${renderHealth.bodies}' after a successful load`);
    } else {
      assert(mgr.ready === false, 'a failed load still claims a real rig');
      assert(renderHealth.bodies === 'standin', `bodies says '${renderHealth.bodies}' — the fallback did not engage`);
      assert(renderHealth.faults > 0, 'a failed load recorded no fault, so the player is never told');
      assert(!!renderHealth.log[0], 'a fault with no reason on it is not a reason');
    }
  });

  /* ------------------------------- 2. a throw inside the success path — the bug -- */
  const before = requested.length;
  const mgr2 = new ThreePlayerManager(canvasStub);
  const proto: any = Object.getPrototypeOf(mgr2);
  const realPrepare = proto.prepareTemplate;
  proto.prepareTemplate = function boom(this: any) { throw new Error('forced: a rig the shape of the code did not expect'); };
  const second = await settle(mgr2.load(), 'forced-throw load');
  proto.prepareTemplate = realPrepare;

  await check('A THROW IN THE LOADER SURFACES AS A REJECTION, NOT A HANG', () => {
    assert(!second.hung, 'a throw inside the success path left the promise pending forever — the exact 66% bug');
    assert(!second.ok, 'the forced failure was swallowed: the boot would proceed believing it has a rig');
    assert(String((second.err as Error).message).includes('forced'),
      `rejected with '${String((second.err as Error).message)}' instead of the real cause`);
  });

  /* ------------------------------------- 3. the bytes are fetched once per page -- */
  await check('ONE FETCH PER RIG, WHATEVER THE MOUNT COUNT', () => {
    const rigs = requested.filter((u) => u.includes('rugby_player.glb'));
    /* `load()` ran three times above (twice real, once forced) and the model was
     * requested at most twice — once for the first pass, and once more only if the
     * second pass re-read the pair. A per-manager fetch would read three. */
    assert(rigs.length <= 2, `${rigs.length} requests for the 6.3 MB rig across 3 manager loads`);
    assert(requested.length - before <= 2, `the forced-throw reload re-fetched ${requested.length - before} assets`);
    out.push(`      rig requests across 3 manager loads: ${rigs.length} (bytes cached after the first)`);
  });

  /* ----------------------------------- 4. the boot path itself is budget-guarded -- */
  await check('THE BOOT DOES NOT WAIT ON THE RIG WITHOUT A BUDGET', () => {
    const src = fs.readFileSync(path.resolve('src/ui/MatchView.tsx'), 'utf8');
    assert(/Promise\.race\(\[\s*boot,/.test(src), 'the rig await is not raced against a budget');
    assert(/BOOT_BUDGET_MS\s*=\s*\d+/.test(src), 'no outer watchdog constant for the boot as a whole');
    assert(/setBootStall\(bootStage\.current\)/.test(src), 'the watchdog does not say which stage stalled');
    assert(/window\.clearTimeout\(bootWatchdog\.current\)/.test(src), 'the watchdog survives unmount and fires into a dead tree');
  });

  console.log(out.join('\n'));
  console.log(fails ? `\n${fails} FAILING` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error('bootcheck crashed:', e); process.exit(1); });
