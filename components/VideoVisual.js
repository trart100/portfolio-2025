import { useEffect, useRef } from 'react'
import GyroVisual from './GyroVisual'

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
const LERP = 0.15
const SETTLE_PX = 0.01

const toTransform = (x, y) => `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`

// The background visual: the real-time 3D (GyroVisual), drifting a little with the mouse.
export default function VideoVisual({ movementIntensity = 18 }) {
  const wrapRef = useRef(null)

  // Parallax: ease the box toward an offset based on the mouse position.
  // Written straight to the DOM (no React re-render) and the loop sleeps when settled.
  // Every position is snapped to whole screen pixels (keeps the grain crisp).
  useEffect(() => {
    const el = wrapRef.current
    if (!el || movementIntensity <= 0) return undefined

    const target = { x: 0, y: 0 }
    const current = { x: 0, y: 0 }
    let frameId = null

    // One whole-pixel translate from the corner. Percentages (left 50%, translate -50%)
    // can land on half pixels that the browser rounds differently from what it reports.
    const place = () => {
      const dpr = window.devicePixelRatio || 1
      const snap = (value) => Math.round(value * dpr) / dpr
      const rect = el.getBoundingClientRect()
      const page = document.documentElement
      const x = snap((page.clientWidth - rect.width) / 2 + current.x)
      const y = snap((page.clientHeight - rect.height) / 2 + current.y)
      el.style.left = '0px'
      el.style.top = '0px'
      el.style.transform = `translate(${x}px, ${y}px)`
    }

    const animate = () => {
      current.x += (target.x - current.x) * LERP
      current.y += (target.y - current.y) * LERP
      const settled = Math.abs(target.x - current.x) < SETTLE_PX && Math.abs(target.y - current.y) < SETTLE_PX
      if (settled) {
        current.x = target.x
        current.y = target.y
      }
      place()
      frameId = settled ? null : requestAnimationFrame(animate)
    }

    const wake = () => {
      if (frameId == null) frameId = requestAnimationFrame(animate)
    }

    const handleMouseMove = (event) => {
      const width = window.innerWidth || 1
      const height = window.innerHeight || 1
      const relativeX = (event.clientX / width - 0.5) * 2
      const relativeY = (event.clientY / height - 0.5) * 2
      target.x = clamp(relativeX, -1, 1) * movementIntensity
      target.y = clamp(relativeY, -1, 1) * movementIntensity
      wake()
    }

    const release = () => {
      target.x = 0
      target.y = 0
      wake()
    }

    // Recenter only when the pointer actually leaves the page (mouseout bubbles
    // from every element; relatedTarget is null only when leaving the window)
    const handleMouseOut = (event) => {
      if (!event.relatedTarget) release()
    }

    window.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseout', handleMouseOut)
    // The centred box moves with the window size and the page width (scrollbar), so re-snap
    // whenever either changes
    place()
    window.addEventListener('resize', place)
    const layoutObserver = new ResizeObserver(place)
    layoutObserver.observe(document.documentElement)
    layoutObserver.observe(el)

    return () => {
      if (frameId != null) cancelAnimationFrame(frameId)
      window.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseout', handleMouseOut)
      window.removeEventListener('resize', place)
      layoutObserver.disconnect()
      el.style.left = ''
      el.style.top = ''
    }
  }, [movementIntensity])

  return (
    <div ref={wrapRef} className="video-visual" style={{ transform: toTransform(0, 0) }}>
      <GyroVisual />
    </div>
  )
}
