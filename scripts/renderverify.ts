/**
 * renderverify — guards render-pipeline mistakes that produce a broken
 * frame with no error in the console.
 *
 *   npx vite-node scripts/renderverify.ts
 */
import fs from 'node:fs';

let ok = true;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
}

const env = fs.readFileSync('src/render/ThreeEnvironment.ts', 'utf8');
const canvas = fs.readFileSync('src/render/ThreeCanvas.ts', 'utf8');
const players = fs.readFileSync('src/render/ThreePlayerManager.ts', 'utf8');

/* Pitch planes are laid flat. A missing -PI/2 leaves the turf standing
 * upright in world XZ and the 3D players hover beside a wall of grass. */
{
  const innerFlat = /inner\.rotation\.x = -Math\.PI \/ 2/.test(env);
  const outerFlat = /outer\.rotation\.x = -Math\.PI \/ 2/.test(env);
  check('inner pitch is laid flat', innerFlat, innerFlat ? 'rotation.x = -PI/2' : 'MISSING');
  check('outer ground is laid flat', outerFlat, outerFlat ? 'rotation.x = -PI/2' : 'MISSING');
  const innerY = /inner\.position\.y = 0/.test(env);
  const outerBelow = /outer\.position\.y = -0\.05/.test(env);
  check('inner pitch sits at y=0', innerY, innerY ? 'players stand on the markings' : 'pitch height drifted');
  check('outer ground is under the pitch', outerBelow, outerBelow ? 'y = -0.05' : 'may z-fight the inner plane');
}

/* Cel shading + no shadow maps — the look the 2D pitch already has. */
{
  const toon = /new THREE\.MeshToonMaterial/.test(env) && /new THREE\.MeshToonMaterial/.test(players);
  check('MeshToonMaterial on pitch and players', toon, toon ? 'toon kits + toon turf' : 'material drifted');
  const noShadows = /shadowMap\.enabled = false/.test(canvas);
  check('shadow maps stay off', noShadows, noShadows ? 'shadowMap.enabled = false' : 'shadows would flatten the toon look');
}

/* New pack wiring. */
{
  const url = /const MODEL_URL = 'assets\/models\/player\.glb'/.test(players);
  check('players load player.glb', url, url ? 'Quaternius 2017 pack' : 'still rugby_player.glb');
  const noPass = !/name: 'Pass'/.test(players);
  check('no baseball Pass clip mapping', noPass, noPass ? 'pass → LineoutThrow' : 'Pass still mapped');
  const jog = /case 'jog':/.test(players) && /spd < 2\.2/.test(players) && /spd < 4\.2/.test(players);
  check('locomotion has Idle/Walk/Jog/Run/Sprint', jog, jog ? 'in-betweens present' : 'idle still jumps to run/sprint');
  const lineout = /case 'lineoutThrow':/.test(players) && /case 'lineoutJump':/.test(players);
  check('lineout throw/jump have their own states', lineout, lineout ? 'wired' : 'still folded into pass/jump');
  const units = /unitPerM/.test(players)
    && /private boneU\(/.test(players)
    && /this\.boneU\(0\.22\)/.test(players)
    && /scale\.setScalar\(this\.boneU\(1\)\)/.test(players)
    && /this\.u\(0\.02\)/.test(players);
  check('metre attachments survive FBX units', units,
    units ? 'root × unitPerM, bone-parented × boneU' : 'badge/ball still double-count armature scale');
  const lookAside = /case 'lookAside':/.test(players)
    && /BackpedalDiag/.test(players)
    && /case 'sprint': return \{ name: 'Run'/.test(players);
  check('look-aside is a one-shot into sprint', lookAside,
    lookAside ? 'BackpedalDiag then forward Run' : 'Sprint/BackpedalDiag still looping as gait');
  const maulBind = /case 'maulBind'/.test(players) && /case 'maulDrive'/.test(players);
  check('maulBind/maulDrive map to bind, not locomotion', maulBind,
    maulBind ? 'arms-out bind/drive' : 'maulBind falls through to idle/jog');
  const getupYaw = /renderClip === 'getup'/.test(players) && /oneShot === 'getup'/.test(players);
  check('get-up freezes heading', getupYaw,
    getupYaw ? 'no yaw while GetUp plays' : 'spd>2.2 still turns a rising man');
  const ruckFace = /renderClip === 'jackal'/.test(players)
    && /renderClip === 'cleanout'/.test(players)
    && /a\.rf > 0 \? 0 : Math\.PI/.test(players);
  check('ruck grab faces the contest, not velocity', ruckFace,
    ruckFace ? 'jackal/cleanout lock to engine face' : 'grab clip still yaws from lateral ease');
}

{
  const director = fs.readFileSync('src/game/director.ts', 'utf8');
  const breakdown = fs.readFileSync('src/game/engine/breakdown.ts', 'utf8');
  const intel = fs.readFileSync('src/game/intelligence.ts', 'utf8');
  const runIn = /gap > 1\.2 && !p\.down && q\.role !== 'TACKLER'/.test(director)
    && /steer\(p, dt, true\)/.test(director);
  check('ruck men run in before the grab clip', runIn,
    runIn ? 'sprint to slot, then jackal/cleanout' : 'grab still plays metres from the ball');
  const noRetreatCrew = /p\.sinbin > 0 \|\| p\.down \|\| p\.bound/.test(breakdown);
  check('offside retreat skips the ruck pack', noRetreatCrew,
    noRetreatCrew ? 'bound men stay on the ball' : 'retreat still walks jackals to 3 m');
  const noShoveBound = /if \(a\.bound \|\| b\.bound\) continue;/.test(intel);
  check('separation does not shove bound ruck men', noShoveBound,
    noShoveBound ? 'placeBound owns the contest' : 'separate still jitters the jackal');
}

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
