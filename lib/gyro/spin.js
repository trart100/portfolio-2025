// Click / tap spin-up. Every click anywhere on the page adds speed to the gold; the glass picks
// up the gold's speed with a lag (the gold drives the glass). Clicks add up; without clicks both
// ease back to the normal loop speed. VideoVisual counts the clicks (`gyroSpin.kicks`),
// GyroVisual's loop steps the clocks.
// `energy` (0..1) = the gold's extra speed / max, smoothed; every speed-driven effect reads it
// (chroma.js). `hold` (0..1, or null) pins it for comparing effects (?gui).
export const gyroSpin = { kicks: 0, energy: 0, hold: null }

const MAX_STEP = 0.1 // s; a longer gap (background tab, hitch) counts as 0.1 s
const ENERGY_ATTACK = 0.08 // s; smooths the jump of a click so effects don't pop

// Own animation clock for the gold and for the glass (seconds of loop time). `settings` =
// LOOK.spin, read every step (live with ?gui): kick = extra speed per click (1 = +1x the normal
// speed), max = most extra speed, follow = how long (s) the glass takes to catch up with the
// gold's speed, settle = how long (s) the gold's extra speed takes to fade (time constant).
export function createSpinClock(settings) {
  let gold = 0
  let glass = 0
  let goldBoost = 0
  let glassBoost = 0
  let energy = 0
  return {
    step(dt) {
      const step = Math.min(Math.max(dt, 0), MAX_STEP)
      if (gyroSpin.kicks) {
        goldBoost = Math.min(goldBoost + gyroSpin.kicks * settings.kick, settings.max)
        gyroSpin.kicks = 0
      }
      glassBoost += (goldBoost - glassBoost) * (1 - Math.exp(-step / Math.max(settings.follow, 0.01)))
      goldBoost *= Math.exp(-step / Math.max(settings.settle, 0.01))
      gold += step * (1 + goldBoost)
      glass += step * (1 + glassBoost)
      const target = settings.max > 0 ? goldBoost / settings.max : 0
      energy += (target - energy) * (1 - Math.exp(-step / ENERGY_ATTACK))
      if (energy < 0.0005) energy = 0
      gyroSpin.energy = gyroSpin.hold != null ? gyroSpin.hold : energy
    },
    get gold() { return gold },
    get glass() { return glass }
  }
}
