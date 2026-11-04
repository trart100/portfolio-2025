import { useEffect, useRef, useState } from 'react'
import { gsap } from '../lib/gsap'
import { track, addShowreelWatched } from '../lib/analytics'

const VIMEO_ORIGIN = 'https://player.vimeo.com'
const PROGRESS_STEPS = [25, 50, 75, 95]

// On <html>: LOCK stops the page behind from scrolling (wheel/keys inside the
// cross-origin Vimeo iframe would otherwise chain to it); OPEN hides the page chrome.
const LOCK_CLASS = 'showreel-scroll-lock'
const OPEN_CLASS = 'showreel-open'

export default function ShowreelOverlay({ onClose }) {
  const ref = useRef(null)
  const closeBtnRef = useRef(null)
  const closingRef = useRef(false)
  const iframeRef = useRef(null)
  const [videoScale, setVideoScale] = useState(100)
  const videoScaleRef = useRef(100)
  videoScaleRef.current = videoScale

  // Statistics: open, how far the reel was watched (Vimeo's postMessage API, no extra script),
  // and on close: time open, seconds watched, furthest point, zoom
  useEffect(() => {
    const openedAt = performance.now()
    const steps = PROGRESS_STEPS.slice()
    let watched = 0
    let maxPercent = 0
    let lastSeconds = null
    track('showreel_open')

    const post = (msg) => {
      const win = iframeRef.current && iframeRef.current.contentWindow
      if (win) win.postMessage(JSON.stringify(msg), VIMEO_ORIGIN)
    }
    const onMessage = (e) => {
      if (e.origin !== VIMEO_ORIGIN) return
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      let data = e.data
      if (typeof data === 'string') {
        try { data = JSON.parse(data) } catch (err) { return }
      }
      if (!data || !data.event) return
      if (data.event === 'ready') {
        subscribe()
        return
      }
      // Vimeo answers with the old name 'playProgress' (tested 2026-11); accept both
      if ((data.event === 'timeupdate' || data.event === 'playProgress') && data.data) {
        const { seconds, percent } = data.data
        // count only normal playback (skips seeks and the loop's jump back to 0)
        if (lastSeconds != null) {
          const step = seconds - lastSeconds
          if (step > 0 && step < 1.5) watched += step
        }
        lastSeconds = seconds
        const p = Math.round(percent * 100)
        if (p > maxPercent) maxPercent = p
        while (steps.length && maxPercent >= steps[0]) {
          track('showreel_progress', { percent: steps.shift() })
        }
      }
    }
    // Subscribe on 'ready' and on iframe load ('ready' did not arrive in tests); a double
    // subscription is harmless: repeated times give step 0 and are not counted
    const subscribe = () => post({ method: 'addEventListener', value: 'timeupdate' })
    const iframe = iframeRef.current
    window.addEventListener('message', onMessage)
    if (iframe) iframe.addEventListener('load', subscribe)

    return () => {
      window.removeEventListener('message', onMessage)
      if (iframe) iframe.removeEventListener('load', subscribe)
      addShowreelWatched(watched)
      track('showreel_close', {
        open_s: Math.round((performance.now() - openedAt) / 1000),
        watched_s: Math.round(watched),
        max_percent: maxPercent,
        zoom: videoScaleRef.current,
      })
    }
  }, [])

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
    // Focus returns here (the Showreel button) when the overlay closes
    const opener = document.activeElement
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
      if (opener && opener !== document.body && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus({ preventScroll: true })
      }
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
    <div ref={ref} className="showreel-overlay" role="dialog" aria-modal="true" aria-label="Showreel overlay">
      <div className="overlay-contents">
        <div className="overlay-video-wrap">
          <iframe
            ref={iframeRef}
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
