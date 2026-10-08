# Artur Kalinowski — Motion Design Portfolio (one pager)

Next.js (pages router) + GSAP single-page portfolio: hero with a looping video and
interactive dot grid, a manifesto with word-by-word reveal, a contact section and a
Vimeo showreel overlay.

## Run locally

```
npm install
npm run dev      # http://localhost:3000
npm run build    # production build check
```

## Structure

- `pages/index.js` — page layout, manifesto text, title auto-fit
- `pages/_app.js` — global UI: preloader, FPS/version meter, privacy box
- `components/` — one component per feature (`Menu`, `Cursor`, `DotGrid`, `VideoVisual`,
  `ShowreelOverlay`, `AnimatedParagraph`, `AnimatedInformation`, `Inertia`, …)
- `lib/gsap.js` — the single GSAP import point (registers ScrollTrigger and ScrollToPlugin);
  import GSAP from here, not from `gsap` directly
- `styles/globals.css` — all styles; responsive rules live at the end of the file
- `public/assets/` — background video and favicon

## Scroll echo tuning

The scroll "echo" (elements nudged by scroll momentum) lives in `components/Inertia.js`;
its defaults are `INERTIA_DEFAULTS`. Open the site with `?tune` (e.g.
`http://localhost:3000/?tune`) for a temporary slider panel (`components/InertiaTuner.js`)
that edits the values live, with presets and a "Copy values" button. Tuned values are kept
in localStorage for `?tune` visits only; normal visits always use the defaults.

## Versioning

The version from `package.json` is shown bottom-left next to the FPS readout. Bump it on
every change (`npm version 6.3.X --no-git-tag-version`) and tag the commit `v6.3.X`, so a
preview or deployment can be matched to the code at a glance.
