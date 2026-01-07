import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
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


gsap.registerPlugin(ScrollTrigger)

export default function Home() {
  const containerRef = useRef(null)
  const resizeTimeout = useRef(null)
  const lastScroll = useRef(0)
  const [showOverlay, setShowOverlay] = useState(false)

  useEffect(() => {
    const sections = document.querySelectorAll('.section')

    sections.forEach((sec, i) => {
      // Skip manifesto section because paragraphs have their own word-by-word animation
      if (sec.id === 'manifesto') return

      gsap.fromTo(
        sec,
        { opacity: 0.95 },
        {
          opacity: 1,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: sec,
            start: 'top center',
            end: 'bottom center',
            scrub: true
          }
        }
      )
    })

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

    

    // Debug helper: expose a function to manually run measurement and print
    // intermediate values so we can see why a jump happened for a specific
    // screenshot / environment. Use from DevTools: window.__measureTitleDebug()
    window.__measureTitleDebug = () => {
      try {
        const titleEl = document.querySelector('.title')
        if (!titleEl) { console.log('no .title'); return }
        const cs = getComputedStyle(titleEl)
        const text = titleEl.textContent.trim()
        const canvas = document.querySelector('#__title-measure-canvas')
        const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null
        const base = 100
        let measured = 0
        let unitWidth = 0
        if (ctx) {
          ctx.font = `${cs.fontWeight} ${base}px ${cs.fontFamily}`
          measured = Math.max(1, Math.round(ctx.measureText(text).width))
          unitWidth = measured / base
        }
        const pageMargin = getPageMargin()
        const available = Math.max(0, window.innerWidth - (pageMargin * 2))
        const rawTarget = Math.floor(available / unitWidth)
        const clamped = Math.max(TITLE_MIN, Math.min(TITLE_MAX, rawTarget))
        const prevRaw = getComputedStyle(document.documentElement).getPropertyValue('--title-font-size') || ''
        const prev = parseFloat(prevRaw) || TITLE_MAX
        const maxDelta = Math.max(1, Math.round(prev * 0.2))
        let smoothed = clamped
        if (Math.abs(clamped - prev) > maxDelta) smoothed = prev + Math.sign(clamped - prev) * maxDelta

        console.log({ measured, unitWidth, available, rawTarget, clamped, prev, maxDelta, smoothed })
        return { measured, unitWidth, available, rawTarget, clamped, prev, maxDelta, smoothed }
      } catch (err) { console.error(err); return null }
    }

    window.__titleSpacing = () => {
      const title = document.querySelector('.title')
      if (!title) { console.log('no title'); return }
      const r = title.getBoundingClientRect()
      console.log('title left →', Math.round(r.left) + 'px', '| title right →', Math.round(window.innerWidth - r.right) + 'px')
      return { left: Math.round(r.left), right: Math.round(window.innerWidth - r.right) }
    }

    const onResize = () => {
      lastScroll.current = window.scrollY
      clearTimeout(resizeTimeout.current)
      resizeTimeout.current = setTimeout(() => {
        window.scrollTo({ top: lastScroll.current })
      }, 120)
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(measureTitle)
    }

    const onOpen = () => setShowOverlay(true)
    const onClose = () => setShowOverlay(false)

  window.addEventListener('resize', onResize)
    window.addEventListener('openShowreel', onOpen)
    window.addEventListener('closeShowreel', onClose)

  // measure initially and after fonts load
  measureTitle()
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => measureTitle())
  setTimeout(() => measureTitle(), 15)
  
  // Force fake resize to trigger measureTitle through onResize handler
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'))
  }, 50)

    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('openShowreel', onOpen)
      window.removeEventListener('closeShowreel', onClose)
  // no ResizeObserver to cleanup here (kept for backwards-compatibility)
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
    <div ref={containerRef} className="page-root">
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
            <AnimatedInformation 
              switchDuration={0.8}
              displayInterval={1000}
            />
          </div>
        </section>

        <section className="section manifesto" id="manifesto">
          <div className="container manifesto-inner">
            {manifestoParagraphs.map(({ text, highlights }, index) => (
              <AnimatedParagraph key={index} highlights={highlights}>
                {text}
              </AnimatedParagraph>
            ))}
          </div>
        </section>

        <section className="section contact" id="contact">
          <div className="container contact-inner">
            <div className="contact-block">
              <div className="contact-items">
                <a href="mailto:artur.motion@gmail.com" className="mini-text">artur.motion@gmail.com</a>
                <a href="https://www.linkedin.com/in/dynamatic/" className="mini-text">linkedin</a>
              </div>
            </div>
          </div>
        </section>

        <footer className="footer">
          <div className="container">
            <div className="mini-text">© Artur Kalinowski 2025</div>
          </div>
        </footer>
      </main>

      {showOverlay && <ShowreelOverlay onClose={() => setShowOverlay(false)} />}
      <Inertia />
    </div>
  )
}
