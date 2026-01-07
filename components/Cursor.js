import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

export default function Cursor({ attachPadding = 10 }) {
  const largeRef = useRef(null)
  const medRef = useRef(null)
  const smallRef = useRef(null)
  const plusRef = useRef(null)
  const dotRef = useRef(null)
  const rootRef = useRef(null)

  // avoid accessing `window` during SSR — initialize to zeros and populate on mount
  const target = useRef({ x: 0, y: 0 })
  // positions: large (lx,ly), med (mx,my), small (sx,sy)
  const pos = useRef({ lx: 0, ly: 0, mx: 0, my: 0, sx: 0, sy: 0 })
  const attached = useRef({ is: false, x: 0, y: 0, size: 0, scale: 1 })
  const rafId = useRef(null)

  useEffect(() => {
    const largeEl = largeRef.current
    const medEl = medRef.current
    const smallEl = smallRef.current
    const plusEl = plusRef.current
    const dotEl = dotRef.current
    if (!largeEl || !medEl || !smallEl) return

    // set initial target/positions to the center of the viewport (safe: running in browser)
    try {
      target.current.x = window.innerWidth / 2
      target.current.y = window.innerHeight / 2
    } catch (e) {
      target.current.x = 0
      target.current.y = 0
    }
    pos.current.mx = target.current.x
    pos.current.my = target.current.y
    pos.current.sx = target.current.x
    pos.current.sy = target.current.y
  pos.current.lx = target.current.x
  pos.current.ly = target.current.y

    // Sizing authority: CSS variables control base sizes. JS only positions
    // the rings per-frame. When attaching to an element we temporarily set
    // inline CSS vars on the `.cursor` root (see makeEnter/makeLeave) so CSS
    // computes med/small from the active --cursor-large value.

  const onMove = (e) => {
      // update raw cursor target (the loop will drive all rings toward this)
      target.current.x = e.clientX
      target.current.y = e.clientY

      // plus sign should always follow the mouse (even while rings are attached)
      if (plusEl) {
        plusEl.style.left = `${e.clientX}px`
        plusEl.style.top = `${e.clientY}px`
      }
      if (dotEl) {
        dotEl.style.left = `${e.clientX}px`
        dotEl.style.top = `${e.clientY}px`
      }
    }

    // lerp loop for the two smaller rings to create staggered follow
    const loop = () => {
      // when attached, lerp targets are the attached center so rings center on the element
      const tx = attached.current.is ? attached.current.x : target.current.x
      const ty = attached.current.is ? attached.current.y : target.current.y

      // lerp factors: large is fastest, med is medium, small is slowest
      const lF = 0.35
      const mF = 0.18
      const sF = 0.1

  // large follows target quickly
  pos.current.lx += (tx - pos.current.lx) * lF
  pos.current.ly += (ty - pos.current.ly) * lF
  // medium follows the large ring (creates consistent trailing)
  pos.current.mx += (pos.current.lx - pos.current.mx) * mF
  pos.current.my += (pos.current.ly - pos.current.my) * mF
  // small follows the medium ring
  pos.current.sx += (pos.current.mx - pos.current.sx) * sF
  pos.current.sy += (pos.current.my - pos.current.sy) * sF

  // Always position rings; sizing and scale are delegated to CSS variables
  // so we only write left/top here. CSS keeps the translate(-50%,-50%)
  // centering and uses --cursor-*-scale for scale animations.
  largeEl.style.left = `${pos.current.lx}px`
  largeEl.style.top = `${pos.current.ly}px`

  medEl.style.left = `${pos.current.mx}px`
  medEl.style.top = `${pos.current.my}px`

  smallEl.style.left = `${pos.current.sx}px`
  smallEl.style.top = `${pos.current.sy}px`

      rafId.current = requestAnimationFrame(loop)
    }

    document.addEventListener('mousemove', onMove, { passive: true })
    rafId.current = requestAnimationFrame(loop)

    // Optional debug overlay: enable by adding '#cursor-debug' to the URL
    // (lightweight, updates infrequently). This is handy when troubleshooting
    // runtime --cursor-large values without spamming logs or affecting rAF.
    let debugInterval = null
    let debugEl = null
    try {
      if (typeof window !== 'undefined' && window.location && window.location.hash && window.location.hash.includes('cursor-debug')) {
        debugEl = document.createElement('div')
        debugEl.className = 'cursor-debug'
        debugEl.style.position = 'fixed'
        debugEl.style.right = '12px'
        debugEl.style.bottom = '64px'
        debugEl.style.zIndex = '9999'
        debugEl.style.padding = '6px 8px'
        debugEl.style.background = 'rgba(0,0,0,0.6)'
        debugEl.style.color = '#fff'
        debugEl.style.fontFamily = 'monospace'
        debugEl.style.fontSize = '12px'
        debugEl.style.borderRadius = '6px'
        debugEl.style.pointerEvents = 'none'
        document.body.appendChild(debugEl)
        debugInterval = setInterval(() => {
          try {
            const cs = getComputedStyle(rootRef.current || document.documentElement)
            const val = cs.getPropertyValue('--cursor-large') || ''
            debugEl.textContent = `--cursor-large: ${val.trim() || '(unset)'}`
          } catch (e) {
            // ignore
          }
        }, 250)
      }
    } catch (e) {}

  // attach hover handlers only to explicit opt-in elements (use data-cursor-attach)
  // This keeps the main cursor free when hovering menu buttons; the per-button
  // visual rings are handled independently in CSS/markup.
  const attachSelector = '[data-cursor-attach]'
    const attachEls = Array.from(document.querySelectorAll(attachSelector))

    const makeEnter = (el) => () => {
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const targetSize = rect.width + attachPadding
      attached.current.is = true
      attached.current.x = cx
      attached.current.y = cy
      attached.current.size = targetSize

      // set CSS variable on the cursor root so CSS controls all ring sizes
      // (med/small are derived from --cursor-large in CSS)
      try {
        if (rootRef.current && rootRef.current.style) {
          rootRef.current.style.setProperty('--cursor-large', `${targetSize}px`)
        }
      } catch (e) {}

      // snap lerped positions near the attached center to avoid visual popping
      pos.current.lx = cx
      pos.current.ly = cy
      pos.current.mx = cx
      pos.current.my = cy
      pos.current.sx = cx
      pos.current.sy = cy
    }

    const makeLeave = () => () => {
      attached.current.is = false
      attached.current.size = 0
      // remove the temporary CSS override so the stylesheet (root vars)
      // again determines the base sizes
      try {
        if (rootRef.current && rootRef.current.style) {
          rootRef.current.style.removeProperty('--cursor-large')
        }
      } catch (e) {}
      // snap lerped positions to the current target to avoid the large ring "scattering"
      pos.current.lx = target.current.x
      pos.current.ly = target.current.y
      pos.current.mx = target.current.x
      pos.current.my = target.current.y
      pos.current.sx = target.current.x
      pos.current.sy = target.current.y
    }

    const enterHandlers = new Map()
    const leaveHandlers = new Map()
    attachEls.forEach((el) => {
      const enter = makeEnter(el)
      const leave = makeLeave()
      enterHandlers.set(el, enter)
      leaveHandlers.set(el, leave)
      el.addEventListener('mouseenter', enter)
      el.addEventListener('mouseleave', leave)
    })

    // Sequence orchestration for menu hover -> collapse rings -> plus -> dot
    // We use GSAP to animate scales directly on the elements. This avoids
    // relying on CSS transition rules (which can be overridden or skipped
    // by the browser in some scenarios) and prevents the one-frame disappear
    // behavior the user observed.
    let seqTl = null
    const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resetCursorVisuals = () => {
      try {
        const root = rootRef.current
        if (!root) return
        // clear any inline GSAP transforms and classes
        if (smallEl) gsap.set(smallEl, { clearProps: 'transform,opacity' })
        if (medEl) gsap.set(medEl, { clearProps: 'transform,opacity' })
        if (largeEl) gsap.set(largeEl, { clearProps: 'transform,opacity' })
        if (plusEl) gsap.set(plusEl, { clearProps: 'transform,opacity' })
        if (dotEl) gsap.set(dotEl, { clearProps: 'transform,opacity' })
        root.classList.remove('cursor--dot-active')
      } catch (e) {}
    }

    const playSequence = () => {
      // don't start if a timeline is already running
      if (seqTl) return
      if (!smallEl || !medEl || !largeEl || !plusEl || !dotEl) return

      // Respect reduced-motion preference: do a quick, subtle change instead
      if (prefersReduced) {
        // flash the dot briefly but keep motion minimal
        seqTl = gsap.timeline({ onComplete: () => { seqTl = null; resetCursorVisuals() } })
        seqTl.to(dotEl, { scale: 1, opacity: 1, duration: 0.12 })
        seqTl.to(dotEl, { opacity: 0.9, duration: 0.2, yoyo: true, repeat: 1 })
        return
      }

      // ensure starting state: rings at scale 1, plus visible, dot hidden
      gsap.set([smallEl, medEl, largeEl, plusEl], { scale: 1, transformOrigin: '50% 50%' })
      gsap.set(dotEl, { scale: 0, opacity: 0, transformOrigin: '50% 50%' })

      seqTl = gsap.timeline({
        defaults: { ease: 'power2.out' },
        onComplete: () => { seqTl = null }
      })

      // small -> med -> large collapse (staggered)
      seqTl.to(largeEl, { scale: 0, duration: 0.35, ease: 'back.In' })
      seqTl.to(medEl, { scale: 0, duration: 0.35, ease: 'back.In' }, '-=0.04')
      seqTl.to(smallEl, { scale: 0, duration: 0.35, ease: 'back.In' }, '-=0.04')

      // plus collapse
      seqTl.to(plusEl, { scale: 0, duration: 0.35, ease: 'back.In', opacity: 0 }, '-=0.04')

      // dot appear and pulse: scale up then pulse opacity
      seqTl.to(dotEl, { scale: 2, opacity: 1, duration: 0.12, onStart: () => {
        if (rootRef.current) rootRef.current.classList.add('cursor--dot-active')
      } }, '+=0.03')

      // pulse opacity continuously (create a repeating tween attached to the timeline)
      seqTl.add(gsap.to(dotEl, { opacity: 0.5, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
    }

    const cancelSequence = () => {
      try {
        if (seqTl) {
          seqTl.kill()
          seqTl = null
        }
      } catch (e) {}
      // restore visuals immediately
      resetCursorVisuals()
    }

    // Listen for menu hover sequence events (dispatched by Menu.js)
    const onSeqStart = () => playSequence()
    const onSeqCancel = () => cancelSequence()
    window.addEventListener('cursor-menu-sequence-start', onSeqStart)
    window.addEventListener('cursor-menu-sequence-cancel', onSeqCancel)

    // sizing is handled by CSS vars; no resize handler needed here

    return () => {
      document.removeEventListener('mousemove', onMove)
      // remove attach handlers
      attachEls.forEach((el) => {
        const enter = enterHandlers.get(el)
        const leave = leaveHandlers.get(el)
        if (enter) el.removeEventListener('mouseenter', enter)
        if (leave) el.removeEventListener('mouseleave', leave)
      })
      if (rafId.current) cancelAnimationFrame(rafId.current)
      if (debugInterval) clearInterval(debugInterval)
      if (debugEl && debugEl.parentNode) debugEl.parentNode.removeChild(debugEl)
      // remove global sequence listeners
      try {
        window.removeEventListener('cursor-menu-sequence-start', onSeqStart)
        window.removeEventListener('cursor-menu-sequence-cancel', onSeqCancel)
      } catch (e) {}
    }
  }, [])

  return (
    <div className="cursor" ref={rootRef} aria-hidden>
      <div className="cursor-ring cursor-ring--large" ref={largeRef} />
      <div className="cursor-ring cursor-ring--med" ref={medRef} />
      <div className="cursor-ring cursor-ring--small" ref={smallRef} />
        <div className="cursor-plus mini-text" ref={plusRef}>+</div>
        <div className="cursor-dot" ref={dotRef} />
    </div>
  )
}
