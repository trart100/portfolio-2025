import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { gyroClock } from '../lib/gyro/clock'
import { createSpinClock } from '../lib/gyro/spin'

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
    // Level kept when the scene is rebuilt after a lost WebGL context (no new start-up check)
    let keptLevel = null
    let readySent = false

    const params = new URLSearchParams(window.location.search)
    const frozenParam = params.get('t')
    const frozen = frozenParam != null && frozenParam !== '' ? parseFloat(frozenParam) : null
    const forcedParam = parseInt(params.get('q'), 10)
    // Touch devices (phones, often 90-120 Hz screens): the 3D renders at most 30 times a second
    // (the page itself keeps the screen's rate) and at a pixel density of at most 1.5
    const touch = window.matchMedia('(pointer: coarse)').matches
    const MIN_FRAME_MS = touch ? 1000 / 30 - 4 : 0 // - 4: rAF timing jitter
    const MAX_PIXEL_RATIO = touch ? 1.5 : 2

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

          const begin = performance.now()
          let lastRender = -Infinity
          // Click spin-up: own clocks for the gold and the glass (off for frozen frames / ?ref)
          const spinClock = createSpinClock(gyro.look.spin)
          const loop = (now) => {
            frameId = requestAnimationFrame(loop)
            if (now - lastRender < MIN_FRAME_MS) return
            const dt = lastRender > 0 ? (now - lastRender) / 1000 : 0
            lastRender = now
            let seconds = (now - begin) / 1000
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
          frameId = requestAnimationFrame(loop)
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
    canvas.addEventListener('webglcontextlost', handleContextLost)
    canvas.addEventListener('webglcontextrestored', handleContextRestored)
    start()

    return () => {
      disposed = true
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
