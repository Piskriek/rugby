#!/usr/bin/env node
/**
 * Pack public/assets/models/player.glb from:
 *   - AnimationRef/Man Animated - Oct 2017-*.zip  (Quaternius 2017 low-poly skinned mesh)
 *   - AnimationRef/Male Locomotion Pack.zip       (Mixamo idle/walk/run/strafe)
 *   - AnimationRef/*.fbx                          (rugby-named Mixamo clips)
 *
 * Mixamo clips are world-space retargeted onto the 2017 skeleton (bind poses
 * differ, so a bone-name copy is not enough). Horizontal hips X/Z is stripped
 * so the 2D engine remains the only source of world displacement.
 *
 * Run:  node tools/build_player_glb.mjs
 */
import * as THREE from 'three';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/* ---- headless three.js shims ---- */
globalThis.self = globalThis;
globalThis.ProgressEvent = class { constructor(t, o = {}) { this.type = t; Object.assign(this, o); } };
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL() { this.result = 'data:,'; this.onloadend?.(); }
};
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:x';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ANIMREF = path.join(ROOT, 'AnimationRef');
const CACHE = path.join(ROOT, '.cache', 'player_assets');
const OUT = path.join(ROOT, 'public', 'assets', 'models', 'player.glb');
const TARGET_HEIGHT_M = 1.80;
const FPS = 30;

const MAN_ZIP = [...fs.readdirSync(ANIMREF)].find((f) => /^Man Animated.*\.zip$/i.test(f));
const LOCO_ZIP = [...fs.readdirSync(ANIMREF)].find((f) => /Male Locomotion Pack\.zip$/i.test(f));
if (!MAN_ZIP) throw new Error('Man Animated zip not found in AnimationRef/');

function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zip, '-d', dest]);
}

function parseFBX(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new FBXLoader().parse(ab, path.dirname(file) + '/');
}

/** Mixamo canonical name (`mixamorig5:LeftArm` / `mixamorigLeftArm`) -> `LeftArm`. */
const canon = (n) => {
  const m = String(n).match(/^mixamorig\d*:?(.+)$/i);
  return m ? m[1] : n;
};

/**
 * Mixamo humanoid -> 2017 Animated Human bones. Only bones present on the
 * destination rig are listed; Mixamo middle/ring/pinky fingers are dropped
 * (the 2017 mesh only has thumb + index).
 */
const BONE_MAP = {
  Hips: 'Hips',
  Spine: 'Spine', Spine1: 'Spine1', Spine2: 'Spine2',
  Neck: 'Neck', Head: 'Head',
  LeftShoulder: 'LeftShoulder', RightShoulder: 'RightShoulder',
  LeftArm: 'LeftArm', RightArm: 'RightArm',
  LeftForeArm: 'LeftForeArm', RightForeArm: 'RightForeArm',
  LeftHand: 'LeftHand', RightHand: 'RightHand',
  LeftUpLeg: 'LeftUpLeg', RightUpLeg: 'RightUpLeg',
  LeftLeg: 'LeftLeg', RightLeg: 'RightLeg',
  LeftFoot: 'LeftFoot', RightFoot: 'RightFoot',
  LeftToeBase: 'LeftToeBase', RightToeBase: 'RightToeBase',
};
for (const side of ['Left', 'Right']) {
  for (const finger of ['Thumb', 'Index']) {
    for (let i = 1; i <= 4; i++) {
      const n = `${side}Hand${finger}${i}`;
      BONE_MAP[n] = n;
    }
  }
}

const ROOT_BONES = new Set([
  'Hips', 'Human_Armature', 'mixamorigHips', 'root', 'Armature', 'Root',
]);

function stripRootXZ(clip) {
  for (const track of clip.tracks) {
    const [bone, prop] = track.name.split('.');
    if (prop !== 'position') continue;
    if (!ROOT_BONES.has(bone) && !/hips$/i.test(bone)) continue;
    const v = track.values;
    if (!v.length) continue;
    const x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
}

function pickClip(anims) {
  if (!anims?.length) return null;
  return anims.find((a) => a.tracks.length > 0 && a.duration > 0.05) || null;
}

/**
 * Sample `clip` on `srcScene` and write each mapped bone's WORLD rotation into
 * the equivalent bone of `dstScene`, expressed in that bone's parent frame.
 * Horizontal hips translation is dropped; vertical bounce is preserved and
 * scaled into the destination rig's units.
 */
function retargetWorld(clip, srcScene, dstScene, dstRest, fps = FPS) {
  const mixer = new THREE.AnimationMixer(srcScene);
  mixer.clipAction(clip).play();

  const srcNames = new Map();
  srcScene.traverse((o) => { if (o.name) srcNames.set(canon(o.name), o.name); });

  const times = [];
  for (let t = 0; t <= clip.duration + 1e-6; t += 1 / fps) times.push(t);

  const chan = new Map();
  for (const tgt of Object.values(BONE_MAP)) if (dstRest.has(tgt)) chan.set(tgt, []);
  const hipsPos = [];

  const dHipsBone = dstScene.getObjectByName('Hips');
  if (!dHipsBone) throw new Error('destination Hips missing');
  const dstHipsBind = dHipsBone.position.clone();
  const srcHipsName = srcNames.get('Hips');
  const srcHipsBone = srcHipsName ? srcScene.getObjectByName(srcHipsName) : null;
  const srcHipsBindY = srcHipsBone ? srcHipsBone.position.y : 0;
  const UP = dstHipsBind.lengthSq() > 1e-9
    ? dstHipsBind.clone().normalize() : new THREE.Vector3(0, 1, 0);
  const HIP_SCALE = srcHipsBindY > 1e-6 ? dstHipsBind.length() / Math.abs(srcHipsBindY) : 1;

  const rot = new THREE.Matrix4();
  const sw = new THREE.Quaternion(), pw = new THREE.Quaternion(), out = new THREE.Quaternion();

  for (const t of times) {
    mixer.setTime(Math.min(t, clip.duration));
    srcScene.updateMatrixWorld(true);
    for (const [n, q] of dstRest) {
      const b = dstScene.getObjectByName(n);
      if (b) b.quaternion.copy(q);
    }
    dstScene.updateMatrixWorld(true);

    for (const [srcKey, tgt] of Object.entries(BONE_MAP)) {
      const sName = srcNames.get(srcKey);
      const dBone = dstScene.getObjectByName(tgt);
      if (!sName || !dBone || !dBone.parent) continue;
      const sObj = srcScene.getObjectByName(sName);
      if (!sObj) continue;

      sObj.updateWorldMatrix(true, false);
      sw.setFromRotationMatrix(rot.extractRotation(sObj.matrixWorld));
      dBone.parent.updateWorldMatrix(true, false);
      pw.setFromRotationMatrix(rot.extractRotation(dBone.parent.matrixWorld));
      out.copy(pw).invert().multiply(sw);

      dBone.quaternion.copy(out);
      dBone.updateWorldMatrix(false, false);
      chan.get(tgt)?.push(out.x, out.y, out.z, out.w);
    }

    const sHips = srcHipsBone;
    const dy = sHips ? (sHips.position.y - srcHipsBindY) * HIP_SCALE : 0;
    hipsPos.push(
      dstHipsBind.x,
      dstHipsBind.y + dy * UP.y,
      dstHipsBind.z + dy * UP.z,
    );
  }

  const tracks = [];
  for (const [tgt, v] of chan) {
    if (v.length === times.length * 4) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${tgt}.quaternion`, times, v));
    }
  }
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipsPos));
  return new THREE.AnimationClip('rt', clip.duration, tracks);
}

const NATIVE_CLIP_MAP = {
  'Human Armature|Idle': 'Idle',
  'Human Armature|Walk': 'Walk',
  'Human Armature|Run': 'Run',
  'Human Armature|Jump': 'JumpLand',
  'Human Armature|Death': 'Death',
  'Human Armature|Working': 'Push',
};

/** Mixamo / AnimationRef FBX -> in-engine clip name. Later entries overwrite. */
const MIXAMO_CLIPS = [
  // Male Locomotion Pack
  { zip: 'loco', file: 'walking.fbx', name: 'Walk' },
  { zip: 'loco', file: 'standard run.fbx', name: 'Run' },
  { zip: 'loco', file: 'jump.fbx', name: 'Jump' },
  { zip: 'loco', file: 'left strafe walking.fbx', name: 'Shuffle' },
  { zip: 'loco', file: 'right strafe walking.fbx', name: 'ShuffleRight' },
  { zip: 'loco', file: 'right strafe.fbx', name: 'SidestepRight' },
  { zip: 'loco', file: 'left turn 90.fbx', name: 'TurnL' },
  { zip: 'loco', file: 'right turn 90.fbx', name: 'TurnR' },

  // AnimationRef rugby-named Mixamo
  { file: 'Jogging.fbx', name: 'Jog' },
  { file: 'leadingTargetRun.fbx', name: 'Sprint' },
  { file: 'Slow Jog Backwards.fbx', name: 'Backpedal' },
  { file: 'Jog Backward Diagonal.fbx', name: 'BackpedalDiag' },
  { file: 'staggerwalkBackwards.fbx', name: 'BackpedalStagger' },
  { file: 'armsOutBlockingSidestep.fbx', name: 'Sidestep' },
  { file: 'stepright.fbx', name: 'StepRight' },
  { file: 'Standard Walk.fbx', name: 'Walk' },
  { file: 'joggingHoldingBall.fbx', name: 'JogCarry' },
  { file: 'holdingtheballIdle.fbx', name: 'IdleCarry' },
  { file: 'lookingAroundIdle.fbx', name: 'IdleLook' },
  { file: 'subtleIdle.fbx', name: 'IdleSubtle' },
  { file: 'DefensiveIdle.fbx', name: 'IdleReady' },

  { file: 'LinOutThrow In_Overhaed.fbx', name: 'LineoutThrow' },
  { file: 'lineoutJumpArmUp.fbx', name: 'LineoutJump' },
  { file: 'jumpingOverheadCatch.fbx', name: 'Catch' },
  { file: 'jumpBallCatch.fbx', name: 'CatchHigh' },

  { file: 'DivingTackleToTheSide-Left.fbx', name: 'SideDive' },
  { file: 'Body Blockdive_left.fbx', name: 'Dive' },
  { file: 'Double Leg Tackle - Attacker.fbx', name: 'DoubleLegTackle' },
  { file: 'TadckleFromBehindFall_looseball_openhands.fbx', name: 'TackleFromBehind' },
  { file: 'backwardfallTackle - Victim.fbx', name: 'TackleVictim' },
  { file: 'tackelFallBackward - Victim.fbx', name: 'HitReact' },
  { file: 'Hit To Side Of Body.fbx', name: 'HitSide' },
  { file: 'quickDiveIntoRuck.fbx', name: 'RuckDive' },
  { file: 'Receiver CatchToFallFlat.fbx', name: 'CatchFall' },

  { file: 'HookerArmUpForBindToCrouch.fbx', name: 'ScrumBind' },
  { file: 'RightSideFlank_StandToCrouchScrumPos.fbx', name: 'ScrumCrouch' },
  { file: 'flankerRightBindOneArm.fbx', name: 'ScrumDrive' },
  { file: 'crouchToStand.fbx', name: 'CrouchStand' },
  { file: 'crouchedhandsDiggingForBAll.fbx', name: 'Jackal' },

  { file: 'placekick.fbx', name: 'Kick' },
  { file: 'Drop Kick.fbx', name: 'DropKick' },
  { file: 'GrabWaistheightBall.fbx', name: 'Pickup' },
  { file: 'scoopUpBall.fbx', name: 'Scoop' },
  { file: 'Standing Up.fbx', name: 'GetUp' },
  { file: 'Situp To Idle.fbx', name: 'GetUpSit' },
  { file: 'Crawling.fbx', name: 'Crawl' },
  { file: 'JumpOverLiftLegs.fbx', name: 'JumpHurdle' },
];

/* --------------------------------------------------------------- main --- */
console.log('unzip sources…');
const manDir = path.join(CACHE, 'man');
const locoDir = path.join(CACHE, 'loco');
unzip(path.join(ANIMREF, MAN_ZIP), manDir);
if (LOCO_ZIP) unzip(path.join(ANIMREF, LOCO_ZIP), locoDir);

const manFbx = path.join(manDir, 'Man Animated - Oct 2017', 'FBX', 'Animated Human.fbx');
if (!fs.existsSync(manFbx)) {
  const found = execFileSync('find', [manDir, '-name', '*.fbx'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  if (!found.length) throw new Error('Animated Human.fbx not in zip');
  console.log('  using', found[0]);
}

const manPath = fs.existsSync(manFbx) ? manFbx
  : execFileSync('find', [manDir, '-name', 'Animated Human.fbx'], { encoding: 'utf8' }).trim();

console.log('load character', manPath);
const dst = parseFBX(manPath);

/* Drop cameras / lights — they bloat the GLB and confuse the exporter. */
const drop = [];
dst.traverse((o) => {
  if (o.isLight || o.isCamera || o.type === 'AudioListener') drop.push(o);
});
for (const o of drop) o.parent?.remove(o);

/* Replace textured phong with a plain standard material; kit colours are
 * applied at runtime by ThreePlayerManager. */
dst.traverse((o) => {
  if (!o.isMesh) return;
  o.material = new THREE.MeshStandardMaterial({
    color: 0xc4a07a, metalness: 0, roughness: 0.72, name: 'Human_Body',
  });
  o.frustumCulled = false;
});

dst.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(dst);
const nativeHeight = box.max.y - box.min.y;
console.log(`native height ${nativeHeight.toFixed(2)} units (runtime fits to ${TARGET_HEIGHT_M} m)`);

const dstRest = new Map();
dst.traverse((o) => { if (o.isBone) dstRest.set(o.name, o.quaternion.clone()); });
console.log(`target rig: ${dstRest.size} bones  (${[...dstRest.keys()].filter((n) => BONE_MAP[n] === n).length} mapped)`);

const clips = [];
const kept = [];

/* Native clips — already authored on this skeleton. */
for (const anim of dst.animations || []) {
  const mapped = NATIVE_CLIP_MAP[anim.name];
  if (!mapped) continue;
  const c = anim.clone();
  c.name = mapped;
  stripRootXZ(c);
  /* Position tracks are in the pre-fit local units; the root scale `fit`
   * already converts them to metres at playback. */
  clips.push(c);
  kept.push(['native:' + anim.name, mapped, c.duration]);
}

function resolveMixamoFile(spec) {
  if (spec.zip === 'loco') return path.join(locoDir, spec.file);
  return path.join(ANIMREF, spec.file);
}

for (const spec of MIXAMO_CLIPS) {
  const file = resolveMixamoFile(spec);
  if (!fs.existsSync(file)) {
    console.warn(`  missing ${spec.file}`);
    continue;
  }
  try {
    const src = parseFBX(file);
    const raw = pickClip(src.animations);
    if (!raw) { console.warn(`  no clip in ${spec.file}`); continue; }
    const rt = retargetWorld(raw, src.scene ?? src, dst, dstRest);
    rt.name = spec.name;
    stripRootXZ(rt);
    /* overwrite earlier clip of the same name (loco pack Walk/Run beat native) */
    const idx = clips.findIndex((c) => c.name === spec.name);
    if (idx >= 0) clips.splice(idx, 1);
    clips.push(rt);
    kept.push([path.basename(spec.file), spec.name, rt.duration]);
    console.log(`  ${spec.name.padEnd(18)} ${raw.duration.toFixed(2)}s  ${rt.tracks.length} tracks  <- ${path.basename(spec.file)}`);
  } catch (e) {
    console.warn(`  FAIL ${spec.file}: ${e.message}`);
  }
}

/* Aliases: the state machine looks up several rugby names that share a clip. */
const ALIASES = {
  DivingTackle: 'SideDive',
  Tackle: 'DoubleLegTackle',
  SlideStart: 'SideDive',
  Slide: 'Dive',
  Crouch: 'Jackal',
  JumpLand: 'LineoutJump',
};
for (const [alias, src] of Object.entries(ALIASES)) {
  if (clips.some((c) => c.name === alias)) continue;
  const base = clips.find((c) => c.name === src);
  if (!base) continue;
  const c = base.clone();
  c.name = alias;
  clips.push(c);
  kept.push(['alias:' + src, alias, c.duration]);
}

/* Reset dest skeleton to bind so the exported rest pose is clean. */
for (const [n, q] of dstRest) {
  const b = dst.getObjectByName(n);
  if (b) b.quaternion.copy(q);
}
dst.updateMatrixWorld(true);

/* Drop the FBX animation list — we pass `clips` explicitly. */
dst.animations = [];

console.log('\nexport GLB…');
const exporter = new GLTFExporter();
const glb = await new Promise((res, rej) =>
  exporter.parse(dst, res, rej, { binary: true, animations: clips, onlyVisible: false }));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(glb));
const mb = fs.statSync(OUT).size / (1024 * 1024);
console.log(`\nwrote ${OUT}`);
console.log(`  size     ${mb.toFixed(2)} MiB`);
console.log(`  clips    ${clips.length}`);
console.log(`  height   ${nativeHeight.toFixed(2)} units (runtime × ${TARGET_HEIGHT_M}/height)`);
console.log('clips:');
for (const [src, name, dur] of kept) {
  console.log(`  ${String(name).padEnd(18)} ${dur.toFixed(2)}s  <- ${src}`);
}
if (mb >= 8) {
  console.warn('WARNING: GLB is >= 8 MiB');
  process.exitCode = 1;
}
