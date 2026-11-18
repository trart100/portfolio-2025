// Quality-picking simulation (6.8.16): runs lib/gyro/quality.js against model computers.
// Frames are GPU-bound: a frame takes its cost rounded up to the screen refresh. Run: node dev/quality-sim.mjs
// (Node warns that the module type is not set; harmless.)
globalThis.document = { hidden: false }
const Q = await import('../lib/gyro/quality.js')
let seed = 5
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
function run(name, costs, { hz = 60, cap = 60, touch = false, dense = false, noise = 0.15, beginAt = 3000, busyMs = 0, busyAdd = 0, laterSlow = null } = {}) {
  seed = 5
  const gyro = { defaultPeelLayers: touch ? 1 : 4, scaleFor: (m) => (touch || dense ? 1 : m), setPeelLayers: () => {}, setMaxScale: () => {} }
  let settledAt = null, lite = null, now = 0, last = -1e9, begun = false
  const q = Q.createQualityController({ gyro, setResolution: () => {}, onSettled: () => { settledAt = now }, onLite: (f) => { lite = f } })
  const steps = []
  const vsync = 1000 / hz, minFrame = 1000 / cap - 2
  while (now < 25000) {
    now += vsync
    if (!begun && now >= beginAt) { q.begin(); begun = true }
    if (now - last < minFrame) continue
    const lvl = q.getLevel() - 1
    let cost = costs[lvl] * (1 + noise * (rnd() * 2 - 1))
    if (begun && now - beginAt < busyMs) cost += busyAdd
    if (laterSlow && now > laterSlow.at) cost += laterSlow.add
    now += Math.max(0, Math.ceil(cost / vsync) * vsync - vsync)
    last = now
    const before = q.getLevel()
    q.frame(now)
    if (q.getLevel() !== before) steps.push(`Q${q.getLevel()}@+${((now - beginAt) / 1000).toFixed(1)}s`)
    if (settledAt != null && !laterSlow && now > settledAt + 500) break
  }
  const out = lite != null ? `Q6 (${Math.round(lite)} fps at Q5)` : `Q${q.getLevel()}`
  console.log(name.padEnd(40), out.padEnd(18), `settled +${((settledAt - beginAt) / 1000).toFixed(1)} s`.padEnd(16), 'steps:', steps.join(' ') || '-', ' tried:', q.getFps().join(' '))
}
run('your PC (6 ms at Q1)', [6, 4.5, 3.5, 3.2, 2.5])
run('your PC, busy 1.5 s (+10 ms)', [6, 4.5, 3.5, 3.2, 2.5], { busyMs: 1500, busyAdd: 10 })
run('Mac Retina (25 ms at Q1)', [25, 15, 9.8, 9.8, 5.5], { dense: true })
run('mid PC (22 ms at Q1)', [22, 13, 8.6, 7.7, 4.8])
run('weak Mac (60 ms at Q1)', [60, 36, 23, 21, 13])
run('Amsterdam-like (146 ms at Q1)', [146, 90, 60, 56, 40])
run('laptop power saving (30 Hz)', [6, 4.5, 3.5, 3.2, 2.5], { hz: 30, cap: 30 })
run('120 Hz MacBook Pro (12 ms at Q1)', [12, 7, 4.7, 4.2, 2.6], { hz: 120, dense: true })
run('phone (lite, 30 fps cap)', [7, 7, 7, 7, 4], { touch: true, cap: 30 })
run('your PC, gets slow after 10 s (+20 ms)', [6, 4.5, 3.5, 3.2, 2.5], { laterSlow: { at: 13000, add: 20 } })
