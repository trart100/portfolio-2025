import { useEffect, useRef } from 'react'

// Real-time 3D version of the background visual (work in progress, shown with ?3d).
// three.js is loaded on demand, so normal visits never download it.
// ?3d&t=2.5 freezes the animation at that second (for comparing with the video).
export default function GyroVisual({ onFail }) {
  const canvasRef = useRef(null)
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    let disposed = false
    let gyro = null
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

    const frozenParam = new URLSearchParams(window.location.search).get('t')
    const frozen = frozenParam != null && frozenParam !== '' ? parseFloat(frozenParam) : null

    import('../lib/gyro/scene')
      .then(({ createGyroScene }) => {
        if (disposed) return
        gyro = createGyroScene(canvas)
        canvas.addEventListener('webglcontextlost', handleContextLost)

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
      if (gyro) gyro.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden="true" />
}
