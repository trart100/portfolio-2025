import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { gyroClock } from '../lib/gyro/clock'
import { createSpinClock } from '../lib/gyro/spin'
import { liteMode, setLiteMode } from '../lib/gyro/lite'

// Temporary fix (6.8.14, to be worked out properly later): once the preloader is gone, the 3D's
// frames are counted for LITE_WINDOW_MS; below LITE_BELOW_FPS drawn frames a second the scene is
// rebuilt with the phone setup ("lite", lib/gyro/lite.js) for the rest of the visit. A window
// interrupted by the showreel (3D paused) or a hidden tab is thrown away and measured again.
// ?litetest switches regardless of the count (to see the switch on a fast computer).
const LITE_BELOW_FPS = 30
const LITE_SETTLE_MS = 500 // after the preloader is gone, before counting
const LITE_WINDOW_MS = 2000

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
    const root = document.documentElement

    const params = new URLSearchParams(window.location.search)
    const frozenParam = params.get('t')
    const frozen = frozenParam != null && frozenParam !== '' ? parseFloat(frozenParam) : null
    const forcedParam = parseInt(params.get('q'), 10)
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
      if (frameId != null) cancelAnimationFrame(frameId)
      frameId = null
      if (observer) observer.disconnect()
      observer = null
      if (pauseObserver) pauseObserver.disconnect()
      pauseObserver = null
      if (gui) gui.destroy()
      gui = null
      if (!gyro) return
      if (gyro.quality) keptLevel = gyro.quality.getLevel()
      if (window.__gyro === gyro) delete window.__gyro
      gyro.dispose()
      gyro = null
    }

    const start = () =>
      Promise.all([import('../lib/gyro/scene'), import('../lib/gyro/quality')])
        .then(([{ createGyroScene }, { createQualityController }]) => {
          if (disposed) return
          readMode()
          gyro = createGyroScene(canvas)

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

          // Adaptive quality: picks the level behind the preloader, then only steps down on
          // sustained slowness. Off for frozen frames / the comparison tool (dev captures).
          const quality = createQualityController({
            gyro,
            setResolution: (value) => {
              resolution = value
              resize()
            },
            onSettled: () => {
              canvas.dataset.measured = quality.getMeasured().join('/')
              canvas.classList.add('is-ready')
              sendReady()
              if (params.has('gui')) {
                console.info(`[GyroVisual] quality level ${quality.getLevel()} (start-up ms per level tried: ${quality.getMeasured().join(', ')})`)
              }
            },
            forcedLevel: keptLevel != null ? keptLevel : Number.isFinite(forcedParam) ? forcedParam : null,
            adapt: keptLevel == null && !Number.isFinite(frozen) && !params.has('ref')
          })
          gyro.quality = quality

          if (clockBegin == null) clockBegin = performance.now()
          let lastRender = -Infinity
          // Click spin-up: own clocks for the gold and the glass (off for frozen frames / ?ref)
          if (!spinClock) spinClock = createSpinClock(gyro.look.spin)
          const loop = (now) => {
            frameId = requestAnimationFrame(loop)
            if (now - lastRender < MIN_FRAME_MS) return
            const dt = lastRender > 0 ? (now - lastRender) / 1000 : 0
            lastRender = now
            renders += 1
            let seconds = (now - clockBegin) / 1000
            let spin = null
            if (gyroClock.seconds != null) seconds = gyroClock.seconds
            else if (Number.isFinite(frozen)) seconds = frozen
            else {
              spinClock.step(dt)
              spin = spinClock
            }
            if (quality.isMeasuring()) {
              // Drain the frames the GPU still has queued first, so only this frame is timed
              gyro.finish()
              const t0 = performance.now()
              gyro.render(seconds, spin)
              gyro.finish()
              quality.frame(now, performance.now() - t0)
            } else {
              gyro.render(seconds, spin)
              quality.frame(now)
            }
            // Readable from the element inspector (also on phones): level, start-up timings and
            // when each level began (ms after page start)
            const label = `${quality.getLevel()}`
            if (canvas.dataset.quality !== label) {
              canvas.dataset.quality = label
              canvas.dataset.levels = `${canvas.dataset.levels ? `${canvas.dataset.levels} ` : ''}${label}@${Math.round(now)}`
            }
            // Watch median of timed frames (ms), > 20 = step down
            const watched = quality.getWatched()
            if (watched && canvas.dataset.watch !== watched) canvas.dataset.watch = watched
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
              pausedAt = performance.now()
              if (frameId != null) cancelAnimationFrame(frameId)
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
              if (frameId == null) frameId = requestAnimationFrame(loop)
            }
          }
          pauseObserver = new MutationObserver(syncPause)
          pauseObserver.observe(root, { attributes: true, attributeFilter: ['class'] })
          frameId = requestAnimationFrame(loop)
          syncPause()
        })
        .catch(fail)

    // A lost context (GPU reset, phone tab in the background) is rebuilt once it is restored
    const handleContextLost = (event) => {
      event.preventDefault()
      if (frameId != null) cancelAnimationFrame(frameId)
      frameId = null
    }
    const handleContextRestored = () => {
      stop()
      start()
    }

    // The lite check (temporary fix, see LITE_BELOW_FPS). Only on computers in the normal setup
    // (not ?lite / touch, not frozen frames, ?ref or a forced ?q level), once per visit, and only
    // once the preloader is completely gone: <html>.preloader-active is removed when the
    // Preloader unmounts, 0.9 s after loading ends (its fade-out ends at ~0.4 s), then
    // LITE_SETTLE_MS more before counting.
    const canCheckLite = !Number.isFinite(frozen) && !params.has('ref') && !Number.isFinite(forcedParam)
    const onVisibility = () => { interruptions += 1 }
    const measureLite = () => {
      liteTimer = null
      if (disposed || liteMode() || !gyro) return
      if (covered || document.hidden) {
        liteTimer = setTimeout(measureLite, LITE_SETTLE_MS)
        return
      }
      const from = renders
      const epoch = interruptions
      const t0 = performance.now()
      liteTimer = setTimeout(() => {
        liteTimer = null
        if (disposed || liteMode()) return
        if (interruptions !== epoch || covered || document.hidden) {
          liteTimer = setTimeout(measureLite, LITE_SETTLE_MS) // interrupted: measure again
          return
        }
        const fps = ((renders - from) * 1000) / (performance.now() - t0)
        canvas.dataset.fps3d = String(Math.round(fps)) // readable in the element inspector
        if (fps < LITE_BELOW_FPS || params.has('litetest')) {
          canvas.dataset.lite = `auto ${Math.round(fps)} fps @${Math.round(performance.now())}`
          setLiteMode(true)
          stop()
          start()
        }
      }, LITE_WINDOW_MS)
    }
    const waitForPreloader = () => {
      liteTimer = null
      if (disposed) return
      if (root.classList.contains('preloader-active')) {
        liteTimer = setTimeout(waitForPreloader, 250)
        return
      }
      liteTimer = setTimeout(measureLite, LITE_SETTLE_MS)
    }
    if (canCheckLite && !liteMode()) {
      document.addEventListener('visibilitychange', onVisibility)
      waitForPreloader()
    }

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
