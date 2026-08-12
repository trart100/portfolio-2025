import { useEffect, useState } from 'react'

export default function Preloader({ debugLoadTime = 0 }) {
  const [progress, setProgress] = useState(0)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isExiting, setIsExiting] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  const [windowLoaded, setWindowLoaded] = useState(false)
  const [videoReady, setVideoReady] = useState(false)

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    document.documentElement.classList.add('preloader-active')
    return undefined
  }, [])

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

  // Debug override: bypass both checks after the specified delay
  useEffect(() => {
    if (debugLoadTime <= 0) return undefined
    const timer = setTimeout(() => {
      setWindowLoaded(true)
      setVideoReady(true)
    }, debugLoadTime)
    return () => clearTimeout(timer)
  }, [debugLoadTime])

  // Mark as fully loaded only when both signals are received
  useEffect(() => {
    if (windowLoaded && videoReady) setIsLoaded(true)
  }, [windowLoaded, videoReady])

  useEffect(() => {
    let rafId
    const step = () => {
      setProgress((prev) => {
        if (isLoaded) return 100
        const drift = 0.25 + Math.random() * 0.25
        return Math.min(99, prev + drift)
      })
      rafId = requestAnimationFrame(step)
    }

    rafId = requestAnimationFrame(step)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [isLoaded])

  useEffect(() => {
    if (!isLoaded) return undefined

    setProgress(100)
    const showExit = window.setTimeout(() => setIsExiting(true), 180)
    const hide = window.setTimeout(() => setIsVisible(false), 900)

    return () => {
      window.clearTimeout(showExit)
      window.clearTimeout(hide)
    }
  }, [isLoaded])

  if (!isVisible) return null

  const progressLabel = `${Math.min(100, Math.round(progress))}`

  return (
    <div className={`preloader-root ${isExiting ? 'preloader--done' : ''}`} aria-hidden>
      <div className="preloader-content">
        <div className="preloader-circle preloader-circle--large" />
        <div className="preloader-circle preloader-circle--medium" />
        <div className="preloader-circle preloader-circle--small" />
        <span className="preloader-text mini-text" aria-live="polite">
          {progressLabel}
        </span>
      </div>
    </div>
  )
}
