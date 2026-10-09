import { useEffect, useRef } from 'react'

// Real-time 3D version of the background visual (work in progress, shown with ?3d).
// three.js is loaded on demand, so normal visits never download it.
// ?3d&t=2.5 freezes the animation at that second (for comparing with the video).
// ?3d&gui adds a live look-tuning panel.
export default function GyroVisual({ onFail }) {
  const canvasRef = useRef(null)
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    let disposed = false
    let gyro = null
    let gui = null
    let frameId = null
    let observer = null

    const fail = (error) => {
      console.warn('[GyroVisual] falling back to the video:', error)
      if (onFailRef.current) onFailRef.current()
    }
    const handleContextLost = (event) => {
      event.preventDefault()
      fail('WebGL context lost')
    }

    const params = new URLSearchParams(window.location.search)
    const frozenParam = params.get('t')
    const frozen = frozenParam != null && frozenParam !== '' ? parseFloat(frozenParam) : null

    import('../lib/gyro/scene')
      .then(({ createGyroScene }) => {
        if (disposed) return
        gyro = createGyroScene(canvas)
        canvas.addEventListener('webglcontextlost', handleContextLost)

        if (params.has('gui')) {
          window.__gyro = gyro // console access while tuning
          import('../lib/gyro/gui').then(({ createGyroGui }) => {
            if (!disposed) gui = createGyroGui(gyro)
          })
        }

        const box = canvas.parentElement
        const resize = () => gyro.setSize(box.clientWidth, box.clientHeight)
        resize()
        observer = new ResizeObserver(resize)
        observer.observe(box)

        const start = performance.now()
        let first = true
        const loop = (now) => {
          gyro.render(Number.isFinite(frozen) ? frozen : (now - start) / 1000)
          if (first) {
            first = false
            canvas.classList.add('is-ready')
            // Same signal the video sends, so the Preloader can finish
            window.dispatchEvent(new CustomEvent('videoCanPlay'))
          }
          frameId = requestAnimationFrame(loop)
        }
        frameId = requestAnimationFrame(loop)
      })
      .catch(fail)

    return () => {
      disposed = true
      if (frameId != null) cancelAnimationFrame(frameId)
      if (observer) observer.disconnect()
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      if (gui) gui.destroy()
      if (window.__gyro === gyro) delete window.__gyro
      if (gyro) gyro.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden="true" />
}
