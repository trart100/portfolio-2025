// Site statistics (PostHog). One import point, like lib/gsap.js.
//
// Base layer (6.8.0), no consent needed:
//   - no cookies, no localStorage on the visitor's device (persistence 'memory'):
//     every page load is a new anonymous visitor, nothing is stored
//   - page view + page leave, clicks on links / buttons / the canvas (autocapture)
//   - country / region / city: PostHog derives them from the IP address on its side
//     (the browser's location permission is never asked)
// Not here yet: custom events (6.8.1), heatmaps + session recordings after "Accept" (6.8.2).
//
// Not tracked:
//   - without a key (POSTHOG_KEY empty) -> nothing loads at all
//   - localhost / 127.0.0.1 and Vercel preview deployments (unless ?track, for testing)
//   - dev-flag visits: ?gui ?ref ?tune ?t ?q ?fx ?ca
//   - your own visits: open the site once with ?notrack (kept in this browser);
//     ?track removes the mark again
// posthog-js is loaded as its own chunk, after the page is up, so it never delays the preloader.

import pkg from '../package.json'

// Public project key ("phc_..."). It is meant to be in client code; it can only send events.
export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || 'phc_AYt4myt3jPtALmznrnftfMELsBQzHmSYynfttV4syz2N'
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com'

const IGNORE_KEY = 'analytics-ignore'
const DEV_FLAGS = ['gui', 'ref', 'tune', 't', 'q', 'fx', 'ca']

let started = false
let ph = null

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
      loaded: (p) => {
        p.register({
          site_version: pkg.version,
          touch: window.matchMedia('(pointer: coarse)').matches,
        })
      },
    })
    ph = posthog
    window.__analytics = { on: true, posthog }
  }).catch(() => {
    window.__analytics = { on: false, reason: 'load failed' }
  })
}

// Custom events (used from 6.8.1). Safe to call anytime; does nothing when not tracking.
export function track(name, props) {
  if (ph) ph.capture(name, props)
}
