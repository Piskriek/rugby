/**
 * RapierDebugRenderer — live wireframe view of a Rapier3D world.
 *
 * Rapier's `World.debugRender()` returns the physics debug geometry as a flat
 * `Float32Array` of line-segment vertices and a parallel pair of per-vertex
 * RGBA colors. The buffers describe **line segments** (two vertices each), and
 * every capsule, cuboid and ball collider in the world contributes its outline.
 *
 * This class owns the Three.js side of that view:
 *
 *   - a `THREE.LineSegments` with a `THREE.BufferGeometry` whose position and
 *     color attributes are grown once and reused (CPU-side copy only);
 *   - a `sync()` that pulls `world.debugRender()` on demand and copies the
 *     vertices into the render-space mapping used by the rest of the game;
 *   - no ownership of physics stepping. The caller owns the `World` / the
 *     `RapierWorld` wrapper and steps it; this renderer only has to be called
 *     after a step so the wireframes match the physics tick exactly.
 *
 * Coordinate mapping matches `ThreeCanvas.syncCamera` / the renderers:
 * three-space is the game's scaled render space `(x·scale, y·scale, -z·scale)`
 * (pitch-z runs toward three-space -z), so the wireframes align with the GLB
 * players, pitch and ball that are already drawn in that space.
 */
import * as THREE from 'three';
import type { World } from '@dimforge/rapier3d-compat';

export interface RapierDebugRendererOptions {
  /** Multiply physics metres before handing them to Three. Defaults to 1. */
  scale?: number;
  /** Flip physics +z to Three -z (the game's pitch convention). Default true. */
  flipZ?: boolean;
  /** Capacity hint in vertices. The buffers grow automatically if needed. */
  capacity?: number;
  /** Called internally before growth if you want to render a different style. */
  material?: THREE.Material;
}

export class RapierDebugRenderer {
  readonly world: World;
  readonly object: THREE.LineSegments;

  private readonly geometry: THREE.BufferGeometry;
  private readonly scale: number;
  private readonly flipZ: boolean;
  private position: THREE.BufferAttribute;
  private color: THREE.BufferAttribute;
  private capacity = 0;

  constructor(scene: THREE.Scene, world: World, options: RapierDebugRendererOptions = {}) {
    this.world = world;
    this.scale = options.scale ?? 1;
    this.flipZ = options.flipZ ?? true;

    this.geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(0), 3);
    this.color = new THREE.BufferAttribute(new Float32Array(0), 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.color.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('color', this.color);

    const material = options.material
      ?? new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        depthTest: false,
      });

    this.object = new THREE.LineSegments(this.geometry, material);
    this.object.name = 'RapierDebug';
    this.object.frustumCulled = false;
    this.object.renderOrder = 20;
    this.object.visible = true;
    scene.add(this.object);

    this.ensureCapacity(options.capacity ?? 4096);
  }

  /** Show / hide the wireframe overlay. */
  set visible(value: boolean) {
    this.object.visible = value;
  }

  get visible(): boolean {
    return this.object.visible;
  }

  /**
   * Pull the latest Rapier debug buffers into the Three geometry.
   *
   * Call this after `world.step(...)` — doing so means the screen always shows
   * exactly what the physics solver produced for that tick.
   */
  sync(): void {
    const db = this.world.debugRender();
    const vertices = db.vertices;
    const colors = db.colors;

    const vertexCount = Math.max(0, Math.floor(vertices.length / 3));
    const colorVertexCount = Math.max(0, Math.floor(colors.length / 4));
    const lineVertexCount = Math.min(vertexCount, colorVertexCount);

    this.ensureCapacity(lineVertexCount);

    const pos = this.position.array as Float32Array;
    const col = this.color.array as Float32Array;
    const scale = this.scale;
    const zSign = this.flipZ ? -1 : 1;

    for (let i = 0; i < lineVertexCount; i++) {
      const v = i * 3;
      const c = i * 4;
      pos[v] = vertices[v] * scale;
      pos[v + 1] = vertices[v + 1] * scale;
      pos[v + 2] = vertices[v + 2] * scale * zSign;
      col[v] = colors[c];
      col[v + 1] = colors[c + 1];
      col[v + 2] = colors[c + 2];
    }

    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
    this.geometry.setDrawRange(0, lineVertexCount);
  }

  /** Remove the line object from the scene and release Geometry/material. */
  dispose(): void {
    this.object.geometry.dispose();
    const material = this.object.material;
    if (!Array.isArray(material)) material.dispose();
    this.object.removeFromParent();
  }

  private ensureCapacity(vertexCount: number): void {
    if (vertexCount <= this.capacity) return;
    /* Grow a little past the current frame so a ragdoll settling / bouncing
     * does not force a reallocation every single tick. */
    this.capacity = Math.max(4096, Math.ceil(vertexCount * 1.25));

    const positions = new Float32Array(this.capacity * 3);
    const colors = new Float32Array(this.capacity * 3);
    this.position = new THREE.BufferAttribute(positions, 3);
    this.color = new THREE.BufferAttribute(colors, 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.color.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('color', this.color);
  }
}
