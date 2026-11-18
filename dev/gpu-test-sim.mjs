// Logic check of lib/gyro/gpuTest.js with a fake GPU (no browser): node dev/gpu-test-sim.mjs
// A fake device with a given GPU time per level; results arrive 2 frames late, like real queries.
const { createGpuTest } = await import('../lib/gyro/gpuTest.js')
let seed = 11
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }

function run(name, { costs, noise = 0.05, loadExtra = 0, stressLeak = 0, supported = true, dense = false, spikes = 0 }) {
  seed = 11
  let layers = 4, asked = 2, res = 1, result = null
  const levelNow = () => (res < 1 ? 4 : layers === 4 ? 0 : layers === 2 ? 1 : asked === 2 ? 2 : 3)
  const gyro = { defaultPeelLayers: 4, scaleFor: (m) => (dense ? 1 : m), setPeelLayers: (n) => { layers = n }, setMaxScale: (s) => { asked = s } }
  let now = 0
  const preloaderUntil = 2500
  const test = createGpuTest({ gyro, setResolution: (r) => { res = r }, timerSupported: supported, isPreloaderUp: () => now < preloaderUntil, onDone: (r) => { result = r } })
  const queue = []
  for (let f = 0; f < 5000 && !result; f += 1) {
    const busy = test.busyMs()
    const tag = test.tag()
    let lvl = levelNow()
    if (dense && lvl === 3) lvl = 2
    let ms = costs[lvl] * (1 + noise * (rnd() * 2 - 1))
    if (now < preloaderUntil) ms += loadExtra
    if (rnd() < spikes) ms += 2 + rnd() * 10 // other GPU work slipping in: only ever adds time
    if (busy) ms += stressLeak
    now += Math.max(16.7, Math.ceil((ms + busy) / 16.7) * 16.7)
    if (supported) queue.push({ ms, tag })
    while (queue.length > 2) test.sample(queue.shift())
    test.frame(now)
  }
  const v = result.verdicts
  const flags = Object.entries(v).map(([k, ok]) => `${k}:${ok ? 'yes' : 'NO'}`).join(' ')
  console.log(name.padEnd(46), `${(now / 1000).toFixed(1)} s`, JSON.stringify(result.after))
  console.log('   ', flags)
  return result
}

const pc = [6, 4.5, 3.5, 3.2, 2.5]
run('good timer, fast PC', { costs: pc })
run('good timer, slow Mac (Retina: Q3 = Q4)', { costs: [48, 29, 19, 19, 12], dense: true })
run('timer disturbed while loading (+5 ms)', { costs: pc, loadExtra: 5 })
run('timer leaks page stress (+6 ms under stress)', { costs: pc, stressLeak: 6 })
run('good timer, 40 % of frames disturbed (+2-12 ms)', { costs: pc, spikes: 0.4 })
run('noisy timer (+-40 %)', { costs: pc, noise: 0.4 })
run('timer blind to quality (same at all levels)', { costs: [5, 5, 5, 5, 5] })
run('no timer in this browser', { costs: pc, supported: false })
