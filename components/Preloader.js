import { useEffect, useRef, useState } from 'react'

export default function Preloader() {
  const progressRef = useRef(0)
  const labelRef = useRef(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isExiting, setIsExiting] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  const [windowLoaded, setWindowLoaded] = useState(false)
  const [videoReady, setVideoReady] = useState(false)

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    if (isVisible) {
      document.documentElement.classList.add('preloader-active')
    } else {
      document.documentElement.classList.remove('preloader-active')
    }
    return undefined
  }, [isVisible])

  // Track window.load
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (document.readyState === 'complete') {
      setWindowLoaded(true)
      return undefined
    }
    const handleLoad = () => setWindowLoaded(true)
    window.addEventListener('load', handleLoad, { once: true })
    return () => window.removeEventListener('load', handleLoad)
  }, [])

  // Track background video readiness, with an 8s safety fallback
  useEffect(() => {
    const handleVideoReady = () => setVideoReady(true)
    window.addEventListener('videoCanPlay', handleVideoReady, { once: true })
    const fallback = setTimeout(() => setVideoReady(true), 8000)
    return () => {
      window.removeEventListener('videoCanPlay', handleVideoReady)
      clearTimeout(fallback)
    }
  }, [])

  // Mark as fully loaded only when both signals are received
  useEffect(() => {
    if (windowLoaded && videoReady) setIsLoaded(true)
  }, [windowLoaded, videoReady])

  // Fake progress creeps toward 99 until loaded, then jumps to 100.
  // Written straight to the DOM so React doesn't re-render every frame.
  useEffect(() => {
    let rafId = null
    let shown = ''

    const write = () => {
      const next = `${Math.min(100, Math.round(progressRef.current))}`
      if (next !== shown && labelRef.current) {
        shown = next
        labelRef.current.textContent = next
      }
    }

    if (isLoaded) {
      progressRef.current = 100
      write()
      return undefined
    }

    const step = () => {
      const drift = 0.25 + Math.random() * 0.25
      progressRef.current = Math.min(99, progressRef.current + drift)
      write()
      rafId = requestAnimationFrame(step)
    }

    rafId = requestAnimationFrame(step)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [isLoaded])

  useEffect(() => {
    if (!isLoaded) return undefined

    const showExit = window.setTimeout(() => setIsExiting(true), 180)
    const hide = window.setTimeout(() => setIsVisible(false), 900)

    return () => {
      window.clearTimeout(showExit)
      window.clearTimeout(hide)
    }
  }, [isLoaded])

  if (!isVisible) return null

  return (
    <div className={`preloader-root ${isExiting ? 'preloader--done' : ''}`} aria-hidden>
      <div className="preloader-content">
        <div className="preloader-circle preloader-circle--large" />
        <div className="preloader-circle preloader-circle--medium" />
        <div className="preloader-circle preloader-circle--small" />
        <span className="preloader-text mini-text" aria-live="polite" ref={labelRef}>
          0
        </span>
      </div>
    </div>
  )
}
