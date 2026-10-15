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

const SLOW_FRAME_MS = 20 // median frame time above this = below ~50 fps
const GAP_MS = 250 // longer intervals are tab switches / hidden page, not slowness
// Start-up check (behind the preloader): each frame is timed until the GPU has finished it
// (`cost`, see gyro.finish); frame intervals alone look fast at first while the GPU queues
// work. Skip the first frames (shader compilation), then measure; after a step down, skip a
// few more (new images) and measure again.
// A level whose first QUICK_FRAMES are all over twice the limit steps down at once.
const STARTUP_SKIP = 4
const STEP_SKIP = 2
const STARTUP_FRAMES = 12
const QUICK_FRAMES = 4
// While the page is shown: only sustained slowness (~2 s of frames) steps down, one level at
// a time, at least WATCH_PAUSE_MS apart, and never back up (no flicker between levels).
const WATCH_FRAMES = 120
const WATCH_EVERY = 30
const WATCH_PAUSE_MS = 5000

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
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
  let framesSinceCheck = 0
  const measured = [] // start-up median per tried level (ms), for the console / tests

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
  // Next level that actually changes something on this device (e.g. touch: layers are 1 already)
  const stepDown = (now) => {
    const before = state()
    while (level < QUALITY_LEVELS.length - 1) {
      apply(level + 1)
      if (state() !== before) break
    }
    lastChange = now
    samples = []
    skip = STEP_SKIP
    return state() !== before
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

  // `now` = frame time stamp; `cost` = synced render time (start-up check only)
  const frame = (now, cost) => {
    const interval = previous == null ? null : now - previous
    previous = now
    if (!adapt) {
      settle()
      return
    }
    if (interval == null || interval > GAP_MS || document.hidden) return
    if (skip > 0) {
      skip -= 1
      return
    }
    samples.push(settled ? interval : cost)
    if (!settled) {
      const clearlySlow = samples.length === QUICK_FRAMES && samples.every((ms) => ms > 2 * SLOW_FRAME_MS)
      if (samples.length < STARTUP_FRAMES && !clearlySlow) return
      measured.push(Math.round(median(samples) * 10) / 10)
      if (measured[measured.length - 1] > SLOW_FRAME_MS && stepDown(now)) return
      samples = []
      lastChange = now
      settle()
      return
    }
    if (samples.length > WATCH_FRAMES) samples.shift()
    framesSinceCheck += 1
    if (samples.length < WATCH_FRAMES || framesSinceCheck < WATCH_EVERY) return
    framesSinceCheck = 0
    if (now - lastChange >= WATCH_PAUSE_MS && median(samples) > SLOW_FRAME_MS) stepDown(now)
  }

  return {
    frame,
    isMeasuring: () => adapt && !settled,
    getLevel: () => level + 1,
    getMeasured: () => measured,
    getResolution: () => resolution
  }
}
