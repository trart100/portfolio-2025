import { useEffect, useRef } from 'react'
import GyroVisual from './GyroVisual'
import { gyroPointer } from '../lib/gyro/pointer'
import { gyroSpin } from '../lib/gyro/spin'

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
const LERP = 0.15
const SETTLE = 0.0005

const CENTERED = 'translate(-50%, -50%)'
// Scroll jumps larger than this in one event (scroll restored after a resize or reload, anchor
// jumps) only count up to it, so they don't fire a full spin
const MAX_SCROLL_STEP = 300

// The background visual: the real-time 3D (GyroVisual), centred on whole screen pixels.
// Mouse drift: the eased mouse position goes to the 3D (gyroPointer), where the glass and the
// gold move towards it by their own amounts (LOOK.drift); the box itself stays put.
// Click / tap anywhere, or scroll: the gold spins up, the glass follows (spin.js, LOOK.spin).
export default function VideoVisual() {
  const wrapRef = useRef(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined

    const target = { x: 0, y: 0 }
    let frameId = null

    // One whole-pixel translate from the corner. Percentages (left 50%, translate -50%)
    // can land on half pixels that the browser rounds differently from what it reports.
    const place = () => {
      const dpr = window.devicePixelRatio || 1
      const snap = (value) => Math.round(value * dpr) / dpr
      const rect = el.getBoundingClientRect()
      const page = document.documentElement
      el.style.left = '0px'
      el.style.top = '0px'
      el.style.transform = `translate(${snap((page.clientWidth - rect.width) / 2)}px, ${snap((page.clientHeight - rect.height) / 2)}px)`
    }

    const animate = () => {
      gyroPointer.x += (target.x - gyroPointer.x) * LERP
      gyroPointer.y += (target.y - gyroPointer.y) * LERP
      const settled = Math.abs(target.x - gyroPointer.x) < SETTLE && Math.abs(target.y - gyroPointer.y) < SETTLE
      if (settled) {
        gyroPointer.x = target.x
        gyroPointer.y = target.y
      }
      frameId = settled ? null : requestAnimationFrame(animate)
    }

    const wake = () => {
      if (frameId == null) frameId = requestAnimationFrame(animate)
    }

    const handleMouseMove = (event) => {
      const width = window.innerWidth || 1
      const height = window.innerHeight || 1
      target.x = clamp((event.clientX / width - 0.5) * 2, -1, 1)
      target.y = clamp((event.clientY / height - 0.5) * 2, -1, 1)
      wake()
    }

    // Recenter only when the pointer actually leaves the page (mouseout bubbles
    // from every element; relatedTarget is null only when leaving the window)
    const handleMouseOut = (event) => {
      if (event.relatedTarget) return
      target.x = 0
      target.y = 0
      wake()
    }

    // Capture phase: counts clicks on links and buttons too. `click` (not pointerdown), so a
    // touch scroll doesn't count as a tap.
    const handleClick = () => {
      gyroSpin.kicks += 1
    }

    // Scrolling (wheel, touch, keys, scrollbar) adds speed by the distance scrolled
    let lastScrollY = window.scrollY
    const handleScroll = () => {
      const y = window.scrollY
      gyroSpin.scrolled += Math.min(Math.abs(y - lastScrollY), MAX_SCROLL_STEP)
      lastScrollY = y
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('click', handleClick, true)
    window.addEventListener('scroll', handleScroll, { passive: true })
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
      window.removeEventListener('click', handleClick, true)
      window.removeEventListener('scroll', handleScroll)
      gyroSpin.kicks = 0
      gyroSpin.scrolled = 0
      document.removeEventListener('mouseout', handleMouseOut)
      window.removeEventListener('resize', place)
      layoutObserver.disconnect()
      gyroPointer.x = 0
      gyroPointer.y = 0
      el.style.left = ''
      el.style.top = ''
    }
  }, [])

  return (
    <div ref={wrapRef} className="video-visual" style={{ transform: CENTERED }}>
      <GyroVisual />
    </div>
  )
}
