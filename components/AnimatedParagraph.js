import { useEffect, useMemo, useRef } from 'react'

const normalizeWord = (value) => (value || '').replace(/[^a-zA-Z\u00C0-\u017F]+/g, '').toLowerCase()
const createHighlightSet = (highlights) => {
  if (!highlights || !highlights.length) return new Set()
  const tokens = highlights.flatMap((phrase) => (phrase || '').split(/\s+/))
  return new Set(tokens.map((token) => normalizeWord(token)).filter(Boolean))
}

export default function AnimatedParagraph({ children, highlights = [] }) {
  const ref = useRef(null)

  useEffect(() => {
    let mounted = true
    let created = []
    let resizeTimer = null
    let ST = null
    const run = async () => {
      if (!ref.current || !mounted) return
      const gsapMod = await import('gsap')
      const gsap = gsapMod.gsap || gsapMod.default || gsapMod
      const ScrollTrigger = (await import('gsap/ScrollTrigger')).default
      gsap.registerPlugin(ScrollTrigger)
      ST = ScrollTrigger

      const words = ref.current.querySelectorAll('.ap-word')
      // start 50px below and invisible
      gsap.set(words, { y: 50, autoAlpha: 0 })
      
      // Initial reveal animation (simplified): create triggers and timelines

      const createTriggers = () => {
        // cleanup existing and reset inline styles
        created.forEach((c) => { try { if (c.kill) c.kill(); else if (c.revert) c.revert(); } catch (e) {} })
        created = []
        try { gsap.set(words, { y: 50, autoAlpha: 0 }) } catch (e) {}

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
        const revealTrigger = ScrollTrigger.create({
          trigger: ref.current,
          start: revealStart,
          onEnter: () => { tl.play() },
          onLeaveBack: () => { tl.reverse() }
        })
        created.push(revealTrigger)

        // Opacity fade mapped across the paragraph's viewport travel.
        // For small screens use a rect-based onUpdate so the element fades
        // in as it enters the viewport (more reliable on tall/narrow layouts).
        if (isSmall) {
          // Disable container opacity/transparency on small screens — keep
          // the word reveal animation but ensure the paragraph container is
          // fully opaque so words show as they animate.
          try { gsap.set(ref.current, { opacity: 1 }) } catch (e) {}
        } else {
          const fadeStart = isMedium ? 'bottom 90%' : 'bottom 85%'
          const fade = gsap.fromTo(ref.current, { opacity: 0.1 }, {
            opacity: 1,
            scrollTrigger: {
              trigger: ref.current,
              start: fadeStart,
              end: 'top 20%',
              scrub: 0.5,
              toggleActions: 'play none none none'
            }
          })
          created.push(fade)
        }

        const st = ScrollTrigger.create({ trigger: ref.current, start: 'top top', onEnterBack: () => gsap.set(ref.current, { opacity: 1 }) })
        created.push(st)

        // When paragraph fully leaves the viewport at the bottom, snap it hidden
        // (no hide animation) so returning will always use the reveal timeline.
        const exitTrigger = ScrollTrigger.create({
          trigger: ref.current,
          start: 'top bottom',
          end: 'top bottom',
          onEnter: (self) => {
            if (hasRevealed && self.direction > 0) {
              try { tl.pause(0); gsap.set(words, { y: 50, autoAlpha: 0 }); hasRevealed = false } catch (e) {}
            }
          },
          onLeaveBack: (self) => {
            if (self.direction < 0) {
              // coming back up from below: play reveal
              tl.play()
            }
          }
        })
        created.push(exitTrigger)
      }

      // create initially
      createTriggers()

      const onResize = () => {
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          try { createTriggers(); ST && ST.refresh(); } catch (e) {}
        }, 120)
      }

      window.addEventListener('resize', onResize)

      // cleanup for this run invocation
      return () => {
        window.removeEventListener('resize', onResize)
        created.forEach((c) => { try { if (c.kill) c.kill(); else if (c.revert) c.revert(); } catch (e) {} })
        created = []
      }
    }

    let cleanupRun = null
    run().then((maybe) => { if (typeof maybe === 'function') cleanupRun = maybe }).catch(() => {})

    return () => {
      mounted = false
      if (cleanupRun) try { cleanupRun() } catch (e) {}
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
