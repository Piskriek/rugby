/**
 * ThreeCanvas — the WebGL viewport.
 *
 * A single Three.js renderer/camera rig. The camera is NOT a free 3D camera:
 * every frame it is rebuilt to match the 2D pinhole rig in `render/retro.ts`
 * (position, look direction, vertical FOV, and the off-centre horizon via a
 * custom projection matrix), so 3D actors and the 3D pitch land on the exact
 * screen positions the legacy 2D markings used to paint.
 *
 * When `ENV_3D` is set, this layer owns the stadium environment (dual-plane
 * pitch, fog, World Rugby uprights) as well as the GLB actors; the 2D canvas
 * is a transparent HUD overlay on top. When unset, this canvas stays
 * transparent and only paints 3D actors over the 2D pitch.
 *
 * World convention: everything 3D is rendered in the game's *scaled* render
 * space (logical metres * RENDER_SCALE):
 *   world = (x · RENDER_SCALE, y · RENDER_SCALE, −z · RENDER_SCALE)
 */
import * as THREE from 'three';
import { Camera, View, RENDER_SCALE } from './retro';
import { ThreeEnvironment } from './ThreeEnvironment';

/** Feature flag: 3D dual-plane pitch, fog and uprights. */
export const ENV_3D: boolean = true;

const FOG_COLOR = 0x1a2634;

export class ThreeCanvas {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scene: THREE.Scene;
  readonly dom: HTMLCanvasElement;
  environment: ThreeEnvironment | null = null;

  private view: View = { w: 1, h: 1 };

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: false });
    this.renderer.setClearColor(ENV_3D ? FOG_COLOR : 0x000000, ENV_3D ? 1 : 0);
    this.renderer.shadowMap.enabled = false;

    const el = this.renderer.domElement;
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.pointerEvents = 'none';
    el.style.zIndex = ENV_3D ? '0' : '1';
    container.appendChild(el);
    this.dom = el;

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
    this.camera.frustumCulled = true;
    this.scene = new THREE.Scene();

    this.init();
  }

  /** Build the 3D environment (pitch, fog, uprights) when the flag is on. */
  init() {
    if (ENV_3D) {
      this.environment = new ThreeEnvironment(this.scene, this.renderer);
    }
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
   * `horizon*h`, not h/2). That is reproduced with a custom frustum so
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
    this.environment?.dispose();
    this.environment = null;
    this.renderer.dispose();
    this.dom.remove();
  }
}
