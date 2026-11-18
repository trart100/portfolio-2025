// Adaptive quality. Levels from best to lowest; the ladder ends at the lowest 3D level (never the
// video, never a still image). Level 6 is not in this list: it is the phone setup on a computer
// (lite.js), switched to by GyroVisual when onLite() fires.
//  layers     = glass layers (blur steps), capped by the device default (touch: 1)
//  scale      = 2 supersampling where the canvas allows it, 1 = 1x (+ MSAA where used)
//  resolution = canvas pixels per screen pixel (0.75 = rendered smaller, stretched by the browser)
export const QUALITY_LEVELS = [
  { layers: 4, scale: 2, resolution: 1 },
  { layers: 2, scale: 2, resolution: 1 },
  { layers: 1, scale: 2, resolution: 1 },
  { layers: 1, scale: 1, resolution: 1 },
  { layers: 1, scale: 1, resolution: 0.75 }
]

// How the level is picked (6.8.16). Before, it was measured behind the preloader, while the page
// was still loading: on the same computer that gave Q1, Q2 or Q5 at random (owner's PC,
// 2026-11-18: 21-25 ms per frame at every level during loading, 3.9 ms right after it).
//  1. Start at the lowest level (Q5) and measure nothing while the preloader is up.
//  2. begin() (GyroVisual: once the preloader is completely gone): measure Q5 for WINDOW_MS,
//     both the frames drawn per second and the GPU time of every TIME_EVERY-th frame.
//     Fewer than LITE_BELOW_FPS frames a second even here, with the 3D itself slow
//     (LITE_MIN_COST_MS) -> onLite() (phone setup, Q6).
//  3. From the last fine level's frame cost, predict the best level that should stay under
//     BUDGET_MS (LEVEL_COST) and go there; if none, still try the next better level when it
//     should pass the check (one noisy measurement must not leave a fast computer on Q5).
//     Measure it: too slow (cost over VERIFY_MAX_MS, or frames per second below FPS_KEEP of
//     Q5's) -> that level and better ones are out, carry on from the last fine level; fine ->
//     predict again from it. Ends when nothing better is left to try.
//  4. Settled: as before, every WATCH_SYNC_EVERY-th frame is timed and sustained slowness
//     steps down one level (never up).
// interrupt() (showreel over the page, tab hidden) restarts the current measurement.
const WINDOW_MS = 1000
const WINDOW_SKIP = 3 // frames after a level change / begin (new images, shaders)
const TIME_EVERY = 3 // every 3rd frame in a window is timed (each timed frame stalls the GPU queue)
const MIN_SAMPLES = 6
const LITE_BELOW_FPS = 30
// ...and only when the 3D itself is what is slow (Q5 frame cost over this): a laptop in power
// saving / a 30 Hz cap draws ~30 fps however light the 3D is (simulated: 2.4 ms frames went to
// the phone setup without this)
const LITE_MIN_COST_MS = 16
const BUDGET_MS = 12 // predicted cost a level should stay under (60 fps leaves ~16.7 ms per frame)
const VERIFY_MAX_MS = 16 // measured cost above this: the level is too heavy
const FPS_KEEP = 0.85 // a level must keep this share of Q5's frames per second
// Cost of each level relative to the best one, from visitors' computers (PostHog
// visual_quality measured_ms, 2026-11: ~0.6 per step, little from level 3 to 4)
const LEVEL_COST = [1, 0.6, 0.39, 0.35, 0.22]
const GAP_MS = 250 // a longer interval inside a window = hitch / hidden page: measure again

// Settled: every WATCH_SYNC_EVERY-th frame is timed (after the queued frames are drained, so it
// is one frame's real cost). Only sustained slowness (lower quartile of the last WATCH_SAMPLES
// timed frames, ~5 s) steps down, one level at a time, at least WATCH_PAUSE_MS apart.
const SLOW_FRAME_MS = 20
const WATCH_SYNC_EVERY = 60
const WATCH_SAMPLES = 5
const WATCH_PAUSE_MS = 5000

// Lower quartile, not the median: a slow GPU makes every timed frame slow, while the browser's
// other GPU work only inflates some of them
const typicalOf = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 2]
}
const round1 = (value) => Math.round(value * 10) / 10

// `setResolution(r)` resizes the canvas; `onSettled()` once a level is picked; `onLite(fps)` when
// even the lowest level draws fewer than LITE_BELOW_FPS frames a second. `forcedLevel`
// (1-based, ?q= or a rebuild) fixes the level and turns adapting off.
export function createQualityController({ gyro, setResolution, onSettled, onLite = () => {}, forcedLevel = null, adapt = true }) {
  const last = QUALITY_LEVELS.length - 1
  let level = last
  let resolution = 1
  let phase = adapt ? 'wait' : 'fixed' // wait -> base -> verify -> settled (or fixed)
  let settled = false
  let previous = null
  let frameCount = 0
  // current measuring window
  let skip = 0
  let windowStart = null
  let windowFrames = 0
  let samples = []
  // results
  let baseFps = null
  let lastOk = null // last level that measured fine, and its cost
  let lastOkCost = null
  let ceiling = 0 // best level still allowed (raised when a level fails)
  let lastChange = 0
  let watched = ''
  const measured = [] // cost per measured window (ms), for the readout / statistics
  const fpsLog = [] // frames per second per measured window

  // What a level would change on this device, without switching to it (no images re-created)
  const stateOf = (index) => {
    const q = QUALITY_LEVELS[index]
    return `${Math.min(q.layers, gyro.defaultPeelLayers)}|${gyro.scaleFor(q.scale)}|${q.resolution}`
  }
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
  // Nearest level in `direction` (-1 better, +1 lower) that changes something on this device
  const nextDistinct = (from, direction) => {
    const here = stateOf(from)
    for (let j = from + direction; j >= 0 && j <= last; j += direction) {
      if (stateOf(j) !== here) return j
    }
    return null
  }
  // Show the best level number among those that look the same here (e.g. phones: 1-4 are equal)
  const normalize = () => {
    const here = stateOf(level)
    let best = level
    while (best > 0 && stateOf(best - 1) === here) best -= 1
    level = best // same settings, nothing to re-apply
  }
  const newWindow = () => {
    skip = WINDOW_SKIP
    windowStart = null
    windowFrames = 0
    samples = []
  }
  const settle = (now) => {
    if (settled) return
    settled = true
    phase = 'settled'
    normalize()
    lastChange = now || 0
    samples = []
    onSettled()
  }

  // Where to go from a level that measured fine (`from`, its cost): the best level predicted to
  // stay under BUDGET_MS; if none, still the next better level when it should at least pass
  // the check (VERIFY_MAX_MS). That probe is what keeps one noisy measurement from leaving a
  // fast computer on Q5 for good (owner's PC after a reload, 2026-11-18): the probed level is
  // measured itself, and the next prediction is made from that. Never at or above a level
  // that already failed (`ceiling`).
  const nextTarget = (from, cost) => {
    for (let j = ceiling; j < from; j += 1) {
      if (stateOf(j) !== stateOf(from) && (cost * LEVEL_COST[j]) / LEVEL_COST[from] <= BUDGET_MS) return j
    }
    const better = nextDistinct(from, -1)
    if (better != null && better >= ceiling && (cost * LEVEL_COST[better]) / LEVEL_COST[from] <= VERIFY_MAX_MS) return better
    return null
  }
  const goOn = (now, from, cost) => {
    const target = nextTarget(from, cost)
    if (target == null) {
      if (level !== from) apply(from)
      settle(now)
      return
    }
    apply(target)
    phase = 'verify'
    newWindow()
  }

  const evaluate = (now) => {
    const typical = typicalOf(samples)
    const fps = (windowFrames * 1000) / (now - windowStart)
    measured.push(round1(typical))
    fpsLog.push(Math.round(fps))
    if (phase === 'base') {
      baseFps = fps
      if (fps < LITE_BELOW_FPS && typical > LITE_MIN_COST_MS) {
        settle(now)
        onLite(fps)
        return
      }
      lastOk = level
      lastOkCost = typical
      goOn(now, level, typical)
      return
    }
    // verify
    const fine = typical <= VERIFY_MAX_MS && fps >= baseFps * FPS_KEEP
    if (fine) {
      lastOk = level
      lastOkCost = typical
      goOn(now, level, typical)
      return
    }
    // Too heavy: this level and every better one are out; carry on from the last fine level
    ceiling = level + 1
    goOn(now, lastOk, lastOkCost)
  }

  if (forcedLevel != null) {
    apply(Math.min(Math.max(forcedLevel, 1), QUALITY_LEVELS.length) - 1)
    phase = 'fixed'
  } else {
    apply(last)
  }

  // `now` = frame time stamp; `cost` = synced render time (frames where isMeasuring() was true)
  const frame = (now, cost) => {
    const interval = previous == null ? null : now - previous
    previous = now
    frameCount += 1
    if (phase === 'fixed') {
      if (!settled) {
        settled = true
        onSettled()
      }
      return
    }
    if (phase === 'wait' || document.hidden) return
    if (phase === 'base' || phase === 'verify') {
      if (interval != null && interval > GAP_MS) {
        newWindow() // hitch or hidden page inside the window: measure again
        return
      }
      if (skip > 0) {
        skip -= 1
        return
      }
      if (windowStart == null) {
        windowStart = now
        return
      }
      windowFrames += 1
      if (cost != null) samples.push(cost)
      if (now - windowStart >= WINDOW_MS && samples.length >= MIN_SAMPLES) evaluate(now)
      return
    }
    // settled: watch
    if (interval == null || interval > GAP_MS || cost == null) return
    samples.push(cost)
    if (samples.length > WATCH_SAMPLES) samples.shift()
    if (samples.length < WATCH_SAMPLES) return
    const typical = typicalOf(samples)
    watched = `${round1(typical)}`
    if (now - lastChange >= WATCH_PAUSE_MS && typical > SLOW_FRAME_MS) {
      const lower = nextDistinct(level, +1)
      if (lower != null) {
        apply(lower)
        normalize()
      }
      lastChange = now
      samples = []
    }
  }

  return {
    frame,
    // true = time the coming frame synced
    isMeasuring: () => {
      if (phase === 'base' || phase === 'verify') return skip === 0 && windowStart != null && (windowFrames + 1) % TIME_EVERY === 0
      if (phase === 'settled') return frameCount % WATCH_SYNC_EVERY === 0
      return false
    },
    // Start measuring (the preloader is gone). No effect when the level is fixed or already picked.
    begin: () => {
      if (phase !== 'wait') return
      phase = 'base'
      newWindow()
    },
    // The page got covered or hidden: throw the current window away and measure again
    interrupt: () => {
      if (phase === 'base' || phase === 'verify') newWindow()
    },
    isWaiting: () => phase === 'wait',
    getPhase: () => phase,
    getLevel: () => level + 1,
    getMeasured: () => measured,
    getFps: () => fpsLog,
    getWatched: () => watched,
    getResolution: () => resolution
  }
}
