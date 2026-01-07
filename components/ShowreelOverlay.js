import { useEffect, useRef } from 'react'

export default function ShowreelOverlay({ onClose }) {
  const ref = useRef(null)
  const videoRef = useRef(null)

  useEffect(() => {
    let ctx
    let gsap
    const animateIn = async () => {
      const { gsap } = await import('gsap')
      const ScrollToPlugin = (await import('gsap/dist/ScrollToPlugin')).default
      gsap.registerPlugin(ScrollToPlugin)

      // Check current scroll position
      const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0
      const needsScroll = currentScrollY > 100 // Only scroll if more than 100px down

      // Immediately set overlay to visible but transparent for smoother transition
      gsap.set(ref.current, { 
        opacity: 0, 
        visibility: 'visible',
        scale: 1,
        background: '#000' // Ensure solid black background 
      })

      // Create timeline for sequence
      const tl = gsap.timeline()

      // Only add scroll animation if needed
      if (needsScroll) {
        // Calculate dynamic duration based on scroll distance
        const scrollDistance = currentScrollY
        const dynamicDuration = Math.min(Math.max(scrollDistance / 1200, 0.3), 1.5)
        
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
      }), needsScroll ? undefined : 0) // Start immediately if no scroll

      // After overlay is visible, try to play video
      tl.add(() => {
        try { videoRef.current?.play?.() } catch (e) { /* autoplay may be blocked */ }
      })
    }

    animateIn()

    return () => {
      if (ctx && ctx.revert) ctx.revert()
    }
  }, [])

  const handleClose = async () => {
    const mod = await import('gsap')
    const gsap = mod.gsap || mod.default || mod
    gsap.to(ref.current, {
      duration: 0.45,
      opacity: 0,
      ease: 'power2.inOut',
      onComplete: () => {
        // Set visibility hidden after animation completes
        gsap.set(ref.current, { visibility: 'hidden' })
        // pause video
        try { videoRef.current?.pause?.() } catch (e) {}
        // notify other listeners (Menu) that the overlay closed so they can
        // update UI (e.g. unselect the Showreel button)
        try { window.dispatchEvent(new CustomEvent('closeShowreel')) } catch (err) {}
        if (typeof onClose === 'function') onClose()
      }
    })
  }

  return (
    <div ref={ref} className="showreel-overlay" role="dialog" aria-label="Showreel overlay">
      <div className="overlay-contents">
        <div className="overlay-video-wrap">
          <iframe 
            src="https://player.vimeo.com/video/1152240405?h=c373febd16&badge=0&autopause=0&player_id=0&app_id=58479&autoplay=1&loop=1&controls=1" 
            className="overlay-video" 
            frameBorder="0" 
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share" 
            referrerPolicy="strict-origin-when-cross-origin"
            title="Showreel 2025"
          />
          <button className="overlay-close mini-text" onClick={handleClose} aria-label="Close showreel">×</button>
        </div>
      </div>
    </div>
  )
}
