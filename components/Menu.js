import { useEffect, useState } from 'react'

export default function Menu() {
  const [active, setActive] = useState('')
  const [open, setOpen] = useState(false) // mobile expanded

  const scrollTo = async (selector) => {
    if (!selector || typeof window === 'undefined') return
    // dynamic import to avoid SSR issues
    const { gsap } = await import('gsap/dist/gsap')
    const ScrollToPlugin = (await import('gsap/dist/ScrollToPlugin')).default
    gsap.registerPlugin(ScrollToPlugin)
    gsap.to(window, {
      duration: 1,
      ease: 'power2.inOut',
      scrollTo: { y: selector, autoKill: false }
    })
  }

  const handleShowreel = () => {
    setActive('showreel')
    window.dispatchEvent(new CustomEvent('openShowreel'))
    // close mobile menu when opening showreel
    setOpen(false)
  }

  const handleNav = (selector, name) => {
    setActive(name)
    scrollTo(selector)
    // close mobile menu on navigation
    setOpen(false)
  }

  useEffect(() => {
    const onClose = () => setActive('')
    window.addEventListener('closeShowreel', onClose)
    return () => window.removeEventListener('closeShowreel', onClose)
  }, [])

  useEffect(() => {
    // Auto-select menu buttons when their sections are in view.
    // If the user is at the very top of the page, clear selection.
    const sectionMap = [
      { id: 'manifesto', name: 'manifesto' },
      { id: 'contact', name: 'contact' }
    ]

    const els = sectionMap.map((s) => ({ ...s, el: document.getElementById(s.id) }))

    const onTopCheck = () => {
      if (window.scrollY <= 40) setActive('')
    }

    const vw = window.innerWidth || 0
    const isSmallScreen = vw <= 800

    // For small screens we use a simple midpoint check (center of viewport)
    // to decide which section is active. This is more reliable than
    // intersectionRatio on tall/narrow viewports.
    if (isSmallScreen) {
      const onScrollMid = () => {
        onTopCheck()
        const mid = window.scrollY + (window.innerHeight || 0) / 2
        let found = ''
        els.forEach((s) => {
          if (!s.el) return
          const rect = s.el.getBoundingClientRect()
          const top = rect.top + window.scrollY
          const bottom = top + rect.height
          if (mid >= top && mid <= bottom) found = s.name
        })
        if (found) setActive(found)
      }

      window.addEventListener('scroll', onScrollMid)
      window.addEventListener('resize', onScrollMid)
      // initial check
      onScrollMid()

      return () => {
        window.removeEventListener('scroll', onScrollMid)
        window.removeEventListener('resize', onScrollMid)
      }
    }

    // For larger screens use IntersectionObserver with lower activation
    // threshold so sections like manifesto can be selected earlier.
    let io = null
    try {
      io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const map = sectionMap.find((m) => m.id === entry.target.id)
          if (!map) return
          // lower threshold: activate when a decent portion is visible
          if (entry.isIntersecting && entry.intersectionRatio > 0.12) {
            setActive(map.name)
          }
        })
      }, { threshold: [0, 0.12, 0.25, 0.5, 0.75, 1] })

      els.forEach((s) => { if (s.el) io.observe(s.el) })
    } catch (e) {
      // fallback: nearest-section by midpoint
      const onScrollNearest = () => {
        onTopCheck()
        const mid = window.scrollY + (window.innerHeight || 0) / 2
        let found = ''
        els.forEach((s) => {
          if (!s.el) return
          const r = s.el.getBoundingClientRect()
          const top = r.top + window.scrollY
          const bottom = top + r.height
          if (mid >= top && mid <= bottom) found = s.name
        })
        if (found) setActive(found)
      }
      window.addEventListener('scroll', onScrollNearest)
      window.addEventListener('resize', onScrollNearest)
      onScrollNearest()
      return () => { window.removeEventListener('scroll', onScrollNearest); window.removeEventListener('resize', onScrollNearest) }
    }

    window.addEventListener('scroll', onTopCheck)

    return () => {
      window.removeEventListener('scroll', onTopCheck)
      if (io) io.disconnect()
    }
  }, [])

  useEffect(() => {
    // dynamic per-button hover ring sizing
    // Improvements: add a ResizeObserver + window resize fallback so that
    // while a button remains hovered (or when the layout changes — e.g. mobile
    // menu opening, page resizes), the inline ring sizes are recalculated and
    // do not appear to 'jump' or scale unexpectedly.
    const padding = 22 // px extra around element
    const btns = Array.from(document.querySelectorAll('.menu-btn'))

    // helper to compute and apply sizes for a specific button
    const computeSizes = (btn, ringsWrap, ringEls) => {
      if (!btn || !ringsWrap) return
      // Use the layout size (offsetWidth/offsetHeight) as the base so that
      // CSS transforms (scale on hover) do NOT affect the computed ring sizes.
      // getBoundingClientRect() reflects transforms; offset* reflect the
      // untransformed layout size which matches the user's requested behavior.
      const base = Math.max(btn.offsetWidth || 0, btn.offsetHeight || 0)
      const main = Math.round(base + padding)
      const small = Math.round(main * 1.02)
      const med = Math.round(main * 1.05)
      const large = Math.round(main * 1.08)

      ringsWrap.style.width = `${large}px`
      ringsWrap.style.height = `${large}px`

      if (ringEls && ringEls.length) {
        if (ringEls[0]) { ringEls[0].style.width = `${small}px`; ringEls[0].style.height = `${small}px` }
        if (ringEls[1]) { ringEls[1].style.width = `${med}px`; ringEls[1].style.height = `${med}px` }
        if (ringEls[2]) { ringEls[2].style.width = `${large}px`; ringEls[2].style.height = `${large}px` }
      }
    }

  // Maps to keep track of observers / handlers per-button so we can clean up
  const observers = new Map()
  const transHandlers = new Map()
  const clickHandlers = new Map()
  // track active leave timeouts so we can cancel cleanup if user re-enters
  const leaveTimeouts = new Map()

    const enter = (e) => {
      const btn = e.currentTarget
      const ringsWrap = btn.querySelector('.btn-hover-rings')
      if (!ringsWrap) return
      const ringEls = ringsWrap.querySelectorAll('.btn-hover-ring')

      // initial sizing
      computeSizes(btn, ringsWrap, ringEls)

      // clear any inline transforms/opacity that may have been left by
      // a prior click or JS animation so CSS transitions can run on enter
      // (this fixes cases where rings were forced to scale(0)/opacity:0
      // and then never returned because the inline styles persisted).
      if (ringEls && ringEls.length) {
        ringEls.forEach((r) => {
          r.style.transform = ''
          r.style.opacity = ''
        })
      }

      // observe the button size so changes while hovered (menu open/close,
      // responsive layout) trigger recompute
      try {
        const ro = new ResizeObserver(() => computeSizes(btn, ringsWrap, ringEls))
        ro.observe(btn)
        observers.set(btn, ro)
      } catch (err) {
        // ResizeObserver may not be available in some environments — fallback to window resize
      }

      // also recompute after transitions on the button (cover transform/scale transitions)
      const onTransEnd = (evt) => {
        // only recompute for transforms/width/height related transitions
        if (!evt || !evt.propertyName) {
          computeSizes(btn, ringsWrap, ringEls)
          return
        }
        const props = ['transform', 'width', 'height', 'opacity']
        if (props.includes(evt.propertyName)) computeSizes(btn, ringsWrap, ringEls)
      }
      btn.addEventListener('transitionend', onTransEnd)
      transHandlers.set(btn, onTransEnd)

      // If we were in the middle of a leaving cleanup, cancel it and
      // restore the hovered state immediately.
      const pending = leaveTimeouts.get(btn)
      if (pending) {
        clearTimeout(pending)
        leaveTimeouts.delete(btn)
        btn.classList.remove('is-leaving')
      }

  // toggle class to trigger CSS transitions (also covers hover via :hover)
  btn.classList.add('is-hovered')
  // place this hovered button visually behind the others so its rings
  // can appear over background but under neighboring buttons.
  btn.classList.add('is-behind')
      // notify global cursor to begin the collapse->dot sequence
      try {
        window.dispatchEvent(new CustomEvent('cursor-menu-sequence-start', { detail: { source: 'menu-btn' } }))
      } catch (err) {}
    }

    const leave = (e) => {
      const btn = e.currentTarget
      const ringsWrap = btn.querySelector('.btn-hover-rings')
      if (!ringsWrap) return
      const ringEls = ringsWrap.querySelectorAll('.btn-hover-ring')

      // Add an explicit leaving class to flip transition delays (CSS handles
      // reversed stagger when .is-leaving is present). Then remove the
      // hovered state on the next frame so transitions run with the leaving delays.
      btn.classList.add('is-leaving')

      // Remove hovered state next frame to trigger the roll-out transition
      // while keeping the is-leaving class active for delay rules.
      requestAnimationFrame(() => {
        btn.classList.remove('is-hovered')

        // inform cursor to reverse / restore state immediately
        try {
          window.dispatchEvent(new CustomEvent('cursor-menu-sequence-cancel', { detail: { source: 'menu-btn' } }))
        } catch (err) {}

        // schedule cleanup after the longest animation + stagger delay
        const CLEANUP_DELAY = 520 // ms (420ms longest transition + 80ms max delay -> 500ms, add buffer)
        const to = setTimeout(() => {
          // remove inline sizes so CSS falls back to defaults
          ringsWrap.style.width = ''
          ringsWrap.style.height = ''
          ringEls.forEach((r) => {
            r.style.width = ''
            r.style.height = ''
            // also clear any transient inline transform/opacity so next
            // hover starts from the expected CSS state
            r.style.transform = ''
            r.style.opacity = ''
          })

          // clear leaving class and cleanup observers/handlers
          btn.classList.remove('is-leaving')
          // restore stacking: remove behind flag so button returns above neighbors
          btn.classList.remove('is-behind')

          const ro = observers.get(btn)
          if (ro) { ro.disconnect(); observers.delete(btn) }
          const th = transHandlers.get(btn)
          if (th) { btn.removeEventListener('transitionend', th); transHandlers.delete(btn) }

          leaveTimeouts.delete(btn)
        }, CLEANUP_DELAY)

        // track the timeout so enter can cancel it if we re-hover quickly
        leaveTimeouts.set(btn, to)
      })
    }

    // window resize fallback: recompute for any currently hovered button
    const recomputeHovered = () => {
      const hovered = Array.from(document.querySelectorAll('.menu-btn.is-hovered'))
      hovered.forEach((btn) => {
        const ringsWrap = btn.querySelector('.btn-hover-rings')
        if (!ringsWrap) return
        const ringEls = ringsWrap.querySelectorAll('.btn-hover-ring')
        computeSizes(btn, ringsWrap, ringEls)
      })
    }

    btns.forEach((b) => {
      b.addEventListener('mouseenter', enter)
      b.addEventListener('mouseleave', leave)
      // Ensure click always hides the hover rings immediately
      const onClickHide = (e) => {
        try {
          const btn = e.currentTarget
          const ringsWrap = btn.querySelector('.btn-hover-rings')
          if (!ringsWrap) return
          const ringEls = ringsWrap.querySelectorAll('.btn-hover-ring')

          // cancel any scheduled cleanup
          const pending = leaveTimeouts.get(btn)
          if (pending) { clearTimeout(pending); leaveTimeouts.delete(btn) }

          // immediately hide visuals and clear sizing
          ringsWrap.style.width = ''
          ringsWrap.style.height = ''
          ringEls.forEach((r) => {
            r.style.width = ''
            r.style.height = ''
            // force hidden transform and opacity inline so it disappears instantly
            r.style.transform = 'translate(-50%,-50%) scale(0)'
            r.style.opacity = '0'
          })

          // remove hover/leaving/behind states so layout returns to normal
          btn.classList.remove('is-hovered')
          btn.classList.remove('is-leaving')
          btn.classList.remove('is-behind')

          // inform cursor to cancel its sequence immediately
          try { window.dispatchEvent(new CustomEvent('cursor-menu-sequence-cancel', { detail: { source: 'menu-btn-click' } })) } catch (err) {}
        } catch (err) {}
      }
      b.addEventListener('click', onClickHide)
      clickHandlers.set(b, onClickHide)
    })

    window.addEventListener('resize', recomputeHovered)

    return () => {
      btns.forEach((b) => {
        b.removeEventListener('mouseenter', enter)
        b.removeEventListener('mouseleave', leave)
  const ch = clickHandlers.get(b)
  if (ch) b.removeEventListener('click', ch)
        // cleanup any leftover observers/handlers
        const ro = observers.get(b)
        if (ro) ro.disconnect()
        const th = transHandlers.get(b)
        if (th) b.removeEventListener('transitionend', th)
      })
      window.removeEventListener('resize', recomputeHovered)
    }
  }, [])

  return (
    <div className="menu-bottom" role="navigation" aria-label="Main menu">
      {/* Desktop group (keeps original layout) */}
      <div className="menu-group">
        <button type="button" className={`menu-btn mini-text ${active === 'showreel' ? 'selected' : ''}`} onClick={handleShowreel}>
          Showreel
          <span className="btn-hover-rings" aria-hidden>
            <span className="btn-hover-ring ring-1" />
            <span className="btn-hover-ring ring-2" />
            <span className="btn-hover-ring ring-3" />
          </span>
        </button>
        <button type="button" className={`menu-btn mini-text ${active === 'manifesto' ? 'selected' : ''}`} onClick={() => handleNav('#manifesto', 'manifesto')}>
          Manifesto
          <span className="btn-hover-rings" aria-hidden>
            <span className="btn-hover-ring ring-1" />
            <span className="btn-hover-ring ring-2" />
            <span className="btn-hover-ring ring-3" />
          </span>
        </button>
        <button type="button" className={`menu-btn mini-text ${active === 'contact' ? 'selected' : ''}`} onClick={() => handleNav('#contact', 'contact')}>
          Contact
          <span className="btn-hover-rings" aria-hidden>
            <span className="btn-hover-ring ring-1" />
            <span className="btn-hover-ring ring-2" />
            <span className="btn-hover-ring ring-3" />
          </span>
        </button>
      </div>

      {/* Mobile trigger + expandable menu (shown via media query) */}
      <div className="mobile-menu-wrap" aria-hidden={false}>
        <button
          className={`menu-trigger ${open ? 'is-open' : ''}`}
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="hamburger-line" />
          <span className="hamburger-line" />
          <span className="hamburger-line" />
        </button>

        <div className={`mobile-menu ${open ? 'open' : ''}`}>
          <button type="button" className={`menu-btn mini-text mobile-item ${active === 'showreel' ? 'selected' : ''}`} onClick={handleShowreel}>
            Showreel
            <span className="btn-hover-rings" aria-hidden>
              <span className="btn-hover-ring ring-1" />
              <span className="btn-hover-ring ring-2" />
              <span className="btn-hover-ring ring-3" />
            </span>
          </button>
          <button type="button" className={`menu-btn mini-text mobile-item ${active === 'manifesto' ? 'selected' : ''}`} onClick={() => handleNav('#manifesto', 'manifesto')}>
            Manifesto
            <span className="btn-hover-rings" aria-hidden>
              <span className="btn-hover-ring ring-1" />
              <span className="btn-hover-ring ring-2" />
              <span className="btn-hover-ring ring-3" />
            </span>
          </button>
          <button type="button" className={`menu-btn mini-text mobile-item ${active === 'contact' ? 'selected' : ''}`} onClick={() => handleNav('#contact', 'contact')}>
            Contact
            <span className="btn-hover-rings" aria-hidden>
              <span className="btn-hover-ring ring-1" />
              <span className="btn-hover-ring ring-2" />
              <span className="btn-hover-ring ring-3" />
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
