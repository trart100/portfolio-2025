import { useEffect, useRef } from 'react'
import { effects, fxFrame, updateEffects, EFFECT_MODES } from '../lib/gyro/effects'
import { gyroSpin } from '../lib/gyro/spin'

const STEP = 0.25 // px; amounts are rounded to this so the page only repaints on real changes
const RED = 'rgba(255, 0, 0, 0.7)'
const BLUE = 'rgba(0, 90, 255, 0.7)'

const snap = (value) => Math.round(value / STEP) * STEP

// Page side of the speed-driven effects (effects.js: chromatic aberration + shake); the 3D side
// of mode a is in scene.js. Updates the shared frame values once per frame, then:
// Mode b (desktop): the SVG filter below on <html> = true RGB split + shake of the whole page,
//   3D included. On <html> because a filter on any other element would break its position:fixed
//   children (the 3D, the menu); removed whenever both amounts are 0, so at rest it costs nothing.
// Mode a (touch): red/blue text-shadow on the text (--ca-text) and a CSS translate on the text
//   blocks (--shake-x / --shake-y, class fx-shake on <html>; see globals.css).
// Compare: ?fx=auto|off|a|b; with ?gui the "Speed effects" folder switches it live and can hold
// the energy at a fixed level, and the C key cycles the modes.
export default function SpeedEffects() {
  const redRef = useRef(null)
  const greenRef = useRef(null)
  const blueRef = useRef(null)

  useEffect(() => {
    const root = document.documentElement
    const params = new URLSearchParams(window.location.search)
    const forced = params.get('fx') || params.get('ca')
    if (EFFECT_MODES.includes(forced)) effects.mode = forced

    let last = ''
    let frameId = null
    const begin = performance.now()
    const loop = (now) => {
      frameId = requestAnimationFrame(loop)
      updateEffects((now - begin) / 1000)
      const { mode } = fxFrame
      const chroma = snap(fxFrame.chroma)
      const x = snap(fxFrame.shakeX)
      const y = snap(fxFrame.shakeY)
      const key = `${mode} ${chroma} ${x} ${y}`
      if (key === last) return
      last = key

      const inPage = mode === 'a'
      if (inPage && chroma > 0) root.style.setProperty('--ca-text', `${-chroma}px 0 0 ${RED}, ${chroma}px 0 0 ${BLUE}`)
      else root.style.removeProperty('--ca-text')
      if (inPage && (x || y)) {
        root.style.setProperty('--shake-x', `${x}px`)
        root.style.setProperty('--shake-y', `${y}px`)
        root.classList.add('fx-shake')
      } else root.classList.remove('fx-shake')

      if (mode === 'b' && (chroma > 0 || x || y)) {
        redRef.current.setAttribute('dx', String(x - chroma))
        redRef.current.setAttribute('dy', String(y))
        greenRef.current.setAttribute('dx', String(x))
        greenRef.current.setAttribute('dy', String(y))
        blueRef.current.setAttribute('dx', String(x + chroma))
        blueRef.current.setAttribute('dy', String(y))
        root.style.filter = 'url(#fx-speed)'
      } else root.style.filter = ''
      root.dataset.fx = key
    }
    frameId = requestAnimationFrame(loop)

    const handleKey = (event) => {
      if (event.key !== 'c' && event.key !== 'C') return
      if (event.target && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return
      effects.mode = EFFECT_MODES[(EFFECT_MODES.indexOf(effects.mode) + 1) % EFFECT_MODES.length]
      console.info(`[effects] mode ${effects.mode}`)
    }
    if (params.has('gui')) {
      window.addEventListener('keydown', handleKey)
      window.__fx = { effects, fxFrame, gyroSpin } // console access while comparing
    }

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('keydown', handleKey)
      root.style.removeProperty('--ca-text')
      root.classList.remove('fx-shake')
      root.style.filter = ''
      delete root.dataset.fx
      delete window.__fx
    }
  }, [])

  // Each channel taken out on its own and moved (shake + red/blue split), then added back together.
  // sRGB: shift the displayed values as they are (no colour conversion round trip).
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <filter id="fx-speed" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
        <feOffset ref={redRef} in="red" dx="0" dy="0" result="redShifted" />
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
        <feOffset ref={greenRef} in="green" dx="0" dy="0" result="greenShifted" />
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
        <feOffset ref={blueRef} in="blue" dx="0" dy="0" result="blueShifted" />
        <feBlend in="redShifted" in2="greenShifted" mode="screen" result="redGreen" />
        <feBlend in="redGreen" in2="blueShifted" mode="screen" />
      </filter>
    </svg>
  )
}
