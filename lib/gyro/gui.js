import GUI from 'lil-gui'
import { gyroSpin } from './spin'
import { fxFrame } from './effects'

// Live look tuning for the 3D background, shown with ?gui (dev aid, not for visitors).
// "Copy values" puts LOOK on the clipboard in the shape used in config.js.
export function createGyroGui(gyro) {
  const { look, applyLook, rebuildLights } = gyro
  const gui = new GUI({ title: '3D look' })
  Object.assign(gui.domElement.style, { left: '12px', right: 'auto', top: '12px', zIndex: '2050' })

  gui.add(look, 'exposure', 0.2, 3, 0.01).name('Exposure').onChange(applyLook)
  gui.add(look, 'walls', 0, 200, 1).name('Light walls').onChange(rebuildLights)

  const glass = gui.addFolder('Glass')
  glass.add(look.glass, 'roughness', 0, 1, 0.01).name('Roughness').onChange(applyLook)
  glass.add(look.glass, 'ior', 1, 2.5, 0.01).name('IOR').onChange(applyLook)
  glass.add(look.glass, 'coat', 0, 1, 0.01).name('Coat').onChange(applyLook)
  glass.add(look.glass, 'coatRoughness', 0, 1, 0.01).name('Coat roughness').onChange(applyLook)
  glass.add(look.glass, 'reflection', 0, 4, 0.01).name('Reflection').onChange(applyLook)
  glass.add(look.glass, 'dim', 0, 1, 0.01).name('Dims what is behind').onChange(applyLook)

  const gold = gui.addFolder('Gold')
  ;['R', 'G', 'B'].forEach((label, i) => {
    gold.add(look.gold.color, String(i), 0, 2, 0.01).name(`Colour ${label} (linear)`).onChange(applyLook)
  })
  gold.add(look.gold, 'metalness', 0, 1, 0.01).name('Metallic').onChange(applyLook)
  gold.add(look.gold, 'roughness', 0, 1, 0.01).name('Roughness').onChange(applyLook)
  gold.add(look.gold, 'reflection', 0, 4, 0.01).name('Reflection').onChange(applyLook)

  const atmosphere = gui.addFolder('Atmosphere')
  atmosphere.add(look.atmosphere, 'blur', 0, 0.05, 0.001).name('Blur through glass').onChange(applyLook)
  atmosphere.add(look.atmosphere, 'glassBlur', 0, 0.05, 0.001).name('Glass blur (behind glass)')
  atmosphere.add(look.atmosphere, 'behind', 0, 2, 0.01).name('Seen through glass').onChange(applyLook)
  atmosphere.add(look.atmosphere, 'glassBehind', 0, 3, 0.01).name('Glass behind glass')
  atmosphere.add(look.atmosphere, 'blurReach', 0, 4, 0.01).name('Blur reach (distance)').onChange(applyLook)
  atmosphere.add(look.atmosphere, 'haze', 0, 0.1, 0.001).name('Glass haze').onChange(applyLook)
  atmosphere.add(look.atmosphere, 'grain', 0, 0.5, 0.005).name('Grain').onChange(applyLook)
  atmosphere.add(look.atmosphere, 'grainSize', 1, 4, 0.1).name('Grain size (px)').onChange(applyLook)
  atmosphere.add(look.atmosphere, 'grainColor', 0, 1, 0.01).name('Grain colour').onChange(applyLook)
  atmosphere.add(look.atmosphere, 'grainFps', 0, 60, 1).name('Grain speed (per s)')

  // Read every frame by the scene (px at the screen edge)
  const drift = gui.addFolder('Mouse drift')
  drift.add(look.drift, 'glass', 0, 80, 1).name('Glass (px)')
  drift.add(look.drift, 'gold', 0, 80, 1).name('Gold (px)')

  // Click / tap spin-up, read every frame (spin.js)
  const spin = gui.addFolder('Click spin')
  spin.add(look.spin, 'kick', 0, 10, 0.1).name('Speed per click (x)')
  spin.add(look.spin, 'max', 0, 50, 0.5).name('Max extra speed (x)')
  spin.add(look.spin, 'follow', 0, 3, 0.05).name('Glass lag (s)')
  spin.add(look.spin, 'settle', 0.2, 10, 0.1).name('Slow-down (s)')
  spin.add(look.spin, 'scroll', 0, 100, 1).name('Speed per 1000 px scrolled (x)')

  // Effects from the spin speed (effects.js). Compare: pick a mode, tick "Hold" to pin the
  // energy (no clicking needed), watch the FPS meter; the C key cycles the modes too.
  const test = {
    get energy() { return gyroSpin.energy.toFixed(2) },
    set energy(value) {},
    get now() { return `${fxFrame.mode} / split ${fxFrame.chroma.toFixed(1)} / shake ${Math.hypot(fxFrame.shakeX, fxFrame.shakeY).toFixed(1)}` },
    set now(value) {},
    get holdOn() { return gyroSpin.hold != null },
    set holdOn(on) { gyroSpin.hold = on ? test.holdAt : null },
    holdAt: 1
  }
  const fx = gui.addFolder('Speed effects')
  fx.add(look.effects, 'mode', { 'Auto (B desktop, A touch)': 'auto', 'Off': 'off', 'A: 3D shader + CSS': 'a', 'B: SVG filter, whole page': 'b' }).name('Mode').listen()
  fx.add(look.effects.chroma, 'strength', 0, 40, 0.5).name('Colour split at full speed (px)')
  fx.add(look.effects.chroma, 'curve', 0.2, 3, 0.05).name('Colour split curve')
  fx.add(look.effects.shake, 'strength', 0, 40, 0.5).name('Shake at full speed (px)')
  fx.add(look.effects.shake, 'curve', 0.2, 3, 0.05).name('Shake curve')
  fx.add(look.effects.shake, 'speed', 1, 30, 0.5).name('Shake rate (Hz)')
  fx.add(test, 'holdOn').name('Test: hold energy')
  fx.add(test, 'holdAt', 0, 1, 0.01).name('Held energy').onChange((value) => {
    if (gyroSpin.hold != null) gyroSpin.hold = value
  })
  fx.add(test, 'energy').name('Energy now').disable().listen()
  fx.add(test, 'now').name('Now (px)').disable().listen()

  const actions = {
    copy: () => {
      const text = `export const LOOK = ${JSON.stringify(look, null, 2)}\n`
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => console.log(text))
      else console.log(text)
    },
    // Every control back to its starting value (LOOK in config.js)
    reset: () => gui.reset()
  }
  gui.add(actions, 'copy').name('Copy values')
  gui.add(actions, 'reset').name('Reset all to starting values')

  // Rendering quality, not part of the look (not copied)
  // Level = adaptive quality (quality.js, ?q=1..5 forces one); both readouts follow it live
  const quality = {
    get layers() { return gyro.getPeelLayers() },
    set layers(value) { gyro.setPeelLayers(value) },
    get level() {
      const q = gyro.quality
      return q ? `${q.getLevel()} (${gyro.getScale()}x${q.getResolution() < 1 ? `, ${q.getResolution() * 100}%` : ''})` : '-'
    },
    set level(value) {} // read-only; "Reset all" sets every controller
  }
  const qualityFolder = gui.addFolder('Quality')
  qualityFolder.add(quality, 'level').name('Level (auto)').disable().listen()
  qualityFolder.add(quality, 'layers', 1, 6, 1).name('Glass layers (blur steps)').listen()

  return gui
}
