/**
 * conditions.ts — MATCH-DAY CONDITIONS, RESOLVED ONCE PER FRAME.
 *
 * The design document already models this game's sky. `WEATHERS` in
 * `engine/weather.ts` drives ball wetness, handling error and kick distance;
 * `pitchConditions()` in `render/retro.ts` drives acceleration, sidestep
 * success and maul traction; the WIND slider pushes every kick off line; the
 * KICK-OFF slider was documented as "changes crowd shading and the vignette
 * weight" and read by nothing. Four authored systems, one of them advertised
 * in the options menu, and the 3D layer drew the same flat blue night for every
 * one of them.
 *
 * This module is the seam. It is PURE: it reads the option indices the engine
 * already uses and returns one immutable description of what the match looks
 * like. The renderer, the sky, the lights, the precipitation and the FX
 * director all read the same object, so a wet ball, a slippery pitch and a
 * rain-lit stadium cannot disagree — the same argument `scrumFacing()` makes
 * for the pack heading ("the single authored engagement heading ... shared
 * with the engine so the pack cannot be pointing one way in the simulation and
 * another on screen").
 *
 * Rules of the house:
 *  - No engine values are invented here. wetness comes from `wetnessOf()`,
 *    wind from `windOf()`, footing from `pitchConditions()`. Only what the
 *    renderer needs that the engine has no concept of (sky colours, exposure)
 *    is authored, and it is authored as a table, not as arithmetic in a draw
 *    call.
 *  - Every number here is a *presentation* number. Nothing in this file may
 *    change how the match plays. `director.ts` must be able to run headless
 *    with this module deleted.
 */
import { wetnessOf, windOf, WEATHERS } from '../game/engine/weather';
import { pitchConditions } from './retro';

export type Precip = 'NONE' | 'RAIN' | 'SNOW';
export type Quality = 'LEGACY' | 'STANDARD' | 'FULL';

export interface Conditions {
  /** Option indices, kept so the HUD can print what it is drawing. */
  weather: string; timeOfDay: string; pitchKind: string;

  /* ---------------------------------------------------------------- sky --- */
  /** Zenith, mid, horizon. Linear-space hex strings for the dome shader. */
  skyZenith: string; skyMid: string; skyHorizon: string;
  /** Ground haze band below the horizon (stadium bowl glow). */
  groundHaze: string;
  stars: number;        // 0..1 star field opacity
  cloud: number;        // 0..1 cloud deck opacity
  cloudSpeed: number;   // deg/s of drift, driven by wind

  /* ------------------------------------------------------------- lights --- */
  /** The key light. Sun by day, the floodlight battery at night. */
  keyColor: string; keyIntensity: number;
  /** Azimuth/elevation in radians. Elevation < ~0.18 means long shadows. */
  sunAz: number; sunEl: number;
  /** True when the floodlights are the practical light source. */
  floodlit: boolean; floodIntensity: number;
  /** Ambient bounce (sky + concrete) and the hemisphere pair. */
  ambientColor: string; ambientIntensity: number;
  hemiSky: string; hemiGround: string; hemiIntensity: number;
  /** Fill from the far side of the bowl so backs never go pure black. */
  fillColor: string; fillIntensity: number;
  /** 0..1. Scales the shadow map's opacity contribution and the blob alpha. */
  shadowStrength: number;
  shadows: boolean;

  /* --------------------------------------------------------------- air --- */
  fogColor: string; fogDensity: number;
  precip: Precip;
  precipDensity: number;   // 0..1 emitter rate
  /** m/s of horizontal push on every falling particle and on the ball seam. */
  windSpeed: number;
  /** Unit vector on the ground plane the wind blows TOWARD. */
  windX: number; windZ: number;
  /** Radians of lean for a falling streak at this wind. */
  windSlant: number;
  wetness: number;         // 0..1, from the engine's own wetnessOf()
  /** 0..1 specular sheen on the turf and the kit. Rain-slicked, not flooded. */
  sheen: number;
  /** 0..1 standing water in the low ground. */
  puddles: number;
  /** 0..1 rime on the grass blades (FROZEN pitch, COLD SNAP). */
  frost: number;
  /** 0..1 visible breath and ground steam. */
  steam: number;
  /** 0..1 how much the crowd is a colour block rather than people. */
  crowdDamp: number;

  /* ---------------------------------------------------------------- turf --- */
  grassA: string; grassB: string;
  /** 0..1 mud available to be thrown up and to stain kit. */
  mud: number;
  /** 0..1 dry dust (FIRM pitch) as opposed to wet turf (SOFT/MUDDY). */
  dust: number;
  /** Scarring rate: metres of contact per unit of permanent pitch damage. */
  scarring: number;
  wear: number;

  /* ------------------------------------------------- camera & post --- */
  exposure: number;
  bloomStrength: number; bloomThreshold: number;
  /** Halo around every lamp. Rises hard in FOG. */
  bloomRadius: number;
  vignette: number; grain: number; chroma: number;
  /** Colour grade, applied as lift/gain on the way out of the composer. */
  gradeLift: [number, number, number];
  gradeGain: [number, number, number];
  /** 0..1. How much of the frame the rain is allowed to obscure. */
  lensWet: number;

  /** Quality tier chosen by the user; the renderer obeys it, not the weather. */
  quality: Quality;
}

/* ----------------------------------------------------------- time of day --- */
/**
 * KICK-OFF is an index into ['MIDDAY','AFTERNOON','TWILIGHT','FLOODLIT'].
 * The sun's elevation and azimuth are those of a late-autumn 50°N ground —
 * i.e. the real reason a Twickenham kick-off at 4 p.m. throws shadows the
 * length of a backline. Sun azimuth is fixed at ~148° (SE) so the light
 * direction is stable frame to frame and the packs cast consistent shade.
 */
const TIMES = ['MIDDAY', 'AFTERNOON', 'TWILIGHT', 'FLOODLIT'] as const;

interface TimeLook {
  zenith: string; mid: string; horizon: string; haze: string;
  key: string; keyI: number; el: number; az: number;
  amb: string; ambI: number; hs: string; hg: string; hI: number;
  fill: string; fillI: number; fog: string; fogD: number;
  exp: number; bloom: number; thresh: number; vig: number;
  stars: number; cloud: number; flood: number; crowdDamp: number;
  shadow: number;
}

const TIME_LOOK: Record<(typeof TIMES)[number], TimeLook> = {
  MIDDAY: {
    zenith: '#3f79c8', mid: '#7fa9dc', horizon: '#cfdcea', haze: '#9fb0bc',
    key: '#fff4dc', keyI: 3.05, el: 0.92, az: 2.58,
    amb: '#cfe0f2', ambI: 0.62, hs: '#bcd6f0', hg: '#3d5a34', hI: 0.85,
    fill: '#dfeaf5', fillI: 0.30, fog: '#b9c9d8', fogD: 0.0016,
    exp: 1.0, bloom: 0.10, thresh: 0.94, vig: 0.22,
    stars: 0, cloud: 0.30, flood: 0, crowdDamp: 0, shadow: 1.0,
  },
  AFTERNOON: {
    zenith: '#35639f', mid: '#7d94bd', horizon: '#d8b98c', haze: '#a58f74',
    key: '#ffd9a1', keyI: 2.75, el: 0.40, az: 2.34,
    amb: '#d8cbb8', ambI: 0.50, hs: '#a9c3e2', hg: '#42512f', hI: 0.80,
    fill: '#e8c9a0', fillI: 0.34, fog: '#a89e9a', fogD: 0.0026,
    exp: 1.02, bloom: 0.17, thresh: 0.88, vig: 0.30,
    stars: 0, cloud: 0.42, flood: 0.05, crowdDamp: 0.05, shadow: 1.0,
  },
  TWILIGHT: {
    zenith: '#16224a', mid: '#3a4a76', horizon: '#c07a4e', haze: '#5d4a4a',
    key: '#ffb377', keyI: 1.55, el: 0.09, az: 2.10,
    amb: '#5f6f92', ambI: 0.50, hs: '#39496e', hg: '#1a2418', hI: 0.62,
    fill: '#7fa0d8', fillI: 0.40, fog: '#2d3a55', fogD: 0.0058,
    exp: 1.10, bloom: 0.30, thresh: 0.74, vig: 0.40,
    stars: 0.45, cloud: 0.5, flood: 0.75, crowdDamp: 0.25, shadow: 0.75,
  },
  FLOODLIT: {
    zenith: '#050810', mid: '#0c1426', horizon: '#1d2a3e', haze: '#233246',
    key: '#eaf3ff', keyI: 2.35, el: 0.72, az: 0.62,
    amb: '#3a4a66', ambI: 0.42, hs: '#25344e', hg: '#0d1610', hI: 0.55,
    fill: '#89b6ff', fillI: 0.52, fog: '#131d2e', fogD: 0.0062,
    exp: 1.16, bloom: 0.46, thresh: 0.60, vig: 0.50,
    stars: 0.9, cloud: 0.22, flood: 1.0, crowdDamp: 0.4, shadow: 0.9,
  },
};

/* -------------------------------------------------------------- weather --- */
interface WeatherLook {
  /** Multipliers and additive overrides on the time-of-day base. */
  keyMul: number; ambMul: number; fogAdd: number; expMul: number;
  bloomAdd: number; threshAdd: number; vigAdd: number; grain: number;
  chroma: number; sheen: number; puddle: number; steam: number;
  cloudMul: number; starsMul: number; crowdDamp: number;
  precip: Precip; precipMul: number; wetMul: number;
  skyMul: number; horizonMul: number; shadowMul: number;
}

const WEATHER_LOOK: Record<string, WeatherLook> = {
  CLEAR: {
    keyMul: 1.0, ambMul: 1.0, fogAdd: 0, expMul: 1, bloomAdd: 0, threshAdd: 0,
    vigAdd: 0, grain: 0.026, chroma: 0.0011, sheen: 0.02, puddle: 0, steam: 0,
    cloudMul: 0.55, starsMul: 1, crowdDamp: 0, precip: 'NONE', precipMul: 0,
    wetMul: 1, skyMul: 1.06, horizonMul: 1, shadowMul: 1,
  },
  OVERCAST: {
    keyMul: 0.38, ambMul: 1.55, fogAdd: 0.0012, expMul: 1.03, bloomAdd: -0.03,
    threshAdd: 0.1, vigAdd: 0.06, grain: 0.034, chroma: 0.0016, sheen: 0.18,
    puddle: 0.05, steam: 0.05, cloudMul: 1.9, starsMul: 0.1, crowdDamp: 0.1,
    precip: 'NONE', precipMul: 0, wetMul: 1.3, skyMul: 0.78, horizonMul: 0.9,
    shadowMul: 0.18,
  },
  DRIZZLE: {
    keyMul: 0.5, ambMul: 1.3, fogAdd: 0.0035, expMul: 1.04, bloomAdd: 0.06,
    threshAdd: 0.02, vigAdd: 0.16, grain: 0.055, chroma: 0.0026, sheen: 0.5,
    puddle: 0.16, steam: 0.14, cloudMul: 2.2, starsMul: 0.04, crowdDamp: 0.2,
    precip: 'RAIN', precipMul: 0.55, wetMul: 1.35, skyMul: 0.62,
    horizonMul: 0.82, shadowMul: 0.3,
  },
  RAIN: {
    keyMul: 0.42, ambMul: 1.42, fogAdd: 0.0072, expMul: 1.05, bloomAdd: 0.12,
    threshAdd: -0.04, vigAdd: 0.26, grain: 0.075, chroma: 0.0042, sheen: 0.82,
    puddle: 0.45, steam: 0.2, cloudMul: 2.6, starsMul: 0, crowdDamp: 0.34,
    precip: 'RAIN', precipMul: 1.0, wetMul: 1.5, skyMul: 0.5,
    horizonMul: 0.72, shadowMul: 0.22,
  },
  FOG: {
    keyMul: 0.6, ambMul: 1.7, fogAdd: 0.0175, expMul: 1.12, bloomAdd: 0.30,
    threshAdd: -0.16, vigAdd: 0.18, grain: 0.05, chroma: 0.0028, sheen: 0.34,
    puddle: 0.1, steam: 0.55, cloudMul: 2.9, starsMul: 0, crowdDamp: 0.62,
    precip: 'NONE', precipMul: 0, wetMul: 1.45, skyMul: 0.68,
    horizonMul: 1.5, shadowMul: 0.1,
  },
  'COLD SNAP': {
    keyMul: 0.72, ambMul: 1.35, fogAdd: 0.0058, expMul: 1.07, bloomAdd: 0.14,
    threshAdd: 0.02, vigAdd: 0.2, grain: 0.045, chroma: 0.0018, sheen: 0.4,
    puddle: 0.08, steam: 1.0, cloudMul: 1.7, starsMul: 0.5, crowdDamp: 0.3,
    precip: 'SNOW', precipMul: 0.8, wetMul: 0.8, skyMul: 0.72,
    horizonMul: 1.15, shadowMul: 0.5,
  },
  GALE: {
    keyMul: 0.66, ambMul: 1.2, fogAdd: 0.0022, expMul: 1.0, bloomAdd: 0.05,
    threshAdd: 0.06, vigAdd: 0.22, grain: 0.06, chroma: 0.003, sheen: 0.4,
    puddle: 0.2, steam: 0.3, cloudMul: 3.4, starsMul: 0.15, crowdDamp: 0.22,
    precip: 'RAIN', precipMul: 0.7, wetMul: 1.2, skyMul: 0.6,
    horizonMul: 0.9, shadowMul: 0.35,
  },
};

/* ------------------------------------------------------------ the resolver --- */
const mul = (c: string, k: number): string => {
  const n = parseInt(c.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
};

/**
 * Resolve the match-day look from the options object the engine already owns.
 *
 * `options` is the raw menu bag (indices, not values) — the same bag the engine
 * reads at `director.ts:3932` for wetness and `kick.ts:478` for wind, so there
 * is exactly one set of inputs in the building.
 */
export function resolveConditions(
  options: Record<string, number>,
  quality: Quality = 'FULL',
): Conditions {
  const weather = WEATHERS[options.weather ?? 1] ?? 'OVERCAST';
  const timeOfDay = TIMES[clampI(options.timeofday ?? 2, 0, 3)] ?? 'TWILIGHT';
  const pitchIdx = clampI(options.pitch ?? 1, 0, 4);
  const pitchKind = ['FIRM', 'STANDARD', 'SOFT', 'MUDDY', 'FROZEN'][pitchIdx];

  const T = TIME_LOOK[timeOfDay];
  const W = WEATHER_LOOK[weather] ?? WEATHER_LOOK.OVERCAST;
  const P = pitchConditions(pitchKind);

  const wetness = Math.min(1, wetnessOf(weather) * W.wetMul);
  const wind = windOf(options as Record<string, number>);
  /* Wind direction is a fixed bearing (W->E-NE) for the match. A per-frame
   * random bearing would make the flags and the rain disagree with the ball's
   * lateral drift, which the kick solver has already committed to. */
  const windDir = 2.42;
  const windSpeed = wind * 17 + 0.6;

  /* Pitch state. The engine says: firmness changes footing, wear accumulates.
   * The renderer adds: what comes off the ground when a man hits it, and what
   * stays on the shirt when he gets up. */
  const mud = P.firm < 0.4 ? (P.firm < 0.25 ? 1 : 0.62) : 0.2;
  const dust = P.firm > 0.85 ? 0.75 : P.firm > 0.6 ? 0.34 : 0.08;
  const frost = pitchKind === 'FROZEN' ? 1 : weather === 'COLD SNAP' ? 0.62 : 0;
  const scarring = 0.35 + (1 - P.firm) * 1.15;

  const shadows = quality !== 'LEGACY' && T.shadow * W.shadowMul > 0.14;

  return {
    weather, timeOfDay, pitchKind,

    skyZenith: mul(T.zenith, T.stars > 0.4 ? 1 : W.skyMul),
    skyMid: mul(T.mid, W.skyMul),
    skyHorizon: mul(T.horizon, W.horizonMul),
    groundHaze: mul(T.haze, W.skyMul * 0.95 + 0.05),
    stars: T.stars * W.starsMul,
    cloud: Math.min(1, T.cloud * W.cloudMul),
    cloudSpeed: 1.4 + windSpeed * 0.9,

    keyColor: W.precip === 'SNOW' ? '#dbe7ff' : T.key,
    keyIntensity: T.keyI * W.keyMul * (quality === 'LEGACY' ? 1.25 : 1),
    sunAz: T.az, sunEl: T.el,
    floodlit: T.flood > 0.5,
    floodIntensity: T.flood,
    ambientColor: T.amb, ambientIntensity: T.ambI * W.ambMul,
    hemiSky: T.hs, hemiGround: T.hg, hemiIntensity: T.hI * (1 + W.ambMul * 0.25),
    fillColor: T.fill, fillIntensity: T.fillI,
    shadowStrength: clampN(T.shadow * W.shadowMul, 0, 1),
    shadows,

    fogColor: mul(T.fog, 0.9 + W.horizonMul * 0.12),
    fogDensity: Math.max(0.0008, T.fogD + W.fogAdd),
    precip: W.precip,
    precipDensity: W.precipMul,
    windSpeed,
    windX: Math.sin(windDir), windZ: Math.cos(windDir),
    windSlant: Math.min(0.52, windSpeed * 0.021),
    wetness,
    sheen: clampN(W.sheen + wetness * 0.25, 0, 1),
    puddles: clampN(W.puddle + (wetness > 0.8 ? 0.18 : 0), 0, 1),
    frost,
    steam: clampN(W.steam + (timeOfDay === 'FLOODLIT' ? 0.25 : 0), 0, 1),
    crowdDamp: clampN(T.crowdDamp + W.crowdDamp, 0, 1),

    grassA: P.grassA, grassB: P.grassB,
    mud, dust, scarring, wear: P.wear,

    exposure: T.exp * W.expMul * (quality === 'LEGACY' ? 1.1 : 1),
    bloomStrength: clampN(T.bloom + W.bloomAdd, 0, 1.2),
    bloomThreshold: clampN(T.thresh + W.threshAdd, 0.02, 1),
    bloomRadius: 0.55 + (weather === 'FOG' ? 0.5 : 0.18) + (T.flood > 0.5 ? 0.15 : 0),
    vignette: clampN(T.vig + W.vigAdd, 0, 1.2),
    grain: quality === 'LEGACY' ? 0.03 : W.grain,
    chroma: W.chroma,
    gradeLift: [
      (W.precip === 'SNOW' ? 0.020 : 0.006) + (W.skyMul - 1) * 0.01,
      0.004,
      (weather === 'OVERCAST' || W.precip === 'SNOW' ? 0.028 : 0.012),
    ],
    gradeGain: [
      1 + (T.keyI > 2.4 ? 0.03 : 0.0),
      1 - W.crowdDamp * 0.04,
      1 + (W.steam > 0.4 ? 0.06 : 0.0),
    ],
    lensWet: clampN((W.precip === 'RAIN' ? W.precipMul : 0) * 0.8 + wetness * 0.15, 0, 1),

    quality,
  };
}

function clampI(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, Math.round(v)));
}
function clampN(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

/**
 * The PRESENTATION option's index, resolved once. `data.ts` owns the labels
 * ('FLAT 16-BIT', 'STANDARD', 'NEXT-GEN'); this owns the meaning, so the menu
 * can be re-worded without the renderer and the view each keeping a private
 * copy of the same array and drifting.
 */
export function qualityFor(options: Record<string, number>): Quality {
  const i = Math.round(options.render ?? 2);
  return i <= 0 ? 'LEGACY' : i === 1 ? 'STANDARD' : 'FULL';
}

/* A cache so MatchView can call this every frame without allocating a fresh
 * object graph: conditions only change when an option changes. */
let cacheKey = '';
let cacheVal: Conditions | null = null;
export function conditionsFor(
  options: Record<string, number>, quality: Quality,
): Conditions {
  const k = `${options.weather ?? 1}|${options.timeofday ?? 2}|${options.pitch ?? 1}|${options.wind ?? 1}|${quality}`;
  if (k !== cacheKey || !cacheVal) {
    cacheKey = k;
    cacheVal = resolveConditions(options, quality);
  }
  return cacheVal;
}
