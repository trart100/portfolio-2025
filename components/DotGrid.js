import React, { useEffect, useRef, useState } from 'react'

const PAGE_MARGIN = 34
const BASE_HORIZONTAL_SPACING = 68
const BASE_VERTICAL_SPACING = 90
const DOT_SIZE = 5
const DOT_COLOR = 'rgba(255, 255, 255, 0.2)'
const MAX_ROTATION_DEGREES = 2
const DEFAULT_REACTION_SPEED = 0.08
const DEFAULT_PROXIMITY_DISTANCE = 200
const DEFAULT_SCALE_DELTA = .7
// Below this difference (scale units / degrees) a value counts as settled
const SETTLE_EPSILON = 0.0005

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
      dots.push({ id: `dot-${row}-${col}`, x, y })
    }
  }

  return dots
}

export default function DotGrid({
  reactionSpeed = DEFAULT_REACTION_SPEED,
  proximityDistance = DEFAULT_PROXIMITY_DISTANCE,
  scaleDelta = DEFAULT_SCALE_DELTA
}) {
  const [dots, setDots] = useState([])
  const containerRef = useRef(null)
  const rotationRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 })
  const dotElementsRef = useRef(new Map())
  const dotPositionsRef = useRef(new Map())
  const scaleTargetsRef = useRef(new Map())
  const scaleCurrentRef = useRef(new Map())
  const cursorRef = useRef({ x: 0, y: 0, active: false })
  // Set by the animation effect; lets the resize handler restart the sleeping loop
  const wakeRef = useRef(() => {})

  useEffect(() => {
    let isMounted = true

    const rebuildDots = () => {
      if (!isMounted) return
      const nextDots = buildDots(window.innerWidth, window.innerHeight)
      const positions = new Map()

      scaleTargetsRef.current.clear()
      scaleCurrentRef.current.clear()

      nextDots.forEach((dot) => {
        positions.set(dot.id, { x: dot.x, y: dot.y })
        scaleTargetsRef.current.set(dot.id, 1)
        scaleCurrentRef.current.set(dot.id, 1)
      })

      dotPositionsRef.current = positions
      setDots(nextDots)
      wakeRef.current(true)
    }

    rebuildDots()
    window.addEventListener('resize', rebuildDots)

    return () => {
      isMounted = false
      window.removeEventListener('resize', rebuildDots)
    }
  }, [])

  useEffect(() => {
    const rotation = rotationRef.current
    const farRange = proximityDistance > 0 ? proximityDistance * 2 : 200
    let frameId = null
    let targetsDirty = false

    const updateScaleTargets = () => {
      const cursor = cursorRef.current
      if (!cursor.active) return

      dotPositionsRef.current.forEach((pos, id) => {
        const distance = Math.hypot(pos.x - cursor.x, pos.y - cursor.y)
        let targetScale

        if (distance <= proximityDistance) {
          const nearFactor = proximityDistance > 0 ? distance / proximityDistance : 0
          targetScale = 1 + scaleDelta * (1 - clamp(nearFactor, 0, 1))
        } else {
          const farFactor = clamp((distance - proximityDistance) / farRange, 0, 1)
          targetScale = 1 - scaleDelta * farFactor
        }

        scaleTargetsRef.current.set(id, clamp(targetScale, 1 - scaleDelta, 1 + scaleDelta))
      })
    }

    const animate = () => {
      if (targetsDirty) {
        updateScaleTargets()
        targetsDirty = false
      }

      rotation.x += (rotation.targetX - rotation.x) * reactionSpeed
      rotation.y += (rotation.targetY - rotation.y) * reactionSpeed
      let moving = Math.abs(rotation.targetX - rotation.x) > SETTLE_EPSILON ||
        Math.abs(rotation.targetY - rotation.y) > SETTLE_EPSILON

      dotElementsRef.current.forEach((element, id) => {
        const target = scaleTargetsRef.current.get(id) ?? 1
        const current = scaleCurrentRef.current.get(id) ?? 1
        if (Math.abs(target - current) <= SETTLE_EPSILON) return
        const next = current + (target - current) * reactionSpeed
        scaleCurrentRef.current.set(id, next)
        element.style.transform = `translate(-50%, -50%) scale(${next})`
        moving = true
      })

      if (containerRef.current) {
        containerRef.current.style.transform = `perspective(1300px) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`
      }

      // Sleep once everything has settled; input wakes the loop again
      frameId = moving ? requestAnimationFrame(animate) : null
    }

    const wake = (recomputeTargets = false) => {
      if (recomputeTargets) targetsDirty = true
      if (frameId == null) frameId = requestAnimationFrame(animate)
    }
    wakeRef.current = wake

    const handleWindowMouseMove = (event) => {
      const width = window.innerWidth
      const height = window.innerHeight
      const relativeX = clamp(width > 0 ? event.clientX / width : 0, 0, 1)
      const relativeY = clamp(height > 0 ? event.clientY / height : 0, 0, 1)

      cursorRef.current.x = event.clientX
      cursorRef.current.y = event.clientY
      cursorRef.current.active = true

      rotation.targetY = (relativeX - 0.5) * MAX_ROTATION_DEGREES * 2
      rotation.targetX = (0.5 - relativeY) * MAX_ROTATION_DEGREES * 2
      wake(true)
    }

    const resetTargets = () => {
      rotation.targetX = 0
      rotation.targetY = 0
      cursorRef.current.active = false
      scaleTargetsRef.current.forEach((_, id) => scaleTargetsRef.current.set(id, 1))
      wake()
    }

    // Flatten the grid when the pointer leaves the page (relatedTarget is null
    // only when leaving the window; window 'mouseleave' never fires)
    const handleMouseOut = (event) => {
      if (!event.relatedTarget) resetTargets()
    }

    window.addEventListener('mousemove', handleWindowMouseMove)
    document.addEventListener('mouseout', handleMouseOut)
    wake(true)

    return () => {
      if (frameId != null) cancelAnimationFrame(frameId)
      wakeRef.current = () => {}
      window.removeEventListener('mousemove', handleWindowMouseMove)
      document.removeEventListener('mouseout', handleMouseOut)
      if (containerRef.current) {
        containerRef.current.style.transform = ''
      }
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
      {dots.length > 0 ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 9999
          }}
        >
          {dots.map((dot) => (
            <div
              key={dot.id}
              ref={(el) => {
                if (el) {
                  dotElementsRef.current.set(dot.id, el)
                } else {
                  dotElementsRef.current.delete(dot.id)
                }
              }}
              style={{
                position: 'absolute',
                left: `${dot.x}px`,
                top: `${dot.y}px`,
                width: DOT_SIZE,
                height: DOT_SIZE,
                background: DOT_COLOR,
                borderRadius: '50%',
                transform: 'translate(-50%, -50%) scale(1)'
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
