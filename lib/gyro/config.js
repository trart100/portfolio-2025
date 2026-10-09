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

// Look settings (tunable live with ?3d&gui; "Copy values" there prints them in this shape).
// Glass: Principled transmission 1, roughness 0.1, IOR 2.0, coat 0.1875 / roughness 0.75.
// Light passes through (dimmed by `dim`), the band's reflections are added on top.
// Gold: textured base colour boosted by Hue/Sat/Value (sat x2, value x1.96) = linear
// (1.16, 0.82, 0), metallic 0.4045, roughness map average 0.16.
// Light walls: emission 10000 in Blender (clips to white under AgX); `walls` is their
// brightness in the baked reflections. Glass roughness is above Blender's 0.1 because the
// baked reflections treat the walls as infinitely far away, which makes them look sharper.
export const LOOK = {
  exposure: 1.0,
  walls: 10,
  glass: { roughness: 0.22, ior: 2.0, coat: 0.1875, coatRoughness: 0.75, dim: 0.06, reflection: 1.0 },
  gold: { color: [1.16, 0.82, 0.0], metalness: 0.4045, roughness: 0.16, reflection: 0.35 }
}
