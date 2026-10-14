import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { CAMERA, FIRST_FRAME, FPS, GLASS_TINT, GOLD, LOOK, LOOP_FRAMES, RING, RINGS } from './config'
import { LIGHT_WALLS } from './lightWalls'

const clone = (value) => JSON.parse(JSON.stringify(value))
const GOLD_LAYER = 1

// Atmosphere (step 4) works on separate images that the final pass combines. The glass is
// split at the centre plane (where the gold sits):
//  main   = the near half of the rings + light, linear HDR
//  sharp  = "behind": the gold + the far half of the rings; blur = a blurred copy of it
//  near   = near glass: coverage in alpha (4x MSAA, so edges are antialiased) and 1/depth of
//           the nearest near-glass surface in red (stored as coverage * 1/depth)
//  behindDepth = 1/depth of the nearest "behind" surface (0 = nothing behind)
// Final: sharp "behind" where no near glass is in front; under near glass, a mix of sharp and
// blurred by how far behind the glass it is (touching = sharp, like Cycles' rough glass),
// tinted; near glass on top; then AgX tone mapping, exposure and grain.
const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
// Separable gaussian (5 linear-filtered taps = 9 texels), used twice per axis
const BLUR_MATERIAL_PARAMS = {
  uniforms: { tInput: { value: null }, uStep: { value: new THREE.Vector2() } },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tInput;
    uniform vec2 uStep;
    varying vec2 vUv;
    void main() {
      vec4 sum = texture2D(tInput, vUv) * 0.2270270270;
      sum += texture2D(tInput, vUv + uStep * 1.3846153846) * 0.3162162162;
      sum += texture2D(tInput, vUv - uStep * 1.3846153846) * 0.3162162162;
      sum += texture2D(tInput, vUv + uStep * 3.2307692308) * 0.0702702703;
      sum += texture2D(tInput, vUv - uStep * 3.2307692308) * 0.0702702703;
      gl_FragColor = sum;
    }
  `,
  depthTest: false,
  depthWrite: false,
  toneMapped: false
}
// 1/depth (view space) of the nearest surface, max blending (several layers: the nearest wins;
// cleared to 0 = nothing). Alpha 1 = coverage. Honours the centre-plane clipping.
const DEPTH_MATERIAL_PARAMS = {
  vertexShader: /* glsl */ `
    #include <common>
    #include <clipping_planes_pars_vertex>
    varying float vInvDepth;
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vInvDepth = 1.0 / -mvPosition.z;
      gl_Position = projectionMatrix * mvPosition;
      #include <clipping_planes_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    #include <clipping_planes_pars_fragment>
    varying float vInvDepth;
    void main() {
      #include <clipping_planes_fragment>
      gl_FragColor = vec4(vInvDepth, 0.0, 0.0, 1.0);
    }
  `,
  blending: THREE.CustomBlending,
  blendEquation: THREE.MaxEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  depthTest: false,
  depthWrite: false,
  toneMapped: false
}
const COMPOSITE_MATERIAL_PARAMS = {
  uniforms: {
    tMain: { value: null },
    tSharp: { value: null },
    tBlurGold: { value: null },
    tBlurGlass: { value: null },
    uBlurGoldSize: { value: new THREE.Vector2(1, 1) },
    uBlurGlassSize: { value: new THREE.Vector2(1, 1) },
    tNear: { value: null },
    tBehindDepth: { value: null },
    uBlurReach: { value: 1 },
    uBehind: { value: 0 },
    uGlassTint: { value: new THREE.Color() },
    uGrain: { value: 0 },
    uGrainFrame: { value: 0 },
    uGrainSize: { value: 1 },
    uGrainColor: { value: 0 }
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tMain;
    uniform sampler2D tSharp;
    uniform sampler2D tBlurGold;
    uniform sampler2D tBlurGlass;
    uniform vec2 uBlurGoldSize;
    uniform vec2 uBlurGlassSize;
    uniform sampler2D tNear;
    uniform sampler2D tBehindDepth;
    uniform float uBlurReach;
    uniform float uBehind;
    uniform vec3 uGlassTint;
    uniform float uGrain;
    uniform float uGrainFrame;
    uniform float uGrainSize;
    uniform float uGrainColor;
    varying vec2 vUv;
    // PCG integer hash. The sin()-based shortcut repeats in a diagonal lattice on some GPUs
    // (measured on NVIDIA through Direct3D), so the grain uses integer maths instead.
    uint pcgHash(uint v) {
      uint state = v * 747796405u + 2891336453u;
      uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
      return (word >> 22u) ^ word;
    }
    float grainCell(uvec2 cell, uint frame, uint channel) {
      return float(pcgHash(cell.x + pcgHash(cell.y + pcgHash(frame * 4u + channel)))) / 4294967295.0;
    }
    // Random value per grain cell, smoothly blended between cells. At size 1 every pixel sits
    // exactly on a cell, so it is plain per-pixel noise.
    float grainAt(vec2 p, uint frame, uint channel) {
      vec2 i = floor(p);
      vec2 f = p - i;
      f = f * f * (3.0 - 2.0 * f);
      uvec2 c = uvec2(i);
      float a = grainCell(c, frame, channel);
      float b = grainCell(c + uvec2(1u, 0u), frame, channel);
      float d = grainCell(c + uvec2(0u, 1u), frame, channel);
      float e = grainCell(c + uvec2(1u, 1u), frame, channel);
      return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
    }
    // Smooth (cubic B-spline) enlargement of the smaller blurred images: plain bilinear shows
    // their pixel grid as soft diamonds on strong gradients. 4 bilinear taps.
    vec4 textureSmooth(sampler2D tex, vec2 uv, vec2 size) {
      vec2 p = uv * size - 0.5;
      vec2 i = floor(p);
      vec2 f = p - i;
      vec2 f2 = f * f;
      vec2 f3 = f2 * f;
      vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
      vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
      vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
      vec2 w3 = f3 / 6.0;
      vec2 g0 = w0 + w1;
      vec2 g1 = w2 + w3;
      vec2 h0 = (i - 0.5 + w1 / g0) / size;
      vec2 h1 = (i + 1.5 + w3 / g1) / size;
      return g0.y * (g0.x * texture2D(tex, vec2(h0.x, h0.y)) + g1.x * texture2D(tex, vec2(h1.x, h0.y)))
           + g1.y * (g0.x * texture2D(tex, vec2(h0.x, h1.y)) + g1.x * texture2D(tex, vec2(h1.x, h1.y)));
    }
    void main() {
      vec4 mainColor = texture2D(tMain, vUv);
      vec4 sharp = texture2D(tSharp, vUv);
      // Blurred gold over the (more) blurred far glass; the gold's alpha is its coverage
      vec4 blurGold = textureSmooth(tBlurGold, vUv, uBlurGoldSize);
      vec3 blurGlass = textureSmooth(tBlurGlass, vUv, uBlurGlassSize).rgb;
      vec3 blurred = blurGlass * (1.0 - clamp(blurGold.a, 0.0, 1.0)) + blurGold.rgb;
      vec4 near = texture2D(tNear, vUv);
      float cover = near.a;
      // How far behind the near glass the "behind" surface is: 0 = touching (stays sharp),
      // uBlurReach or more = fully blurred. Nothing behind = fully blurred (shows the glow).
      float behindInv = texture2D(tBehindDepth, vUv).r;
      float nearInv = near.r / max(cover, 1e-4);
      float gap = behindInv > 1e-4 && nearInv > 1e-4 ? 1.0 / behindInv - 1.0 / nearInv : 1e3;
      float blurAmount = smoothstep(0.0, max(uBlurReach, 1e-3), gap);
      vec3 throughGlass = mix(sharp.rgb, blurred, blurAmount) * uGlassTint * uBehind;
      vec3 color = mainColor.rgb + sharp.rgb * (1.0 - cover) + throughGlass * cover;
      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      // Grain: render noise that scales with brightness, so black stays black.
      // Inputs: grain cell (pixel position / size) + frame number (new pattern every frame).
      // The +8 keeps cell numbers positive for sizes above 1.
      vec2 grainPos = gl_FragCoord.xy / max(uGrainSize, 1.0) - 0.5 + 8.0;
      uint grainFrame = uint(uGrainFrame);
      float grainMono = grainAt(grainPos, grainFrame, 0u);
      vec3 grainNoise = vec3(grainMono);
      if (uGrainColor > 0.0) {
        vec3 grainRgb = vec3(grainMono, grainAt(grainPos, grainFrame, 1u), grainAt(grainPos, grainFrame, 2u));
        grainNoise = mix(grainNoise, grainRgb, uGrainColor);
      }
      gl_FragColor.rgb *= 1.0 + uGrain * (grainNoise * 2.0 - 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false
}

// Position in the loop, 0..1. Video frame n (time n / 30 s) is Blender scene frame n + 1.
export function loopPhase(seconds) {
  const frame = FIRST_FRAME + seconds * FPS
  return (((frame / LOOP_FRAMES) % 1) + 1) % 1
}

// Closed band around the y axis (like the Blender ring after Solidify): inner wall,
// outer wall and the two thin edges, each strip with its own normals so the edges stay crisp.
function createBandGeometry(innerRadius, height, thickness, segments = 256) {
  const h = height / 2
  const outer = innerRadius + thickness
  // [r0, z0, r1, z1, normal r, normal z] around the z axis; winding matches the normal
  const strips = [
    [innerRadius, -h, innerRadius, h, -1, 0],
    [outer, h, outer, -h, 1, 0],
    [innerRadius, h, outer, h, 0, 1],
    [outer, -h, innerRadius, -h, 0, -1]
  ]
  const positions = []
  const normals = []
  const indices = []
  strips.forEach(([r0, z0, r1, z1, nr, nz]) => {
    const base = positions.length / 3
    for (let i = 0; i <= segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      positions.push(r0 * cos, r0 * sin, z0, r1 * cos, r1 * sin, z1)
      normals.push(nr * cos, nr * sin, nz, nr * cos, nr * sin, nz)
    }
    for (let i = 0; i < segments; i += 1) {
      const p = base + i * 2
      indices.push(p, p + 1, p + 2, p + 1, p + 3, p + 2)
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  geometry.rotateX(-Math.PI / 2) // band axis z -> y, as in the Blender mesh
  return geometry
}

// Bakes the two walls of light (exported from Blender) into a reflection map.
// Size per cube face: at the default 256 the rough glass/coat read coarse levels that show as
// faint straight lines in the reflections (still faintly visible at 512, gone at 1024).
// GPU memory (3*size x 4*size half-float): 1024 = ~100 MB, 512 = ~25 MB (touch devices).
const reflectionMapSize = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 512 : 1024
function bakeLightWalls(renderer, intensity) {
  const scene = new THREE.Scene()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(LIGHT_WALLS.positions, 3))
  geometry.setIndex(LIGHT_WALLS.indices)
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  material.color.setScalar(intensity)
  scene.add(new THREE.Mesh(geometry, material))
  const pmrem = new THREE.PMREMGenerator(renderer)
  const target = pmrem.fromScene(scene, 0, 0.1, 200, { size: reflectionMapSize() })
  pmrem.dispose()
  geometry.dispose()
  material.dispose()
  return target
}

export function createGyroScene(canvas) {
  const look = clone(LOOK)

  // Antialiasing happens in the multisampled images; the canvas only shows the final pass
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.AgXToneMapping // Blender's view transform
  renderer.localClippingEnabled = true

  const scene = new THREE.Scene()
  let envTarget = bakeLightWalls(renderer, look.walls)
  scene.environment = envTarget.texture

  const rebuildLights = () => {
    const previous = envTarget
    envTarget = bakeLightWalls(renderer, look.walls)
    scene.environment = envTarget.texture
    previous.dispose()
  }

  // Blender coordinates inside (z up); this converts them to three.js (y up)
  const root = new THREE.Group()
  root.rotation.x = -Math.PI / 2
  scene.add(root)

  const tanHalf = (CAMERA.sensor / 2 / CAMERA.lens) * CAMERA.frameScale
  const camera = new THREE.PerspectiveCamera(1, 1, 0.1, 200)
  camera.position.set(0, 0, CAMERA.distance)

  // Splits the glass at the centre plane (world z = 0, the camera looks straight at it):
  // normal +z keeps the near half, -z the far half. Flipped between the passes in render().
  const centrePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

  // Glass on black: the band's reflections are added in full and what is behind it is
  // dimmed by `opacity` (src * 1 + dst * (1 - alpha)). Black base colour: a fully
  // transmissive glass has no diffuse part.
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    clippingPlanes: [centrePlane],
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor
  })

  const ringGeometry = createBandGeometry(RING.radius - RING.thickness, RING.height, RING.thickness)
  const rings = RINGS.map((cfg) => {
    const mesh = new THREE.Mesh(ringGeometry, glassMaterial)
    mesh.scale.setScalar(cfg.scale)
    mesh.rotation.order = 'ZYX' // = Blender's XYZ Euler
    root.add(mesh)
    return { mesh, end: cfg.end }
  })

  const goldMaterial = new THREE.MeshStandardMaterial()
  const goldGeometry = new THREE.TorusGeometry(GOLD.ringRadius, GOLD.tube, 32, 160)
  const gold = new THREE.Group()
  gold.rotation.x = GOLD.objectRotationX
  gold.scale.setScalar(GOLD.objectScale)
  root.add(gold)
  const goldRings = Array.from({ length: GOLD.count }, (_, i) => {
    const mesh = new THREE.Mesh(goldGeometry, goldMaterial)
    mesh.scale.setScalar(GOLD.baseScale + GOLD.scaleStep * i)
    mesh.rotation.order = 'ZYX'
    mesh.layers.set(GOLD_LAYER) // drawn into its own image, see the final pass
    gold.add(mesh)
    return mesh
  })

  // Images for the final pass (sizes set in setSize). Main, "behind" and near get 4x MSAA.
  // goldTarget / glassTarget: half-size gold alone and far glass alone (at "Glass behind
  // glass" strength), each blurred with its own radius: the gold at half size, the glass
  // (bigger blur) at quarter size.
  const hdr = { type: THREE.HalfFloatType }
  const mainTarget = new THREE.WebGLRenderTarget(1, 1, { ...hdr, samples: 4 })
  const sharpTarget = new THREE.WebGLRenderTarget(1, 1, { ...hdr, samples: 4 })
  const nearTarget = new THREE.WebGLRenderTarget(1, 1, { ...hdr, samples: 4, depthBuffer: false })
  const behindDepthTarget = new THREE.WebGLRenderTarget(1, 1, { ...hdr, depthBuffer: false })
  const goldTarget = new THREE.WebGLRenderTarget(1, 1, { ...hdr, samples: 4 })
  const glassTarget = new THREE.WebGLRenderTarget(1, 1, { ...hdr, samples: 4, depthBuffer: false })
  const flat = { ...hdr, depthBuffer: false }
  const goldBlurTargets = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, flat))
  const glassBlurTargets = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, flat))
  const blurQuad = new FullScreenQuad(new THREE.ShaderMaterial(BLUR_MATERIAL_PARAMS))
  // Rings are split by the centre plane; the gold is never clipped
  const glassDepthMaterial = new THREE.ShaderMaterial({ ...DEPTH_MATERIAL_PARAMS, clipping: true, clippingPlanes: [centrePlane] })
  const goldDepthMaterial = new THREE.ShaderMaterial(DEPTH_MATERIAL_PARAMS)
  const compositeQuad = new FullScreenQuad(new THREE.ShaderMaterial(COMPOSITE_MATERIAL_PARAMS))
  const composite = compositeQuad.material.uniforms
  composite.tMain.value = mainTarget.texture
  composite.tSharp.value = sharpTarget.texture
  composite.tBlurGold.value = goldBlurTargets[1].texture
  composite.tBlurGlass.value = glassBlurTargets[1].texture
  composite.tNear.value = nearTarget.texture
  composite.tBehindDepth.value = behindDepthTarget.texture
  composite.uGlassTint.value.setRGB(...GLASS_TINT)

  // Gaussian blur of `source` into targets[1]; `amount` = radius as a fraction of the height.
  // A source twice the target size is box-averaged on the way (the taps land between texels).
  const blurInto = (source, targets, amount) => {
    const [ping, pong] = targets
    // Two horizontal + vertical rounds; the outer tap lands at radius / 2 per round
    const radius = amount * ping.height
    const stepX = radius / 2 / 3.2307692308 / ping.width
    const stepY = radius / 2 / 3.2307692308 / ping.height
    const blur = blurQuad.material
    for (let round = 0; round < 2; round += 1) {
      blur.uniforms.tInput.value = source.texture
      blur.uniforms.uStep.value.set(stepX, 0)
      renderer.setRenderTarget(ping)
      blurQuad.render(renderer)
      blur.uniforms.tInput.value = ping.texture
      blur.uniforms.uStep.value.set(0, stepY)
      renderer.setRenderTarget(pong)
      blurQuad.render(renderer)
      source = pong
    }
  }

  // Everything the glass adds (reflections, coat, haze) scaled by `strength`; the dimming
  // of what is behind it (opacity) stays.
  const setGlassStrength = (strength) => {
    glassMaterial.envMapIntensity = look.glass.reflection * strength
    glassMaterial.color.setRGB(...GLASS_TINT).multiplyScalar(look.atmosphere.haze * strength)
  }

  const applyLook = () => {
    renderer.toneMappingExposure = look.exposure
    const g = look.glass
    const atm = look.atmosphere
    glassMaterial.roughness = g.roughness
    glassMaterial.ior = g.ior
    glassMaterial.clearcoat = g.coat
    glassMaterial.clearcoatRoughness = g.coatRoughness
    glassMaterial.opacity = g.dim
    setGlassStrength(1)
    const a = look.gold
    goldMaterial.color.setRGB(a.color[0], a.color[1], a.color[2])
    goldMaterial.metalness = a.metalness
    goldMaterial.roughness = a.roughness
    goldMaterial.envMapIntensity = a.reflection
    composite.uGrain.value = atm.grain
    composite.uGrainSize.value = atm.grainSize
    composite.uGrainColor.value = atm.grainColor
    composite.uBehind.value = atm.behind
    composite.uBlurReach.value = atm.blurReach
  }
  applyLook()

  const drawingSize = new THREE.Vector2()
  // Width/height in drawing-buffer pixels. The caller sizes the canvas so one buffer pixel is
  // one screen pixel (no browser resampling, which would smear the grain).
  const setSize = (width, height) => {
    if (!width || !height) return
    renderer.setPixelRatio(1)
    renderer.setSize(width, height, false)
    renderer.getDrawingBufferSize(drawingSize)
    const { x, y } = drawingSize
    mainTarget.setSize(x, y)
    sharpTarget.setSize(x, y)
    nearTarget.setSize(x, y)
    const half = [Math.ceil(x / 2), Math.ceil(y / 2)]
    const quarter = [Math.ceil(x / 4), Math.ceil(y / 4)]
    behindDepthTarget.setSize(...half)
    goldTarget.setSize(...half)
    glassTarget.setSize(...half)
    goldBlurTargets.forEach((target) => target.setSize(...half))
    glassBlurTargets.forEach((target) => target.setSize(...quarter))
    composite.uBlurGoldSize.value.set(...half)
    composite.uBlurGlassSize.value.set(...quarter)
    camera.aspect = width / height
    // Behave like object-fit: cover: wide boxes keep the width, tall boxes keep the height
    const vertical = camera.aspect > 1 ? tanHalf / camera.aspect : tanHalf
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(vertical))
    camera.updateProjectionMatrix()
  }

  const render = (seconds) => {
    const p = loopPhase(seconds)
    rings.forEach(({ mesh, end }) => {
      mesh.rotation.set(end[0] * p, end[1] * p, end[2] * p)
    })
    const rx = GOLD.rx.start + (GOLD.rx.end - GOLD.rx.start) * p
    const ry = GOLD.ry.start + (GOLD.ry.end - GOLD.ry.start) * p
    goldRings.forEach((mesh, i) => {
      mesh.rotation.set(i * rx, i * ry, 0)
    })

    camera.layers.set(0)
    centrePlane.normal.z = 1 // near glass
    renderer.setRenderTarget(mainTarget)
    renderer.render(scene, camera)
    scene.overrideMaterial = glassDepthMaterial
    renderer.setRenderTarget(nearTarget)
    renderer.render(scene, camera)
    centrePlane.normal.z = -1 // far glass + gold = what is behind the near glass
    renderer.setRenderTarget(behindDepthTarget)
    renderer.render(scene, camera)
    renderer.autoClear = false
    scene.overrideMaterial = goldDepthMaterial
    camera.layers.set(GOLD_LAYER)
    renderer.render(scene, camera)
    renderer.autoClear = true
    scene.overrideMaterial = null
    camera.layers.set(0)
    camera.layers.enable(GOLD_LAYER)
    renderer.setRenderTarget(sharpTarget)
    renderer.render(scene, camera)
    camera.layers.set(GOLD_LAYER)
    renderer.setRenderTarget(goldTarget)
    renderer.render(scene, camera)
    camera.layers.set(0)
    setGlassStrength(look.atmosphere.glassBehind)
    renderer.setRenderTarget(glassTarget)
    renderer.render(scene, camera)
    setGlassStrength(1)
    blurInto(goldTarget, goldBlurTargets, look.atmosphere.blur)
    blurInto(glassTarget, glassBlurTargets, look.atmosphere.glassBlur)

    // New grain pattern grainFps times per second (0 = frozen; a frozen frame keeps its grain).
    // The wrap keeps the float uniform an exact whole number however long the page runs.
    const grainFps = look.atmosphere.grainFps
    composite.uGrainFrame.value = grainFps > 0 ? Math.floor(seconds * grainFps) % 65536 : 0
    renderer.setRenderTarget(null)
    compositeQuad.render(renderer)
  }

  const dispose = () => {
    ringGeometry.dispose()
    goldGeometry.dispose()
    glassMaterial.dispose()
    goldMaterial.dispose()
    glassDepthMaterial.dispose()
    goldDepthMaterial.dispose()
    ;[mainTarget, sharpTarget, nearTarget, behindDepthTarget, goldTarget, glassTarget, ...goldBlurTargets, ...glassBlurTargets].forEach((target) => target.dispose())
    ;[blurQuad, compositeQuad].forEach((quad) => {
      quad.material.dispose()
      quad.dispose()
    })
    envTarget.dispose()
    renderer.dispose()
  }

  return { render, setSize, dispose, look, applyLook, rebuildLights }
}
