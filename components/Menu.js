import { useEffect, useRef, useState } from 'react'
import { gsap } from '../lib/gsap'

const NAV_ITEMS = [
  { name: 'showreel', label: 'Showreel' },
  { name: 'manifesto', label: 'Manifesto', target: '#manifesto' },
  { name: 'contact', label: 'Contact', target: '#contact' }
]
const SPY_SECTION_IDS = ['manifesto', 'contact']
const SMALL_SCREEN_MAX = 800
const TOP_RESET_PX = 40
// longest ring transition (420ms) + max stagger delay (80ms) + buffer
const RING_LEAVE_MS = 520

const emitCursorEvent = (type, source) => {
  window.dispatchEvent(new CustomEvent(type, { detail: { source } }))
}

// Hover phases drive the ring classes: 'hovered' rolls rings in, 'leaving' rolls
// them out with reversed stagger, 'off' hides them instantly after a click.
const PHASE_CLASSES = {
  idle: '',
  hovered: 'is-hovered is-behind',
  leaving: 'is-leaving is-behind',
  off: 'rings-off'
}

function MenuButton({ label, selected, className = '', onClick }) {
  const [phase, setPhase] = useState('idle')
  const leaveTimer = useRef(null)

  useEffect(() => () => clearTimeout(leaveTimer.current), [])

  const handleEnter = () => {
    clearTimeout(leaveTimer.current)
    setPhase('hovered')
    emitCursorEvent('cursor-menu-sequence-start', 'menu-btn')
  }

  const handleLeave = () => {
    setPhase('leaving')
    emitCursorEvent('cursor-menu-sequence-cancel', 'menu-btn')
    clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => setPhase('idle'), RING_LEAVE_MS)
  }

  const handleClick = () => {
    clearTimeout(leaveTimer.current)
    setPhase('off')
    emitCursorEvent('cursor-menu-sequence-cancel', 'menu-btn-click')
    onClick()
  }

  const classes = ['menu-btn', 'mini-text', className, selected && 'selected', PHASE_CLASSES[phase]]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={classes}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={handleClick}
    >
      {label}
      <span className="btn-hover-rings" aria-hidden>
        <span className="btn-hover-ring ring-1" />
        <span className="btn-hover-ring ring-2" />
        <span className="btn-hover-ring ring-3" />
      </span>
    </button>
  )
}

export default function Menu() {
  const [active, setActive] = useState('')
  const [open, setOpen] = useState(false) // mobile expanded

  const handleSelect = ({ name, target }) => {
    setActive(name)
    setOpen(false)
    if (target) {
      gsap.to(window, { duration: 1, ease: 'power2.inOut', scrollTo: { y: target, autoKill: false } })
    } else {
      window.dispatchEvent(new CustomEvent('openShowreel'))
    }
  }

  useEffect(() => {
    const onClose = () => setActive('')
    window.addEventListener('closeShowreel', onClose)
    return () => window.removeEventListener('closeShowreel', onClose)
  }, [])

  // Scroll-spy: highlight the menu item of the section in view; clear at the top.
  useEffect(() => {
    const sections = SPY_SECTION_IDS
      .map((id) => document.getElementById(id))
      .filter(Boolean)

    const clearAtTop = () => {
      if (window.scrollY <= TOP_RESET_PX) setActive('')
    }

    // Small screens: viewport-midpoint check, more reliable than
    // intersectionRatio on tall/narrow viewports.
    if (window.innerWidth <= SMALL_SCREEN_MAX) {
      const onScroll = () => {
        clearAtTop()
        const mid = window.innerHeight / 2
        const current = sections.find((el) => {
          const rect = el.getBoundingClientRect()
          return mid >= rect.top && mid <= rect.bottom
        })
        if (current) setActive(current.id)
      }

      window.addEventListener('scroll', onScroll)
      window.addEventListener('resize', onScroll)
      onScroll()

      return () => {
        window.removeEventListener('scroll', onScroll)
        window.removeEventListener('resize', onScroll)
      }
    }

    // Larger screens: activate once a section is ~12% visible.
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.12) {
          setActive(entry.target.id)
        }
      })
    }, { threshold: [0, 0.12, 0.25, 0.5, 0.75, 1] })

    sections.forEach((el) => io.observe(el))
    window.addEventListener('scroll', clearAtTop)

    return () => {
      window.removeEventListener('scroll', clearAtTop)
      io.disconnect()
    }
  }, [])

  const renderButtons = (className) => NAV_ITEMS.map((item) => (
    <MenuButton
      key={item.name}
      label={item.label}
      className={className}
      selected={active === item.name}
      onClick={() => handleSelect(item)}
    />
  ))

  return (
    <div className="menu-bottom" role="navigation" aria-label="Main menu">
      <div className="menu-group">
        {renderButtons()}
      </div>

      {/* Mobile trigger + expandable menu (shown via media query) */}
      <div className="mobile-menu-wrap">
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
          {renderButtons('mobile-item')}
        </div>
      </div>
    </div>
  )
}
