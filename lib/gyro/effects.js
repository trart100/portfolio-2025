import { LOOK } from './config'
import { gyroSpin } from './spin'

// Effects driven by the spin speed (gyroSpin.energy, 0..1); the faster the spin, the stronger:
//   chroma = chromatic aberration: red shifts left, blue right
//   shake  = the whole picture shakes (smooth random wobble)
// Each grows as strength x energy^curve (CSS px). How they are put on the site = `mode`:
//   b = one SVG filter on the whole page (<html>): true RGB split + shake of everything
//       (SpeedEffects.js). Desktop default.
//   a = colour split + shake in the 3D's final shader pass (scene.js), shake also as a CSS
//       translate on the page blocks (SpeedEffects.js); the page text gets no colour split.
//       Touch default (an SVG filter over the page is too heavy for phones).
//   auto = b on desktop, a on touch; off = none. ?fx=auto|off|a|b forces one (?ca= still works).
// Shared, mutable settings: the scene puts this object into its `look` (so ?gui edits it and
// "Copy values" includes it).
export const effects = JSON.parse(JSON.stringify(LOOK.effects))

export const EFFECT_MODES = ['auto', 'off', 'a', 'b']

// This frame's values, written once per frame by SpeedEffects (page), read by the scene
export const fxFrame = { mode: 'off', chroma: 0, shakeX: 0, shakeY: 0 }

let touch = null
const isTouch = () => {
  if (touch == null) touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  return touch
}

export function resolveMode() {
  if (effects.mode !== 'auto') return effects.mode
  return isTouch() ? 'a' : 'b'
}

const TAU = Math.PI * 2

export function updateEffects(seconds) {
  const held = gyroSpin.hold != null ? gyroSpin.hold : gyroSpin.energy
  const energy = Math.min(Math.max(held, 0), 1)
  const response = (settings) => (energy > 0 ? settings.strength * Math.pow(energy, settings.curve) : 0)
  fxFrame.mode = resolveMode()
  fxFrame.chroma = response(effects.chroma)
  // Three sines per axis at unrelated rates (base, ~2x, ~3.5x `speed` Hz): looks random, stays
  // smooth, and never goes past the amplitude (weights add up to 1)
  const amplitude = response(effects.shake)
  const t = seconds * effects.shake.speed * TAU
  fxFrame.shakeX = amplitude * (0.5 * Math.sin(t + 1.3) + 0.3 * Math.sin(1.93 * t + 4.1) + 0.2 * Math.sin(3.17 * t + 2.2))
  fxFrame.shakeY = amplitude * (0.5 * Math.sin(1.11 * t + 0.4) + 0.3 * Math.sin(2.27 * t + 5.3) + 0.2 * Math.sin(3.71 * t + 1.7))
}
