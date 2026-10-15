import React, { useEffect, useRef } from 'react'
import { effects } from '../lib/gyro/effects'
import { gyroSpin } from '../lib/gyro/spin'

const PAGE_MARGIN = 34
const BASE_HORIZONTAL_SPACING = 68
const BASE_VERTICAL_SPACING = 90
const DOT_SIZE = 5
const DOT_ALPHA = 0.2
const MAX_ROTATION_DEGREES = 2
const DEFAULT_REACTION_SPEED = 0.08
const DEFAULT_PROXIMITY_DISTANCE = 200
const DEFAULT_SCALE_DELTA = .7
// Below this difference (scale units / degrees) a value counts as settled
const SETTLE_EPSILON = 0.0005
// Most ripples running at once (fast clicking drops the oldest)
const MAX_RIPPLES = 8
const MAX_PIXEL_RATIO = 2

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

function buildDots(width, height) {
  const availableWidth = Math.max(0, width - PAGE_MARGIN * 2)
  const availableHeight = Math.max(0, height - PAGE_MARGIN * 2)

  const horizontalIntervals = availableWidth > 0
    ? Math.max(1, Math.floor(availableWidth / BASE_HORIZONTAL_SPACING))
    : 1
  const verticalIntervals = availableHeight > 0
    ? Math.max(1, Math.floor(availableHeight / BASE_VERTICAL_SPACING))
    : 1
  const horizontalSpacing = availableWidth / horizontalIntervals
  const verticalSpacing = availableHeight / verticalIntervals

  const dots = []

  for (let row = 0; row <= verticalIntervals; row++) {
    const y = PAGE_MARGIN + row * verticalSpacing
    for (let col = 0; col <= horizontalIntervals; col++) {
      const x = PAGE_MARGIN + col * horizontalSpacing
      // scale = eased size, target = where the mouse proximity wants it
      dots.push({ x, y, scale: 1, target: 1 })
    }
  }

  return dots
}

// Background dot grid, drawn on one canvas (until 6.7.0 one element per dot; the click ripple
// changes every dot every frame, which cost ~5 ms per frame on the main thread as elements).
// The grid tilts towards the mouse (CSS transform on the box), dots near the mouse grow, far ones
// shrink, and every click / tap sends a ripple through the dots (LOOK.effects.ripple).
// The loop sleeps once everything has settled; input wakes it again.
export default function DotGrid({
  reactionSpeed = DEFAULT_REACTION_SPEED,
  proximityDistance = DEFAULT_PROXIMITY_DISTANCE,
  scaleDelta = DEFAULT_SCALE_DELTA
}) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    const ctx = canvas && canvas.getContext('2d')
    if (!container || !ctx) return undefined

    const rotation = { x: 0, y: 0, targetX: 0, targetY: 0 }
    const cursor = { x: 0, y: 0, active: false }
    const farRange = proximityDistance > 0 ? proximityDistance * 2 : 200
    // Click / tap ripples: { x, y, start (ms), strength }
    let ripples = []
    let dots = []
    let frameId = null
    let targetsDirty = false
    let needsDraw = true
    let wasRippling = false
    let ratio = 1

    const updateScaleTargets = () => {
      dots.forEach((dot) => {
        if (!cursor.active) {
          dot.target = 1
          return
        }
        const distance = Math.hypot(dot.x - cursor.x, dot.y - cursor.y)
        let targetScale

        if (distance <= proximityDistance) {
          const nearFactor = proximityDistance > 0 ? distance / proximityDistance : 0
          targetScale = 1 + scaleDelta * (1 - clamp(nearFactor, 0, 1))
        } else {
          const farFactor = clamp((distance - proximityDistance) / farRange, 0, 1)
          targetScale = 1 - scaleDelta * farFactor
        }

        dot.target = clamp(targetScale, 1 - scaleDelta, 1 + scaleDelta)
      })
    }

    // Ripple (LOOK.effects.ripple, read live): a wave front travels out from the pointer; dots it
    // passes move out then back (the wave's slope), grow and light up (its peak). Each wave
    // fades over `life`; ripples add up.
    const ripple = { dx: 0, dy: 0, peak: 0 }
    const rippleAt = (dot, now) => {
      const settings = effects.ripple
      ripple.dx = 0
      ripple.dy = 0
      ripple.peak = 0
      for (let i = 0; i < ripples.length; i++) {
        const r = ripples[i]
        const age = (now - r.start) / 1000
        const fade = 1 - age / settings.life
        if (fade <= 0) continue
        const rx = dot.x - r.x
        const ry = dot.y - r.y
        const distance = Math.hypot(rx, ry) || 1
        const u = (distance - age * settings.speed) / Math.max(settings.width, 1)
        if (u > 3 || u < -3) continue
        const bell = Math.exp(-u * u)
        const strength = r.strength * fade * fade
        // -u * bell peaks at 0.43 (u = -0.71): x 2.33 = 1 = full push
        const push = -u * bell * 2.33 * settings.push * strength
        ripple.dx += (rx / distance) * push
        ripple.dy += (ry / distance) * push
        ripple.peak += bell * strength
      }
      ripple.peak = Math.min(ripple.peak, 1.5)
      return ripple
    }

    const draw = (now, rippling) => {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#fff'
      const { grow, glow } = effects.ripple
      const radius = DOT_SIZE / 2
      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i]
        let { x, y } = dot
        let size = radius * dot.scale
        let alpha = DOT_ALPHA
        if (rippling) {
          const r = rippleAt(dot, now)
          x += r.dx
          y += r.dy
          size *= 1 + r.peak * grow
          alpha = Math.min(DOT_ALPHA + r.peak * glow, 1)
        }
        ctx.globalAlpha = alpha
        ctx.beginPath()
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const animate = (now = performance.now()) => {
      if (targetsDirty) {
        updateScaleTargets()
        targetsDirty = false
      }

      rotation.x += (rotation.targetX - rotation.x) * reactionSpeed
      rotation.y += (rotation.targetY - rotation.y) * reactionSpeed
      let moving = Math.abs(rotation.targetX - rotation.x) > SETTLE_EPSILON ||
        Math.abs(rotation.targetY - rotation.y) > SETTLE_EPSILON
      container.style.transform = `perspective(1300px) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`

      dots.forEach((dot) => {
        if (Math.abs(dot.target - dot.scale) <= SETTLE_EPSILON) return
        dot.scale += (dot.target - dot.scale) * reactionSpeed
        moving = true
      })

      const life = effects.ripple.life * 1000
      ripples = ripples.filter((r) => now - r.start < life)
      const rippling = ripples.length > 0
      // Redraw while anything changes, and once more after the last ripple (to clear it)
      if (moving || rippling || wasRippling || needsDraw) draw(now, rippling)
      needsDraw = false
      wasRippling = rippling

      frameId = moving || rippling ? requestAnimationFrame(animate) : null
    }

    const wake = (recomputeTargets = false) => {
      if (recomputeTargets) targetsDirty = true
      if (frameId == null) frameId = requestAnimationFrame(animate)
    }

    const resize = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      dots = buildDots(width, height)
      needsDraw = true
      wake(true)
    }

    const handleWindowMouseMove = (event) => {
      const width = window.innerWidth
      const height = window.innerHeight
      const relativeX = clamp(width > 0 ? event.clientX / width : 0, 0, 1)
      const relativeY = clamp(height > 0 ? event.clientY / height : 0, 0, 1)

      cursor.x = event.clientX
      cursor.y = event.clientY
      cursor.active = true

      rotation.targetY = (relativeX - 0.5) * MAX_ROTATION_DEGREES * 2
      rotation.targetX = (0.5 - relativeY) * MAX_ROTATION_DEGREES * 2
      wake(true)
    }

    // Flatten the grid when the pointer leaves the page (relatedTarget is null
    // only when leaving the window; window 'mouseleave' never fires)
    const handleMouseOut = (event) => {
      if (event.relatedTarget) return
      rotation.targetX = 0
      rotation.targetY = 0
      cursor.active = false
      wake(true)
    }

    // Every click / tap (capture: links and buttons too). detail 0 = keyboard "click", no position.
    // Faster spin = stronger ripple (energy read at the click)
    const handleClick = (event) => {
      if (!event.detail) return
      const strength = 1 + effects.ripple.boost * clamp(gyroSpin.energy, 0, 1)
      ripples.push({ x: event.clientX, y: event.clientY, start: performance.now(), strength })
      if (ripples.length > MAX_RIPPLES) ripples.shift()
      wake()
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('click', handleClick, true)
    document.addEventListener('mouseout', handleMouseOut)

    return () => {
      if (frameId != null) cancelAnimationFrame(frameId)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('click', handleClick, true)
      document.removeEventListener('mouseout', handleMouseOut)
      container.style.transform = ''
    }
  }, [reactionSpeed, proximityDistance, scaleDelta])

  return (
    <div
      id="dot-grid"
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        background: 'transparent',
        pointerEvents: 'none',
        transformStyle: 'preserve-3d',
        willChange: 'transform'
      }}
    >
      <canvas ref={canvasRef} aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, display: 'block', pointerEvents: 'none' }} />
    </div>
  )
}
