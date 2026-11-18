// "Lite" 3D = the phone setup: 1 glass layer, no supersampling or MSAA, pixel density at most
// 1.5, at most 30 frames a second, fewer ring segments, a small reflection map, one blur round.
// Phones / tablets (pointer: coarse) always use it. On a computer: ?lite shows it (preview,
// 6.8.14), and setLiteMode() can switch it on while the page runs (GyroVisual rebuilds the
// scene, since segments / reflection map / MSAA are fixed when the scene is made).
// The speed effects keep their own touch / desktop choice (effects.js).
let forced = null

const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

export function liteMode() {
  if (forced != null) return forced
  if (typeof window === 'undefined') return false
  return isTouch() || new URLSearchParams(window.location.search).has('lite')
}

export function setLiteMode(on) {
  forced = on
}

// The phone setup on a computer (the automatic switch, or ?lite): shown and counted as quality
// level 6 (6.8.15), after the computer levels 1-5. Phones keep their own 1-5.
export function liteOnComputer() {
  return liteMode() && !isTouch()
}
