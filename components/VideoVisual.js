import { useEffect, useRef, useState } from 'react'

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

export default function VideoVisual({ movementIntensity = 18 }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const targetRef = useRef({ x: 0, y: 0 })
  const currentRef = useRef({ x: 0, y: 0 })
  const frameRef = useRef(null)

  useEffect(() => {
    if (movementIntensity <= 0) {
      targetRef.current = { x: 0, y: 0 }
      currentRef.current = { x: 0, y: 0 }
      setOffset({ x: 0, y: 0 })
      return undefined
    }

    const handleMouseMove = (event) => {
      const width = window.innerWidth || 1
      const height = window.innerHeight || 1
      const relativeX = (event.clientX / width - 0.5) * 2
      const relativeY = (event.clientY / height - 0.5) * 2
      targetRef.current = {
        x: clamp(relativeX, -1, 1) * movementIntensity,
        y: clamp(relativeY, -1, 1) * movementIntensity
      }
    }

    const release = () => {
      targetRef.current = { x: 0, y: 0 }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseleave', release)
    window.addEventListener('mouseout', release)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseleave', release)
      window.removeEventListener('mouseout', release)
    }
  }, [movementIntensity])

  useEffect(() => {
    const animate = () => {
      const current = currentRef.current
      const target = targetRef.current
      current.x += (target.x - current.x) * 0.15
      current.y += (target.y - current.y) * 0.15
      setOffset({ x: current.x, y: current.y })
      frameRef.current = requestAnimationFrame(animate)
    }

    frameRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameRef.current)
  }, [])

  const transform = `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`

  return (
    <div className="video-visual" style={{ transform }}>
      <video
        playsInline
        autoPlay
        muted
        loop
        poster="/assets/video_visual_for_website_1.mp4"
        style={{ pointerEvents: 'none', opacity: 0.8 }}
      >
        <source src="/assets/video_visual_for_website_1.mp4" type="video/mp4" />
      </video>
    </div>
  )
}
