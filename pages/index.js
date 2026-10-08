import { useEffect, useRef, useState } from 'react'
import VideoVisual from '../components/VideoVisual'
import Inertia from '../components/Inertia'
import Cursor from '../components/Cursor'
import Menu from '../components/Menu'
import ShowreelOverlay from '../components/ShowreelOverlay'
import AnimatedParagraph from '../components/AnimatedParagraph'
import DotGrid from '../components/DotGrid'
import AnimatedInformation from '../components/AnimatedInformation'


const manifestoParagraphs = [
  {
    text: 'Meaning begins at the origin and settles at the destination, and motion design gives weight to what happens in between. It is a practice built on clarity, pacing, and the awareness that context defines every choice. Even when the creative field feels broad, the aim is always to understand the problem, observe the environment, and react consciously.',
    highlights: ['Meaning', 'Motion', 'Practice', 'Awareness', 'Context', 'Observe', 'Consciously']
  },
  {
    text: 'Context is the quiet force behind design. It shifts constantly, whether through time, audience, or technology, and the designer adapts to those movements. Strategy, communication, and aesthetic direction all follow from this changing foundation. The work becomes an ongoing dialogue, where keeping track of subtle shifts matters as much as taking decisive steps.',
    highlights: ['Context', 'Design', 'Aesthetic', 'Dialogue']
  },
  {
    text: 'Change and stability coexist in every project. They shape the path, the decisions, and the amount of experimentation possible. Time, resources, and skills form the practical limits, while context shapes the intention. Navigating this balance is where the creative process lives. It evolves, pauses, and redirects, but always stays grounded in purpose.',
    highlights: ['Change', 'Decisions', 'Experimentation', 'Skills', 'Creative process', 'Purpose']
  },
  {
    text: 'In an increasingly unstable environment, defining context grows harder, yet the human perspective remains steady. Tools like machine learning assist, but they do not define meaning. Values, direction, and responsibility stay with the designer. Creation happens in the tension between order and chaos, and understanding that tension is what keeps design human.',
    highlights: ['Unstable', 'Defining', 'Human perspective', 'Meaning', 'Values', 'Responsibility', 'Creation', 'Tension', 'human']
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
    </div>
  )
}
