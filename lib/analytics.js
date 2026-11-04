// Site statistics (PostHog). One import point, like lib/gsap.js.
//
// Base layer (6.8.0), no consent needed:
//   - no cookies, no localStorage on the visitor's device (persistence 'memory'):
//     every page load is a new anonymous visitor, nothing is stored
//   - page view + page leave, clicks on links / buttons / the canvas (autocapture)
//   - country / region / city: PostHog derives them from the IP address on its side
//     (the browser's location permission is never asked)
// Custom events (6.8.1), all anonymous:
//   menu_click {item}                         (components/Menu.js)
//   showreel_open / showreel_progress {percent 25|50|75|95} /
//   showreel_close {open_s, watched_s, max_percent, zoom}   (components/ShowreelOverlay.js, Vimeo messages)
//   section_view {section}                    manifesto / contact seen (a quarter visible), once each
//   scroll_depth {percent 25|50|75|100}       once each
//   contact_click {link} / contact_copy       email or LinkedIn clicked, or text copied in the contact block
//   visual_clicks {count 1|5|20|50, peak_energy}  clicks / taps on the page itself (they spin the 3D)
//   visual_quality {level, levels, measured_ms, watch_ms, ready_ms, dpr, screen}  10 s after start
//   $pageleave gets a visit summary: clicks, max scroll %, peak spin energy, quality level, showreel watched s
// Not here yet: heatmaps + session recordings after "Accept" (6.8.2).
//
// Not tracked:
//   - without a key (POSTHOG_KEY empty) -> nothing loads at all
//   - localhost / 127.0.0.1 and Vercel preview deployments (unless ?track, for testing)
//   - dev-flag visits: ?gui ?ref ?tune ?t ?q ?fx ?ca
//   - your own visits: open the site once with ?notrack (kept in this browser);
//     ?track removes the mark again
// posthog-js is loaded as its own chunk, after the page is up, so it never delays the preloader.

import pkg from '../package.json'
import { gyroSpin } from './gyro/spin'

// Public project key ("phc_..."). It is meant to be in client code; it can only send events.
export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || 'phc_AYt4myt3jPtALmznrnftfMELsBQzHmSYynfttV4syz2N'
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com'

const IGNORE_KEY = 'analytics-ignore'
const DEV_FLAGS = ['gui', 'ref', 'tune', 't', 'q', 'fx', 'ca']

let started = false
let ph = null

// Visit summary, sent with $pageleave (and partly with the events above)
const visit = { clicks: 0, maxScroll: 0, peakEnergy: 0, showreelWatched: 0, readyMs: null }

// The 3D sends 'videoCanPlay' when its quality level is settled, often before statistics start,
// so listen from the moment this module loads
if (typeof window !== 'undefined') {
  window.addEventListener('videoCanPlay', () => {
    if (visit.readyMs == null) visit.readyMs = Math.round(performance.now())
  }, { once: true })
}

function readIgnoreMark(params) {
  try {
    if (params.has('notrack')) localStorage.setItem(IGNORE_KEY, '1')
    if (params.has('track')) localStorage.removeItem(IGNORE_KEY)
    return localStorage.getItem(IGNORE_KEY) === '1'
  } catch (e) {
    return false
  }
}

// Why this visit is not tracked, or '' when it is.
export function skipReason() {
  if (typeof window === 'undefined') return 'server'
  if (!POSTHOG_KEY) return 'no key'
  const params = new URLSearchParams(window.location.search)
  if (readIgnoreMark(params)) return 'own visit (?notrack)'
  const forced = params.has('track')
  const host = window.location.hostname
  if (!forced && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]')) return 'localhost'
  if (!forced && process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview') return 'preview deployment'
  if (DEV_FLAGS.some((f) => params.has(f))) return 'dev flag'
  return ''
}

export function initAnalytics() {
  if (started) return
  started = true
  const reason = skipReason()
  if (reason) {
    window.__analytics = { on: false, reason }
    return
  }
  import('posthog-js').then(({ default: posthog }) => {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      persistence: 'memory', // nothing stored on the device
      person_profiles: 'identified_only', // anonymous events only
      capture_pageview: true,
      capture_pageleave: true, // gives time on page
      autocapture: true, // clicks
      enable_heatmaps: false, // 6.8.2, after consent
      disable_session_recording: true, // 6.8.2, after consent
      disable_surveys: true,
      advanced_disable_feature_flags: true,
      before_send: (event) => {
        if (event && event.event === '$pageleave') Object.assign(event.properties, visitSummary())
        return event
      },
      loaded: (p) => {
        p.register({
          site_version: pkg.version,
          touch: window.matchMedia('(pointer: coarse)').matches,
        })
      },
    })
    ph = posthog
    window.__analytics = { on: true, posthog, visit }
    watchPage()
  }).catch(() => {
    window.__analytics = { on: false, reason: 'load failed' }
  })
}

// Custom events. Safe to call anytime; does nothing when not tracking.
export function track(name, props) {
  if (ph) ph.capture(name, props)
}

// Showreel watch time, added to the visit summary (ShowreelOverlay)
export function addShowreelWatched(seconds) {
  visit.showreelWatched += seconds
}

const round2 = (v) => Math.round(v * 100) / 100

function qualityReadout() {
  const canvas = document.querySelector('canvas[data-quality]')
  if (!canvas) return { level: null }
  const d = canvas.dataset
  return {
    level: Number(d.quality),
    levels: d.levels || '',
    measured_ms: d.measured || '',
    watch_ms: d.watch ? Number(d.watch) : null,
  }
}

function visitSummary() {
  return {
    visual_clicks: visit.clicks,
    max_scroll_percent: visit.maxScroll,
    peak_energy: round2(visit.peakEnergy),
    showreel_watched_s: Math.round(visit.showreelWatched),
    quality_level: qualityReadout().level,
  }
}

// Page-wide listeners, started once statistics are on
function watchPage() {
  // Sections seen (a quarter of them visible), once each
  const seen = new Set()
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const id = entry.target.id
      if (entry.isIntersecting && !seen.has(id)) {
        seen.add(id)
        track('section_view', { section: id })
        io.unobserve(entry.target)
      }
    })
  }, { threshold: 0.25 })
  ;['manifesto', 'contact'].forEach((id) => {
    const el = document.getElementById(id)
    if (el) io.observe(el)
  })

  // Scroll depth milestones
  const depths = [25, 50, 75, 100]
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight
    if (max <= 0) return
    const percent = Math.min(100, Math.round((window.scrollY / max) * 100))
    if (percent <= visit.maxScroll) return
    visit.maxScroll = percent
    while (depths.length && visit.maxScroll >= (depths[0] === 100 ? 98 : depths[0])) {
      track('scroll_depth', { percent: depths.shift() })
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true })

  // Clicks: contact links, and clicks on the page itself (those spin the 3D)
  const clickSteps = [1, 5, 20, 50]
  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null
    if (!target) return
    const link = target.closest('a')
    if (link && link.closest('.contact-items')) {
      const href = link.getAttribute('href') || ''
      track('contact_click', { link: href.startsWith('mailto:') ? 'email' : href.includes('linkedin') ? 'linkedin' : href })
      return
    }
    if (target.closest('a, button, input, .menu-bottom, .data-protection, .showreel-overlay')) return
    visit.clicks += 1
    if (clickSteps.length && visit.clicks >= clickSteps[0]) {
      const count = clickSteps.shift()
      // read the energy a moment later, once this click has been added to the spin
      setTimeout(() => {
        if (gyroSpin.energy > visit.peakEnergy) visit.peakEnergy = gyroSpin.energy
        track('visual_clicks', { count, peak_energy: round2(visit.peakEnergy) })
      }, 400)
    }
  }, true)
  document.addEventListener('copy', () => {
    const sel = document.getSelection()
    const node = sel && sel.anchorNode
    const el = node && (node.nodeType === 1 ? node : node.parentElement)
    if (el && el.closest('.contact-items')) track('contact_copy')
  })

  // Peak spin energy (0..1), sampled while the tab is visible
  setInterval(() => {
    if (document.hidden) return
    if (gyroSpin.energy > visit.peakEnergy) visit.peakEnergy = gyroSpin.energy
  }, 250)

  // 3D quality on this visitor's device, once
  setTimeout(() => {
    const q = qualityReadout()
    if (q.level == null) return
    track('visual_quality', {
      ...q,
      ready_ms: visit.readyMs,
      dpr: round2(window.devicePixelRatio || 1),
      screen: `${window.screen.width}x${window.screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    })
  }, 10000)
}
