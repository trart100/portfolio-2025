import { QUALITY_LEVELS } from './quality.js' // with .js so node can run dev/gpu-test-sim.mjs

// ?gputest: checks on this very device whether the GPU timer (gpuTimer.js) is a measurement the
// quality picking can rely on. It walks through the quality levels by itself and reports:
//   load    Q1..Q5 while the page is still loading (behind the preloader)
//   after   Q1..Q5 twice, once the preloader is gone
//   stress  Q1 again while the page itself is made slow on purpose (STRESS_MS of busy work per
//           frame): the GPU time must stay, the frames per second must drop
// and judges (see `verdicts`): timer available; rises with quality; repeatable; the same while
// loading; the same under stress. Result: on screen (showGpuTestResult), in window.__gpuTest,
// and as a `gpu_test` event when statistics are on (?track&testrun=...).
// What is judged is the LOW end of a level's frames (`lo`, the 20th percentile), not the median:
// the timer reports elapsed GPU time, so other GPU work that slips in between (the browser's own
// drawing, other programs, shader compiling while loading) can only ADD time. First real run
// (2026-11-18, RTX 3060, real scene): Q1 single frames 5-17 ms, but the low end 5.1 / 5.2 / 6.0 ms
// in three rounds. `noisy` = share of frames more than 1.5x over the low end (shown, not judged).
const WARM = 8 // frames after a level change not measured (new images, shaders)
const SAMPLES = 40
const LOW = 0.2
const STEP_TIMEOUT_MS = 6000
const SETTLE_MS = 1000 // after the preloader is gone, before the "after" rounds
const STRESS_MS = 12
// "burst" / "hot": the same picture is drawn BURST times per frame. A graphics card slows its
// own clock down while the work is light (seen 2026-11-18 with nvidia-smi during this test:
// 210-780 MHz, and Q1 read 3.0 ms at the higher clock, 6.2 ms at the lower one), so a frame's GPU
// time says little about what the card CAN do. Under a full load the clock goes up: the burst
// row shows the time per frame falling (series = lowest time per 10 frames), the "hot" rows
// the levels measured right after it, still under load.
const BURST = 6

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]
const round2 = (value) => Math.round(value * 100) / 100
const within = (a, b, share) => a != null && b != null && Math.abs(a - b) <= share * Math.max(a, b)

export function createGpuTest({ gyro, setResolution, timerSupported, isPreloaderUp, onDone }) {
  const levels = QUALITY_LEVELS.map((_, i) => i)
  const steps = [
    ...levels.map((level) => ({ phase: 'load', level })),
    { wait: true },
    ...levels.map((level) => ({ phase: 'after1', level })),
    ...levels.map((level) => ({ phase: 'after2', level })),
    { phase: 'stress', level: 0, busy: STRESS_MS },
    { phase: 'burst', level: 0, repeat: BURST, samples: 150 * BURST, series: true },
    ...[...levels].reverse().map((level) => ({ phase: 'hot', level, repeat: BURST, samples: 12 * BURST, warm: 4 }))
  ]
  let index = -1
  let step = null
  let frameNo = 0
  let samples = []
  let series = []
  let firstAt = null
  let lastAt = null
  let counted = 0
  let preUp = 0
  let startedAt = 0
  let clearSince = null
  let resolution = null
  let done = false
  const rows = []

  const apply = (level) => {
    const q = QUALITY_LEVELS[level]
    gyro.setPeelLayers(Math.min(q.layers, gyro.defaultPeelLayers))
    gyro.setMaxScale(q.scale)
    if (q.resolution !== resolution) {
      resolution = q.resolution
      setResolution(resolution)
    }
  }
  const next = (now) => {
    index += 1
    step = steps[index] || null
    frameNo = 0
    samples = []
    series = []
    firstAt = null
    lastAt = null
    counted = 0
    preUp = 0
    startedAt = now
    clearSince = null
    if (!step) {
      finish()
      return
    }
    apply(step.wait ? 0 : step.level)
  }
  const closeStep = () => {
    const sorted = [...samples].sort((a, b) => a - b)
    rows.push({
      phase: step.phase,
      level: step.level + 1,
      n: sorted.length,
      lo: sorted.length ? round2(quantile(sorted, LOW)) : null,
      ms: sorted.length ? round2(quantile(sorted, 0.5)) : null,
      p90: sorted.length ? round2(quantile(sorted, 0.9)) : null,
      noisy: sorted.length ? Math.round((sorted.filter((v) => v > 1.5 * quantile(sorted, LOW)).length / sorted.length) * 100) : null,
      fps: counted > 1 && lastAt > firstAt ? Math.round(((counted - 1) * 1000) / (lastAt - firstAt)) : null,
      series: step.series ? series.filter((v) => v != null).map(round2) : undefined,
      preloader: counted ? Math.round((preUp / counted) * 100) : 0 // % of frames with the preloader up
    })
  }
  const row = (phase, level) => rows.find((r) => r.phase === phase && r.level === level) || {}
  const finish = () => {
    done = true
    apply(0)
    const all = levels.map((l) => l + 1)
    const after = (l) => {
      const a = row('after1', l).lo
      const b = row('after2', l).lo
      return a != null && b != null ? round2((a + b) / 2) : null
    }
    // levels that differ on this device (e.g. Retina: Q3 = Q4), for the "rises" check
    const state = (l) => {
      const q = QUALITY_LEVELS[l - 1]
      return `${Math.min(q.layers, gyro.defaultPeelLayers)}|${gyro.scaleFor(q.scale)}|${q.resolution}`
    }
    const distinct = all.filter((l, i) => i === 0 || state(l) !== state(all[i - 1]))
    const afterRows = rows.filter((r) => r.phase.startsWith('after') && r.lo != null)
    const stress = row('stress', 1)
    const verdicts = {
      timer: !!timerSupported && afterRows.length > 0,
      // more quality = more GPU time. Q1 > Q2 > Q3 (glass layers) and the lowest level cheapest;
      // Q4 (1x + MSAA) is not required to be cheaper than Q3 (2x): measured about equal before
      rises: distinct.length > 1 && after(1) != null && after(1) > after(2) && after(2) > after(3) && Math.min(after(3), after(4)) > after(5),
      repeatable: all.every((l) => within(row('after1', l).lo, row('after2', l).lo, 0.15)),
      sameWhileLoading: all.every((l) => within(row('load', l).lo, after(l), 0.2)),
      sameUnderStress: within(stress.lo, after(1), 0.15),
      // the stress really slowed the page (otherwise the stress row proves nothing)
      stressSlowedPage: stress.fps != null && row('after2', 1).fps != null && stress.fps < row('after2', 1).fps * 0.85
    }
    const noisy = afterRows.length ? Math.max(...afterRows.map((r) => r.noisy)) : null
    const hot = Object.fromEntries(all.map((l) => [`q${l}`, row('hot', l).lo == null ? null : row('hot', l).lo]))
    // Under a full load: does the time per frame fall (the card speeds its clock up), and do the
    // levels then cost what their settings say (every distinct level cheaper than the one above)?
    const burstSeries = (rows.find((r) => r.series) || {}).series || []
    verdicts.fasterUnderLoad = burstSeries.length > 2 && Math.min(...burstSeries) <= 0.85 * burstSeries[0]
    verdicts.hotRises = distinct.length > 1 && distinct.every((l, i) => i === 0 || (hot[`q${l}`] != null && hot[`q${l}`] < hot[`q${distinct[i - 1]}`]))
    onDone({ supported: !!timerSupported, rows, after: Object.fromEntries(all.map((l) => [`q${l}`, after(l)])), hot, noisy, verdicts })
  }

  return {
    isDone: () => done,
    // true once the "load" rounds are measured: GyroVisual then lets the preloader finish
    loadDone: () => done || index > levels.length - 1,
    getLevel: () => (step && !step.wait ? step.level + 1 : 1),
    busyMs: () => (step && step.busy) || 0,
    // how many times the coming frame is drawn (burst / hot rounds: more than once)
    repeat: () => (step && step.repeat) || 1,
    // label for the timer query of the coming frame
    tag: () => ({ step: index, n: frameNo }),
    sample: ({ ms, tag }) => {
      if (done || !step || step.wait || !tag || tag.step !== index || tag.n < (step.warm || WARM)) return
      if (samples.length < (step.samples || SAMPLES)) samples.push(ms)
      if (step.series) {
        const bucket = Math.floor(tag.n / 10)
        series[bucket] = series[bucket] == null ? ms : Math.min(series[bucket], ms)
      }
    },
    // after every drawn frame
    frame: (now) => {
      if (done) return
      if (index < 0) next(now)
      if (!step) return
      if (step.wait) {
        if (isPreloaderUp()) clearSince = null
        else if (clearSince == null) clearSince = now
        if (clearSince != null && now - clearSince >= SETTLE_MS) next(now)
        return
      }
      frameNo += 1
      if (frameNo > (step.warm || WARM)) {
        if (firstAt == null) firstAt = now
        lastAt = now
        counted += 1
        if (isPreloaderUp()) preUp += 1
      }
      const enough = timerSupported ? samples.length >= (step.samples || SAMPLES) : counted >= SAMPLES
      if (enough || now - startedAt > STEP_TIMEOUT_MS) {
        closeStep()
        next(now)
      }
    }
  }
}

// The result as a small panel over the page (Polish: it is read by the site's owner)
export function showGpuTestResult(result, info = {}) {
  const old = document.getElementById('gpu-test-result')
  if (old) old.remove()
  const el = document.createElement('div')
  el.id = 'gpu-test-result'
  el.style.cssText = 'position:fixed;left:12px;top:12px;z-index:3000;max-height:calc(100vh - 24px);overflow:auto;background:rgba(0,0,0,0.92);color:#ddd;font:12px/1.5 monospace;padding:14px 16px;border:1px solid #444;border-radius:8px;max-width:calc(100vw - 24px)'
  const mark = (ok) => (ok ? '<span style="color:#7fd28a">TAK</span>' : '<span style="color:#e8785a">NIE</span>')
  const v = result.verdicts
  const phases = { load: 'w trakcie ładowania', after1: 'po załadowaniu, 1. raz', after2: 'po załadowaniu, 2. raz', stress: 'strona spowolniona celowo', burst: `karta pod pełnym obciążeniem (Q1 ×${BURST})`, hot: 'zaraz po obciążeniu' }
  const cell = 'padding:1px 10px 1px 0;text-align:right'
  const num = (value) => (value == null ? '–' : value.toFixed(2))
  const body = result.rows.map((r) => `<tr><td style="padding-right:10px">${phases[r.phase] || r.phase}</td><td style="${cell}">Q${r.level}</td><td style="${cell};color:#fff">${num(r.lo)}</td><td style="${cell};color:#888">${num(r.ms)}</td><td style="${cell};color:#888">${num(r.p90)}</td><td style="${cell};color:#888">${r.noisy == null ? '–' : `${r.noisy}%`}</td><td style="${cell}">${r.fps == null ? '–' : r.fps}</td><td style="${cell};color:#888">${r.preloader}%</td></tr>`).join('')
  el.innerHTML = `
    <div style="font-weight:700;color:#fff;margin-bottom:6px">Test miernika karty graficznej</div>
    <div style="color:#888;margin-bottom:8px">${info.renderer || ''}<br>okno ${info.viewport || ''}, gęstość ${info.dpr || ''}, obraz 3D ${info.canvas || ''}</div>
    <div>Miernik dostępny w tej przeglądarce: ${mark(v.timer)}</div>
    <div>Pod pełnym obciążeniem karta przyspiesza (czas klatki spada): ${mark(v.fasterUnderLoad)}</div>
    <div>Zaraz po obciążeniu każdy niższy poziom jest tańszy: ${mark(v.hotRises)}</div>
    <div style="color:#888;margin-top:6px">Przy zwykłej pracy (karta sama zwalnia, więc „NIE” tutaj nie oznacza błędu miernika):</div>
    <div>Rośnie z jakością (Q1 &gt; Q2 &gt; Q3 &gt; Q5): ${mark(v.rises)}</div>
    <div>Powtarzalny (1. i 2. raz ±15%): ${mark(v.repeatable)}</div>
    <div>Ten sam w trakcie ładowania (±20%): ${mark(v.sameWhileLoading)}</div>
    <div>Ten sam przy spowolnionej stronie (±15%): ${mark(v.sameUnderStress)} <span style="color:#888">(strona faktycznie zwolniła: ${v.stressSlowedPage ? 'tak' : 'nie'})</span></div>
    <div style="color:#888">„GPU ms” to dolna granica czasu klatki. Zakłócone klatki: do ${result.noisy == null ? '–' : result.noisy}%.</div>
    <table style="border-collapse:collapse;margin-top:10px">
      <tr style="color:#888"><td>kiedy</td><td style="${cell}">poziom</td><td style="${cell}">GPU ms</td><td style="${cell}">środek</td><td style="${cell}">górne 10%</td><td style="${cell}">zakłóc.</td><td style="${cell}">kl./s</td><td style="${cell}">ekran ład.</td></tr>
      ${body}
    </table>
    <div style="color:#888;margin-top:8px;max-width:560px">Pod obciążeniem, czas klatki co 10 klatek: ${((result.rows.find((r) => r.series) || {}).series || []).join(' ')}</div>
    <div style="color:#888;margin-top:8px">Kliknij, żeby zamknąć.</div>`
  el.addEventListener('click', () => el.remove())
  document.body.appendChild(el)
}
