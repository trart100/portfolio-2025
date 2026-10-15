# Artur Kalinowski — Motion Design Portfolio (one pager)

Next.js (pages router) + GSAP single-page portfolio: hero with a real-time 3D visual
(three.js) and interactive dot grid, a manifesto with word-by-word reveal, a contact section and a
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
- `public/assets/` — favicon, and the original background video (only the `?ref` comparison
  tool loads it; the page itself never does)

## Scroll echo tuning

The scroll "echo" (elements nudged by scroll momentum) lives in `components/Inertia.js`;
its defaults are `INERTIA_DEFAULTS`. Open the site with `?tune` (e.g.
`http://localhost:3000/?tune`) for a temporary slider panel (`components/InertiaTuner.js`)
that edits the values live, with presets and a "Copy values" button. Tuned values are kept
in localStorage for `?tune` visits only; normal visits always use the defaults.

## 3D background

A real-time three.js rebuild of the former background video (the video was dropped in 6.5.7;
without WebGL the page keeps its dark background). three.js is loaded as its own chunk.
It is rebuilt from the original Blender scene (`main_visual_for_claude.blend`): same camera,
three glass rings, the 5-ring gold array, the two walls of light and the linear 10 s loop.
Atmosphere: what is seen through a glass band (the gold and the far halves of the other
rings) is blurred and tinted like Cycles' rough glass,
plus optional glass haze and grain (the "Atmosphere" folder of the panel: amount, size,
colour, speed). The grain uses an integer hash (the common sin()-based one forms a lattice
on some GPUs), and the canvas is placed on whole screen pixels so the browser
never resamples it. The smoky wisps of the video were a separate layer added after the
render and are not rebuilt yet.

Dev aids (the old `?3d` switch is still accepted and changes nothing):

- `?t=2.5` freezes the animation at that second, for comparing poses with the video
- `?gui` adds a live look-tuning panel (lil-gui) with "Copy values" and
  "Reset all to starting values" (the `LOOK` values in `lib/gyro/config.js`)
- `?ref` opens the comparison tool: the original video drives the clock and the 3D
  follows frame by frame (Blender frame numbers). Modes: Side by side, Wipe (drag the line),
  Blend (crossfade slider), Difference (black = identical). Space = play/pause,
  arrows = ±1 frame (Shift = ±10), keys 1–4 = modes, "Site view" shows the page again.
  Combine with the panel: `?gui&ref`
- `?q=1..5` forces a quality level (see `lib/gyro/quality.js`); without it the level is
  picked automatically (not with `&t` / `&ref`)

- `components/GyroVisual.js` — canvas wrapper (inside `VideoVisual`, which adds the mouse-drift parallax);
  loads the scene on demand, rebuilds it after a lost WebGL context
- `components/GyroReference.js` — the `?ref` comparison tool (loaded only with `&ref`)
- `lib/gyro/clock.js` — shared time override (the comparison tool drives the 3D from the video)
- `lib/gyro/config.js` — values taken from the Blender file (camera, rings, gold, keyframes, look)
- `lib/gyro/scene.js` — the three.js scene, the loop and the final pass (a depth pre-pass finds
  the front-most surface at every pixel; the front layer is drawn sharp and everything behind
  it — gold and glass — goes into a "behind" image, separately blurred copies of the gold and
  of the glass, and depth images of the front glass and of what is behind it; combined so that
  things just behind the glass stay sharp and farther ones are blurred; since 6.5.2 the
  layers are peeled progressively (desktop 4, touch 1; "Quality" folder in `?gui`), so a
  band seen through two bands is blurred twice; then AgX tone mapping, exposure and grain.
  Desktop renders at 2x and averages down after tone mapping (supersampling); touch devices
  and canvases above 1920 px use 1x with 4x MSAA)
- `lib/gyro/quality.js` — adaptive quality: 5 levels (glass layers 4/2/1, 2x → 1x, 75% canvas).
  The level is picked behind the preloader from GPU-synced frame times (the preloader waits for
  it); afterwards one frame per second is timed the same way after draining the GPU queue (frame-rate
  caps like phone low-power mode don't count; lower quartile of 5, so the page's own GPU work
  doesn't either) and only sustained slowness (above 20 ms) steps down, one level at a time,
  never back up. The lowest level is still the 3D (no video or still-image fallback).
  Readout on the canvas element (inspector, also on phones): `data-quality` (level),
  `data-levels` (level@ms after start), `data-measured` (start-up ms per level tried),
  `data-watch` (latest typical frame ms).
- `lib/gyro/lightWalls.js` — the light-wall mesh exported from Blender (used for reflections)
- `lib/gyro/gui.js` — the `?gui` panel

## Versioning

The version from `package.json` is shown bottom-left next to the FPS readout. Bump it on
every change (`npm version 6.X.Y --no-git-tag-version`) and tag the commit `v6.X.Y`, so a
preview or deployment can be matched to the code at a glance. The last number never goes
past 9: after 6.3.9 comes 6.4.0, after 6.4.9 comes 6.5.0.
