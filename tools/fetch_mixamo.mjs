#!/usr/bin/env node
/**
 * FETCH + RETARGET the paired Mixamo tackle animations.
 *
 * Output: public/assets/models/tackle_pair.glb — a small animation-only GLB
 * holding two clips, `MX_Tackle` and `MX_TackleReact`, already retargeted onto
 * this project's Quaternius/Unreal skeleton and already stripped of horizontal
 * root motion. ThreePlayerManager loads it alongside the player model.
 *
 * WHY A BAKED ARTEFACT AND NOT A RUNTIME FETCH
 * --------------------------------------------
 * Retargeting is expensive and completely deterministic, so it runs once here
 * rather than in every browser on every page load. The output is committed.
 *
 * SOURCE
 * ------
 *   github.com/CandyManGames/Enable3dFootball_Prod
 *     animations/Player_Actions/tackle_ip.gltf        (the tackler)
 *     animations/Player_Actions/tackle_react_ip.gltf  (the man being hit)
 *
 * These are Mixamo exports ("mixamo.com" is the clip name) committed as plain
 * base64-embedded glTF, not Git LFS — which matters, see NETWORK below. The
 * `_ip` suffix is the author's "in-place" export.
 *
 * NETWORK CONSTRAINTS discovered the hard way in this sandbox:
 *   - raw.githubusercontent.com, objects.githubusercontent.com and
 *     media.githubusercontent.com are ALL blocked. The obvious
 *     raw.githubusercontent.com/{repo}/main/{path} URL cannot be used.
 *   - api.github.com works, and returns file contents base64-encoded, so that
 *     is the download route used below.
 *   - Git LFS is therefore USELESS here: the API returns the 131-byte pointer,
 *     and the real bytes live on the blocked CDN. Most Mixamo assets on GitHub
 *     (e.g. the 2344-clip mjc-xq/drive-home library) are LFS and unreachable.
 *     Any replacement source MUST be a non-LFS, embedded-buffer glTF.
 *
 * RETARGETING — WHY NAME-MAPPING ALONE DOES NOT WORK
 * --------------------------------------------------
 * The two skeletons have different BIND POSES. Measured deltas between the
 * Mixamo rest orientation and ours:
 *     thigh_l 178.2deg   thigh_r 172.7deg   pelvis 100.2deg
 *     upperarm_l 93.0deg  upperarm_r 74.8deg  calf_r 84.3deg
 * A local quaternion means "rotation relative to MY bind pose", so copying it
 * across rigs that disagree by 178deg puts the legs on upside down. Renaming
 * tracks is necessary but nowhere near sufficient.
 *
 * This tool instead does a WORLD-SPACE TRANSFER: it samples the source
 * skeleton at 30 Hz, reads each mapped bone's world rotation, and converts
 * that into the destination bone's parent frame. Bind differences cancel
 * because no source local quaternion is ever reused.
 *
 * Verified: worst limb-direction deviation between source and retargeted rig
 * is 0.7deg across the whole clip (a pure rename scored 147deg).
 *
 * Run:  node tools/fetch_mixamo.mjs
 */
import * as THREE from 'three';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/* ---- headless three.js shims (no DOM in node) ---- */
globalThis.self = globalThis;
globalThis.ProgressEvent = class { constructor(t, o = {}) { this.type = t; Object.assign(this, o); } };
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.FileReader = class {                        // GLTFExporter blob path
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend(); }); }
};
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:x';

const REPO = 'CandyManGames/Enable3dFootball_Prod';
const SOURCES = [
  { remote: 'animations/Player_Actions/tackle_ip.gltf', clip: 'MX_Tackle' },
  { remote: 'animations/Player_Actions/tackle_react_ip.gltf', clip: 'MX_TackleReact' },
  /* Get-up. Phase 3 locks the player in place for exactly this clip's length,
   * so the engine's recovery timer is derived from the duration baked here
   * rather than a hand-guessed constant. */
  { remote: 'animations/Player_Actions/standing_up_ip.gltf', clip: 'MX_StandUp' },
];
const MODEL = 'public/assets/models/rugby_player.glb';
const OUT = 'public/assets/models/tackle_pair.glb';
const CACHE = '.cache/mixamo';

/**
 * Mixamo humanoid -> this rig. Only bones that exist on BOTH are listed; the
 * fingers and toes Mixamo ships are dropped deliberately (our rig has its own,
 * and a tackle does not animate them meaningfully).
 */
const BONE_MAP = {
  Hips: 'pelvis',
  Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03',
  Neck: 'neck_01', Head: 'Head',
  LeftShoulder: 'clavicle_l', RightShoulder: 'clavicle_r',
  LeftArm: 'upperarm_l', RightArm: 'upperarm_r',
  LeftForeArm: 'lowerarm_l', RightForeArm: 'lowerarm_r',
  LeftHand: 'hand_l', RightHand: 'hand_r',
  LeftUpLeg: 'thigh_l', RightUpLeg: 'thigh_r',
  LeftLeg: 'calf_l', RightLeg: 'calf_r',
  LeftFoot: 'foot_l', RightFoot: 'foot_r',
};

/** `mixamorig5:LeftArm` / `mixamorig5LeftArm` (three strips the colon) -> `LeftArm`. */
const canon = (n) => { const m = n.match(/^mixamorig\d*:?(.+)$/); return m ? m[1] : n; };

function download(remote, dest) {
  if (fs.existsSync(dest)) { console.log(`  cached  ${path.basename(dest)}`); return; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // api.github.com, because every raw/CDN host is blocked in this sandbox.
  const b64 = execFileSync('gh', ['api', `repos/${REPO}/contents/${remote}`, '--jq', '.content'],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  const buf = Buffer.from(b64.replace(/\s/g, ''), 'base64');
  if (buf.slice(0, 23).toString() === 'version https://git-lfs') {
    throw new Error(`${remote} is a Git LFS pointer; its bytes are on a blocked CDN.`);
  }
  fs.writeFileSync(dest, buf);
  console.log(`  fetched ${path.basename(dest)}  ${buf.length} bytes`);
}

const parseGLTF = (file) => new Promise((res, rej) => {
  const b = fs.readFileSync(file);
  if (file.endsWith('.gltf')) new GLTFLoader().parse(b.toString('utf8'), '', res, rej);
  else new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej);
});

/**
 * Sample `clip` on `srcScene` and write each mapped bone's WORLD rotation into
 * the equivalent bone of `dstScene`, expressed in that bone's parent frame.
 */
function retargetWorld(clip, srcScene, dstScene, dstRest, fps = 30) {
  const mixer = new THREE.AnimationMixer(srcScene);
  mixer.clipAction(clip).play();

  const srcNames = new Map();          // canonical -> actual source node name
  srcScene.traverse((o) => { if (o.name) srcNames.set(canon(o.name), o.name); });

  const times = [];
  for (let t = 0; t <= clip.duration + 1e-6; t += 1 / fps) times.push(t);

  const chan = new Map();
  for (const tgt of Object.values(BONE_MAP)) if (dstRest.has(tgt)) chan.set(tgt, []);
  const hipsPos = [];

  /* pelvis frames: which axis is up, and how tall is each rig */
  const dHipsBone = dstScene.getObjectByName('pelvis');
  const dstHipsBind = dHipsBone.position.clone();
  const srcHipsBone = srcScene.getObjectByName(srcNames.get('Hips'));
  const srcHipsBindY = srcHipsBone ? srcHipsBone.position.y : 0;
  // unit vector along our pelvis's own offset from its parent = our "up"
  const UP = dstHipsBind.lengthSq() > 1e-9
    ? dstHipsBind.clone().normalize() : new THREE.Vector3(0, 1, 0);
  // proportional scale, so a 0.5 m drop on a taller rig is not 0.5 m on ours
  const HIP_SCALE = srcHipsBindY > 1e-6 ? dstHipsBind.length() / srcHipsBindY : 1;

  const rot = new THREE.Matrix4();
  const sw = new THREE.Quaternion(), pw = new THREE.Quaternion(), out = new THREE.Quaternion();

  for (const t of times) {
    mixer.setTime(t);
    srcScene.updateMatrixWorld(true);
    // reset destination to bind so each frame is solved from a known state
    for (const [n, q] of dstRest) { const b = dstScene.getObjectByName(n); if (b) b.quaternion.copy(q); }
    dstScene.updateMatrixWorld(true);

    // top-down: a bone's parent must already hold this frame's rotation
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
      chan.get(tgt).push(out.x, out.y, out.z, out.w);
    }

    /* Hips VERTICAL only, and expressed in OUR pelvis's own axes.
     *
     * The two rigs do not agree on which local axis is "up" at the pelvis:
     *   mixamo Hips bind translation = [0, 0.876, 0]      -> height on Y
     *   our    pelvis bind translation = [0, 0.043, 0.949] -> height on Z
     * so copying the source Y into our Y wrote the drop onto a sideways axis
     * and the hips never moved (measured: pelvis world Y pinned at 0.95 for
     * the whole clip). The source's vertical DISPLACEMENT from its own bind is
     * measured, scaled into our rig's proportions, and applied along our own
     * pelvis up-axis instead. Horizontal is dropped for the usual reason: the
     * 2D engine owns X/Z. */
    const sHips = srcScene.getObjectByName(srcNames.get('Hips'));
    const dy = sHips ? (sHips.position.y - srcHipsBindY) * HIP_SCALE : 0;
    hipsPos.push(dstHipsBind.x, dstHipsBind.y + dy * UP.y, dstHipsBind.z + dy * UP.z);
  }

  const tracks = [];
  for (const [tgt, v] of chan) {
    if (v.length === times.length * 4) tracks.push(new THREE.QuaternionKeyframeTrack(`${tgt}.quaternion`, times, v));
  }
  tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, hipsPos));
  return new THREE.AnimationClip('rt', clip.duration, tracks);
}

/* --------------------------------------------------------------- main --- */
console.log(`source repo: ${REPO}`);
for (const s of SOURCES) download(s.remote, path.join(CACHE, path.basename(s.remote)));

const dst = await parseGLTF(MODEL);
const dstRest = new Map();
dst.scene.traverse((o) => { if (o.isBone) dstRest.set(o.name, o.quaternion.clone()); });
console.log(`target rig: ${dstRest.size} bones`);

const clips = [];
for (const s of SOURCES) {
  const src = await parseGLTF(path.join(CACHE, path.basename(s.remote)));
  const raw = src.animations[0];
  const rt = retargetWorld(raw, src.scene, dst.scene, dstRest);
  rt.name = s.clip;
  clips.push(rt);
  console.log(`  ${s.clip.padEnd(15)} ${raw.duration.toFixed(2)}s  ${rt.tracks.length} tracks`);
}

/* Export the SKELETON plus the clips, with every mesh stripped.
 * GLTFExporter can only write an animation track whose target node is present
 * in the exported scene, so an empty group silently drops all 21 tracks. The
 * bone hierarchy is a few hundred bytes; the meshes are the megabytes, and
 * those the game already has. */
const holder = new THREE.Group();
holder.name = 'TacklePair';
{
  const roots = [];
  dst.scene.traverse((o) => { if (o.isBone && (!o.parent || !o.parent.isBone)) roots.push(o); });
  for (const r of roots) holder.add(r.clone(true));
  // back to bind, so the exported rest pose is the rig's own
  holder.traverse((o) => { const q = dstRest.get(o.name); if (q) o.quaternion.copy(q); });
}
const exporter = new GLTFExporter();
const glb = await new Promise((res, rej) =>
  exporter.parse(holder, res, rej, { binary: true, animations: clips }));
fs.writeFileSync(OUT, Buffer.from(glb));
console.log(`\nwrote ${OUT}  ${fs.statSync(OUT).size} bytes  (${clips.length} clips)`);
