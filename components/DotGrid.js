import React, { useCallback, useEffect, useRef, useState } from 'react'

const PAGE_MARGIN = 34
const BASE_HORIZONTAL_SPACING = 68
const BASE_VERTICAL_SPACING = 90
const DOT_SIZE = 5
const DOT_COLOR = '#ffffff'
const DEBUG_GRID = true
const DEBUG_DOT_COLOR = 'rgba(255, 255, 255, 0.2)'
const MAX_ROTATION_DEGREES = 2
const DEFAULT_REACTION_SPEED = 0.08
const DEFAULT_PROXIMITY_DISTANCE = 200
const DEFAULT_SCALE_DELTA = .7

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

function buildManualParticles(width, height, verticalScale = 1) {
  const availableWidth = Math.max(0, width - PAGE_MARGIN * 2)
  const availableHeight = Math.max(0, height - PAGE_MARGIN * 2)

  const horizontalIntervals = availableWidth > 0
    ? Math.max(1, Math.floor(availableWidth / BASE_HORIZONTAL_SPACING))
    : 1
  const verticalIntervals = availableHeight > 0
    ? Math.max(1, Math.floor(availableHeight / BASE_VERTICAL_SPACING))
    : 1
  const columnCount = horizontalIntervals + 1
  const rowCount = verticalIntervals + 1
  const horizontalSpacing = horizontalIntervals > 0 ? availableWidth / horizontalIntervals : 0
  const verticalSpacing = verticalIntervals > 0 ? availableHeight / verticalIntervals : 0
  const horizontalOffset = PAGE_MARGIN
  const verticalOffset = PAGE_MARGIN

  const particles = []

  for (let row = 0; row < rowCount; row++) {
    const y = verticalOffset + row * verticalSpacing
    for (let col = 0; col < columnCount; col++) {
      const x = horizontalOffset + col * horizontalSpacing
      const percentX = width > 0 ? (x / width) * 100 : 0
      const percentY = height > 0
        ? Math.min(100, Math.max(0, ((y / height) * 100 * verticalScale)))
        : 0
      particles.push({
        id: `dot-${row}-${col}`,
        position: {
          x: percentX,
          y: percentY,
          mode: 'percent'
        },
        pxPosition: { x, y },
        options: {
          size: { value: DOT_SIZE },
          color: { value: DOT_COLOR }
        }
      })
    }
  }

  if (DEBUG_GRID) {
    // Debug flag retained for future use, but logging removed per request.
  }

  return particles
}

export default function DotGrid({
  reactionSpeed = DEFAULT_REACTION_SPEED,
  proximityDistance = DEFAULT_PROXIMITY_DISTANCE,
  scaleDelta = DEFAULT_SCALE_DELTA
}) {
  const [manualParticles, setManualParticles] = useState([])
  const verticalScale = 1
  const containerRef = useRef(null)
  const rotationRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 })
  const dotElementsRef = useRef(new Map())
  const dotPositionsRef = useRef(new Map())
  const scaleTargetsRef = useRef(new Map())
  const scaleCurrentRef = useRef(new Map())
  const cursorRef = useRef({ x: 0, y: 0, active: false })

  const updateRotationTargets = useCallback((relativeX, relativeY) => {
    rotationRef.current.targetY = (relativeX - 0.5) * MAX_ROTATION_DEGREES * 2
    rotationRef.current.targetX = (0.5 - relativeY) * MAX_ROTATION_DEGREES * 2
  }, [])

  const resetTargets = useCallback(() => {
    rotationRef.current.targetX = 0
    rotationRef.current.targetY = 0
    cursorRef.current.active = false
    scaleTargetsRef.current.forEach((_, id) => scaleTargetsRef.current.set(id, 1))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let isMounted = true

    const rebuildParticles = () => {
      if (!isMounted) return
      const width = window.innerWidth
      const height = window.innerHeight
      const particles = buildManualParticles(width, height, verticalScale)
      const positions = new Map()

      scaleTargetsRef.current.clear()
      scaleCurrentRef.current.clear()

      particles.forEach((dot) => {
        positions.set(dot.id, dot.pxPosition)
        scaleTargetsRef.current.set(dot.id, 1)
        scaleCurrentRef.current.set(dot.id, 1)
      })

      dotPositionsRef.current = positions
      setManualParticles(particles)
    }

    rebuildParticles()
    window.addEventListener('resize', rebuildParticles)

    return () => {
      isMounted = false
      window.removeEventListener('resize', rebuildParticles)
    }
  }, [verticalScale])

  const updateScaleTargets = useCallback(() => {
    const cursor = cursorRef.current
    if (!cursor.active) return
    const positions = dotPositionsRef.current
    const farRange = proximityDistance > 0 ? proximityDistance * 2 : 200

    positions.forEach((pos, id) => {
      const distance = Math.hypot(pos.x - cursor.x, pos.y - cursor.y)
      let targetScale

      if (distance <= proximityDistance) {
        const nearFactor = proximityDistance > 0 ? distance / proximityDistance : 0
        targetScale = 1 + scaleDelta * (1 - clamp(nearFactor, 0, 1))
      } else {
        const farFactor = clamp((distance - proximityDistance) / farRange, 0, 1)
        targetScale = 1 - scaleDelta * farFactor
      }

      scaleTargetsRef.current.set(
        id,
        clamp(targetScale, 1 - scaleDelta, 1 + scaleDelta)
      )
    })
  }, [proximityDistance, scaleDelta])

  useEffect(() => {
    const handleWindowMouseMove = (event) => {
      const width = window.innerWidth
      const height = window.innerHeight
      const relativeX = width > 0 ? event.clientX / width : 0
      const relativeY = height > 0 ? event.clientY / height : 0

      cursorRef.current.x = event.clientX
      cursorRef.current.y = event.clientY
      cursorRef.current.active = true

      updateRotationTargets(clamp(relativeX, 0, 1), clamp(relativeY, 0, 1))
    }

    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseleave', resetTargets)

    let frameId

    const animate = () => {
      const rotation = rotationRef.current
      rotation.x += (rotation.targetX - rotation.x) * reactionSpeed
      rotation.y += (rotation.targetY - rotation.y) * reactionSpeed
      updateScaleTargets()

      dotElementsRef.current.forEach((element, id) => {
        const target = scaleTargetsRef.current.get(id) ?? 1
        const current = scaleCurrentRef.current.get(id) ?? 1
        const next = current + (target - current) * reactionSpeed
        scaleCurrentRef.current.set(id, next)
        element.style.transform = `translate(-50%, -50%) scale(${next})`
      })

      if (containerRef.current) {
        containerRef.current.style.transform = `perspective(1300px) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`
      }

      frameId = requestAnimationFrame(animate)
    }

    frameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseout', resetTargets)
      if (containerRef.current) {
        containerRef.current.style.transform = ''
      }
    }
  }, [reactionSpeed, resetTargets, updateRotationTargets, updateScaleTargets])

  return (
    <>
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
        {/* tsParticles container removed; manual grid now standalone */}
        {DEBUG_GRID && manualParticles.length > 0 ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 9999
            }}
          >
            {manualParticles.map((dot) => (
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
                  left: `${dot.pxPosition?.x || 0}px`,
                  top: `${dot.pxPosition?.y || 0}px`,
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  background: DEBUG_DOT_COLOR,
                  borderRadius: '50%',
                  transform: 'translate(-50%, -50%) scale(1)',
                  willChange: 'transform'
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
      {/* Vertical scale control removed per request */}
    </>
  )
}
