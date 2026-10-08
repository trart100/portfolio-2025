import { useEffect, useRef, useState } from 'react'
import { gsap } from '../lib/gsap'

// On <html>: LOCK stops the page behind from scrolling (wheel/keys inside the
// cross-origin Vimeo iframe would otherwise chain to it); OPEN hides the page chrome.
const LOCK_CLASS = 'showreel-scroll-lock'
const OPEN_CLASS = 'showreel-open'

export default function ShowreelOverlay({ onClose }) {
  const ref = useRef(null)
  const closeBtnRef = useRef(null)
  const closingRef = useRef(false)
  const [videoScale, setVideoScale] = useState(100)

  useEffect(() => {
    // Reset scale on window resize
    const handleResize = () => {
      setVideoScale(100)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const currentScrollY = window.scrollY || root.scrollTop || 0
    const needsScroll = currentScrollY > 100 // Only scroll if more than 100px down

    // Immediately set overlay to visible but transparent for smoother transition
    gsap.set(ref.current, {
      opacity: 0,
      visibility: 'visible',
      scale: 1,
      background: '#000'
    })

    // Once the overlay fully covers the page: lock scrolling and hide cursor/FPS/privacy
    // (any layout shift from the scrollbar disappearing happens unseen), then move focus
    // to the close button so Esc works and keyboard users land in the dialog
    const tl = gsap.timeline({
      onComplete: () => {
        if (closingRef.current) return
        root.classList.add(LOCK_CLASS, OPEN_CLASS)
        if (closeBtnRef.current) closeBtnRef.current.focus({ preventScroll: true })
      }
    })

    if (needsScroll) {
      // Scroll back to top first; duration scales with distance
      const dynamicDuration = Math.min(Math.max(currentScrollY / 1200, 0.3), 1.5)
      tl.add(gsap.to(window, {
        duration: dynamicDuration,
        scrollTo: { y: 0, autoKill: false },
        ease: 'power2.inOut'
      }))
    }

    // Then fade in overlay (immediate if no scroll needed)
    tl.add(gsap.to(ref.current, {
      duration: 0.6,
      opacity: 1,
      ease: 'power2.out'
    }), needsScroll ? undefined : 0)

    return () => {
      tl.kill()
      document.documentElement.classList.remove(OPEN_CLASS, LOCK_CLASS)
    }
  }, [])

  const handleClose = () => {
    if (closingRef.current) return
    closingRef.current = true
    document.documentElement.classList.remove(OPEN_CLASS, LOCK_CLASS)
    gsap.to(ref.current, {
      duration: 0.45,
      opacity: 0,
      ease: 'power2.inOut',
      overwrite: 'auto', // cancels a still-running fade-in (e.g. Esc pressed early)
      onComplete: () => {
        gsap.set(ref.current, { visibility: 'hidden' })
        // notify other listeners (Menu) so they can unselect the Showreel button
        window.dispatchEvent(new CustomEvent('closeShowreel'))
        if (typeof onClose === 'function') onClose()
      }
    })
  }

  // Esc closes (when focus is in the page; inside the player Esc belongs to Vimeo).
  // touchmove is blocked as a backup scroll lock for mobile browsers.
  const handleCloseRef = useRef(handleClose)
  handleCloseRef.current = handleClose
  useEffect(() => {
    const el = ref.current
    const blockTouchScroll = (e) => e.preventDefault()
    const onKeyDown = (e) => {
      if (e.key === 'Escape') handleCloseRef.current()
    }

    el.addEventListener('touchmove', blockTouchScroll, { passive: false })
    window.addEventListener('keydown', onKeyDown)

    return () => {
      el.removeEventListener('touchmove', blockTouchScroll)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const handleZoomIn = () => {
    setVideoScale(prev => Math.min(200, prev + 50))
  }

  const handleZoomOut = () => {
    setVideoScale(prev => Math.max(100, prev - 50))
  }

  return (
    <div ref={ref} className="showreel-overlay" role="dialog" aria-label="Showreel overlay">
      <div className="overlay-contents">
        <div className="overlay-video-wrap">
          <iframe
            src="https://player.vimeo.com/video/1217380292?h=0f4dff3f1b&badge=0&autopause=0&player_id=0&app_id=58479&autoplay=1&loop=1&controls=1"
            className="overlay-video"
            frameBorder="0"
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share" 
            referrerPolicy="strict-origin-when-cross-origin"
            title="Showreel 2025"
            style={{ transform: `scale(${videoScale / 100})`, transformOrigin: 'center center' }}
          />
          <button ref={closeBtnRef} className="overlay-close mini-text" onClick={handleClose} aria-label="Close showreel">×</button>
          <div className="video-zoom-controls">
            <button className="video-zoom-btn" onClick={handleZoomOut} aria-label="Zoom out">−</button>
            <button className="video-zoom-btn" onClick={handleZoomIn} aria-label="Zoom in">+</button>
          </div>
        </div>
      </div>
    </div>
  )
}
