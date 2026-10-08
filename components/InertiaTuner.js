import { useEffect, useState } from 'react'
import { INERTIA_DEFAULTS, INERTIA_GROUPS, inertiaParams } from './Inertia'

// TEMPORARY tuning panel for the scroll echo (Inertia). Shown only with ?tune in the URL.
// Values persist in localStorage for ?tune visits only; normal visits always use the defaults.
const STORAGE_KEY = 'inertia-tune'
const clone = (o) => JSON.parse(JSON.stringify(o))

const PHYSICS = [
  { key: 'inSpring', label: 'Push spring', min: 0.002, max: 0.25, step: 0.002 },
  { key: 'inFriction', label: 'Push glide', min: 0.5, max: 0.98, step: 0.01 },
  { key: 'outSpring', label: 'Return spring', min: 0.002, max: 0.25, step: 0.002 },
  { key: 'outFriction', label: 'Return glide', min: 0.5, max: 0.98, step: 0.01 },
  { key: 'idleMs', label: 'Return delay ms', min: 0, max: 600, step: 10 }
]

// Starting points; they only change the physics rows, not the per-group values.
// Default = INERTIA_DEFAULTS (snappy); Slow = the original soft echo.
const PRESETS = {
  Default: {},
  'Slow (old)': { inSpring: 0.01, inFriction: 0.9, outSpring: 0.01, outFriction: 0.9, idleMs: 120 },
  Bouncy: { inSpring: 0.05, inFriction: 0.88, outSpring: 0.04, outFriction: 0.88, idleMs: 100 }
}
const PHYSICS_DEFAULTS = Object.fromEntries(PHYSICS.map(({ key }) => [key, INERTIA_DEFAULTS[key]]))

const fmt = (v) => String(Number(v.toFixed(3)))

export default function InertiaTuner() {
  const [values, setValues] = useState(null)
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  const apply = (next) => {
    Object.keys(next).forEach((k) => {
      inertiaParams[k] = typeof next[k] === 'object' ? { ...next[k] } : next[k]
    })
    setValues(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch (e) {}
  }

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('tune')) return
    let stored = null
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) } catch (e) {}
    // merge over the defaults so keys added later still get a value
    const start = clone(INERTIA_DEFAULTS)
    if (stored) {
      Object.keys(start).forEach((k) => {
        if (!(k in stored)) return
        start[k] = typeof start[k] === 'object' ? { ...start[k], ...stored[k] } : stored[k]
      })
    }
    apply(start)
  }, [])

  if (!values) return null

  const setPhysics = (key, v) => apply({ ...values, [key]: v })
  const setGroup = (group, key, v) => apply({ ...values, [group]: { ...values[group], [key]: v } })
  const applyPreset = (name) => apply({ ...values, ...PHYSICS_DEFAULTS, ...PRESETS[name] })

  const copy = async () => {
    const text = JSON.stringify(values, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      window.prompt('Copy these values:', text)
    }
  }

  const row = (id, label, value, min, max, step, onChange) => (
    <label className="it-row" key={id}>
      <span className="it-name">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="it-val">{fmt(value)}</span>
    </label>
  )

  return (
    <div className="inertia-tuner">
      <button type="button" className="it-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Scroll echo tuner <span>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="it-body">
          <div className="it-presets">
            {Object.keys(PRESETS).map((name) => (
              <button type="button" key={name} onClick={() => applyPreset(name)}>{name}</button>
            ))}
          </div>

          <div className="it-section">Physics</div>
          {PHYSICS.map(({ key, label, min, max, step }) =>
            row(key, label, values[key], min, max, step, (v) => setPhysics(key, v)))}

          {INERTIA_GROUPS.map(({ key, label }) => (
            <div key={key}>
              <div className="it-section">{label}</div>
              {row(`${key}-factor`, 'Strength', values[key].factor, 0, 2, 0.05, (v) => setGroup(key, 'factor', v))}
              {row(`${key}-max`, 'Max px', values[key].max, 0, 600, 10, (v) => setGroup(key, 'max', v))}
            </div>
          ))}

          <div className="it-actions">
            <button type="button" onClick={copy}>{copied ? 'Copied ✓' : 'Copy values'}</button>
            <button type="button" onClick={() => apply(clone(INERTIA_DEFAULTS))}>Reset</button>
          </div>
        </div>
      )}

      <style jsx global>{`
        .inertia-tuner{
          position:fixed; left:12px; top:12px; z-index:2050;
          width:300px; max-height:calc(100vh - 140px); overflow:auto;
          background:rgba(0,0,0,0.88); color:#ddd;
          border:1px solid rgba(255,255,255,0.12); border-radius:8px;
          font-family:monospace; font-size:11px;
        }
        .inertia-tuner button{
          font:inherit; color:#fff; cursor:pointer;
          background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2);
          border-radius:4px; padding:4px 8px;
        }
        .inertia-tuner .it-head{
          width:100%; display:flex; justify-content:space-between;
          background:none; border:none; border-radius:8px; padding:8px 10px; font-weight:700;
        }
        .inertia-tuner .it-body{ padding:0 10px 10px; }
        .inertia-tuner .it-presets, .inertia-tuner .it-actions{ display:flex; gap:6px; margin:4px 0 6px; }
        .inertia-tuner .it-actions{ margin-top:10px; }
        .inertia-tuner .it-section{ margin:8px 0 2px; color:#eccfab; font-weight:700; }
        .inertia-tuner .it-row{ display:grid; grid-template-columns:105px 1fr 44px; align-items:center; gap:6px; }
        .inertia-tuner .it-row input{ width:100%; accent-color:#eccfab; }
        .inertia-tuner .it-val{ text-align:right; color:#fff; }
      `}</style>
    </div>
  )
}
