import { useEffect, useRef, useState } from 'react'

// Longest the preloader may hold the page, whatever is still loading.
// The background video fades in on its own once it has a frame (VideoVisual).
const MAX_WAIT_MS = 3500
// Counter value reached at MAX_WAIT_MS; it jumps to 100 when loading finishes
const PROGRESS_CEILING = 95

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

  // Track background video readiness
  useEffect(() => {
    const handleVideoReady = () => setVideoReady(true)
    window.addEventListener('videoCanPlay', handleVideoReady, { once: true })
    return () => window.removeEventListener('videoCanPlay', handleVideoReady)
  }, [])

  // Overall time limit (covers both window.load and the video)
  useEffect(() => {
    const cap = setTimeout(() => setIsLoaded(true), MAX_WAIT_MS)
    return () => clearTimeout(cap)
  }, [])

  // Mark as fully loaded only when both signals are received
  useEffect(() => {
    if (windowLoaded && videoReady) setIsLoaded(true)
  }, [windowLoaded, videoReady])

  // Time-based progress: eases toward PROGRESS_CEILING over MAX_WAIT_MS, then jumps
  // to 100 once loaded. Written straight to the DOM so React doesn't re-render every frame.
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

    const start = performance.now()
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / MAX_WAIT_MS)
      progressRef.current = PROGRESS_CEILING * (1 - (1 - t) * (1 - t))
      write()
      rafId = t < 1 ? requestAnimationFrame(step) : null
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
