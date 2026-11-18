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

// How the level is picked (6.8.16): by the 3D's real frames per second only.
// Before, the GPU time of single frames was measured (a forced wait for the GPU). In a browser
// that number also contains waiting for the screen and for other programs: on the owner's PC,
// 2026-11-18, it read 15-25 ms per frame at every level, at 59 fps, while the same PC draws Q1 in
// 6 ms. Measured while the page was still loading it was random as well.
//  1. Start at the lowest level (Q5); nothing is measured while the preloader is up.
//  2. begin() (GyroVisual: 1 s after the preloader is completely gone): count the frames drawn
//     at Q5 for WINDOW_MS = the frame rate this screen / browser gives (60 on most screens; 30
//     in power saving). Below LITE_BELOW_FPS -> onLite() (phone setup, Q6).
//  3. Try better levels, each for WINDOW_MS: a level is fine if it keeps KEEP of Q5's frame
//     rate. Order: the middle level first (Q3); fine -> straight to the best (Q1), then
//     between if Q1 is too much; not fine -> the one below the middle (Q4). At most 3 tries.
//     Levels that look the same on this device (phones: Q1-Q4; Retina: Q3 = Q4) are one try.
//  4. Settled: the frame rate is counted every second; WATCH_SECONDS seconds in a row below
//     WATCH_DROP of Q5's -> one level lower (at most every WATCH_PAUSE_MS, never up).
// interrupt() (showreel over the page, tab hidden) throws the current count away.
const WINDOW_MS = 1000
const WINDOW_SKIP = 3 // frames after a level change / begin (new images, shaders) not counted
const LITE_BELOW_FPS = 28 // "under 30 fps", with 2 fps of counting tolerance
const KEEP = 0.9
const GAP_MS = 250 // a longer pause between frames (hitch, hidden page): count again
const WATCH_DROP = 0.8
const WATCH_SECONDS = 3
const WATCH_PAUSE_MS = 5000

// `setResolution(r)` resizes the canvas; `onSettled()` once a level is picked; `onLite(fps)` when
// the lowest level gets fewer than LITE_BELOW_FPS frames a second. `forcedLevel` (1-based, ?q=
// or a rebuild) fixes the level and turns adapting off.
export function createQualityController({ gyro, setResolution, onSettled, onLite = () => {}, forcedLevel = null, adapt = true }) {
  const last = QUALITY_LEVELS.length - 1
  let level = last
  let resolution = 1
  let phase = adapt ? 'wait' : 'fixed' // wait -> base -> try -> settled (or fixed)
  let settled = false
  let previous = null
  // counting window
  let skip = 0
  let windowStart = null
  let windowFrames = 0
  // search
  let baseFps = null
  let distinct = [] // levels that differ on this device, best first; the last one is Q5
  let lo = 0 // the answer is distinct[lo..hi]; distinct[hi] is known fine
  let hi = 0
  let testing = null // index into `distinct` being tried
  let triedBest = false
  // watch
  let slowSeconds = 0
  let lastChange = 0
  let watched = ''
  const fpsLog = [] // "level:fps" per counted window, for the readout / statistics

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
  // Best level number of each group that looks the same here, best first. Q5 is always its own
  // group (the only one at resolution 0.75), so it is the last entry.
  const distinctLevels = () => {
    const out = []
    const seen = new Set()
    for (let j = 0; j <= last; j += 1) {
      const s = stateOf(j)
      if (!seen.has(s)) {
        seen.add(s)
        out.push(j)
      }
    }
    return out
  }
  const newWindow = () => {
    skip = WINDOW_SKIP
    windowStart = null
    windowFrames = 0
  }
  const settle = (index, now) => {
    if (settled) return
    if (index !== level) apply(index)
    settled = true
    phase = 'settled'
    lastChange = now || 0
    slowSeconds = 0
    newWindow()
    onSettled()
  }
  const tryNext = (now) => {
    if (lo >= hi) {
      settle(distinct[hi], now)
      return
    }
    testing = Math.floor((lo + hi) / 2)
    apply(distinct[testing])
    phase = 'try'
    newWindow()
  }
  const counted = (now) => {
    const fps = (windowFrames * 1000) / (now - windowStart)
    fpsLog.push(`${level + 1}:${Math.round(fps)}`)
    return fps
  }

  if (forcedLevel != null) {
    apply(Math.min(Math.max(forcedLevel, 1), QUALITY_LEVELS.length) - 1)
    phase = 'fixed'
  } else {
    apply(last)
  }

  // `now` = frame time stamp (a frame the 3D actually drew)
  const frame = (now) => {
    const interval = previous == null ? null : now - previous
    previous = now
    if (phase === 'fixed') {
      if (!settled) {
        settled = true
        onSettled()
      }
      return
    }
    if (phase === 'wait' || document.hidden) return
    if (interval != null && interval > GAP_MS) {
      newWindow() // hitch / hidden / paused: count again
      if (phase === 'settled') slowSeconds = 0
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
    if (now - windowStart < WINDOW_MS) return

    if (phase === 'base') {
      baseFps = counted(now)
      if (baseFps < LITE_BELOW_FPS) {
        settle(level, now)
        onLite(baseFps)
        return
      }
      distinct = distinctLevels()
      lo = 0
      hi = distinct.length - 1
      tryNext(now)
      return
    }
    if (phase === 'try') {
      const fine = counted(now) >= baseFps * KEEP
      if (fine) {
        hi = testing
        // first fine try: jump straight to the best level still possible
        if (!triedBest && testing > lo) {
          triedBest = true
          testing = lo
          apply(distinct[testing])
          newWindow()
          return
        }
      } else {
        lo = testing + 1
      }
      tryNext(now)
      return
    }
    // settled: count every second; sustained drops step down one level
    const fps = (windowFrames * 1000) / (now - windowStart)
    watched = `${Math.round(fps)}`
    slowSeconds = fps < baseFps * WATCH_DROP ? slowSeconds + 1 : 0
    windowStart = now
    windowFrames = 0
    if (slowSeconds >= WATCH_SECONDS && now - lastChange >= WATCH_PAUSE_MS) {
      const here = stateOf(level)
      let lower = null
      for (let j = level + 1; j <= last; j += 1) {
        if (stateOf(j) !== here) {
          lower = j
          break
        }
      }
      if (lower != null) {
        apply(lower)
        fpsLog.push(`down:${lower + 1}`)
      }
      lastChange = now
      slowSeconds = 0
      newWindow()
    }
  }

  return {
    frame,
    // The GPU-synced timing is not used any more (6.8.16): no frame is forced to wait
    isMeasuring: () => false,
    // Start counting (the preloader is gone). No effect when the level is fixed or already picked.
    begin: () => {
      if (phase !== 'wait') return
      phase = 'base'
      newWindow()
    },
    // The page got covered or hidden: throw the current count away
    interrupt: () => {
      if (phase === 'base' || phase === 'try' || phase === 'settled') {
        newWindow()
        if (phase === 'settled') slowSeconds = 0
      }
    },
    getPhase: () => phase,
    getLevel: () => level + 1,
    getBaseFps: () => (baseFps == null ? null : Math.round(baseFps)),
    getFps: () => fpsLog,
    getMeasured: () => [],
    getWatched: () => watched,
    getResolution: () => resolution
  }
}
