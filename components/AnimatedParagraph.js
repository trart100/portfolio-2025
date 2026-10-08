import { useEffect, useMemo, useRef } from 'react'
import { gsap, ScrollTrigger } from '../lib/gsap'

const normalizeWord = (value) => (value || '').replace(/[^a-zA-Z\u00C0-\u017F]+/g, '').toLowerCase()
const createHighlightSet = (highlights) => {
  if (!highlights || !highlights.length) return new Set()
  const tokens = highlights.flatMap((phrase) => (phrase || '').split(/\s+/))
  return new Set(tokens.map((token) => normalizeWord(token)).filter(Boolean))
}

export default function AnimatedParagraph({ children, highlights = [] }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return undefined
    let created = []
    let resizeTimer = null

    const words = ref.current.querySelectorAll('.ap-word')
    // start 50px below and invisible
    gsap.set(words, { y: 50, autoAlpha: 0 })

    const killCreated = () => {
      created.forEach((c) => c.kill())
      created = []
    }

    const createTriggers = () => {
      // cleanup existing and reset inline styles
      killCreated()
      gsap.set(words, { y: 50, autoAlpha: 0 })

      const vw = window.innerWidth || 0
      const isSmall = vw <= 800
      const isMedium = vw > 800 && vw <= 1200
      const revealStart = isSmall ? 'top 92%' : isMedium ? 'top 88%' : 'top 80%'

      // Single reveal timeline (paused). We'll control it explicitly so
      // hiding simply snaps content hidden and reveal uses this timeline.
      let hasRevealed = false
      const tl = gsap.timeline({ paused: true })
      tl.to(words, { y: 0, autoAlpha: 1, stagger: 0.04, duration: 0.45, ease: 'power2.out' })
      tl.eventCallback('onComplete', () => { hasRevealed = true })
      tl.eventCallback('onReverseComplete', () => { hasRevealed = false })
      created.push(tl)

      // Reveal trigger: play the timeline when the paragraph reaches the reveal start
      created.push(ScrollTrigger.create({
        trigger: ref.current,
        start: revealStart,
        onEnter: () => { tl.play() },
        onLeaveBack: () => { tl.reverse() }
      }))

      // Opacity fade mapped across the paragraph's viewport travel (desktop only);
      // small screens keep the container fully opaque so words show as they animate.
      if (isSmall) {
        gsap.set(ref.current, { opacity: 1 })
      } else {
        const fadeStart = isMedium ? 'bottom 90%' : 'bottom 85%'
        created.push(gsap.fromTo(ref.current, { opacity: 0.1 }, {
          opacity: 1,
          scrollTrigger: {
            trigger: ref.current,
            start: fadeStart,
            end: 'top 20%',
            scrub: 0.5,
            toggleActions: 'play none none none'
          }
        }))
      }

      created.push(ScrollTrigger.create({ trigger: ref.current, start: 'top top', onEnterBack: () => gsap.set(ref.current, { opacity: 1 }) }))

      // When paragraph fully leaves the viewport at the bottom, snap it hidden
      // (no hide animation) so returning will always use the reveal timeline.
      created.push(ScrollTrigger.create({
        trigger: ref.current,
        start: 'top bottom',
        end: 'top bottom',
        onEnter: (self) => {
          if (hasRevealed && self.direction > 0) {
            tl.pause(0)
            gsap.set(words, { y: 50, autoAlpha: 0 })
            hasRevealed = false
          }
        },
        onLeaveBack: (self) => {
          // coming back up from below: play reveal
          if (self.direction < 0) tl.play()
        }
      }))
    }

    createTriggers()

    const onResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        createTriggers()
        ScrollTrigger.refresh()
      }, 120)
    }

    window.addEventListener('resize', onResize)

    return () => {
      clearTimeout(resizeTimer)
      window.removeEventListener('resize', onResize)
      killCreated()
    }
  }, [children])

  // Render: split on whitespace but keep spaces so layout doesn't collapse
  const parts = typeof children === 'string' ? children.split(/(\s+)/) : [children]
  const highlightSet = useMemo(() => createHighlightSet(highlights), [highlights])
  return (
    <p ref={ref} className="main-text manifesto-p">
      {parts.map((part, i) => {
        if (typeof part !== 'string') return part
        if (part.match(/\s+/)) return part
        const normalized = normalizeWord(part)
        const isHighlight = normalized && highlightSet.has(normalized)
        return (
          <span
            className={`ap-word${isHighlight ? ' manifesto-highlight' : ''}`}
            style={{ whiteSpace: 'pre' }}
            key={i}
          >{part}</span>
        )
      })}
    </p>
  )
}
