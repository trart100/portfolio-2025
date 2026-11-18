// GPU time of the 3D's own drawing, asked from the graphics card itself (WebGL 2 extension
// EXT_disjoint_timer_query_webgl2, TIME_ELAPSED). Unlike timing a forced wait (readPixels) it does
// not include waiting for the screen refresh, the browser's GPU queue or other programs, and it
// blocks nothing: the result of a frame arrives a few frames later.
// Checked 2026-11-18 (Chromium, RTX 3060, simple test drawing): 0.31 / 3.03 / 12.36 ms for
// 1x / 10x / 40x the work, repeat to repeat within 1 %.
// Not in every browser (Safari has none): `supported` says so and everything else is a no-op.
// One query at a time (WebGL allows only one TIME_ELAPSED query to be active).
const MAX_PENDING = 96

export function createGpuTimer(gl) {
  let ext = null
  try {
    if (gl && typeof gl.createQuery === 'function') ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  } catch (e) {
    ext = null
  }
  if (!ext) {
    return { supported: false, begin: () => {}, end: () => {}, poll: () => [], dispose: () => {} }
  }

  let active = null
  let pending = [] // { query, tag }, oldest first
  let broken = false
  const fail = () => {
    broken = true
    active = null
    pending = []
  }

  return {
    get supported() {
      return !broken
    },
    // `tag` comes back with the result (results arrive later, so the caller labels them)
    begin(tag) {
      if (broken || active || pending.length >= MAX_PENDING) return
      try {
        const query = gl.createQuery()
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
        active = { query, tag }
      } catch (e) {
        fail()
      }
    },
    end() {
      if (broken || !active) return
      try {
        gl.endQuery(ext.TIME_ELAPSED_EXT)
        pending.push(active)
        active = null
      } catch (e) {
        fail()
      }
    },
    // Finished measurements since the last call: [{ ms, tag }]. Call once per frame, before begin().
    poll() {
      if (broken || !pending.length) return []
      const out = []
      try {
        // "Disjoint" = the GPU's clock was disturbed (e.g. power state change): results are invalid
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT)
        while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
          const { query, tag } = pending.shift()
          if (!disjoint) out.push({ ms: gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6, tag })
          gl.deleteQuery(query)
        }
      } catch (e) {
        fail()
      }
      return out
    },
    dispose() {
      try {
        if (active) gl.endQuery(ext.TIME_ELAPSED_EXT)
        pending.forEach(({ query }) => gl.deleteQuery(query))
      } catch (e) {}
      active = null
      pending = []
    }
  }
}
