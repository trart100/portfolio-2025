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

## 3D background (work in progress)

A real-time three.js rebuild of the background video, shown only with `?3d`
(`http://localhost:3000/?3d`); normal visits keep the video and never download three.js.
It is rebuilt from the original Blender scene (`main_visual_for_claude.blend`): same camera,
three glass rings, the 5-ring gold array, the two walls of light and the linear 10 s loop.

- `?3d&t=2.5` freezes the animation at that second, for comparing poses with the video
- `?3d&gui` adds a live look-tuning panel (lil-gui) with "Copy values" and
  "Reset all to starting values" (the `LOOK` values in `lib/gyro/config.js`)

- `components/GyroVisual.js` — canvas wrapper used by `VideoVisual`; loads the scene on
  demand, falls back to the video if WebGL fails
- `lib/gyro/config.js` — values taken from the Blender file (camera, rings, gold, keyframes, look)
- `lib/gyro/scene.js` — the three.js scene and the loop
- `lib/gyro/lightWalls.js` — the light-wall mesh exported from Blender (used for reflections)
- `lib/gyro/gui.js` — the `?3d&gui` panel

## Versioning

The version from `package.json` is shown bottom-left next to the FPS readout. Bump it on
every change (`npm version 6.3.X --no-git-tag-version`) and tag the commit `v6.3.X`, so a
preview or deployment can be matched to the code at a glance.
