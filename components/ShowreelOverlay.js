import { useEffect, useRef, useState } from 'react'
import { gsap } from '../lib/gsap'
import { track, addShowreelWatched } from '../lib/analytics'

// The player URL has dnt=1 ("do not track": Vimeo sets no tracking cookies and keeps no
// viewing session data); Vimeo is contacted only once the showreel is opened. See pages/privacy.js.
const VIMEO_ORIGIN = 'https://player.vimeo.com'
const PROGRESS_STEPS = [25, 50, 75, 95]

// Opening: the player loads at once but stays invisible and paused (autoplay=0). Only when
// the overlay is fully black is it told to play, and it fades in once it really plays, so the
// sound never starts over the page and the reel is seen from its first frame (before 6.8.6,
// opened from further down the page, it started ~0.5 s before the overlay was in).
// If the browser blocks playback (e.g. iOS), the player is shown anyway with Vimeo's play button.
const PLAY_RETRY_MS = 600 // ask again once if Vimeo has not started yet
const SHOW_ANYWAY_MS = 1500 // after asking to play: show the player even if it did not start
const READY_FALLBACK_MS = 800 // iframe loaded but no 'ready' message: treat it as ready
const VIDEO_FADE_IN = 0.5 // s, video fading in from black
const CLOSE_FADE = 0.3 // s, overlay and sound fading out on close

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
  // Player control shared by the effects and the close handler (filled in the effect below)
  const playerRef = useRef({ overlayIn: () => {}, fadeOut: () => {} })

  // The Vimeo player (postMessage API, no extra script): start / show it once the overlay is
  // in, fade its sound on close; statistics: open, how far the reel was watched, and on close
  // the time open, seconds watched, furthest point, zoom
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

    // --- start once both the player is ready and the overlay is fully in, then show it
    let ready = false
    let overlayIn = false
    let requestedAt = null
    let shown = false
    let closing = false
    let volume = 1 // the player's current volume (the visitor may change it); not remembered by Vimeo
    const timers = []
    const later = (fn, ms) => timers.push(setTimeout(fn, ms))
    const show = (autoplay) => {
      if (shown || closing) return
      shown = true
      if (iframeRef.current) iframeRef.current.classList.add('is-shown')
      track('showreel_start', {
        autoplay, // false = the browser blocked playback, Vimeo's play button is shown
        wait_ms: Math.round(performance.now() - openedAt),
      })
    }
    const start = () => {
      if (!ready || !overlayIn || requestedAt != null || closing) return
      requestedAt = performance.now()
      post({ method: 'play' })
      later(() => { if (!shown) post({ method: 'play' }) }, PLAY_RETRY_MS)
      later(() => show(false), SHOW_ANYWAY_MS)
    }
    const markReady = () => {
      if (ready) return
      ready = true
      subscribe()
      start()
    }
    playerRef.current.overlayIn = () => {
      overlayIn = true
      start()
    }
    // Sound down with the visual fade, then pause (the overlay unmounts right after)
    playerRef.current.fadeOut = (seconds) => {
      closing = true
      timers.forEach(clearTimeout)
      if (!shown) {
        post({ method: 'pause' }) // not shown yet: make sure a just-requested start stays silent
        return
      }
      const level = { v: volume } // from where the visitor left it, never louder
      gsap.to(level, {
        v: 0,
        duration: seconds,
        ease: 'power1.out',
        onUpdate: () => post({ method: 'setVolume', value: Math.round(level.v * 100) / 100 }),
        onComplete: () => post({ method: 'pause' }),
      })
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
        markReady()
        return
      }
      if (data.event === 'volumechange') {
        // ignore our own fade-out steps
        if (!closing && data.data && typeof data.data.volume === 'number') volume = data.data.volume
        return
      }
      if (data.event === 'play') {
        if (requestedAt != null) show(true)
        return
      }
      // Vimeo answers with the old name 'playProgress' (tested 2026-11); accept both
      if ((data.event === 'timeupdate' || data.event === 'playProgress') && data.data) {
        // playing for real -> fade the video in (only after we asked: autoplay is off)
        if (requestedAt != null) show(true)
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
    // A double subscription is harmless: repeated times give step 0 and are not counted
    const subscribe = () => {
      post({ method: 'addEventListener', value: 'play' })
      post({ method: 'addEventListener', value: 'timeupdate' })
      post({ method: 'addEventListener', value: 'volumechange' })
    }
    // 'ready' normally arrives ~0.1 s after the iframe loads; if it ever does not, go on anyway
    const onLoad = () => later(markReady, READY_FALLBACK_MS)
    const iframe = iframeRef.current
    window.addEventListener('message', onMessage)
    if (iframe) iframe.addEventListener('load', onLoad)

    return () => {
      closing = true
      timers.forEach(clearTimeout)
      window.removeEventListener('message', onMessage)
      if (iframe) iframe.removeEventListener('load', onLoad)
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
        // Fully black now: the video may start (it fades in once it plays)
        playerRef.current.overlayIn()
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
    // Unlock while the overlay still covers the page (the scrollbar comes back unseen)
    document.documentElement.classList.remove(OPEN_CLASS, LOCK_CLASS)
    playerRef.current.fadeOut(CLOSE_FADE)
    // Quick fade: starts at once, eases into the page
    gsap.to(ref.current, {
      duration: CLOSE_FADE,
      opacity: 0,
      ease: 'power2.out',
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
            src="https://player.vimeo.com/video/1217380292?h=0f4dff3f1b&badge=0&autopause=0&player_id=0&app_id=58479&autoplay=0&loop=1&controls=1&dnt=1"
            className="overlay-video"
            frameBorder="0"
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share" 
            referrerPolicy="strict-origin-when-cross-origin"
            title="Showreel 2025"
            style={{
              transform: `scale(${videoScale / 100})`,
              transformOrigin: 'center center',
              transitionDuration: `${VIDEO_FADE_IN}s`,
            }}
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
