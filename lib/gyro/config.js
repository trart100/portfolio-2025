// Numbers measured from the reference video (public/assets/video_visual_for_website_1.mp4:
// 1350x1350, 30 fps, seamless 10 s loop). Lengths are in units of the outer ring radius.
// First estimates; they get tuned against the video in the matching step.

export const LOOP_SECONDS = 10

// Outer ring fills ~60% of the frame height (rim at 402 px of 1350)
export const CAMERA = { fov: 30, distance: 6.2 }

// Frame-difference speed profile: the rings rest at 0 s, 5 s and 10 s and slow to
// ~55% of the peak speed around 2.5 s and 7.5 s (the "cross" pose).
export const MID_SLOWDOWN = 0.78

// Four frosted bands, flat to the camera at 0 s. Radii from the rim profile at 0 s
// (402 / 365 / 331 / 296 px). Each band flips around an axis lying in its own plane
// (x right, y up) and makes `halfTurns` x 180 degrees per loop, so 0 s and 10 s match.
export const RINGS = [
  // edge-on, vertical at 5 s
  { radius: 1.0, height: 0.3, axis: [0, 1, 0], halfTurns: 3 },
  // edge-on, horizontal at 2.5 s and 7.5 s
  { radius: 0.908, height: 0.3, axis: [1, 0, 0], halfTurns: 2 },
  // edge-on, vertical at 2.5 s and 7.5 s
  { radius: 0.823, height: 0.3, axis: [0, 1, 0], halfTurns: 2 },
  // diagonal flip, flat again at 2.5 s and 5 s
  { radius: 0.736, height: 0.3, axis: [1, 1, 0], halfTurns: 4 }
]

// Small gold gyroscope in the centre (outer gold ring at 39 px of 1350)
export const CORE = {
  outerRadius: 0.097,
  innerRadius: 0.062,
  tube: 0.007,
  color: 0xc8963c,
  halfTurns: 4
}
