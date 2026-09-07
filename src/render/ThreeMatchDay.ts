/**
 * ThreeMatchDay — the sky, the light rig, and the weather.
 *
 * Splits the atmosphere into the four things a broadcast actually sees and
 * nothing else:
 *
 *  1. SKY DOME. One back-side sphere, one shader. Zenith→horizon gradient,
 *     sun or moon disc, a hash-noise star field, a two-octave cloud deck that
 *     drifts at the wind the KICK and the ball are already obeying, and four
 *     warm glow bands on the floodlight bearings at night. `fog: false` — the
 *     horizon colour IS the fog colour, so the seam is invisible without the
 *     dome being eaten by it.
 *  2. LIGHT RIG. A shadowed key (the sun by day, the lamp battery at night),
 *     a hemisphere bounce pair, a flat ambient, and a cool fill off the far
 *     stand so backs go dark-but-not-black. The key's ortho frustum is NOT the
 *     pitch: it is a box centred on where the camera is LOOKING, re-centred
 *     every frame, which is what buys 2048 texels over 42 m instead of over
 *     130 and makes the shadow edge readable at all.
 *  3. PRECIPITATION. Rain and snow are one `LineSegments` mesh animated
 *     entirely in the vertex shader: the CPU never touches a drop. Each vertex
 *     carries a seed and an end flag; the shader folds the fall into a modulo
 *     window around the camera and shears it by the wind. 9 000 drops cost one
 *     draw call and zero allocation per frame.
 *  4. THE WET LAYER. A second plane over the turf, painted once into a canvas
 *     texture: sky-reflection gradient, standing water in the low ground, rime
 *     on the shaded side. Only its colour and opacity move, driven by
 *     `sheen`, `puddles` and `frost`. Plus ground mist quads for FOG and
 *     COLD SNAP, and the additive floodlight cones whose opacity is what makes
 *     a rainy night under lights look like a rainy night under lights.
 *
 * Every value comes from `resolveConditions()`. This class never reads a
 * gameplay number, so the match can be played headless with the file deleted.
 */
import * as THREE from 'three';
import { RENDER_SCALE, type Camera, type View } from './retro';
import type { Conditions } from './conditions';

const DOME_R = 470;

/** World position of the four floodlight tower heads (logical metres). */
const TOWERS: [number, number][] = [[48, 75], [-48, 75], [48, -75], [-48, -75]];
const LAMP_H = 28;

function softSprite(stops: [number, string][]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------ sky shader --- */
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uZenith, uMid, uHorizon, uHaze, uSunCol, uStarCol;
  uniform vec3 uSunDir;
  uniform float uStars, uCloud, uCloudT, uNight, uFlood, uTime;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash(i), n100 = hash(i + vec3(1,0,0));
    float n010 = hash(i + vec3(0,1,0)), n110 = hash(i + vec3(1,1,0));
    float n001 = hash(i + vec3(0,0,1)), n101 = hash(i + vec3(1,0,1));
    float n011 = hash(i + vec3(0,1,1)), n111 = hash(i + vec3(1,1,1));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }

  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;

    /* Three-stop gradient with a hard-ish knee at the horizon, matching the
     * flat, quickly-darkening sky a 28 m light tower sits against. */
    float up = clamp(y, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.30, up));
    sky = mix(sky, uZenith, smoothstep(0.22, 0.85, up));
    /* Below the rim the bowl glows off concrete and stands, not off space. */
    sky = mix(sky, uHaze, 1.0 - smoothstep(-0.22, 0.0, y));

    /* Stars: cell noise, twinkling, only above the haze and only at night. */
    if (uStars > 0.001 && y > 0.04) {
      vec3 sp = floor(d * 260.0);
      float h = hash(sp);
      float star = smoothstep(0.9975, 1.0, h);
      float tw = 0.55 + 0.45 * sin(uTime * (1.6 + h * 7.0) + h * 40.0);
      float fade = smoothstep(0.04, 0.30, y) * (1.0 - uCloud * 0.85);
      sky += uStarCol * star * tw * uStars * fade * 2.4;
    }

    /* Cloud deck: two octaves on the projected dome, sheared by wind time.
     * Lit from the sun side, underlit warm at twilight. */
    if (uCloud > 0.001 && y > -0.05) {
      vec2 q = d.xz / max(0.12, abs(y) + 0.25);
      float t = uCloudT;
      float n = vnoise(vec3(q * 0.55 + vec2(t * 0.06, t * 0.02), t * 0.03));
      n = n * 0.62 + vnoise(vec3(q * 1.35 - vec2(t * 0.10, 0.0), t * 0.05)) * 0.38;
      float deck = smoothstep(0.52, 0.92, n) * smoothstep(-0.02, 0.24, y);
      float sunSide = clamp(dot(d, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
      vec3 cloudCol = mix(vec3(0.20, 0.22, 0.26), vec3(0.86, 0.86, 0.90), sunSide)
                    + uSunCol * pow(sunSide, 6.0) * 0.55 * (1.0 - uNight);
      /* Underlit by the lamps at night: a grey, low, rain-lit ceiling. */
      cloudCol += vec3(0.16, 0.14, 0.10) * uFlood * 0.7;
      sky = mix(sky, cloudCol, deck * uCloud);
    }

    /* Sun or moon disc + halo. */
    float sd = clamp(dot(d, uSunDir), -1.0, 1.0);
    float disc = smoothstep(0.9987, 0.9996, sd);
    float halo = pow(max(sd, 0.0), 220.0) * 0.5 + pow(max(sd, 0.0), 14.0) * 0.09;
    sky += uSunCol * (disc * 2.2 + halo) * (1.0 - uCloud * 0.75);

    /* Floodlight glow bands along the horizon on the tower bearings. */
    if (uFlood > 0.01) {
      for (int i = 0; i < 4; i++) {
        float a = (i == 0) ? 1.031 : (i == 1) ? 2.111 : (i == 2) ? -1.031 : -2.111;
        vec3 bd = vec3(sin(a), 0.10, cos(a));
        float g = pow(clamp(dot(d, normalize(bd)), 0.0, 1.0), 60.0);
        float low = 1.0 - smoothstep(0.02, 0.30, abs(y - 0.10));
        sky += vec3(1.0, 0.94, 0.78) * g * low * uFlood * 0.9;
      }
    }
    gl_FragColor = vec4(max(sky, vec3(0.0)), 1.0);
  }
`;

/* ------------------------------------------------------- precip shader --- */
const PRECIP_VERT = /* glsl */ `
  precision highp float;
  attribute float aSeed;   // 0..1 per drop
  attribute float aEnd;    // 0 = head, 1 = tail
  uniform float uTime, uFall, uSpan, uBox, uSize, uSlant, uSway, uMode, uPixel;
  uniform vec3 uWind;
  uniform vec2 uCam;       // camera x/z in world units
  varying float vFade;
  void main() {
    float s = aSeed;
    /* Column the drop lives in: fixed x/z inside a box that follows the
     * camera, so precipitation always fills the frame and never the stadium. */
    float col = floor(s * 4096.0);
    float hx = fract(sin(col * 12.9898) * 43758.5453) - 0.5;
    float hz = fract(sin(col * 78.233) * 12345.6789) - 0.5;
    float yy = fract(sin(col * 37.719) * 9876.54321);

    float t = uTime * uFall * (0.65 + 0.7 * fract(sin(col * 91.7) * 4521.987));
    float y = uSpan - mod(yy * uSpan + t, uSpan);
    vec3 p = vec3(uCam.x + hx * uBox, y, uCam.y - hz * uBox);

    /* Wind shears the whole column; snow sways, rain does not. */
    float k = uSpan - y;
    p.xz += uWind.xz * k * 0.06;
    if (uMode > 0.5) {
      p.x += sin(uTime * 1.4 + s * 40.0) * 1.9 * (1.0 - y / uSpan);
      p.z += cos(uTime * 1.1 + s * 27.0) * 1.9 * (1.0 - y / uSpan);
    }
    vec3 tail = p - normalize(vec3(uWind.x * (uMode > 0.5 ? 0.2 : 1.0), -1.0, uWind.z * (uMode > 0.5 ? 0.2 : 1.0))) * uSize * (uMode > 0.5 ? 0.6 : 1.0 + uSlant * 3.0);
    vec3 pos = mix(p, tail, aEnd);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    gl_PointSize = uPixel;
    /* Depth cue: drops close to the lens are brighter and slightly softer. */
    /* (reversed smoothstep edges are undefined in GLSL ES, so every ramp here
     * is written ascending and inverted) */
    vFade = (1.0 - smoothstep(uBox * 0.35, uBox * 2.4, dist))
          * (1.0 - smoothstep(uSpan * 0.55, uSpan, y));
    vFade *= 0.35 + 0.65 * fract(sin(col * 5.13) * 1234.5);
  }
`;

const PRECIP_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity, uMode;
  varying float vFade;
  void main() {
    float a = uOpacity * vFade * (uMode > 0.5 ? 0.95 : 0.65);
    gl_FragColor = vec4(uColor, a);
  }
`;

/* ------------------------------------------------------------------ class --- */
export class ThreeMatchDay {
  readonly group = new THREE.Group();

  private dome: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private precip: THREE.LineSegments;
  private precipMat: THREE.ShaderMaterial;
  private wetLayer: THREE.Mesh;
  private wetMat: THREE.MeshBasicMaterial;
  private mist: THREE.Mesh[] = [];
  private cones: THREE.Mesh[] = [];
  private lampGlows: THREE.Sprite[] = [];

  private key = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0x88aaff, 0x223311, 0.7);
  private ambient = new THREE.AmbientLight(0xffffff, 0.4);
  private fill = new THREE.DirectionalLight(0xa9c6ff, 0.4);

  private target: THREE.Object3D;
  private tmpCol = new THREE.Color();
  private t = 0;

  /** Exposed so the composer can match the post stack to the same sky. */
  readonly bloom = { strength: 0.3, threshold: 0.75, radius: 0.6 };

  constructor(private scene: THREE.Scene) {
    this.group.name = 'MatchDay';
    scene.add(this.group);
    scene.add(this.key);
    scene.add(this.hemi);
    scene.add(this.ambient);
    scene.add(this.fill);

    /* ---------------------------------------------------------- sky dome */
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color('#101a33') },
        uMid: { value: new THREE.Color('#22304c') },
        uHorizon: { value: new THREE.Color('#33465f') },
        uHaze: { value: new THREE.Color('#1a2431') },
        uSunCol: { value: new THREE.Color('#fff0cf') },
        uStarCol: { value: new THREE.Color('#dfe8ff') },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uStars: { value: 0 }, uCloud: { value: 0.4 },
        uCloudT: { value: 0 }, uNight: { value: 0.5 },
        uFlood: { value: 0 }, uTime: { value: 0 },
      },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 32, 20), this.skyMat);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    /* ------------------------------------------------------------ lights */
    this.target = new THREE.Object3D();
    scene.add(this.target);
    this.key.target = this.target;
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.55;
    this.key.shadow.radius = 2.2;

    /* -------------------------------------------------- precipitation */
    const COUNT = 9000;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 2 * 3);
    const seed = new Float32Array(COUNT * 2);
    const end = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      const s = Math.random();
      seed[i * 2] = s; seed[i * 2 + 1] = s;
      end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.precipMat = new THREE.ShaderMaterial({
      vertexShader: PRECIP_VERT,
      fragmentShader: PRECIP_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: { value: 0 }, uFall: { value: 90 }, uSpan: { value: 90 },
        uBox: { value: 190 }, uSize: { value: 3.2 }, uSlant: { value: 0.2 },
        uSway: { value: 0 }, uMode: { value: 0 }, uPixel: { value: 1 },
        uWind: { value: new THREE.Vector3(1, 0, 0) },
        uCam: { value: new THREE.Vector2(0, 0) },
        uColor: { value: new THREE.Color('#b9cfe8') },
        uOpacity: { value: 0.5 },
      },
    });
    this.precip = new THREE.LineSegments(g, this.precipMat);
    this.precip.frustumCulled = false;
    this.precip.renderOrder = 6;
    this.group.add(this.precip);

    /* ------------------------------------------------- wet / frost layer */
    this.wetMat = new THREE.MeshBasicMaterial({
      map: this.paintWetLayer(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const inner = new THREE.PlaneGeometry(76 * RENDER_SCALE, 140 * RENDER_SCALE);
    this.wetLayer = new THREE.Mesh(inner, this.wetMat);
    this.wetLayer.rotation.x = -Math.PI / 2;
    this.wetLayer.position.y = 0.02;
    this.wetLayer.renderOrder = 2;
    this.group.add(this.wetLayer);

    /* --------------------------------------------------------- ground mist */
    const mistTex = softSprite([[0, 'rgba(255,255,255,0.55)'], [0.55, 'rgba(220,232,246,0.22)'], [1, 'rgba(220,232,246,0)']]);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: mistTex, transparent: true, opacity: 0, depthWrite: false,
          blending: THREE.NormalBlending, fog: false,
          color: new THREE.Color('#c8d6e6'),
        }),
      );
      m.scale.setScalar((70 + (i % 5) * 34) * RENDER_SCALE * 0.5);
      m.position.set(
        (Math.random() - 0.5) * 150 * RENDER_SCALE,
        1.4 * RENDER_SCALE + Math.random() * 5 * RENDER_SCALE,
        (Math.random() - 0.5) * 260 * RENDER_SCALE,
      );
      m.renderOrder = 3;
      this.mist.push(m);
      this.group.add(m);
    }

    /* --------------------------------------- floodlight cones + lamp glow */
    const coneMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffeab8'), transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      fog: false,
    });
    for (const [lx, lz] of TOWERS) {
      const wx = lx * RENDER_SCALE, wz = -lz * RENDER_SCALE, h = LAMP_H * RENDER_SCALE;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(23 * RENDER_SCALE, h, 26, 1, true), coneMat.clone());
      cone.position.set(wx * 0.62, h * 0.5, wz * 0.62);
      cone.lookAt(0, 0, 0);
      cone.rotateX(Math.PI / 2);
      cone.renderOrder = 4;
      this.cones.push(cone);
      this.group.add(cone);

      const glowTex = softSprite([[0, 'rgba(255,248,224,0.95)'], [0.35, 'rgba(255,232,170,0.35)'], [1, 'rgba(255,220,150,0)']]);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false,
      }));
      glow.position.set(wx, h, wz);
      glow.scale.setScalar(26 * RENDER_SCALE);
      glow.renderOrder = 5;
      this.lampGlows.push(glow);
      this.group.add(glow);
    }
  }

  /** Paint the wet/frost/puddle overlay once. Only opacity and colour move. */
  private paintWetLayer(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 1024, 512);

    /* Sky reflection: strongest toward the far touchlines and at the ends,
     * where a flat wet pitch mirrors the ceiling. */
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, 'rgba(150,180,215,0.55)');
    grad.addColorStop(0.35, 'rgba(120,150,190,0.16)');
    grad.addColorStop(0.62, 'rgba(120,150,190,0.10)');
    grad.addColorStop(1, 'rgba(160,190,220,0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 512);

    /* Standing water: low, irregular pools, mostly midfield and the 22s. */
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 46; i++) {
      const x = 60 + Math.random() * 904;
      const y = 40 + Math.random() * 432;
      const rx = 14 + Math.random() * 52;
      const ry = rx * (0.28 + Math.random() * 0.3);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
      g.addColorStop(0, `rgba(190,215,240,${0.16 + Math.random() * 0.18})`);
      g.addColorStop(1, 'rgba(190,215,240,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    /* Rime: fine speckle on the shaded half, where frost holds. */
    for (let i = 0; i < 5200; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 512;
      const w = 0.35 + Math.random() * 1.1;
      ctx.fillStyle = `rgba(228,240,252,${0.05 + Math.random() * 0.14})`;
      ctx.fillRect(x, y, w, w);
    }
    ctx.globalCompositeOperation = 'source-over';
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /**
   * Where the light and the shadow budget should be spent: under the point the
   * camera is looking at, not the middle of the field.
   */
  private focusOf(cam: Camera): THREE.Vector3 {
    const s = RENDER_SCALE;
    const fx = cam.x + Math.sin(cam.yaw) * 26;
    const fz = cam.z + Math.cos(cam.yaw) * 26;
    return new THREE.Vector3(fx * s, 0, -fz * s);
  }

  private sunVec = new THREE.Vector3();

  update(cam: Camera, _v: View, cond: Conditions, dt: number) {
    this.t += dt;
    const s = RENDER_SCALE;

    /* ---------------------------------------------------------------- sky */
    const el = Math.max(0.06, cond.sunEl);
    this.sunVec.set(
      Math.sin(cond.sunAz) * Math.cos(el),
      Math.sin(el),
      Math.cos(cond.sunAz) * Math.cos(el),
    ).normalize();
    const u = this.skyMat.uniforms;
    (u.uZenith.value as THREE.Color).set(cond.skyZenith);
    (u.uMid.value as THREE.Color).set(cond.skyMid);
    (u.uHorizon.value as THREE.Color).set(cond.skyHorizon);
    (u.uHaze.value as THREE.Color).set(cond.groundHaze);
    (u.uSunCol.value as THREE.Color).set(cond.keyColor);
    (u.uSunDir.value as THREE.Vector3).copy(this.sunVec);
    u.uStars.value = cond.stars;
    u.uCloud.value = cond.cloud;
    u.uCloudT.value = this.t * (0.4 + cond.cloudSpeed * 0.12);
    u.uNight.value = cond.timeOfDay === 'FLOODLIT' ? 1 : cond.timeOfDay === 'TWILIGHT' ? 0.55 : 0;
    u.uFlood.value = cond.floodIntensity;
    u.uTime.value = this.t;

    /* -------------------------------------------------------------- lights */
    const focus = this.focusOf(cam);
    const nightKey = cond.floodlit;
    /* At night the practical key IS the floodlight battery, high and steep, so
     * shadows sit almost under the man and the bowl reads as an evening. By day
     * the sun's elevation gives the long shadows that make a backline move. */
    const kx = nightKey ? 60 * s : this.sunVec.x * 150 * s;
    const ky = nightKey ? 150 * s : this.sunVec.y * 150 * s;
    const kz = nightKey ? -40 * s : this.sunVec.z * 150 * s;
    this.key.color.set(cond.keyColor);
    this.key.intensity = cond.keyIntensity;
    this.key.position.set(focus.x + kx, ky, focus.z + kz);
    this.target.position.copy(focus);
    this.target.updateMatrixWorld();

    this.hemi.color.set(cond.hemiSky);
    this.hemi.groundColor.set(cond.hemiGround);
    this.hemi.intensity = cond.hemiIntensity;
    this.ambient.color.set(cond.ambientColor);
    this.ambient.intensity = cond.ambientIntensity;
    this.fill.color.set(cond.fillColor);
    this.fill.intensity = cond.fillIntensity;
    this.fill.position.set(-focus.x * 0.4 - 80 * s, 60 * s, -focus.z * 0.4 + 120 * s);

    /* Shadow frustum: a 42 m box (logical) centred on the focus. The aspect of
     * the box follows the pitch's own 1 : 1.5, so the texels are square. */
    const R = 42 * s;
    const sc = this.key.shadow.camera as THREE.OrthographicCamera;
    if (sc.left !== -R) {
      sc.left = -R; sc.right = R; sc.top = R * 1.5; sc.bottom = -R * 1.5;
      sc.near = 1; sc.far = 460 * s;
      sc.updateProjectionMatrix();
    }

    /* -------------------------------------------------------------- mist */
    for (let i = 0; i < this.mist.length; i++) {
      this.mist[i].visible = false;
    }

    /* ------------------------------------------------- floodlight shafts */
    const coneA = cond.floodIntensity * (cond.weather === 'FOG' ? 0.2 : 0.075);
    for (const cone of this.cones) {
      const mat = cone.material as THREE.MeshBasicMaterial;
      mat.opacity += (coneA - mat.opacity) * Math.min(1, dt * 2);
    }
    for (const g of this.lampGlows) {
      const mat = g.material as THREE.SpriteMaterial;
      const want = cond.floodIntensity * (0.55 + cond.bloomStrength * 0.3);
      mat.opacity += (want - mat.opacity) * Math.min(1, dt * 2);
    }

    /* --------------------------------------------------------- rain / snow */
    this.precip.visible = false;

    /* ---------------------------------------------------------- wet layer */
    const wetA = cond.sheen * 0.5 + cond.puddles * 0.34;
    this.wetLayer.visible = wetA > 0.005 || cond.frost > 0.02;
    this.wetMat.opacity = cond.frost > 0.02
      ? Math.max(wetA * 0.8, cond.frost * 0.5)
      : wetA * 0.8;
    this.wetMat.color.set(cond.frost > 0.02 ? '#dceaff' : '#a9c8ea');

    /* ------------------------------------------------- scene-wide effects */
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color.set(cond.fogColor);
      fog.density = cond.fogDensity;
    }
    this.tmpCol.set(cond.fogColor);
    (this.scene.background as THREE.Color | null)?.copy?.(this.tmpCol);

    this.bloom.strength = cond.bloomStrength;
    this.bloom.threshold = cond.bloomThreshold;
    this.bloom.radius = cond.bloomRadius;
  }

  /**
   * Quality tier changed (or first frame): rebuild the shadow map size and
   * whether the key casts at all. `mapSize` changes need the old map disposed.
   */
  /* -------------------------------------------------- image-based lighting */
  private pmrem: THREE.PMREMGenerator | null = null;
  private envScene: THREE.Scene | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;

  /**
   * Filter THIS frame's sky dome into an environment map.
   *
   * A PBR material has two halves: a diffuse lobe and a specular lobe. Lights
   * give it the diffuse and nothing else gives it the specular, so a scene of
   * `MeshStandardMaterial`s with no `scene.environment` is a scene where a
   * black jersey cannot reflect a stadium and a white jersey has nothing to do
   * but clip — exactly the flat, primed, everything-is-grey look a hand-lit PBR
   * rig falls into. The dome already holds the answer (it IS the sky, the
   * floodlit haze and the sun), so rather than inventing a second set of fills
   * the scene's own sky is run through three's prefiltered radiance generator.
   *
   * Once per CONDITIONS CHANGE, not per frame: `fromScene` costs a handful of
   * milliseconds, and the sky only changes when the weather or the kick-off
   * time moves on the options screen.
   */
  refreshEnvironment(renderer: THREE.WebGLRenderer, cond: Conditions): THREE.Texture | null {
    /* FLAT 16-BIT is a deliberately unlit frame; an IBL would fight it. */
    if (cond.quality === 'LEGACY') {
      this.envRT?.dispose();
      this.envRT = null;
      return null;
    }
    if (!this.envScene) {
      /* A second mesh over the SAME geometry and material: the real dome is
       * never re-parented out of the live scene, and the two cannot disagree
       * about what the sky looks like because they share their uniforms. */
      const proxy = new THREE.Mesh(this.dome.geometry, this.skyMat);
      proxy.frustumCulled = false;
      this.envScene = new THREE.Scene();
      this.envScene.add(proxy);
    }
    this.pmrem ??= new THREE.PMREMGenerator(renderer);
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, DOME_R * 4);
    this.envRT?.dispose();
    this.envRT = rt;
    return rt.texture;
  }

  applyQuality(cond: Conditions) {
    const size = cond.quality === 'FULL' ? 2048 : 1024;
    this.key.castShadow = cond.shadows;
    if (this.key.shadow.mapSize.x !== size) {
      this.key.shadow.mapSize.set(size, size);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.precip.visible = false;
    for (const c of this.cones) (c.material as THREE.MeshBasicMaterial).visible = cond.quality !== 'LEGACY';
  }

  dispose() {
    this.envRT?.dispose();
    this.envRT = null;
    this.envScene = null;
    this.pmrem?.dispose();
    this.pmrem = null;
    this.dome.geometry.dispose();
    this.skyMat.dispose();
    this.precip.geometry.dispose();
    this.precipMat.dispose();
    this.wetLayer.geometry.dispose();
    (this.wetMat.map as THREE.Texture | null)?.dispose();
    this.wetMat.dispose();
    for (const m of this.mist) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    for (const c of this.cones) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); }
    for (const g of this.lampGlows) { (g.material.map as THREE.Texture | null)?.dispose(); g.material.dispose(); }
    for (const l of [this.key, this.hemi, this.ambient, this.fill]) {
      l.dispose?.();
      l.removeFromParent();
    }
    this.target.removeFromParent();
    this.group.removeFromParent();
  }
}
