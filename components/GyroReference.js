import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FIRST_FRAME, FPS, LOOP_FRAMES } from '../lib/gyro/config'
import { gyroClock } from '../lib/gyro/clock'

// Comparison tool for the 3D background (dev aid, ?ref). The original video is the master
// clock: on every video frame the 3D scene renders the same moment. Frame numbers follow
// Blender (1..300). Page content is hidden while the tool is on ("Site view" shows it again).
const VIDEO_SRC = '/assets/video_visual_for_website_1.mp4'
const MODES = [
  { key: 'side', label: 'Side by side' },
  { key: 'wipe', label: 'Wipe' },
  { key: 'blend', label: 'Blend' },
  { key: 'diff', label: 'Difference' }
]
const SPEEDS = [0.25, 0.5, 1]
const BAR_HEIGHT = 56
const GAP = 16
const ROOT_CLASS = 'gyro-ref'
const CSS_VARS = ['--ref-size', '--ref-x', '--ref-y', '--ref-clip', '--ref-opacity', '--ref-blend']

const wrapFrame = (n) => ((n % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES

// Positions and size on whole screen pixels, so the 3D canvas isn't resampled (keeps the grain crisp)
function layoutFor(mode) {
  const dpr = window.devicePixelRatio || 1
  const snap = (value) => Math.round(value * dpr) / dpr
  const w = window.innerWidth
  const availH = window.innerHeight - BAR_HEIGHT - GAP * 2
  if (mode === 'side') {
    const size = snap(Math.max(50, Math.min((w - GAP * 3) / 2, availH)))
    return { size, videoX: snap((w - GAP) / 2 - size), canvasX: snap((w + GAP) / 2), y: snap(GAP + (availH - size) / 2) }
  }
  const size = snap(Math.max(50, Math.min(w - GAP * 2, availH)))
  const x = snap((w - size) / 2)
  return { size, videoX: x, canvasX: x, y: snap(GAP + (availH - size) / 2) }
}

export default function GyroReference() {
  const videoRef = useRef(null)
  const [mode, setMode] = useState('side')
  const [siteView, setSiteView] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [frame, setFrame] = useState(0) // video frame index 0..299 (Blender frame = index + 1)
  const [wipe, setWipe] = useState(50)
  const [blend, setBlend] = useState(50)
  const [layout, setLayout] = useState(null)
  const draggingRef = useRef(false)

  // Video -> shared clock (exact presented frame when requestVideoFrameCallback exists)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    const sync = (n) => {
      const index = wrapFrame(n)
      gyroClock.seconds = index / FPS
      setFrame(index)
    }
    let cancelled = false
    let handle = null
    let rafId = null
    const hasRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype
    if (hasRvfc) {
      const onFrame = (_now, meta) => {
        if (cancelled) return
        sync(Math.round(meta.mediaTime * FPS))
        handle = video.requestVideoFrameCallback(onFrame)
      }
      handle = video.requestVideoFrameCallback(onFrame)
    } else {
      const poll = () => {
        if (cancelled) return
        sync(Math.floor(video.currentTime * FPS + 1e-3))
        rafId = requestAnimationFrame(poll)
      }
      rafId = requestAnimationFrame(poll)
    }
    const onSeeked = () => sync(Math.floor(video.currentTime * FPS + 1e-3))
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      cancelled = true
      if (hasRvfc && handle != null) video.cancelVideoFrameCallback(handle)
      if (rafId != null) cancelAnimationFrame(rafId)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      gyroClock.seconds = null
    }
  }, [])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
  }, [speed])

  // Layout + the CSS hooks that move the 3D canvas (see the <style> block below)
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const next = layoutFor(mode)
      setLayout(next)
      root.style.setProperty('--ref-size', `${next.size}px`)
      root.style.setProperty('--ref-x', `${next.canvasX}px`)
      root.style.setProperty('--ref-y', `${next.y}px`)
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [mode])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle(ROOT_CLASS, !siteView)
    root.style.setProperty('--ref-clip', mode === 'wipe' ? `inset(0 0 0 ${wipe}%)` : 'none')
    root.style.setProperty('--ref-opacity', mode === 'blend' ? String(blend / 100) : '1')
    root.style.setProperty('--ref-blend', mode === 'diff' ? 'difference' : 'normal')
  }, [mode, wipe, blend, siteView])

  useEffect(() => () => {
    const root = document.documentElement
    root.classList.remove(ROOT_CLASS)
    CSS_VARS.forEach((name) => root.style.removeProperty(name))
  }, [])

  const seekFrame = useCallback((n) => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.currentTime = (wrapFrame(n) + 0.5) / FPS
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }, [])

  // Space = play/pause, arrows = +-1 frame (Shift = +-10), 1-4 = view modes
  useEffect(() => {
    const onKey = (event) => {
      const target = event.target
      const typing = target && ((target.tagName === 'INPUT' && target.type !== 'range') || target.tagName === 'TEXTAREA')
      if (typing || (target && target.closest && target.closest('.lil-gui'))) return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowLeft' ? -1 : 1)
        seekFrame(frame + step)
      } else if (['1', '2', '3', '4'].includes(event.key)) {
        setMode(MODES[Number(event.key) - 1].key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [frame, seekFrame, togglePlay])

  // Wipe handle drag
  useEffect(() => {
    const onMove = (event) => {
      if (!draggingRef.current || !layout) return
      const pct = ((event.clientX - layout.canvasX) / layout.size) * 100
      setWipe(Math.min(100, Math.max(0, pct)))
    }
    const onUp = () => { draggingRef.current = false }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [layout])

  const seconds = (frame / FPS).toFixed(2)
  const hint = {
    side: 'left: video · right: 3D',
    wipe: 'left of the line: video · right: 3D',
    blend: 'crossfade video → 3D',
    diff: 'black = identical · bright = different'
  }[mode]

  const ui = (
    <>
      <style>{`
        html.${ROOT_CLASS}{ overflow:hidden; }
        html.${ROOT_CLASS} .page-content{ z-index:auto; visibility:hidden; }
        html.${ROOT_CLASS} .video-visual{
          visibility:visible; z-index:2045;
          left:var(--ref-x) !important; top:var(--ref-y) !important;
          width:var(--ref-size); height:var(--ref-size);
          max-width:none; max-height:none; border-radius:0;
          transform:none !important;
          /* black backing: the 3D is judged as one solid image (the glass only adds light) */
          background:#000;
          opacity:var(--ref-opacity, 1);
          clip-path:var(--ref-clip, none);
          mix-blend-mode:var(--ref-blend, normal);
        }
        html.${ROOT_CLASS} .video-visual canvas,
        html.${ROOT_CLASS} .video-visual canvas.is-ready{ opacity:1; transition:none; border-radius:0; }
        .gyro-ref-stage{ position:fixed; inset:0; z-index:2040; background:#000; }
        .gyro-ref-stage video{ position:absolute; display:block; object-fit:cover; }
        .gyro-ref-handle{ position:fixed; z-index:2046; width:24px; margin-left:-12px; cursor:ew-resize; touch-action:none; }
        .gyro-ref-handle::after{ content:''; position:absolute; left:11px; top:0; bottom:0; width:2px; background:#eccfab; }
        .gyro-ref-bar{
          position:fixed; left:0; right:0; bottom:0; height:${BAR_HEIGHT}px; z-index:2060;
          display:flex; align-items:center; gap:10px; padding:0 14px; box-sizing:border-box;
          background:rgba(0,0,0,0.88); color:#ddd; border-top:1px solid rgba(255,255,255,0.12);
          font:12px/1.2 monospace; white-space:nowrap;
        }
        .gyro-ref-bar button{
          background:rgba(255,255,255,0.08); color:#ddd; border:1px solid rgba(255,255,255,0.2);
          border-radius:6px; padding:5px 8px; font:inherit; cursor:pointer;
        }
        .gyro-ref-bar button.is-on{ border-color:#eccfab; color:#eccfab; }
        .gyro-ref-bar input[type=range]{ accent-color:#eccfab; }
        .gyro-ref-bar .grow{ flex:1; min-width:80px; }
        .gyro-ref-bar .sep{ width:1px; height:24px; background:rgba(255,255,255,0.15); }
      `}</style>

      {/* Site view: invisible but still rendered, so the video keeps reporting frames */}
      <div
        className="gyro-ref-stage"
        style={siteView ? { opacity: 0, pointerEvents: 'none' } : undefined}
        aria-hidden="true"
      >
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          muted
          loop
          autoPlay
          playsInline
          style={layout ? { left: layout.videoX, top: layout.y, width: layout.size, height: layout.size } : undefined}
        />
      </div>

      {mode === 'wipe' && !siteView && layout && (
        <div
          className="gyro-ref-handle"
          style={{ left: layout.canvasX + (layout.size * wipe) / 100, top: layout.y, height: layout.size }}
          onPointerDown={(event) => { draggingRef.current = true; event.preventDefault() }}
        />
      )}

      <div className="gyro-ref-bar">
        <button type="button" onClick={togglePlay} title="Space">{playing ? 'Pause' : 'Play'}</button>
        <button type="button" onClick={() => seekFrame(frame - 1)} title="Left arrow (Shift = 10)">-1</button>
        <button type="button" onClick={() => seekFrame(frame + 1)} title="Right arrow (Shift = 10)">+1</button>
        <input
          className="grow"
          type="range"
          min={0}
          max={LOOP_FRAMES - 1}
          step={1}
          value={frame}
          onChange={(event) => seekFrame(Number(event.target.value))}
          aria-label="Frame"
        />
        <span>frame {String(frame + FIRST_FRAME).padStart(3, ' ')} / {LOOP_FRAMES} · {seconds} s</span>
        <span className="sep" />
        {SPEEDS.map((value) => (
          <button key={value} type="button" className={speed === value ? 'is-on' : ''} onClick={() => setSpeed(value)}>
            {value}x
          </button>
        ))}
        <span className="sep" />
        {MODES.map((m, i) => (
          <button key={m.key} type="button" className={mode === m.key ? 'is-on' : ''} onClick={() => setMode(m.key)} title={`Key ${i + 1}`}>
            {m.label}
          </button>
        ))}
        {mode === 'blend' && (
          <input type="range" min={0} max={100} value={blend} onChange={(event) => setBlend(Number(event.target.value))} aria-label="3D opacity" />
        )}
        <span>{hint}</span>
        <span className="sep" />
        <button type="button" className={siteView ? 'is-on' : ''} onClick={() => setSiteView((v) => !v)}>Site view</button>
      </div>
    </>
  )

  return createPortal(ui, document.body)
}
