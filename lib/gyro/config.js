// Values from the original Blender scene (main_visual_for_claude.blend, Blender 4.3, Cycles).
// Scene objects are built in Blender coordinates (z up, camera looking along +y) inside a
// root group that converts them to three.js (y up). Angles in radians unless noted.

const TAU = Math.PI * 2
const DEG = Math.PI / 180

// 300 frames at 30 fps, scene frames 1..300; every animated value is linear and periodic
export const FPS = 30
export const LOOP_FRAMES = 300
export const FIRST_FRAME = 1

// Camera at (0, -7.0366, 0), 30 mm lens on a 36 mm sensor (square render, no depth of field).
// The video is the 1080 px render placed unscaled in a 1350 px frame, hence frameScale 1.25.
export const CAMERA = { distance: 7.0366, lens: 30, sensor: 36, frameScale: 1350 / 1080 }

// Three glass bands (mesh radius 3, height 0.66, Solidify 0.02 inwards), object scales 1 / 0.9 / 0.8.
// end = Euler XYZ rotation reached at frame 300 (linear from 0 at frame 0).
export const RING = { radius: 3, height: 0.66, thickness: 0.02 }
export const RINGS = [
  { scale: 1.0, end: [Math.PI, Math.PI, 0] },
  { scale: 0.9, end: [TAU, 0, TAU] },
  { scale: 0.8, end: [-TAU, -TAU, 0] }
]

// "gold array": a bevelled circle copied 5 times by the Advanced Array Tool.
// Object: rotation X 90 deg, scale 0.51455. Copy i (0..4): scale 0.09 + 0.3312 * i,
// rotation Euler XYZ (i * rx, i * ry, 0) with rx 90 -> 810 deg and ry 45 -> 405 deg over the loop.
export const GOLD = {
  objectRotationX: 90 * DEG,
  objectScale: 0.51455,
  count: 5,
  baseScale: 0.09,
  scaleStep: 0.3312,
  ringRadius: 0.403,
  tube: 0.04,
  rx: { start: 90 * DEG, end: 810 * DEG },
  ry: { start: 45 * DEG, end: 405 * DEG }
}

// Glass base colour from the Blender material (colour ramp at 0.5, saturation x0.5), linear.
// Tints what is seen through the glass and the haze.
export const GLASS_TINT = [0.875, 0.929, 1.0]

// Look settings (tunable live with ?gui; "Copy values" there prints them in this shape).
// Glass: Principled transmission 1, roughness 0.1, IOR 2.0, coat 0.1875 / roughness 0.75.
// Light passes through (dimmed by `dim`), the band's reflections are added on top.
// Gold: textured base colour boosted by Hue/Sat/Value (sat x2, value x1.96) = linear
// (1.16, 0.82, 0), metallic 0.4045, roughness map average 0.16.
// Light walls: emission 10000 in Blender (clips to white under AgX); `walls` is their
// brightness in the baked reflections. Glass roughness is above Blender's 0.1 because the
// baked reflections treat the walls as infinitely far away, which makes them look sharper.
// Starting values = Artur's tuning (v6.5.5).
// "Reset all" in ?gui returns to these.
export const LOOK = {
  exposure: 1,
  walls: 13,
  glass: { roughness: 0.1, ior: 1.87, coat: 0.45, coatRoughness: 0.29, dim: 0.51, reflection: 1.94 },
  gold: { color: [1.24, 0.48, 0.0], metalness: 0.84, roughness: 0, reflection: 0.41 },
  // Effects of the Cycles glass that the basic material can't do (step 4):
  // blur = how blurred the gold behind the glass looks (fraction of the frame height),
  // glassBlur = the same for rings seen through a band (more: their sharp reflection edges
  // otherwise show through as hard steps),
  // behind = brightness of what is seen through the glass, glassBehind = far glass seen through
  // near glass, relative to the gold (1 = same), blurReach = distance behind the glass (scene
  // units, ring radius 3) over which things go from sharp (touching) to fully blurred,
  // haze = frosted glass catching
  // light from the walls, grain = render noise on lit areas (the black stays clean),
  // grainSize = grain size in screen pixels (1 = single pixel, larger = softer),
  // grainColor = 0 grey .. 1 separate noise per colour channel, grainFps = new grain per second (0 = frozen)
  atmosphere: { blur: 0.001, glassBlur: 0.013, behind: 1.83, glassBehind: 0.75, blurReach: 0.46, haze: 0.003, grain: 0.06, grainSize: 1, grainColor: 1, grainFps: 30 },
  // Mouse drift: how far (screen px, mouse at the screen edge) the glass bands and the gold
  // move towards the mouse (until 6.6.2 the whole visual moved 18 px as one image)
  drift: { glass: 26, gold: 80 },
  // Click / tap spin-up (spin.js): kick = extra speed per click (x the normal speed, adds up),
  // max = most extra speed, follow = seconds the glass lags behind the gold's speed,
  // settle = seconds the extra speed takes to fade (time constant; ~3x that to look normal again),
  // scroll = extra speed per 1000 px scrolled (steady scrolling at v px/s holds about
  // v / 1000 x scroll x settle extra speed)
  spin: { kick: 5, max: 50, follow: 0.4, settle: 0.5, scroll: 15 },
  // Effects from the spin speed (effects.js): mode auto (SVG filter on desktop, shader + CSS on
  // touch) / b / a / off. Per effect: strength = CSS px at full speed, curve = response (1 =
  // linear, < 1 = shows early, > 1 = only when fast); shake speed = base wobble rate (Hz).
  effects: {
    mode: 'auto',
    chroma: { strength: 12, curve: 0.7 },
    shake: { strength: 6, curve: 1.5, speed: 8 }
  }
}

// Reference only (not used): the first values derived from the Blender file (v6.3.6),
// kept for comparison with the tuned LOOK above.
export const LOOK_FROM_BLENDER = {
  exposure: 1.0,
  walls: 10,
  glass: { roughness: 0.22, ior: 2.0, coat: 0.1875, coatRoughness: 0.75, dim: 0.06, reflection: 1.0 },
  gold: { color: [1.16, 0.82, 0.0], metalness: 0.4045, roughness: 0.16, reflection: 0.35 }
}
