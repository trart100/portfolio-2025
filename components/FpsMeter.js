import { useEffect, useRef, useState } from 'react'

export default function FpsMeter({ visible = process.env.NODE_ENV === 'development' }) {
  const [fps, setFps] = useState(0)
  const [winSize, setWinSize] = useState({ w: 0, h: 0 })
  const rafRef = useRef(null)
  const lastRef = useRef(performance.now())
  const framesRef = useRef(0)
  const samplesRef = useRef([])

  useEffect(() => {
    if (!visible || typeof window === 'undefined') return

    const loop = (t) => {
      rafRef.current = requestAnimationFrame(loop)
      framesRef.current += 1
      const last = lastRef.current
      const delta = t - last
      // compute instant fps
      const instant = 1000 / (delta || 1)
      samplesRef.current.push(instant)
      if (samplesRef.current.length > 30) samplesRef.current.shift()
      const avg = samplesRef.current.reduce((a, b) => a + b, 0) / samplesRef.current.length
      setFps(Math.round(avg))
      lastRef.current = t
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [visible])

  useEffect(() => {
    if (!visible || typeof window === 'undefined') return
    
    const updateSize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight })
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [visible])

  if (!visible) return null

  return (
    <div className="fps-meter" aria-hidden>
      <div className="fps-value">{winSize.w} × {winSize.h} / {fps} FPS</div>
    </div>
  )
}
