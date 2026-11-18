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

// How the level is picked (6.8.18): no start-up exam; a level is dropped only on SUSTAINED overload.
//
// Why: a graphics card changes its own clock with the load (measured 2026-11-18 on the owner's
// RTX 3060 with nvidia-smi: 210-1100 MHz; the same Q1 frame took 6.2 ms at ~390 MHz, 3.0 ms at
// 780 MHz, 2.1 ms at 1100 MHz, and under a full load the clock needed ~2 s to come up). At normal
// load the card settles where a frame takes ~60 % of the frame interval (owner's Brave: Q1 steady
// at ~10.5 ms although the card can do it in 4 ms), and when the quality is lowered it slows down
// further. So one frame's cost says little about what the card can do; every earlier version
// (timed frames behind the preloader, then short FPS counts) read the clock state and picked
// Q1, Q2 or Q5 at random on the same computer.
//
// Rule: start at the best level, already behind the preloader. A level is "overloaded" only if,
// over a whole window (so the card had time to speed up):
//   with the GPU timer (gpuTimer.js): frames really come late (fewer than FPS_LOW of the expected
//     ones) AND the card is the reason (even the faster frames, the 20th percentile, take more
//     than EXPLAINS of the frame interval). Late frames with a light GPU = the page is busy, not
//     the 3D; heavy GPU times with frames on time = the card merely took its time. While the
//     times are still falling the window is extended. Far over (EXTREME) is decided sooner.
//   without it (e.g. Safari): frames come late, counted only once the preloader is gone
//     (begin()), since loading itself makes frames late.
// The frame interval comes from the display (`frameMs`, measured by GyroVisual), so a 30 Hz or
// power-saving screen is not taken for an overload.
// Overloaded -> jump straight to the level whose expected cost fits (LEVEL_COST and the measured
// overshoot) and check that one the same way. If the jump skipped levels, the one in between is
// tried once (with the timer only when its expected cost fits). Overloaded at the lowest level
// -> onLite() (Q6). The same rule runs for the whole visit (two windows in a row once a level was
// fine); a level that had been fine and was dropped later is tried again once after
// UP_AFTER_MS of calm (a passing overload, e.g. another program).
// interrupt() (showreel over the page, tab hidden) throws the current window away.
const LEVEL_COST = [1, 0.7, 0.5, 0.42, 0.25] // cost relative to Q1 (cautious: measured 0.63-0.72, 0.44-0.52, 0.37-0.42, 0.14-0.25)
const SKIP_FRAMES = 6 // after a level change / interruption (new images, shaders) not judged
const GAP_MS = 250 // a longer pause between frames (hitch, hidden page): start the window again
const WINDOW_MS = 1500
const MIN_SAMPLES = 8
const FINE_SAMPLES = 12 // this many frames in, a level with a light GPU is accepted without waiting
const FPS_LOW = 0.8 // "frames come late": fewer than this share of the expected frames
const EXPLAINS = 0.75 // "the card is the reason": faster frames above this share of the frame interval
const EXTREME = 3 // every frame over this many frame intervals after EXTREME_MS: no need to wait
const EXTREME_MS = 800
const MAX_EXTENSIONS = 2
const AIM = 0.75 // after a jump the expected cost should be under this share of the frame interval
const PROBE_BELOW = 0.8 // trying the level in between: its expected cost under this share
const UP_AFTER_MS = 15000
const NO_SAMPLES_FRAMES = 30 // timer present but silent for this many frames: count frames only
const FPS_WINDOW_MS = 2000
const FPS_GRACE_MS = 500
const FPS_HELPS = 1.15 // a big step down must raise the frame rate by this factor, or it is taken back
const HELP_CHECK_BELOW = 0.3 // ... checked only for jumps to under this share of the cost

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]
const round1 = (value) => Math.round(value * 10) / 10

// `setResolution(r)` resizes the canvas. `timerSupported`: GPU times will arrive through gpu().
// `frameMs`: the interval between the 3D's frames on this display (number or function; 16.7 at
// 60 Hz, 33.3 for the phone setup). `onLite(fps)`: the lowest level is overloaded.
// `forcedLevel` (1-based, ?q= or a rebuild) fixes the level, no adapting.
export function createQualityController({ gyro, setResolution, timerSupported = false, frameMs = 1000 / 60, onLite = () => {}, forcedLevel = null, adapt = true }) {
  const last = QUALITY_LEVELS.length - 1
  const interval = () => (typeof frameMs === 'function' ? frameMs() : frameMs)
  let level = 0
  let resolution = 1
  const fixed = !adapt || forcedLevel != null
  let mode = timerSupported ? 'gpu' : 'fps'
  let begun = false // the preloader is gone (frame counting without the timer waits for this)
  let readyToShow = !timerSupported || fixed // false until the first verdict (GyroVisual holds the preloader)
  let checking = true // the current level has not been found fine yet
  let liteAsked = false
  let previous = null
  let serial = 0 // frames drawn
  let acceptFrom = 0 // GPU times of frames before this serial are ignored (level change, pause)
  let skip = SKIP_FRAMES
  // window
  let winStart = null
  let winFrames = 0
  let samples = []
  let extensions = 0
  let overCount = 0
  let graceUntil = 0
  // history
  let stableSince = null
  let refineFrom = null // the level a jump came from, while the level in between is still untried
  let refined = false
  let probeBack = null // trying a better level: where to return if it is overloaded
  let pendingHelp = null // { from, fps }: a big jump without the timer; did it raise the frame rate?
  let cappedFps = null // frame rate that lowering the quality could not raise (display cap)
  const wasFine = QUALITY_LEVELS.map(() => false)
  const retried = QUALITY_LEVELS.map(() => false)
  const retryable = new Set()
  let watched = ''
  const log = [] // what was decided, for the readout / statistics

  // What a level would change on this device, without switching to it (no images re-created)
  const stateOf = (index) => {
    const q = QUALITY_LEVELS[index]
    return `${Math.min(q.layers, gyro.defaultPeelLayers)}|${gyro.scaleFor(q.scale)}|${q.resolution}`
  }
  // Levels that differ on this device, best first (phones: Q1-Q4 are one; Retina: Q3 = Q4)
  const distinct = []
  for (let j = 0; j <= last; j += 1) {
    if (!distinct.some((d) => stateOf(d) === stateOf(j))) distinct.push(j)
  }
  const lowest = distinct[distinct.length - 1]
  const newWindow = (now, withSkip) => {
    if (withSkip) skip = SKIP_FRAMES
    acceptFrom = serial + (withSkip ? SKIP_FRAMES : 0)
    winStart = null
    winFrames = 0
    samples = []
    extensions = 0
    if (now != null && withSkip) graceUntil = now + FPS_GRACE_MS
  }
  const apply = (index, now) => {
    const q = QUALITY_LEVELS[index]
    level = index
    gyro.setPeelLayers(Math.min(q.layers, gyro.defaultPeelLayers))
    gyro.setMaxScale(q.scale)
    if (q.resolution !== resolution) {
      resolution = q.resolution
      setResolution(resolution)
    }
    checking = true
    overCount = 0
    stableSince = null
    newWindow(now, true)
  }
  // The best level below `from` whose expected cost is at most `share` of `from`'s
  const fitting = (from, share) => {
    const below = distinct.filter((j) => j > from)
    return below.find((j) => LEVEL_COST[j] / LEVEL_COST[from] <= share) ?? below[below.length - 1]
  }

  // `lo` = GPU ms of the faster frames in the window just judged (null without the timer)
  const verdictFine = (now, note, lo) => {
    const first = checking
    if (first) log.push(`${level + 1}:ok:${note}`)
    checking = false
    readyToShow = true
    overCount = 0
    wasFine[level] = true
    probeBack = null
    if (first || stableSince == null) stableSince = now
    // a jump skipped levels: try the one in between, once
    if (refineFrom != null) {
      const a = distinct.indexOf(refineFrom)
      const b = distinct.indexOf(level)
      refineFrom = null
      refined = true
      if (b - a >= 2) {
        const mid = distinct[Math.floor((a + b) / 2)]
        const fits = lo == null || (lo * LEVEL_COST[mid]) / LEVEL_COST[level] <= PROBE_BELOW * interval()
        if (fits) {
          log.push(`${level + 1}:try>${mid + 1}`)
          probeBack = level
          apply(mid, now)
          return
        }
      }
    }
    // a level that had been fine before it was dropped: once more after a calm stretch
    if (now - stableSince >= UP_AFTER_MS) {
      const again = distinct.find((j) => j < level && retryable.has(j) && !retried[j])
      if (again != null) {
        retried[again] = true
        log.push(`${level + 1}:retry>${again + 1}`)
        probeBack = level
        apply(again, now)
        return
      }
    }
    newWindow(now, false)
  }
  // `share` = the part of the present cost that would fit; `fps` = the window's frame rate
  const verdictOver = (now, share, note, fps) => {
    readyToShow = true
    if (probeBack != null) {
      const back = probeBack
      probeBack = null
      log.push(`${level + 1}:over:${note}>${back + 1}`)
      apply(back, now)
      checking = false // it was fine before
      stableSince = now
      return
    }
    if (wasFine[level] && !retried[level]) retryable.add(level)
    if (level === lowest) {
      newWindow(now, false)
      if (liteAsked) return
      liteAsked = true
      checking = false
      log.push(`${level + 1}:over:${note}>lite`)
      onLite(fps)
      return
    }
    const from = level
    const to = fitting(level, share)
    log.push(`${from + 1}:over:${note}>${to + 1}`)
    if (!refined && distinct.indexOf(to) - distinct.indexOf(from) >= 2) refineFrom = from
    apply(to, now)
    if (mode === 'fps' && cappedFps == null && LEVEL_COST[to] / LEVEL_COST[from] <= HELP_CHECK_BELOW) pendingHelp = { from, fps }
  }

  const judge = (now) => {
    const t = interval()
    const elapsed = now - winStart
    const fps = (winFrames * 1000) / elapsed
    const expected = cappedFps || 1000 / t
    let share
    let note
    let lo = null
    if (mode === 'gpu') {
      const n = samples.length
      if (!n) {
        if (winFrames > NO_SAMPLES_FRAMES) {
          mode = 'fps' // the timer gives nothing here
          readyToShow = true
          log.push('timer:silent>fps')
          newWindow(now, false)
        }
        return
      }
      const sorted = [...samples].sort((a, b) => a - b)
      lo = quantile(sorted, 0.2)
      const heavy = lo > EXPLAINS * t
      if (checking) {
        if (n >= FINE_SAMPLES && !heavy) {
          verdictFine(now, `${round1(lo)}ms`, lo)
          return
        }
        if (elapsed >= EXTREME_MS && n >= 4 && sorted[0] > EXTREME * t) {
          verdictOver(now, (AIM * t) / sorted[0], `${round1(sorted[0])}ms`, fps)
          return
        }
      }
      if (elapsed < WINDOW_MS || (n < MIN_SAMPLES && elapsed < 2 * WINDOW_MS)) return
      watched = `${round1(lo)}ms/${Math.round(fps)}fps`
      if (!(heavy && fps < FPS_LOW * expected)) {
        verdictFine(now, `${round1(lo)}ms/${Math.round(fps)}fps`, lo)
        return
      }
      // overloaded: still getting faster (the card's clock is coming up)? then look again
      const third = Math.max(1, Math.floor(n / 3))
      if (checking && extensions < MAX_EXTENSIONS && Math.min(...samples.slice(-third)) < 0.9 * Math.min(...samples.slice(0, third))) {
        extensions += 1
        samples = samples.slice(-third)
        winFrames = Math.round(winFrames / 3)
        winStart = now - elapsed / 3
        return
      }
      share = (AIM * t) / lo
      note = `${round1(lo)}ms/${Math.round(fps)}fps`
    } else {
      if (elapsed < FPS_WINDOW_MS) return
      watched = `${Math.round(fps)}fps`
      if (pendingHelp) {
        const { from, fps: before } = pendingHelp
        pendingHelp = null
        if (fps < before * FPS_HELPS) {
          // far lower quality, same frame rate: the 3D is not what limits it. Back, and expect no more.
          cappedFps = Math.max(fps, before)
          refineFrom = null
          refined = true
          log.push(`${level + 1}:nohelp:${Math.round(fps)}fps>${from + 1}`)
          apply(from, now)
          checking = false
          stableSince = now
          return
        }
      }
      if (fps >= FPS_LOW * expected) {
        verdictFine(now, `${Math.round(fps)}fps`, null)
        return
      }
      share = AIM * (fps / expected)
      note = `${Math.round(fps)}fps`
    }
    // a level that was fine needs two overloaded windows in a row
    if (!checking) {
      overCount += 1
      if (overCount < 2) {
        const keep = overCount
        newWindow(now, false)
        overCount = keep
        return
      }
    }
    verdictOver(now, share, note, fps)
  }

  if (forcedLevel != null) {
    apply(Math.min(Math.max(forcedLevel, 1), QUALITY_LEVELS.length) - 1, null)
    log.push(`${level + 1}:fixed`)
  } else {
    apply(distinct[0], null)
  }

  return {
    // after every frame the 3D drew; `now` = its time stamp
    frame: (now) => {
      const gap = previous == null ? null : now - previous
      previous = now
      serial += 1
      if (fixed || document.hidden) return
      if (gap != null && gap > GAP_MS) {
        const keep = overCount
        newWindow(now, true)
        overCount = keep
        if (stableSince != null) stableSince = now
        return
      }
      if (skip > 0) {
        skip -= 1
        return
      }
      if (mode === 'fps' && (!begun || now < graceUntil)) return
      if (winStart == null) {
        winStart = now
        winFrames = 0
        return
      }
      winFrames += 1
      judge(now)
    },
    // label for the coming frame's GPU timing, and the timing when it arrives (a few frames later)
    tag: () => serial,
    gpu: ({ ms, tag }) => {
      if (fixed || mode !== 'gpu' || tag == null || tag < acceptFrom) return
      samples.push(ms)
    },
    // The preloader is gone (the frame counting of browsers without the timer starts here)
    begin: () => {
      if (begun) return
      begun = true
      if (mode === 'fps') newWindow(previous, true)
    },
    // The page got covered or hidden: throw the current window away
    interrupt: () => {
      const keep = overCount
      newWindow(previous, true)
      overCount = keep
    },
    // false while the first verdict is still open: GyroVisual keeps the preloader up meanwhile
    isReadyToShow: () => readyToShow,
    getMode: () => (fixed ? 'fixed' : mode),
    getPhase: () => (fixed ? 'fixed' : checking ? 'checking' : 'watching'),
    getLevel: () => level + 1,
    getLog: () => log,
    getWatched: () => watched, // last full window: GPU ms of the faster frames / frames per second
    getResolution: () => resolution
  }
}
