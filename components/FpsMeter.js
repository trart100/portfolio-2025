import { useEffect, useRef } from 'react'

const SAMPLE_COUNT = 30

export default function FpsMeter({ visible = process.env.NODE_ENV === 'development' }) {
  const textRef = useRef(null)

  // Measures rAF rate every frame but only touches the DOM when the label changes
  useEffect(() => {
    if (!visible) return undefined

    const samples = []
    const size = { w: window.innerWidth, h: window.innerHeight }
    let fps = 0
    let last = performance.now()
    let label = ''
    let rafId = null

    const render = () => {
      const next = `${size.w} × ${size.h} / ${fps} FPS`
      if (next !== label && textRef.current) {
        label = next
        textRef.current.textContent = next
      }
    }

    const loop = (t) => {
      rafId = requestAnimationFrame(loop)
      samples.push(1000 / ((t - last) || 1))
      if (samples.length > SAMPLE_COUNT) samples.shift()
      fps = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
      last = t
      render()
    }

    const onResize = () => {
      size.w = window.innerWidth
      size.h = window.innerHeight
      render()
    }

    render()
    rafId = requestAnimationFrame(loop)
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
    }
  }, [visible])

  if (!visible) return null

  return (
    <div className="fps-meter" aria-hidden>
      <div className="fps-value" ref={textRef}>0 × 0 / 0 FPS</div>
    </div>
  )
}
