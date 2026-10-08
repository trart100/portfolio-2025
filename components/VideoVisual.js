import { useEffect, useRef } from 'react'

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
const LERP = 0.15
const SETTLE_PX = 0.01

const toTransform = (x, y) => `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`

export default function VideoVisual({ movementIntensity = 18 }) {
  const wrapRef = useRef(null)
  const videoRef = useRef(null)

  // Parallax: ease the video toward an offset based on the mouse position.
  // Written straight to the DOM (no React re-render) and the loop sleeps when settled.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || movementIntensity <= 0) return undefined

    const target = { x: 0, y: 0 }
    const current = { x: 0, y: 0 }
    let frameId = null

    const animate = () => {
      current.x += (target.x - current.x) * LERP
      current.y += (target.y - current.y) * LERP
      const settled = Math.abs(target.x - current.x) < SETTLE_PX && Math.abs(target.y - current.y) < SETTLE_PX
      if (settled) {
        current.x = target.x
        current.y = target.y
      }
      el.style.transform = toTransform(current.x, current.y)
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

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseleave', release)
    window.addEventListener('mouseout', release)

    return () => {
      if (frameId != null) cancelAnimationFrame(frameId)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseleave', release)
      window.removeEventListener('mouseout', release)
    }
  }, [movementIntensity])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    const handleCanPlay = () => {
      window.dispatchEvent(new CustomEvent('videoCanPlay'))
    }

    // Video may already be ready (readyState HAVE_FUTURE_DATA or higher)
    if (video.readyState >= 3) {
      handleCanPlay()
      return undefined
    }

    video.addEventListener('canplay', handleCanPlay, { once: true })
    return () => video.removeEventListener('canplay', handleCanPlay)
  }, [])

  return (
    <div ref={wrapRef} className="video-visual" style={{ transform: toTransform(0, 0) }}>
      <video
        ref={videoRef}
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
