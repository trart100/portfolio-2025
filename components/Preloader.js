import { useEffect, useState } from 'react'

export default function Preloader({ debugLoadTime = 0 }) {
  const [progress, setProgress] = useState(0)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isExiting, setIsExiting] = useState(false)
  const [isVisible, setIsVisible] = useState(true)

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

  useEffect(() => {
    if (debugLoadTime > 0) {
      const timer = setTimeout(() => setIsLoaded(true), debugLoadTime)
      return () => clearTimeout(timer)
    }

    if (typeof window === 'undefined') return undefined

    if (document.readyState === 'complete') {
      setIsLoaded(true)
      return undefined
    }

    const handleLoad = () => setIsLoaded(true)
    window.addEventListener('load', handleLoad, { once: true })
    return () => window.removeEventListener('load', handleLoad)
  }, [debugLoadTime])

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
