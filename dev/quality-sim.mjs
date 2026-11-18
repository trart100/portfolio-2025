// Simulation of the quality picking (lib/gyro/quality.js, 6.8.18) on model computers whose
// graphics card changes its clock with the load, as measured on the owner's RTX 3060.
// Run: node dev/quality-sim.mjs   (Node warns that the module type is not set; harmless.)
//
// Model: `max` = GPU ms per level with the card at full clock. The card's clock f (fMin..1) drifts
// to where a frame takes ~63 % of the frame interval (up in ~0.8 s, down in ~1.5 s); a frame reads
// max / f. Frames take whole screen refreshes. GPU times arrive 2 frames late. The preloader is up
// for 2.5 s. `revealed` = when the quality let the preloader go; `seen` = level changes after that.
globalThis.document = { hidden: false }
const { createQualityController } = await import('../lib/gyro/quality.js')

let seed = 9
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }

function run(name, { max, fMin = 0.15, hz = 60, timer = true, touch = false, dense = false, lite = false, busy = null, seconds = 30 }) {
  seed = 9
  const cap = lite ? 1000 / 30 : 1000 / 60
  const vsync = 1000 / hz
  // the 3D draws every k-th screen refresh (its own cap), as GyroVisual works it out
  const frameMs = Math.max(1, Math.ceil((cap - 6) / vsync - 0.05)) * vsync
  let layers = 4, asked = 2, res = 1
  const levelNow = () => (res < 1 ? 4 : layers === 4 ? 0 : layers === 2 ? 1 : asked === 2 && !dense && !touch ? 2 : 3)
  const gyro = { defaultPeelLayers: touch ? 1 : 4, scaleFor: (m) => (touch || dense ? 1 : m), setPeelLayers: (n) => { layers = n }, setMaxScale: (s) => { asked = s } }
  let liteAt = null, now = 0, f = fMin * 2, hitch = 0
  const q = createQualityController({ gyro, setResolution: (r) => { res = r }, timerSupported: timer, frameMs, onLite: () => { liteAt = now } })
  const preloaderEnd = 2500
  let revealed = null, begun = false, seen = 0, lastLevel = q.getLevel()
  const queue = []
  let lastRender = -1e9
  while (now < seconds * 1000 && liteAt == null) {
    now += vsync
    if (now - lastRender < cap - 6) continue // the 3D own frame cap
    let lvl = touch ? (res < 1 ? 4 : 3) : levelNow()
    let ms = (max[lvl] / f) * (1 + 0.06 * (rnd() * 2 - 1))
    if (busy && now >= busy.from && now < busy.to) ms += busy.add // other GPU work slipping in
    if (hitch > 0) { ms += 30; hitch -= 1 }
    const took = Math.max(vsync, Math.ceil(ms / vsync) * vsync)
    // the card's clock follows the load
    const want = Math.min(1, Math.max(fMin, (max[lvl] + (busy && now >= busy.from && now < busy.to ? busy.add * f : 0)) / (0.63 * frameMs)))
    const tau = want > f ? 800 : 1500
    f += (want - f) * Math.min(1, took / tau)
    now += took - vsync
    lastRender = now
    const tag = q.tag()
    if (timer) queue.push({ ms, tag })
    while (queue.length > 2) q.gpu(queue.shift())
    if (!begun && now >= Math.max(preloaderEnd, revealed ?? 0)) { q.begin(); begun = true }
    q.frame(now)
    if (revealed == null && (q.isReadyToShow() || now > 2550)) revealed = now
    if (q.getLevel() !== lastLevel) {
      lastLevel = q.getLevel()
      hitch = 2
      if (revealed != null && now > Math.max(revealed, preloaderEnd)) seen += 1
    }
  }
  const shown = Math.max(revealed ?? 0, preloaderEnd)
  console.log(`${name.padEnd(46)} ${(liteAt != null ? 'Q6' : `Q${q.getLevel()}`).padEnd(3)} revealed ${(shown / 1000).toFixed(1)} s  seen ${seen}  ${q.getMode()}  [${q.getLog().join('  ')}]`)
}

const pc = [4.0, 2.9, 2.1, 1.7, 0.6] // owner's PC, big window: Q1 4 ms at full clock
console.log('--- with the GPU timer')
run('owner PC (Q1 4 ms at full clock)', { max: pc })
run('owner PC, deep idle start (clock floor 10 %)', { max: pc, fMin: 0.1 })
run('owner PC, other GPU work for 4 s at t=10 s', { max: pc, busy: { from: 10000, to: 14000, add: 14 }, seconds: 60 })
run('good laptop (Q1 9 ms)', { max: [9, 6.3, 4.5, 3.8, 2.2] })
run('edge laptop (Q1 14 ms)', { max: [14, 9.8, 7, 5.9, 3.5] })
run('mid laptop (Q1 22 ms)', { max: [22, 15.4, 11, 9.2, 5.5] })
run('Mac Retina (Q1 30 ms, Q3 = Q4)', { max: [30, 21, 15, 15, 7.5], dense: true })
run('weak (Q1 60 ms)', { max: [60, 42, 30, 25, 15] })
run('Amsterdam-like (Q1 146 ms)', { max: [146, 100, 73, 61, 40] })
run('owner PC on a 30 Hz screen', { max: pc, hz: 30 })
run('owner PC on a 144 Hz screen', { max: pc, hz: 144 })
run('phone setup (30 fps), fine', { max: [7, 7, 7, 7, 4], touch: true, lite: true })
run('phone setup, weak (Q1 45 ms)', { max: [45, 45, 45, 45, 26], touch: true, lite: true })
console.log('--- without the timer (frame rate only)')
run('owner PC', { max: pc, timer: false })
run('mid laptop (Q1 22 ms)', { max: [22, 15.4, 11, 9.2, 5.5], timer: false })
run('weak (Q1 60 ms)', { max: [60, 42, 30, 25, 15], timer: false })
run('Amsterdam-like (Q1 146 ms)', { max: [146, 100, 73, 61, 40], timer: false })
run('owner PC on a 30 Hz screen', { max: pc, hz: 30, timer: false })
run('Safari Mac Retina (Q1 30 ms)', { max: [30, 21, 15, 15, 7.5], dense: true, timer: false })
