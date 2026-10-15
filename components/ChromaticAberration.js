import { useEffect, useRef } from 'react'
import { chroma, chromaPixels, CHROMA_MODES } from '../lib/gyro/chroma'
import { gyroSpin } from '../lib/gyro/spin'

const STEP = 0.25 // px; the amount is rounded to this so the page only repaints on real changes
const RED = 'rgba(255, 0, 0, 0.7)'
const BLUE = 'rgba(0, 90, 255, 0.7)'

// Page side of the speed-driven chromatic aberration (chroma.js); the 3D side is in scene.js.
// Mode a: red/blue text-shadow split on all page text (--ca-text, see globals.css).
// Mode b: the SVG filter below on <html> = a true RGB split of the whole page, the 3D included.
//   On <html> because a filter on any other element would break its position:fixed children
//   (the 3D, the menu); it is removed whenever the amount is 0, so at rest it costs nothing.
// Compare: ?ca=off|a|b picks the mode; with ?gui the "Chromatic aberration" folder switches it
// live and can hold the energy at a fixed level, and the C key cycles off -> a -> b.
export default function ChromaticAberration() {
  const redRef = useRef(null)
  const blueRef = useRef(null)

  useEffect(() => {
    const root = document.documentElement
    const params = new URLSearchParams(window.location.search)
    const forced = params.get('ca')
    if (CHROMA_MODES.includes(forced)) chroma.mode = forced

    let lastPx = -1
    let lastMode = null
    let frameId = null
    const loop = () => {
      frameId = requestAnimationFrame(loop)
      const px = Math.round(chromaPixels() / STEP) * STEP
      const mode = chroma.mode
      if (px === lastPx && mode === lastMode) return
      lastPx = px
      lastMode = mode

      if (mode === 'a' && px > 0) root.style.setProperty('--ca-text', `${-px}px 0 0 ${RED}, ${px}px 0 0 ${BLUE}`)
      else root.style.removeProperty('--ca-text')

      if (mode === 'b' && px > 0) {
        redRef.current.setAttribute('dx', String(-px))
        blueRef.current.setAttribute('dx', String(px))
        root.style.filter = 'url(#ca-split)'
      } else root.style.filter = ''
      root.dataset.ca = `${mode} ${px}`
    }
    frameId = requestAnimationFrame(loop)

    const handleKey = (event) => {
      if (event.key !== 'c' && event.key !== 'C') return
      if (event.target && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return
      chroma.mode = CHROMA_MODES[(CHROMA_MODES.indexOf(chroma.mode) + 1) % CHROMA_MODES.length]
      console.info(`[chroma] mode ${chroma.mode}`)
    }
    if (params.has('gui')) {
      window.addEventListener('keydown', handleKey)
      window.__chroma = { chroma, gyroSpin } // console access while comparing
    }

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('keydown', handleKey)
      root.style.removeProperty('--ca-text')
      root.style.filter = ''
      delete root.dataset.ca
      delete window.__chroma
    }
  }, [])

  // Each channel taken out on its own (red and blue shifted), then added back together.
  // sRGB: shift the displayed values as they are (no colour conversion round trip).
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <filter id="ca-split" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
        <feOffset ref={redRef} in="red" dx="0" dy="0" result="redShifted" />
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
        <feOffset ref={blueRef} in="blue" dx="0" dy="0" result="blueShifted" />
        <feBlend in="redShifted" in2="green" mode="screen" result="redGreen" />
        <feBlend in="redGreen" in2="blueShifted" mode="screen" />
      </filter>
    </svg>
  )
}
