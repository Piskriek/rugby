/**
 * ThreeCanvas — the transparent WebGL overlay.
 *
 * A single Three.js renderer/camera rig drawn on a canvas that sits directly
 * on top of the 2D pitch canvas. The camera is NOT a free 3D camera: every
 * frame it is rebuilt to match the 2D pinhole rig in `render/retro.ts`
 * (position, look direction, vertical FOV, and the off-centre horizon via
 * `setViewOffset`), so the GLB players walk the exact screen positions the 2D
 * pitch markings are painted at. The 2D canvas stays authoritative for the
 * stadium, pitch lines, overlays and HUD; this layer only paints 3D actors.
 *
 * World convention: everything 3D is rendered in the game's *scaled* render
 * space (logical metres * RENDER_SCALE), the same space `project()` multiplies
 * into before rasterising, so a player at logical (x, y, z) and the 2D mown
 * stripe under his feet land on the same pixels.
 */
import * as THREE from 'three';
import { Camera, View, RENDER_SCALE } from './retro';

export class ThreeCanvas {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scene: THREE.Scene;
  readonly dom: HTMLCanvasElement;

  private view: View = { w: 1, h: 1 };

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: false });
    this.renderer.setClearColor(0x000000, 0);   // transparent — the 2D pitch shows through
    this.renderer.shadowMap.enabled = false;

    const el = this.renderer.domElement;
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '1';
    container.appendChild(el);
    this.dom = el;

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
    this.camera.frustumCulled = true;
    this.scene = new THREE.Scene();
  }

  /**
   * Match the 2D pinhole rig. Mirrors `project()` in retro.ts:
   *
   *   focal  = (h/2) / tan(fov/2)
   *   depth  = fwd·cos(tilt) − (wy − camH)·sin(tilt)
   *   right  = dx·cos(yaw) − dz·sin(yaw)
   *   up     = (wy − camH)·cos(tilt) + fwd·sin(tilt)
   *
   * The 2D lens is an off-centre pinhole (its principal point sits at
   * `horizon*h`, not h/2). That is reproduced with PerspectiveCamera's
   * `setViewOffset`, which shifts the frustum without changing focal length —
   * pitch markings and players therefore cannot parallax apart.
   */
  syncCamera(cam: Camera, v: View, shakeX = 0, shakeY = 0) {
    this.view = v;
    const s = RENDER_SCALE;
    // Pitch logical z runs "down-field AWAY from the cable camera", i.e. toward
    // three-space -Z (the renderer maps mesh z = -pitchZ). The camera rig sits
    // at logical (x, z) so its three-space position is (x, h, -z).
    const camPos = new THREE.Vector3(cam.x * s, cam.h * s, -cam.z * s);

    // 2D ground-forward is (sin yaw, cos yaw) in pitch (x, z); in three space
    // that is (sin yaw, 0, -cos yaw). Then tilt DOWN to aim at the turf.
    const yaw = cam.yaw, tilt = cam.tilt;
    const fHorz = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
    const down = new THREE.Vector3(0, -1, 0);
    const lookDir = fHorz.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(down, Math.sin(tilt));

    // Screen-up: world-up rotated FORWARD by the tilt so it is perpendicular to
    // lookDir (the lens tilt axis). With pitch z mapped to three -z the
    // ground-forward's z component is -cos yaw, hence the sign on z.
    const upVec = new THREE.Vector3(
      Math.sin(yaw) * Math.sin(tilt),
      Math.cos(tilt),
      -Math.cos(yaw) * Math.sin(tilt),
    );

    this.camera.position.copy(camPos);
    this.camera.up.copy(upVec);
    this.camera.lookAt(camPos.clone().add(lookDir));

    // Off-axis projection that EXACTLY reproduces the 2D pinhole intrinsics
    // (focal length f and the off-centre principal point at (w/2, horizon*h)).
    // At the near plane the window maps to frustum bounds:
    //   f = h / (2 tan(fov/2));  a ray's screen offset = f * axis/depth.
    // We build the frustum directly (instead of setViewOffset, whose aspect
    // term distorts the horizontal focal) so players and pitch lines share
    // one lens.
    const near = 0.15 * s;
    const far = 320 * s;
    const focal = v.h * 0.5 / Math.tan(cam.fov * 0.5);
    const left = near * (-v.w * 0.5 - shakeX) / focal;
    const right = near * (v.w * 0.5 - shakeX) / focal;
    const top = near * (cam.horizon * v.h + shakeY) / focal;
    const bottom = near * ((cam.horizon - 1) * v.h + shakeY) / focal;
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix(); // keep defaults sane
    this.camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.updateMatrixWorld(true);
  }

  resize() {
    const w = this.dom.clientWidth || this.view.w;
    const h = this.dom.clientHeight || this.view.h;
    const pr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    return { w, h };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
    this.dom.remove();
  }
}
