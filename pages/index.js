import { useEffect, useRef, useState } from 'react'
import VideoVisual from '../components/VideoVisual'
import Inertia from '../components/Inertia'
import InertiaTuner from '../components/InertiaTuner'
import Cursor from '../components/Cursor'
import Menu from '../components/Menu'
import ShowreelOverlay from '../components/ShowreelOverlay'
import AnimatedParagraph from '../components/AnimatedParagraph'
import DotGrid from '../components/DotGrid'
import AnimatedInformation from '../components/AnimatedInformation'


const manifestoParagraphs = [
  {
    text: 'Meaning begins at the origin and settles at the destination. As a motion designer, I work on what happens in between: the pacing, the transitions, the moment an idea becomes clear. I start with the message, the audience, and the context, because context decides every frame. Then I build motion that explains, sells, or simply makes people stop scrolling.',
    highlights: ['Meaning', 'Motion designer', 'Pacing', 'Context']
  },
  {
    text: 'My work spans brand identities, campaigns, product UI, and social content, from the first storyboard to the final mix. I animate and edit in After Effects, Cinema 4D, Blender, Premiere, and Figma, build coded JavaScript animations for the web, design sound, and automate pipelines when work needs to move faster. One person who can carry a piece from concept to delivery without losing the thread.',
    // Highlights match single words anywhere in the paragraph, so avoid filler words like "to"
    highlights: ['Brand identities', 'Campaigns', 'Product UI', 'Concept', 'Delivery']
  },
  {
    text: 'Good motion depends on clear communication as much as on craft. Leading teams and mentoring designers taught me how much a precise brief, honest feedback, and a realistic deadline shape the final piece. Time, budget, and skills set the limits; context sets the intention. Working inside that balance and delivering on schedule is where I do my best work.',
    highlights: ['Communication', 'Craft', 'Leading', 'Mentoring']
  },
  {
    text: "Tools change fast, and machine learning and AI generation are now part of my workflow. They speed up exploration, but they do not define meaning: the values, direction, and responsibility behind every frame stay with the designer, and that is what I bring to every project. If your story needs to move, let's talk.",
    highlights: ['Meaning', 'Values', 'Responsibility', "Let's talk"]
  }
]

export default function Home() {
  const resizeTimeout = useRef(null)
  const lastScroll = useRef(0)
  const [showOverlay, setShowOverlay] = useState(false)

  useEffect(() => {
    // remember scroll position on resize and restore after
    // Also measure title so it fills (viewport - 2 * page-margin) smoothly
    let rafId = null
    const TITLE_MIN = 56
    const TITLE_MAX = 150

    const getPageMargin = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--page-margin') || '34px'
      return parseFloat(v) || 34
    }

    // create an offscreen canvas for text measurement (more stable)
    let canvas = document.querySelector('#__title-measure-canvas')
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.id = '__title-measure-canvas'
      canvas.style.position = 'absolute'
      canvas.style.left = '-9999px'
      canvas.style.top = '-9999px'
      canvas.style.width = '0'
      canvas.style.height = '0'
      document.body.appendChild(canvas)
    }
    const ctx = canvas.getContext && canvas.getContext('2d')

    const measureTitle = () => {
      try {
        const titleEl = document.querySelector('.title')
        if (!titleEl) return

        // copy font properties for canvas measurement
        const cs = getComputedStyle(titleEl)
        const text = titleEl.textContent.trim()
        if (!ctx) {
          // canvas context not available; defer
          return
        }
        // measure using a large base size for precision
        const base = 100
        ctx.font = `${cs.fontWeight} ${base}px ${cs.fontFamily}`
        const measured = Math.max(1, Math.round(ctx.measureText(text).width))
        const unitWidth = measured / base

        // guard against broken measurements
        if (!unitWidth || !isFinite(unitWidth) || unitWidth < 0.01) {
          requestAnimationFrame(measureTitle)
          return
        }

        // available content width = viewport width minus page margins
        const pageMargin = getPageMargin()
        const available = Math.max(0, window.innerWidth - (pageMargin * 2))

        // compute font size that will make text width ~= available
        let target = Math.floor(available / unitWidth)
        if (target < TITLE_MIN) target = TITLE_MIN
        if (target > TITLE_MAX) target = TITLE_MAX

        // smooth sudden jumps: limit change per measurement to 20% of prev size
        const prevRaw = getComputedStyle(document.documentElement).getPropertyValue('--title-font-size') || ''
        const prev = parseFloat(prevRaw) || TITLE_MAX
        const maxDelta = Math.max(1, Math.round(prev * 0.2))
        if (Math.abs(target - prev) > maxDelta) {
          target = prev + Math.sign(target - prev) * maxDelta
        }

        document.documentElement.style.setProperty('--title-font-size', target + 'px')
        document.documentElement.style.setProperty('--title-width', available + 'px')
      } catch (err) {
        // ignore
      }
    }

    let lastWidth = window.innerWidth

    // Only react to width changes. Height-only resizes happen constantly on mobile
    // (address bar showing/hiding while scrolling); restoring scroll then would
    // yank the page back mid-swipe.
    const onResize = () => {
      const width = window.innerWidth
      if (width === lastWidth) return
      lastWidth = width

      // re-fit the title right away, then again once the layout has settled
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(measureTitle)

      // remember scroll position and restore it after the reflow
      lastScroll.current = window.scrollY
      clearTimeout(resizeTimeout.current)
      resizeTimeout.current = setTimeout(() => {
        window.scrollTo({ top: lastScroll.current })
        // Wait for scroll to settle before measuring title
        setTimeout(() => {
          rafId = requestAnimationFrame(measureTitle)
        }, 50)
      }, 120)
    }

    const onOpen = () => setShowOverlay(true)
    const onClose = () => {
      setShowOverlay(false)
      // Re-measure title after overlay closes to prevent jump
      setTimeout(() => {
        if (rafId) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(measureTitle)
      }, 100)
    }

    window.addEventListener('resize', onResize)
    window.addEventListener('openShowreel', onOpen)
    window.addEventListener('closeShowreel', onClose)

    // measure initially and after fonts load
    measureTitle()
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => measureTitle())
    setTimeout(() => measureTitle(), 15)

    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('openShowreel', onOpen)
      window.removeEventListener('closeShowreel', onClose)
      clearTimeout(resizeTimeout.current)
      if (rafId) cancelAnimationFrame(rafId)
      try { const m = document.querySelector('#__title-measure-canvas'); if (m && m.parentNode) m.parentNode.removeChild(m) } catch(e) {}
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const selector = '.contact-items .mini-text'
    const start = () => {
      try {
        window.dispatchEvent(new CustomEvent('cursor-menu-sequence-start', { detail: { source: 'contact-line' } }))
      } catch (err) {}
    }
    const cancel = () => {
      try {
        window.dispatchEvent(new CustomEvent('cursor-menu-sequence-cancel', { detail: { source: 'contact-line' } }))
      } catch (err) {}
    }
    const items = Array.from(document.querySelectorAll(selector))
    if (!items.length) return
    items.forEach((item) => {
      item.addEventListener('mouseenter', start)
      item.addEventListener('mouseleave', cancel)
    })
    return () => {
      items.forEach((item) => {
        item.removeEventListener('mouseenter', start)
        item.removeEventListener('mouseleave', cancel)
      })
    }
  }, [])

  return (
    <div className="page-root">
      <Cursor />
      <Menu />

      <main className="page-content">
        <section className="section home full-screen" id="home">
          <div className="container">
            <DotGrid />
            <div className="video-visual-wrap">
              <VideoVisual />
            </div>
            <h1 className="title">Artur Kalinowski</h1>
            <AnimatedInformation />
          </div>
        </section>

        <section className="section manifesto" id="manifesto">
          <h2 className="sr-only">Manifesto</h2>
          <div className="container manifesto-inner">
            {manifestoParagraphs.map(({ text, highlights }, index) => (
              <AnimatedParagraph key={index} highlights={highlights}>
                {text}
              </AnimatedParagraph>
            ))}
          </div>
        </section>

        <section className="section contact" id="contact">
          <h2 className="sr-only">Contact</h2>
          <div className="container contact-inner">
            <div className="contact-block">
              <div className="contact-items">
                <a href="https://www.linkedin.com/in/dynamatic/" className="mini-text">linkedin</a>
                <a href="mailto:artur.motion@gmail.com" className="mini-text">artur.motion@gmail.com</a>
                <div className="mini-text">© Artur Kalinowski 2026</div>
              </div>
            </div>
          </div>
        </section>

      </main>

      {showOverlay && <ShowreelOverlay onClose={() => setShowOverlay(false)} />}
      <Inertia />
      {/* temporary: scroll echo tuning panel, only shown with ?tune */}
      <InertiaTuner />
    </div>
  )
}
