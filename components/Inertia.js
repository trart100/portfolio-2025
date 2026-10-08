import { useEffect } from 'react'

// Elements nudged by scroll momentum (tunable values live in INERTIA_DEFAULTS)
export const INERTIA_GROUPS = [
  { key: 'contact', label: 'Contact lines', selector: '.contact-items .mini-text' },
  { key: 'manifesto', label: 'Manifesto', selector: '.manifesto .manifesto-p' },
  { key: 'title', label: 'Title', selector: '.title' },
  { key: 'skills', label: 'Skills line', selector: '.animated-information' },
  { key: 'menu', label: 'Menu buttons', selector: '.menu-btn' }
]

// spring = stiffness toward the target; friction = share of velocity kept per frame
// (higher = floatier, more overshoot); "in" = pushed by scroll, "out" = returning to rest.
// Per group: factor = share of the scroll delta, max = clamp in px.
export const INERTIA_DEFAULTS = {
  inSpring: 0.01,
  inFriction: 0.9,
  outSpring: 0.01,
  outFriction: 0.9,
  idleMs: 120, // ms without scroll input before elements start returning
  contact: { factor: 1, max: 300 },
  manifesto: { factor: 1, max: 300 },
  title: { factor: 0.5, max: 300 },
  // between title and manifesto so the two hero lines separate slightly
  skills: { factor: 0.75, max: 300 },
  // buttons react subtly (smaller magnitude)
  menu: { factor: 0.45, max: 120 }
}

// Live values, read every frame (the ?tune panel in InertiaTuner edits them)
export const inertiaParams = JSON.parse(JSON.stringify(INERTIA_DEFAULTS))

// Generic inertia: elements react to scroll with a subtle inertia/momentum effect
export default function Inertia() {
  useEffect(() => {
    let touchStartY = 0

    try {
      const groups = INERTIA_GROUPS.map((g) => ({ ...g, els: Array.from(document.querySelectorAll(g.selector)) }))
      const allEls = groups.flatMap((g) => g.els)

      // per-element state
      allEls.forEach((el) => {
        el.style.willChange = 'transform'
        el._currentY = 0
        el._targetY = 0
        el._lastActive = 0
      })

      const applyShift = (deltaY) => {
        const raw = -deltaY
        const now = performance.now()
        groups.forEach(({ key, els }) => {
          const { max, factor } = inertiaParams[key]
          const shift = Math.max(-max, Math.min(max, raw * factor))
          els.forEach((el) => { el._targetY = shift; el._lastActive = now })
        })
        wakeLoop()
      }

      // Coalesce wheel/touch deltas into one applyShift per frame
      let pendingDelta = 0
      let inputRaf = null
      const scheduleShift = (delta) => {
        pendingDelta += delta
        if (inputRaf == null) {
          inputRaf = requestAnimationFrame(() => {
            applyShift(pendingDelta)
            pendingDelta = 0
            inputRaf = null
          })
        }
      }

      // Physics integrator: spring + damping (velocity) per element.
      // This produces a more organic motion than a simple lerp.
      let rafLoop = null
      const ZERO_THRESHOLD = 0.05 // px threshold under which we snap to 0

      let prevTime = performance.now()
      const loop = (now) => {
        const elapsed = Math.min(64, now - prevTime)
        const dt = elapsed / 16.6667 // ~1 at 60fps
        prevTime = now
        let active = false
        const p = inertiaParams

        for (let i = 0; i < allEls.length; i++) {
          const el = allEls[i]
          // if not recently updated, nudge its target to 0 so it decays
          if (now - (el._lastActive || 0) > p.idleMs) el._targetY = 0

          const cur = el._currentY || 0
          const tgt = el._targetY || 0

          // pick physics params based on whether element is moving into a
          // larger target (enter) or decaying back (exit)
          const entering = Math.abs(tgt) > Math.abs(cur)
          const spring = entering ? p.inSpring : p.outSpring
          const friction = entering ? p.inFriction : p.outFriction

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

          if (el._currentY !== 0 || el._targetY !== 0) active = true
          else el._velY = 0
        }

        // Sleep once every element is back at rest; input wakes the loop again
        rafLoop = active ? requestAnimationFrame(loop) : null
      }

      const wakeLoop = () => {
        if (rafLoop == null) {
          prevTime = performance.now()
          rafLoop = requestAnimationFrame(loop)
        }
      }

      // Wheel handler (user scroll)
      const onWheel = (e) => { scheduleShift(e.deltaY) }

      // Touch handlers
      const onTouchStart = (e) => { touchStartY = e.touches ? e.touches[0].clientY : e.clientY }
      const onTouchMove = (e) => {
        const y = e.touches ? e.touches[0].clientY : e.clientY
        const delta = touchStartY - y
        touchStartY = y
        scheduleShift(delta)
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
        if (inputRaf != null) cancelAnimationFrame(inputRaf)
        if (rafLoop != null) cancelAnimationFrame(rafLoop)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Inertia] init failed', err)
    }
  }, [])

  return null
}
