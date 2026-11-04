import { useEffect, useRef, useState } from 'react'
import { gsap } from '../lib/gsap'
import { track, addShowreelWatched } from '../lib/analytics'

// The player URL has dnt=1 ("do not track": Vimeo sets no tracking cookies and keeps no
// viewing session data); Vimeo is contacted only once the showreel is opened. See pages/privacy.js.
const VIMEO_ORIGIN = 'https://player.vimeo.com'
const PROGRESS_STEPS = [25, 50, 75, 95]

// Opening: page scrolls home, the overlay fades to black, THEN the video. The player loads at
// once but is not drawn (visibility hidden) and stays paused (autoplay=0); only when the overlay
// is fully black is it told to play, and it fades in once it really plays (before 6.8.6, opened
// from further down the page, it played over the scrolling page).
// Fades of the video are done with a black cover above it, never with opacity on the Vimeo frame
// or the overlay while the frame is drawn: browsers draw the cross-origin frame at full strength
// during such opacity animations (it showed over the page). See .overlay-video in globals.css.
// If the browser blocks playback (e.g. iOS), the player is shown anyway with Vimeo's play button.
const PLAY_RETRY_MS = 600 // ask again once if Vimeo has not started yet
// While it loads, the overlay shows the reel's own first frame (public/assets/showreel-first-frame.jpg,
// frame 0 of the original file: the dark rings) with the site's pulsing preloader rings on it. Vimeo
// itself shows its bright thumbnail (the taxfix shot) while buffering, so it stays hidden until its
// frames really run; then the still crossfades into the playing reel. (On Vimeo only frame 0 is the
// rings; from ~0.1 s the reel is on the taxfix phone shot - that cut is the reel itself. Note: the
// local file ../Showreel_1920x1080_2025_1.mp4 is a different edit; only its frame 0 matches Vimeo's.)
// Shown only once frames really run (timeupdate past FIRST_FRAME_S): Vimeo's 'play' event comes
// ~0.7 s earlier, while it still buffers behind that thumbnail + spinner (user report 6.8.7)
// Playback blocked (e.g. iOS): Vimeo answers the play request with an 'error' event
// (NotAllowedError) -> the player is shown at once with its play button. If Vimeo does not answer
// at all, show it after SHOW_ANYWAY_MS (1.5 s was too short: a slow start was taken for blocked)
const SHOW_ANYWAY_MS = 4000
const BUFFER_MAX_MS = 15000 // 'play' came but no frames yet (slow network): show the player after this
const FIRST_FRAME_S = 0.05 // playback time that counts as "frames are running"
const READY_FALLBACK_MS = 800 // iframe loaded but no 'ready' message: treat it as ready
const VIDEO_FADE_IN = 0.5 // s, the still (first frame) crossfading into the running video
// Close: video to black (cover), frame hidden, then the black overlay fades to the page
const CLOSE_VIDEO_OUT = 0.18 // s
const CLOSE_OVERLAY_OUT = 0.25 // s

// On <html>: LOCK stops the page behind from scrolling (wheel/keys inside the
// cross-origin Vimeo iframe would otherwise chain to it); OPEN hides the page chrome.
const LOCK_CLASS = 'showreel-scroll-lock'
const OPEN_CLASS = 'showreel-open'

export default function ShowreelOverlay({ onClose }) {
  const ref = useRef(null)
  const closeBtnRef = useRef(null)
  const closingRef = useRef(false)
  const iframeRef = useRef(null)
  const coverRef = useRef(null)
  const [videoScale, setVideoScale] = useState(100)
  const videoScaleRef = useRef(100)
  videoScaleRef.current = videoScale
  // Player control shared by the effects and the close handler (filled in the effect below)
  const playerRef = useRef({ overlayIn: () => {}, fadeOut: () => {}, isShown: () => false })

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
    let playAccepted = false // Vimeo's 'play' event: it will play, may still be buffering
    let shown = false
    let closing = false
    let volume = 1 // the player's current volume (the visitor may change it); not remembered by Vimeo
    const timers = []
    const later = (fn, ms) => timers.push(setTimeout(fn, ms))
    const show = (autoplay, why) => {
      if (shown || closing) return
      shown = true
      // Readable in the element inspector (also on phones): why and when the video was shown
      if (iframeRef.current) {
        iframeRef.current.dataset.shown = `${why}@${Math.round(performance.now() - (requestedAt || openedAt))}ms`
      }
      // Draw the frame under the (still black) cover, then fade the cover away
      if (iframeRef.current) iframeRef.current.classList.add('is-shown')
      if (coverRef.current) {
        gsap.to(coverRef.current, { opacity: 0, duration: VIDEO_FADE_IN, ease: 'power1.inOut', delay: 0.05 })
      }
      track('showreel_start', {
        autoplay, // false = the browser blocked playback, Vimeo's play button is shown
        wait_ms: Math.round(performance.now() - openedAt),
      })
    }
    const start = () => {
      if (!ready || !overlayIn || requestedAt != null || closing) return
      requestedAt = performance.now()
      post({ method: 'play' })
      later(() => { if (!shown && !playAccepted) post({ method: 'play' }) }, PLAY_RETRY_MS)
      later(() => { if (!playAccepted) show(false, 'no-answer') }, SHOW_ANYWAY_MS)
      later(() => show(true, 'buffer-timeout'), BUFFER_MAX_MS)
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
    playerRef.current.isShown = () => shown
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
        playAccepted = true // not shown yet: frames may still be buffering
        return
      }
      if (data.event === 'error') {
        // our play request was refused (autoplay blocked): show Vimeo's own play button now
        const err = data.data || {}
        // (Vimeo may send 'play' first and the refusal after it, so don't require !playAccepted)
        if (requestedAt != null && (err.method === 'play' || err.name === 'NotAllowedError')) {
          show(false, 'blocked')
        }
        return
      }
      // Vimeo answers with the old name 'playProgress' (tested 2026-11); accept both
      if ((data.event === 'timeupdate' || data.event === 'playProgress') && data.data) {
        const { seconds, percent } = data.data
        // frames really running -> fade the video in (only after we asked: autoplay is off)
        if (requestedAt != null && seconds > FIRST_FRAME_S) show(true, 'frames')
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
    const videoOn = playerRef.current.isShown()
    // Sound fades over the whole close (or, if nothing plays yet, the start is cancelled)
    playerRef.current.fadeOut(videoOn ? CLOSE_VIDEO_OUT + CLOSE_OVERLAY_OUT : 0)
    // cancel a still-running fade-in (e.g. Esc pressed early)
    gsap.killTweensOf(ref.current, 'opacity')
    const tl = gsap.timeline()
    if (videoOn && coverRef.current) {
      // 1. video to black under our cover (plain black now: no still, no rings), then stop
      //    drawing the frame
      gsap.killTweensOf(coverRef.current)
      coverRef.current.classList.add('is-closing')
      tl.to(coverRef.current, { opacity: 1, duration: CLOSE_VIDEO_OUT, ease: 'power1.in' })
      tl.add(() => { if (iframeRef.current) iframeRef.current.classList.remove('is-shown') })
    }
    // 2. the black overlay fades to the page: starts at once, eases into the page
    tl.to(ref.current, {
      duration: CLOSE_OVERLAY_OUT,
      opacity: 0,
      ease: 'power2.out',
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
            }}
          />
          {/* The reel's first frame + the site's preloader rings while Vimeo loads */}
          <div ref={coverRef} className="overlay-video-cover" aria-hidden>
            <div className="preloader-content overlay-loading">
              <div className="preloader-circle preloader-circle--large" />
              <div className="preloader-circle preloader-circle--medium" />
              <div className="preloader-circle preloader-circle--small" />
            </div>
          </div>
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
