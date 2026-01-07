import { useEffect } from 'react'

// Generic inertia: elements react to scroll with a subtle inertia/momentum effect
// Applies to contact items and manifesto paragraphs by default.
export default function Inertia() {
  useEffect(() => {
    let mounted = true
    let touchStartY = 0

    try {
      const contactEls = Array.from(document.querySelectorAll('.contact-items .mini-text'))
      const paraEls = Array.from(document.querySelectorAll('.manifesto .manifesto-p'))
  const titleEls = Array.from(document.querySelectorAll('.title, .sub-title'))
  const showreelTextEls = Array.from(document.querySelectorAll('.overlay-close, .overlay-contents .mini-text'))
  // add menu buttons to react to scroll as well
  const buttonEls = Array.from(document.querySelectorAll('.menu-btn'))

  const allContact = contactEls
  const allPara = paraEls
  const allTitle = titleEls
  const allShowreel = showreelTextEls
  const allButtons = buttonEls

      // mark will-change once
  allContact.forEach((el) => { el.style.willChange = 'transform' })
  allPara.forEach((el) => { el.style.willChange = 'transform' })
  allTitle.forEach((el) => { el.style.willChange = 'transform' })
  allShowreel.forEach((el) => { el.style.willChange = 'transform' })
  allButtons.forEach((el) => { el.style.willChange = 'transform' })

      // tuning: set uniform max and factor (user will tweak later)
      const contactMax = 300
      const contactFactor = 1

      const paraMax = 300
      const paraFactor = 1

      const titleMax = 300
      const titleFactor = .5

      const showreelMax = 300
      const showreelFactor = 1

  // buttons should react subtly to scroll (smaller magnitude)
  const buttonMax = 120
  const buttonFactor = 0.45

  // All elements we animate (include buttons)
  const allEls = [...allContact, ...allPara, ...allTitle, ...allShowreel, ...allButtons]

      // per-element state
      allEls.forEach((el) => {
        el._currentY = 0
        el._targetY = 0
        el._lastActive = 0
      })

      // Coalescing vars for wheel/touch to avoid firing applyShift too many times
      let wheelPending = 0
      let wheelRaf = null
      let touchPending = 0
      let touchRaf = null

      const scheduleWheel = (delta) => {
        wheelPending += delta
        if (wheelRaf == null) {
          wheelRaf = requestAnimationFrame(() => {
            applyShift(wheelPending)
            wheelPending = 0
            wheelRaf = null
          })
        }
      }

      const scheduleTouch = (delta) => {
        touchPending += delta
        if (touchRaf == null) {
          touchRaf = requestAnimationFrame(() => {
            applyShift(touchPending)
            touchPending = 0
            touchRaf = null
          })
        }
      }

      const applyShift = (deltaY) => {
        const raw = -deltaY

        const c = Math.max(-contactMax, Math.min(contactMax, raw * contactFactor))
        allContact.forEach((el) => { el._targetY = c; el._lastActive = performance.now() })

        const p = Math.max(-paraMax, Math.min(paraMax, raw * paraFactor))
        allPara.forEach((el) => { el._targetY = p; el._lastActive = performance.now() })

  const t = Math.max(-titleMax, Math.min(titleMax, raw * titleFactor))
  allTitle.forEach((el) => { el._targetY = t; el._lastActive = performance.now() })

  const s = Math.max(-showreelMax, Math.min(showreelMax, raw * showreelFactor))
  allShowreel.forEach((el) => { el._targetY = s; el._lastActive = performance.now() })

  const b = Math.max(-buttonMax, Math.min(buttonMax, raw * buttonFactor))
  allButtons.forEach((el) => { el._targetY = b; el._lastActive = performance.now() })
      }

      // Physics integrator: spring + damping (velocity) per element.
      // This produces a more organic motion than a simple lerp.
      let rafLoop = null
      const IN_SPRING = 0.01 // spring stiffness when moving into a larger target
      const IN_FRICTION = 0.9 // damping when moving into a larger target
      const OUT_SPRING = 0.01 // spring stiffness when decaying back to zero
      const OUT_FRICTION = 0.9 // damping when decaying back to zero
      const INACTIVE_TO_ZERO_MS = 120 // ms of inactivity before nudging target to 0
      const ZERO_THRESHOLD = 0.05 // px threshold under which we snap to 0

      let prevTime = performance.now()
      const loop = (now) => {
        rafLoop = requestAnimationFrame(loop)
        const elapsed = Math.min(64, now - prevTime)
        const dt = elapsed / 16.6667 // ~1 at 60fps
        prevTime = now

        for (let i = 0; i < allEls.length; i++) {
          const el = allEls[i]
          // if not recently updated, nudge its target to 0 so it decays
          if (now - (el._lastActive || 0) > INACTIVE_TO_ZERO_MS) el._targetY = 0

          const cur = el._currentY || 0
          const tgt = el._targetY || 0

          // pick physics params based on whether element is moving into a
          // larger target (enter) or decaying back (exit)
          const entering = Math.abs(tgt) > Math.abs(cur)
          const spring = entering ? IN_SPRING : OUT_SPRING
          const friction = entering ? IN_FRICTION : OUT_FRICTION

          // integrate velocity: v += (target - pos) * spring * dt; v *= friction^dt; pos += v * dt
          el._velY = (el._velY || 0) + (tgt - cur) * spring * dt
          el._velY *= Math.pow(friction, dt)
          const next = cur + el._velY * dt

          el._currentY = Math.abs(next) < ZERO_THRESHOLD && Math.abs(el._velY) < 0.01 ? 0 : next

          // apply transform only when needed
          if (el._currentY === 0) {
            if (el._hasTransform) {
              el.style.transform = ''
              el._hasTransform = false
            }
          } else {
            el.style.transform = `translate3d(0, ${el._currentY}px, 0)`
            el._hasTransform = true
          }
        }
      }

      // start loop
      rafLoop = requestAnimationFrame(loop)

      // Wheel handler (user scroll)
      const onWheel = (e) => { scheduleWheel(e.deltaY) }

      // Touch handlers
      const onTouchStart = (e) => { touchStartY = e.touches ? e.touches[0].clientY : e.clientY }
      const onTouchMove = (e) => {
        const y = e.touches ? e.touches[0].clientY : e.clientY
        const delta = touchStartY - y
        touchStartY = y
        scheduleTouch(delta)
      }

      // Scroll handler (programmatic scrolls & ScrollTrigger scrubs) — already rAF coalesced
      let lastScrollY = window.scrollY || 0
      let pendingScrollY = lastScrollY
      let rafId = null
      const onScroll = () => {
        pendingScrollY = window.scrollY || 0
        if (rafId == null) {
          rafId = requestAnimationFrame(() => {
            const delta = pendingScrollY - lastScrollY
            lastScrollY = pendingScrollY
            rafId = null
            if (delta !== 0) applyShift(delta)
          })
        }
      }

      window.addEventListener('wheel', onWheel, { passive: true })
      window.addEventListener('touchstart', onTouchStart, { passive: true })
      window.addEventListener('touchmove', onTouchMove, { passive: true })
      window.addEventListener('scroll', onScroll, { passive: true })

      // cleanup
      return () => {
        allEls.forEach((el) => {
          el.style.willChange = ''
          el.style.transform = ''
          delete el._currentY
          delete el._targetY
          delete el._lastActive
          delete el._hasTransform
        })
        window.removeEventListener('wheel', onWheel)
        window.removeEventListener('touchstart', onTouchStart)
        window.removeEventListener('touchmove', onTouchMove)
        window.removeEventListener('scroll', onScroll)
        if (rafId != null) cancelAnimationFrame(rafId)
        if (wheelRaf != null) cancelAnimationFrame(wheelRaf)
        if (touchRaf != null) cancelAnimationFrame(touchRaf)
        if (rafLoop != null) cancelAnimationFrame(rafLoop)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Inertia] init failed', err)
    }
    return () => { mounted = false }
  }, [])

  return null
}
