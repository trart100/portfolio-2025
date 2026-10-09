import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { CAMERA, FIRST_FRAME, FPS, GLASS_TINT, GOLD, LOOK, LOOP_FRAMES, RING, RINGS } from './config'
import { LIGHT_WALLS } from './lightWalls'

const clone = (value) => JSON.parse(JSON.stringify(value))
const GOLD_LAYER = 1

// Atmosphere (step 4) works on separate images that the final pass combines:
//  main  = rings + light (no gold), linear HDR
//  sharp = the gold alone; blur = a blurred copy of it
//  mask  = where glass is in front of the gold (max blending: several layers still = 1)
// Final: sharp gold where no glass is in front, blurred + tinted gold where there is
// (like Cycles' rough glass), then AgX tone mapping, exposure and grain.
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
// Glass surfaces nearer to the camera than the centre (where the gold is)
const MASK_MATERIAL_PARAMS = {
  uniforms: { uCenterDepth: { value: 0 } },
  vertexShader: /* glsl */ `
    varying float vDepth;
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vDepth = -mvPosition.z;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uCenterDepth;
    varying float vDepth;
    void main() {
      float inFront = 1.0 - smoothstep(uCenterDepth - 0.5, uCenterDepth + 0.5, vDepth);
      gl_FragColor = vec4(inFront, inFront, inFront, 1.0);
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
    tBlur: { value: null },
    tMask: { value: null },
    uBehind: { value: 0 },
    uGlassTint: { value: new THREE.Color() },
    uGrain: { value: 0 },
    uGrainSeed: { value: 0 }
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tMain;
    uniform sampler2D tSharp;
    uniform sampler2D tBlur;
    uniform sampler2D tMask;
    uniform float uBehind;
    uniform vec3 uGlassTint;
    uniform float uGrain;
    uniform float uGrainSeed;
    varying vec2 vUv;
    void main() {
      vec4 mainColor = texture2D(tMain, vUv);
      vec4 sharp = texture2D(tSharp, vUv);
      vec3 blurred = texture2D(tBlur, vUv).rgb;
      float mask = texture2D(tMask, vUv).r;
      float open = 1.0 - mask;
      vec3 color = mainColor.rgb * (1.0 - sharp.a * open) + sharp.rgb * open + blurred * uGlassTint * uBehind * mask;
      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      // Grain: render noise that scales with brightness, so black stays black
      float grainNoise = fract(sin(dot(gl_FragCoord.xy + uGrainSeed, vec2(12.9898, 78.233))) * 43758.5453);
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

// Bakes the two walls of light (exported from Blender) into a reflection map
function bakeLightWalls(renderer, intensity) {
  const scene = new THREE.Scene()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(LIGHT_WALLS.positions, 3))
  geometry.setIndex(LIGHT_WALLS.indices)
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  material.color.setScalar(intensity)
  scene.add(new THREE.Mesh(geometry, material))
  const pmrem = new THREE.PMREMGenerator(renderer)
  const target = pmrem.fromScene(scene, 0, 0.1, 200)
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

  // Glass on black: the band's reflections are added in full and what is behind it is
  // dimmed by `opacity` (src * 1 + dst * (1 - alpha)). Black base colour: a fully
  // transmissive glass has no diffuse part.
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0,
    transparent: true,
    depthWrite: false,
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

  // Images for the final pass (sizes set in setSize). Main + gold get 4x MSAA.
  const hdr = { type: THREE.HalfFloatType }
  const mainTarget = new THREE.WebGLRenderTarget(1, 1, { ...hdr, samples: 4 })
  const sharpTarget = new THREE.WebGLRenderTarget(1, 1, { ...hdr, samples: 4 })
  const blurTargets = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, hdr))
  const maskTarget = new THREE.WebGLRenderTarget(1, 1)
  const blurQuad = new FullScreenQuad(new THREE.ShaderMaterial(BLUR_MATERIAL_PARAMS))
  const maskMaterial = new THREE.ShaderMaterial(MASK_MATERIAL_PARAMS)
  maskMaterial.uniforms.uCenterDepth.value = camera.position.z
  const compositeQuad = new FullScreenQuad(new THREE.ShaderMaterial(COMPOSITE_MATERIAL_PARAMS))
  const composite = compositeQuad.material.uniforms
  composite.tMain.value = mainTarget.texture
  composite.tSharp.value = sharpTarget.texture
  composite.tBlur.value = blurTargets[1].texture
  composite.tMask.value = maskTarget.texture
  composite.uGlassTint.value.setRGB(...GLASS_TINT)

  const blurGold = () => {
    const [ping, pong] = blurTargets
    // Two horizontal + vertical rounds; the outer tap lands at radius / 2 per round
    const radius = look.atmosphere.blur * ping.height
    const stepX = radius / 2 / 3.2307692308 / ping.width
    const stepY = radius / 2 / 3.2307692308 / ping.height
    const blur = blurQuad.material
    let source = sharpTarget
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

  const applyLook = () => {
    renderer.toneMappingExposure = look.exposure
    const g = look.glass
    const atm = look.atmosphere
    glassMaterial.roughness = g.roughness
    glassMaterial.ior = g.ior
    glassMaterial.clearcoat = g.coat
    glassMaterial.clearcoatRoughness = g.coatRoughness
    glassMaterial.envMapIntensity = g.reflection
    glassMaterial.opacity = g.dim
    glassMaterial.color.setRGB(...GLASS_TINT).multiplyScalar(atm.haze)
    const a = look.gold
    goldMaterial.color.setRGB(a.color[0], a.color[1], a.color[2])
    goldMaterial.metalness = a.metalness
    goldMaterial.roughness = a.roughness
    goldMaterial.envMapIntensity = a.reflection
    composite.uGrain.value = atm.grain
    composite.uBehind.value = atm.behind
  }
  applyLook()

  const drawingSize = new THREE.Vector2()
  const setSize = (width, height) => {
    if (!width || !height) return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height, false)
    renderer.getDrawingBufferSize(drawingSize)
    const { x, y } = drawingSize
    mainTarget.setSize(x, y)
    sharpTarget.setSize(x, y)
    const half = [Math.ceil(x / 2), Math.ceil(y / 2)]
    blurTargets.forEach((target) => target.setSize(...half))
    maskTarget.setSize(...half)
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
    renderer.setRenderTarget(mainTarget)
    renderer.render(scene, camera)
    scene.overrideMaterial = maskMaterial
    renderer.setRenderTarget(maskTarget)
    renderer.render(scene, camera)
    scene.overrideMaterial = null
    camera.layers.set(GOLD_LAYER)
    renderer.setRenderTarget(sharpTarget)
    renderer.render(scene, camera)
    camera.layers.set(0)
    blurGold()

    // New grain pattern per video frame (a frozen frame keeps its grain)
    composite.uGrainSeed.value = (Math.floor(seconds * FPS) % 997) * 7.31
    renderer.setRenderTarget(null)
    compositeQuad.render(renderer)
  }

  const dispose = () => {
    ringGeometry.dispose()
    goldGeometry.dispose()
    glassMaterial.dispose()
    goldMaterial.dispose()
    maskMaterial.dispose()
    ;[mainTarget, sharpTarget, maskTarget, ...blurTargets].forEach((target) => target.dispose())
    ;[blurQuad, compositeQuad].forEach((quad) => {
      quad.material.dispose()
      quad.dispose()
    })
    envTarget.dispose()
    renderer.dispose()
  }

  return { render, setSize, dispose, look, applyLook, rebuildLights }
}
