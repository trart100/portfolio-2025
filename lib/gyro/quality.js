// Adaptive quality (step 5a). Levels from best to lowest; the ladder ends at the lowest 3D
// level (never the video, never a still image).
//  layers     = glass layers (blur steps), capped by the device default (touch: 1)
//  scale      = 2 supersampling where the canvas allows it, 1 = 1x + MSAA
//  resolution = canvas pixels per screen pixel (0.75 = rendered smaller, stretched by the browser)
export const QUALITY_LEVELS = [
  { layers: 4, scale: 2, resolution: 1 },
  { layers: 2, scale: 2, resolution: 1 },
  { layers: 1, scale: 2, resolution: 1 },
  { layers: 1, scale: 1, resolution: 1 },
  { layers: 1, scale: 1, resolution: 0.75 }
]

const SLOW_FRAME_MS = 20 // typical frame time above this = below ~50 fps
// Longer intervals between untimed frames are tab switches / a hidden page, not slowness.
// Timed frames (`cost`) always count while the page is visible (6.8.14): before, every frame
// over GAP_MS was dropped, so on the slowest computers (140 ms frames) the start-up check
// stood still for up to 9 s on the first level (PostHog visual_quality, 2026-11).
const GAP_MS = 250
// Cost of each level relative to the best one, from visitors' computers (PostHog
// visual_quality measured_ms, 2026-11: ~0.6 per step, little from level 3 to 4). Only used
// to jump straight to a level that should fit when the start is far too slow; that level is
// then measured like any other, so a wrong guess is corrected by the normal steps.
const LEVEL_COST = [1, 0.6, 0.39, 0.35, 0.22]
// Start-up check (behind the preloader): each frame is timed until the GPU has finished it
// (`cost`, see gyro.finish); frame intervals alone look fast at first while the GPU queues
// work. Skip the first frames (shader compilation), then measure; after a step down, skip a
// few more (new images) and measure again.
// A level whose first QUICK_FRAMES are all over twice the limit steps down at once.
const STARTUP_SKIP = 4
const STEP_SKIP = 2
const STARTUP_FRAMES = 12
const QUICK_FRAMES = 4
// While the page is shown: every WATCH_SYNC_EVERY-th frame is timed the same way, after the
// frames still queued on the GPU are drained (GyroVisual), so it is one frame's real cost.
// Not frame intervals: a capped frame rate (phone low-power mode, battery saver, 30 Hz) looks
// slow, while a GPU-bound page can keep ~16.7 ms intervals (the browser drops frames instead).
// A timed frame blocks the page for its own cost, so only ~1 per second (no stutter while the
// GPU is fast; a device near the limit may drop that one frame). Only sustained slowness
// (lower quartile of the last WATCH_SAMPLES timed frames, ~5 s) steps down, one level at a time, at
// least WATCH_PAUSE_MS apart, never back up (no flicker).
const WATCH_SYNC_EVERY = 60
const WATCH_SAMPLES = 5
const WATCH_PAUSE_MS = 5000

// Lower quartile, not the median: a slow GPU makes every timed frame slow, while the browser's
// other GPU work (the page's own animations) only inflates some of them (a phone at ~3 ms once
// read 12.8 ms as the median).
const typicalOf = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 2]
}

// `setResolution(r)` resizes the canvas; `onSettled()` is called once, when the start-up
// check has picked a level. `forcedLevel` (1-based, ?q=) fixes the level and turns adapting off.
export function createQualityController({ gyro, setResolution, onSettled, forcedLevel = null, adapt = true }) {
  let level = 0
  let resolution = 1
  let settled = false
  let previous = null
  let skip = STARTUP_SKIP
  let samples = []
  let lastChange = 0
  let frameCount = 0
  let watched = '' // last watch value (ms), for the readout
  const measured = [] // start-up value per tried level (ms), for the console / tests

  const state = () => `${gyro.getPeelLayers()}|${gyro.getScale()}|${resolution}`
  const apply = (index) => {
    const q = QUALITY_LEVELS[index]
    level = index
    gyro.setPeelLayers(Math.min(q.layers, gyro.defaultPeelLayers))
    gyro.setMaxScale(q.scale)
    if (q.resolution !== resolution) {
      resolution = q.resolution
      setResolution(resolution)
    }
  }
  // Down to level `to` (default: the next one), and further if that changes nothing on this
  // device (e.g. touch: layers are 1 already)
  const last = QUALITY_LEVELS.length - 1
  const stepDown = (now, to = level + 1) => {
    const before = state()
    if (level < last) apply(Math.min(Math.max(to, level + 1), last))
    while (state() === before && level < last) apply(level + 1)
    lastChange = now
    samples = []
    skip = STEP_SKIP
    return state() !== before
  }
  // Best level expected to stay under the limit, from this level's typical cost
  const fittingLevel = (typical) => {
    for (let j = level + 1; j < last; j += 1) {
      if ((typical * LEVEL_COST[j]) / LEVEL_COST[level] <= SLOW_FRAME_MS) return j
    }
    return last
  }
  const settle = () => {
    if (settled) return
    settled = true
    onSettled()
  }

  if (forcedLevel != null) {
    apply(Math.min(Math.max(forcedLevel, 1), QUALITY_LEVELS.length) - 1)
    adapt = false
  } else {
    apply(0)
  }

  // `now` = frame time stamp; `cost` = synced render time (frames where isMeasuring() was true)
  const frame = (now, cost) => {
    const interval = previous == null ? null : now - previous
    previous = now
    frameCount += 1
    if (!adapt) {
      settle()
      return
    }
    if (interval == null || document.hidden) return
    if (interval > GAP_MS && cost == null) return
    if (skip > 0) {
      skip -= 1
      return
    }
    if (cost == null) return
    samples.push(cost)
    if (!settled) {
      const clearlySlow = samples.length === QUICK_FRAMES && samples.every((ms) => ms > 2 * SLOW_FRAME_MS)
      if (samples.length < STARTUP_FRAMES && !clearlySlow) return
      const typical = typicalOf(samples)
      measured.push(Math.round(typical * 10) / 10)
      // Slow: straight to the level expected to fit (one step when only a little slow)
      if (typical > SLOW_FRAME_MS && stepDown(now, fittingLevel(typical))) return
      samples = []
      lastChange = now
      settle()
      return
    }
    if (samples.length > WATCH_SAMPLES) samples.shift()
    if (samples.length < WATCH_SAMPLES) return
    const typical = typicalOf(samples)
    watched = `${Math.round(typical * 10) / 10}`
    if (now - lastChange >= WATCH_PAUSE_MS && typical > SLOW_FRAME_MS) stepDown(now)
  }

  return {
    frame,
    // true = time the coming frame synced (all start-up frames, then every WATCH_SYNC_EVERY-th)
    isMeasuring: () => adapt && (!settled || frameCount % WATCH_SYNC_EVERY === 0),
    getLevel: () => level + 1,
    getMeasured: () => measured,
    getWatched: () => watched,
    getResolution: () => resolution
  }
}
