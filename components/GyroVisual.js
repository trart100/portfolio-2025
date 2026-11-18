import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { gyroClock } from '../lib/gyro/clock'
import { createSpinClock } from '../lib/gyro/spin'
import { liteMode, setLiteMode, liteOnComputer } from '../lib/gyro/lite'
import { createGpuTimer } from '../lib/gyro/gpuTimer'
import { track } from '../lib/analytics'

// GPU time readout (6.8.17, lib/gyro/gpuTimer.js): every frame's own GPU time is measured where
// the browser can (no waiting, no blocking); the median of the last GPU_WINDOW frames is shown
// next to the FPS (canvas data-gpu, updated twice a second) and sent with visual_quality.
// It does not pick the quality yet: first it has to prove itself on real devices (?gputest).
const GPU_WINDOW = 30
const GPU_READOUT_MS = 500

// Quality is picked once the preloader is completely gone (quality.js, 6.8.16): GyroVisual
// waits for that, then LITE_SETTLE_MS more, and calls quality.begin(). When even the lowest
// level draws fewer than 30 frames a second, quality.js calls onLite and the scene is rebuilt
// with the phone setup ("lite", lib/gyro/lite.js, shown as Q6) for the rest of the visit.
// ?litetest switches to it anyway, shortly after the measuring starts (to see the switch).
const LITE_SETTLE_MS = 0 // after the preloader is gone, before measuring (owner, 2026-11-18: right away)
const BEGIN_RETRY_MS = 500 // page hidden / showreel open when measuring should start: try again
const PRELOADER_FADE_MS = 240 // the preloader fade-out (220 ms in globals.css) + a frame
const LITE_TEST_MS = 1500

const GyroReference = dynamic(() => import('./GyroReference'), { ssr: false })

// The real-time 3D background visual. three.js is loaded on demand (its own chunk).
// Without WebGL the page keeps its dark background (no video, no still image).
// Dev aids: ?t=2.5 freezes the animation at that second, ?gui adds a live look-tuning panel,
// ?ref opens the comparison tool (3D next to / over the original video, in sync),
// ?q=1..5 forces a quality level. (?3d, the old switch to the 3D, is still accepted.)
export default function GyroVisual() {
  const canvasRef = useRef(null)
  const [showRef, setShowRef] = useState(false)

  useEffect(() => {
    setShowRef(new URLSearchParams(window.location.search).has('ref'))
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    let disposed = false
    let gyro = null
    let gui = null
    let frameId = null
    let observer = null
    let pauseObserver = null
    // Level kept when the scene is rebuilt after a lost WebGL context or the lite switch (no
    // new start-up check)
    let keptLevel = null
    let readySent = false
    // Kept across rebuilds, so the animation carries on from the same pose: the animation
    // clock (shifted by showreel pauses) and the click / scroll spin
    let clockBegin = null
    let spinClock = null
    // For the lite check: 3D frames drawn so far; showreel covering the page; pauses / hidden
    // tab so far (a measuring window compares them)
    let renders = 0
    let covered = false
    let interruptions = 0
    let liteTimer = null
    let gpuTestRan = false
    const root = document.documentElement

    const params = new URLSearchParams(window.location.search)
    const frozenParam = params.get('t')
    const frozen = frozenParam != null && frozenParam !== '' ? parseFloat(frozenParam) : null
    const forcedParam = parseInt(params.get('q'), 10)
    // ?gputest=timer: frames driven by a timer instead of the screen. A hidden / background page
    // gets no animation frames, so this is how the GPU test can run where nobody is looking
    // (its frames-per-second column then says nothing; the GPU times are real).
    const timerDriven = params.get('gputest') === 'timer'
    const nextFrame = (fn) => (timerDriven ? setTimeout(() => fn(performance.now()), 16) : requestAnimationFrame(fn))
    const cancelFrame = (id) => (timerDriven ? clearTimeout(id) : cancelAnimationFrame(id))
    // Touch devices (phones, often 90-120 Hz screens) and the "lite" setup (lib/gyro/lite.js):
    // the 3D renders at most 30 times a second (the page itself keeps the screen's rate) and at
    // a pixel density of at most 1.5. Computers (6.8.14): at most ~60 times a second; before,
    // every screen refresh, so 120 Hz screens (MacBook Pro) rendered it twice as often.
    // 60/75/90 Hz screens render every frame, 120 Hz every 2nd (60), 144 Hz every 2nd (72).
    // - 4 / - 6: rAF timing jitter. Read again on every (re)start of the scene.
    let MIN_FRAME_MS = 0
    let MAX_PIXEL_RATIO = 2
    const readMode = () => {
      const lite = liteMode()
      MIN_FRAME_MS = lite ? 1000 / 30 - 4 : 1000 / 60 - 6
      MAX_PIXEL_RATIO = lite ? 1.5 : 2
    }

    // Same signal the video used to send, so the Preloader can finish
    const sendReady = () => {
      if (readySent) return
      readySent = true
      window.dispatchEvent(new CustomEvent('videoCanPlay'))
    }
    const fail = (error) => {
      console.warn('[GyroVisual] 3D unavailable:', error)
      sendReady()
    }

    const stop = () => {
      if (frameId != null) cancelFrame(frameId)
      frameId = null
      if (observer) observer.disconnect()
      observer = null
      if (pauseObserver) pauseObserver.disconnect()
      pauseObserver = null
      if (gui) gui.destroy()
      gui = null
      if (!gyro) return
      if (gyro.quality) keptLevel = gyro.quality.getLevel()
      if (gyro.timer) gyro.timer.dispose()
      if (window.__gyro === gyro) delete window.__gyro
      gyro.dispose()
      gyro = null
    }

    // An event for the statistics that may be ready before they are (they start after page load)
    const sendWhenReady = (name, props, tries = 30) => {
      const a = window.__analytics
      if (a && a.on) track(name, props)
      else if (!a && tries > 0 && !disposed) setTimeout(() => sendWhenReady(name, props, tries - 1), 500)
    }

    const start = () =>
      Promise.all([import('../lib/gyro/scene'), import('../lib/gyro/quality'), params.has('gputest') ? import('../lib/gyro/gpuTest') : null])
        .then(([{ createGyroScene }, { createQualityController }, gpuTestModule]) => {
          if (disposed) return
          readMode()
          gyro = createGyroScene(canvas)
          const timer = createGpuTimer(gyro.gl)
          gyro.timer = timer
          canvas.dataset.gpuTimer = timer.supported ? 'yes' : 'no'

          if (params.has('gui')) {
            window.__gyro = gyro // console access while tuning
            const current = gyro
            import('../lib/gyro/gui').then(({ createGyroGui }) => {
              if (!disposed && gyro === current) gui = createGyroGui(gyro)
            })
          }

          const box = canvas.parentElement
          // Whole number of screen pixels (pixel density capped at 2, touch 1.5), and a CSS size that
          // matches exactly, so the browser never stretches the canvas. Absolutely positioned
          // at the box's corner so its rounded size can't resize (and shift) the box.
          canvas.style.position = 'absolute'
          canvas.style.left = '0'
          canvas.style.top = '0'
          // resolution < 1 (lowest quality level only): fewer canvas pixels, stretched to the box
          let resolution = 1
          const resize = () => {
            const rect = box.getBoundingClientRect()
            const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * resolution
            const width = Math.max(1, Math.round(rect.width * ratio))
            const height = Math.max(1, Math.round(rect.height * ratio))
            canvas.style.width = `${width / ratio}px`
            canvas.style.height = `${height / ratio}px`
            gyro.setSize(width, height, height / ratio)
          }
          resize()
          observer = new ResizeObserver(resize)
          observer.observe(box)

          // Adaptive quality (quality.js, 6.8.16): starts at Q5, measures once the preloader is
          // gone (begin(), below), then only steps down on sustained slowness. Off for frozen
          // frames / the comparison tool (dev captures) / a forced ?q level / a rebuild.
          const quality = createQualityController({
            gyro,
            setResolution: (value) => {
              resolution = value
              resize()
            },
            onSettled: () => {
              const base = quality.getBaseFps()
              if (base != null) canvas.dataset.fps3d = String(base) // frames a second at Q5, after the preloader
              canvas.dataset.fpsLog = quality.getFps().join(' ') // "level:fps" per counted window
              if (params.has('gui')) {
                console.info(`[GyroVisual] quality level ${quality.getLevel()} (level:fps tried: ${quality.getFps().join(', ')})`)
              }
            },
            onLite: (fps) => switchToLite(fps),
            forcedLevel: keptLevel != null ? keptLevel : gpuTestModule ? 1 : Number.isFinite(forcedParam) ? forcedParam : null,
            adapt: keptLevel == null && !gpuTestModule && !Number.isFinite(frozen) && !params.has('ref')
          })
          gyro.quality = quality

          // ?gputest (lib/gyro/gpuTest.js): walks through the levels itself and reports whether
          // the GPU timer can be trusted on this device. Once per page load.
          let gpuTest = null
          if (gpuTestModule && !gpuTestRan) {
            gpuTestRan = true
            gpuTest = gpuTestModule.createGpuTest({
              gyro,
              setResolution: (value) => {
                resolution = value
                resize()
              },
              timerSupported: timer.supported,
              isPreloaderUp: () => root.classList.contains('preloader-active'),
              onDone: (result) => {
                const ext = gyro.gl.getExtension('WEBGL_debug_renderer_info')
                const info = {
                  renderer: ext ? String(gyro.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '',
                  viewport: `${window.innerWidth}x${window.innerHeight}`,
                  dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
                  canvas: gyro.getRenderSize()
                }
                window.__gpuTest = { ...result, info }
                gpuTestModule.showGpuTestResult(result, info)
                const v = result.verdicts
                sendWhenReady('gpu_test', {
                  ...info,
                  supported: result.supported,
                  ok_timer: v.timer, ok_faster_under_load: v.fasterUnderLoad, ok_hot_rises: v.hotRises, ok_rises: v.rises, ok_repeatable: v.repeatable, noisy_pct: result.noisy,
                  ok_loading: v.sameWhileLoading, ok_stress: v.sameUnderStress, stress_slowed_page: v.stressSlowedPage,
                  ...result.after,
                  rows: result.rows.map((r) => `${r.phase}:Q${r.level}:lo${r.lo}:med${r.ms}:p90 ${r.p90}:noisy${r.noisy}%:${r.fps}fps:pre${r.preloader}%`).join(' | '),
                  ...Object.fromEntries(Object.entries(result.hot).map(([k, ms]) => [`hot_${k}`, ms])),
                  burst_series: ((result.rows.find((r) => r.series) || {}).series || []).join(' ')
                })
              }
            })
          }
          const gpuRecent = []
          let gpuShownAt = 0
          let gpuLevel = ''

          if (clockBegin == null) clockBegin = performance.now()
          let lastRender = -Infinity
          // Click spin-up: own clocks for the gold and the glass (off for frozen frames / ?ref)
          if (!spinClock) spinClock = createSpinClock(gyro.look.spin)
          const loop = (now) => {
            frameId = nextFrame(loop)
            if (now - lastRender < MIN_FRAME_MS) return
            const dt = lastRender > 0 ? (now - lastRender) / 1000 : 0
            lastRender = now
            renders += 1
            // Shown (and the Preloader released) after the first frames at the starting level;
            // the level is picked later, once the preloader is gone (6.8.16)
            if (renders === 3) {
              canvas.classList.add('is-ready')
              if (!gpuTest) sendReady()
            }
            // ?gputest keeps the preloader up until its "while loading" round is measured
            if (gpuTest && !readySent && gpuTest.loadDone()) sendReady()
            let seconds = (now - clockBegin) / 1000
            let spin = null
            if (gyroClock.seconds != null) seconds = gyroClock.seconds
            else if (Number.isFinite(frozen)) seconds = frozen
            // ?gputest measures one fixed pose, so every round draws exactly the same picture
            else if (gpuTest && !gpuTest.isDone()) seconds = 2.5
            else {
              spinClock.step(dt)
              spin = spinClock
            }
            // GPU time of earlier frames that has arrived by now (gpuTimer.js)
            const finished = timer.poll()
            for (let i = 0; i < finished.length; i += 1) {
              gpuRecent.push(finished[i].ms)
              if (gpuRecent.length > GPU_WINDOW) gpuRecent.shift()
              if (gpuTest) gpuTest.sample(finished[i])
            }
            if (gpuTest) {
              // the test's "stress" round: the page itself is made slow on purpose
              const busy = gpuTest.busyMs()
              if (busy) {
                const until = performance.now() + busy
                while (performance.now() < until) { /* busy on purpose */ }
              }
            }
            // ?gputest "burst" rounds draw the same frame several times to load the GPU fully
            const draws = gpuTest ? gpuTest.repeat() : 1
            const tag = gpuTest ? gpuTest.tag() : null
            for (let d = 0; d < draws; d += 1) {
              timer.begin(tag)
              gyro.render(seconds, spin)
              timer.end()
            }
            quality.frame(now)
            if (gpuTest) gpuTest.frame(now)
            // Readable from the element inspector (also on phones): level, start-up timings and
            // when each level began (ms after page start). 6 = the phone setup on a computer
            // (lite switch or ?lite, 6.8.15); the FPS readout shows it as Q6.
            const label = liteOnComputer() ? '6' : gpuTest && !gpuTest.isDone() ? `${gpuTest.getLevel()}` : `${quality.getLevel()}`
            // GPU readout: median of the recent frames at the current level, twice a second
            if (label !== gpuLevel) {
              gpuLevel = label
              gpuRecent.length = 0
            }
            if (gpuRecent.length >= 5 && now - gpuShownAt >= GPU_READOUT_MS) {
              gpuShownAt = now
              const sorted = [...gpuRecent].sort((a, b) => a - b)
              canvas.dataset.gpu = sorted[sorted.length >> 1].toFixed(1)
            }
            if (canvas.dataset.quality !== label) {
              canvas.dataset.quality = label
              canvas.dataset.levels = `${canvas.dataset.levels ? `${canvas.dataset.levels} ` : ''}${label}@${Math.round(now)}`
            }
            // Frames a second over the last counted second, once settled (6.8.16: fps, not ms)
            const watched = quality.getWatched()
            if (watched && canvas.dataset.watch !== watched) canvas.dataset.watch = watched
            // Diagnostics (6.8.16): where the quality picking is (wait / base / verify / settled / fixed)
            const phaseNow = quality.getPhase()
            if (canvas.dataset.qPhase !== phaseNow) canvas.dataset.qPhase = phaseNow
          }

          // Showreel open (6.8.12): while the black showreel overlay covers the whole page
          // (<html>.showreel-open, set by ShowreelOverlay once its fade-in is done and removed as
          // soon as closing starts) the 3D is not rendered at all, so the GPU is free for the video
          // (suspected cause of the stutter at the reel's start, 2026-11). It resumes where it
          // stopped: its clock skips the paused time and the first frame after has no time step,
          // so pose and spin carry on unchanged. The quality check ignores the gap (> GAP_MS).
          let pausedAt = null
          const syncPause = () => {
            covered = root.classList.contains('showreel-open')
            if (covered && pausedAt == null) {
              interruptions += 1
              quality.interrupt() // a measuring window must not include the pause
              pausedAt = performance.now()
              if (frameId != null) cancelFrame(frameId)
              frameId = null
              // No spin energy while covered: the speed effects (SpeedEffects, still running)
              // read it, and a frozen value shook the whole page, video included (6.8.12 bug)
              spinClock.calm()
              canvas.dataset.paused = 'showreel' // readable in the element inspector
            } else if (!covered && pausedAt != null) {
              clockBegin += performance.now() - pausedAt
              pausedAt = null
              lastRender = -Infinity
              spinClock.calm() // clicks inside the showreel (zoom, close) add no spin afterwards
              delete canvas.dataset.paused
              if (frameId == null) frameId = nextFrame(loop)
            }
          }
          pauseObserver = new MutationObserver(syncPause)
          pauseObserver.observe(root, { attributes: true, attributeFilter: ['class'] })
          frameId = nextFrame(loop)
          syncPause()
        })
        .catch(fail)

    // A lost context (GPU reset, phone tab in the background) is rebuilt once it is restored
    const handleContextLost = (event) => {
      event.preventDefault()
      if (frameId != null) cancelFrame(frameId)
      frameId = null
    }
    const handleContextRestored = () => {
      stop()
      start()
    }

    // The phone setup for the rest of the visit (Q6): from quality.js (onLite) or ?litetest.
    // Rebuilt after the current frame (onLite fires inside the loop).
    const switchToLite = (fps) => {
      if (disposed || liteMode()) return
      canvas.dataset.lite = `auto ${Math.round(fps)} fps @${Math.round(performance.now())}`
      setLiteMode(true)
      setTimeout(() => {
        if (disposed) return
        stop()
        start()
      }, 0)
    }

    // Quality is picked as soon as the preloader has faded out: its root gets .preloader--done
    // 0.18 s after loading ends and fades for 0.22 s (PRELOADER_FADE_MS); it is unmounted (and
    // <html>.preloader-active removed) only at 0.9 s, which waited half a second too long
    // (owner, 2026-11-18). A hidden tab or the showreel restarts the measuring window.
    const onVisibility = () => {
      interruptions += 1
      if (gyro && gyro.quality) gyro.quality.interrupt()
    }
    const beginQuality = () => {
      liteTimer = null
      if (disposed) return
      if (!gyro || !gyro.quality || covered || document.hidden) {
        liteTimer = setTimeout(beginQuality, BEGIN_RETRY_MS)
        return
      }
      gyro.quality.begin()
      canvas.dataset.qBegin = String(Math.round(performance.now())) // diagnostics (6.8.16)
      if (params.has('litetest')) liteTimer = setTimeout(() => switchToLite(0), LITE_TEST_MS)
    }
    const waitForPreloader = () => {
      liteTimer = null
      if (disposed) return
      const gone = !root.classList.contains('preloader-active')
      const fading = !gone && document.querySelector('.preloader-root.preloader--done')
      if (!gone && !fading) {
        liteTimer = setTimeout(waitForPreloader, 50)
        return
      }
      canvas.dataset.qPre = String(Math.round(performance.now())) // diagnostics (6.8.16)
      liteTimer = setTimeout(beginQuality, fading ? PRELOADER_FADE_MS : LITE_SETTLE_MS)
    }
    document.addEventListener('visibilitychange', onVisibility)
    waitForPreloader()

    canvas.addEventListener('webglcontextlost', handleContextLost)
    canvas.addEventListener('webglcontextrestored', handleContextRestored)
    start()

    return () => {
      disposed = true
      if (liteTimer != null) clearTimeout(liteTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      canvas.removeEventListener('webglcontextrestored', handleContextRestored)
      stop()
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} aria-hidden="true" />
      {showRef && <GyroReference />}
    </>
  )
}
