import { LOOK } from './config'
import { gyroSpin } from './spin'

// Chromatic aberration driven by the spin speed (gyroSpin.energy, 0..1): red shifts left, blue
// right, by `chromaPixels()` CSS px. Two ways to put it on the site, picked by `mode`
// (?ca=off|a|b, or ?gui):
//   a = real channel split in the 3D's final shader pass + red/blue text-shadow on the page text
//   b = one SVG filter on the whole page (<html>), a true split of everything; the 3D's own split
//       is off then (it would be doubled). Only on while the amount is above 0.
// Shared, mutable settings: the scene puts this object into its `look` (so ?gui edits it and
// "Copy values" includes it), the page driver (ChromaticAberration.js) reads it every frame.
export const chroma = { ...LOOK.chroma }

export const CHROMA_MODES = ['off', 'a', 'b']

// Shift in CSS px for the current energy: strength at full speed, `curve` < 1 = stronger early
export function chromaPixels() {
  const energy = Math.min(Math.max(gyroSpin.hold != null ? gyroSpin.hold : gyroSpin.energy, 0), 1)
  return energy > 0 ? chroma.strength * Math.pow(energy, chroma.curve) : 0
}
