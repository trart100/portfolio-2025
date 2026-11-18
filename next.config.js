// Statistics through this site's own address (6.8.11), used only for visitors who clicked
// "Accept" (lib/analytics.js, PROXY_HOST): /akx/... is passed on to PostHog EU, so a tracker
// blocker (e.g. Brave) does not drop the events of someone who agreed to them.
// The path is deliberately plain and not on the common block lists (checked 2026-11 against
// EasyPrivacy, EasyList and uBlock filters; avoid /ingest, /s, /analytics, /posthog ...).
// Order matters: static and array before the catch-all.
module.exports = {
  async rewrites() {
    return [
      { source: '/akx/static/:path*', destination: 'https://eu-assets.i.posthog.com/static/:path*' },
      { source: '/akx/array/:path*', destination: 'https://eu-assets.i.posthog.com/array/:path*' },
      { source: '/akx/:path*', destination: 'https://eu.i.posthog.com/:path*' },
    ]
  },
  // PostHog's paths end with a slash (/e/, /flags/): no redirect round trip for them
  skipTrailingSlashRedirect: true,
}
