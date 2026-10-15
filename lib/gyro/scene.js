import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { CAMERA, FIRST_FRAME, FPS, GLASS_TINT, GOLD, LOOK, LOOP_FRAMES, RING, RINGS } from './config'
import { LIGHT_WALLS } from './lightWalls'

const clone = (value) => JSON.parse(JSON.stringify(value))
const GOLD_LAYER = 1

// Atmosphere (step 4): depth peeling, built up back to front. Depth images (1/depth, max
// blending) find the 1st, 2nd, ... K-th surface at every pixel ("layers"; a band's own inner
// wall, within PEEL_EPSILON, belongs to the same layer); everything behind the K-th layer is
// one more "rest" layer. Starting with the rest, each layer in front of what has built up so
// far adds its own light (glass reflections / gold) and shows what is behind through its glass:
// sharp where it touches, blurred with distance (like Cycles' rough glass), tinted and dimmed —
// so a band seen through two bands is blurred twice. Gold and glass build up separately (the
// gold has a smaller blur) and are added at the end. K = 4 on desktop, 1 on touch devices.
// All at `scale` x the canvas (linear HDR). Output pass: AgX tone mapping + exposure per
// rendered pixel, averaged down to screen pixels (supersampling), then grain.
const PEEL_EPSILON = 0.05
const MAX_PEEL_LAYERS = 6
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
// Depth peeling test shared by every scene material: keep only fragments whose view depth is
// behind the layer in tPeelNear (by more than uPeelEpsilon; skipped if uPeelNear = 0) and not
// behind the layer in tPeelFar (within uPeelEpsilon counts as that layer; skipped if
// uPeelFar = 0). Depth images hold 1/depth, 0 = no surface. uPeelSize = size of the image
// being drawn.
const PEEL_GLSL = /* glsl */ `
  uniform sampler2D tPeelNear;
  uniform sampler2D tPeelFar;
  uniform int uPeelNear;
  uniform int uPeelFar;
  uniform vec2 uPeelSize;
  uniform float uPeelEpsilon;
  void peelTest(float viewDepth) {
    vec2 peelUv = gl_FragCoord.xy / uPeelSize;
    if (uPeelNear == 1) {
      float nearInv = texture2D(tPeelNear, peelUv).r;
      // No surface in the previous layer = nothing further back either
      if (nearInv <= 0.0 || viewDepth <= 1.0 / nearInv + uPeelEpsilon) discard;
    }
    if (uPeelFar == 1) {
      float farInv = texture2D(tPeelFar, peelUv).r;
      if (farInv > 0.0 && viewDepth > 1.0 / farInv + uPeelEpsilon) discard;
    }
  }
`
// 1/depth (view space) of the nearest surface, max blending (several layers: the nearest wins;
// cleared to 0 = nothing). Alpha 1 = coverage. With OCCLUDER: green = 1 (gold in front).
const DEPTH_MATERIAL_PARAMS = {
  vertexShader: /* glsl */ `
    varying float vInvDepth;
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vInvDepth = 1.0 / -mvPosition.z;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    ${PEEL_GLSL}
    varying float vInvDepth;
    void main() {
      peelTest(1.0 / vInvDepth);
      #ifdef OCCLUDER
        gl_FragColor = vec4(0.0, 1.0, 0.0, 0.0);
      #else
        gl_FragColor = vec4(vInvDepth, 0.0, 0.0, 1.0);
      #endif
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
// One step of the back-to-front build-up: this layer's own light (glass reflections, or the
// gold) + what has accumulated behind it, seen through this layer's glass: a mix of sharp and
// blurred by the distance behind the glass (touching = sharp, like Cycles' rough glass),
// tinted and dimmed; hidden where this layer's gold is in front. Gold and glass build up
// separately (different blur radii; uIsGlass picks which) and are added in the output pass.
const COMPOSITE_MATERIAL_PARAMS = {
  uniforms: {
    tLayer: { value: null },
    tLayerNear: { value: null },
    tAcc: { value: null },
    tAccBlur: { value: null },
    uAccBlurSize: { value: new THREE.Vector2(1, 1) },
    tFrontDepth: { value: null },
    tBehindDepth: { value: null },
    uHasBehind: { value: 0 },
    uStrength: { value: 1 },
    uBlurReach: { value: 1 },
    uBehind: { value: 0 },
    uGlassTint: { value: new THREE.Color() }
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tLayer;
    uniform sampler2D tLayerNear;
    uniform sampler2D tAcc;
    uniform sampler2D tAccBlur;
    uniform vec2 uAccBlurSize;
    uniform sampler2D tFrontDepth;
    uniform sampler2D tBehindDepth;
    uniform int uHasBehind;
    uniform float uStrength;
    uniform float uBlurReach;
    uniform float uBehind;
    uniform vec3 uGlassTint;
    varying vec2 vUv;
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
      vec3 color = texture2D(tLayer, vUv).rgb;
      if (uHasBehind == 1) {
        vec4 near = texture2D(tLayerNear, vUv);
        float cover = clamp(near.a, 0.0, 1.0);
        float goldInFront = clamp(near.g, 0.0, 1.0);
        vec3 acc = texture2D(tAcc, vUv).rgb;
        vec3 accBlur = textureSmooth(tAccBlur, vUv, uAccBlurSize).rgb;
        // How far behind this layer the next surface is: 0 = touching (stays sharp),
        // uBlurReach or more = fully blurred. Nothing there = fully blurred (shows the glow).
        float frontInv = texture2D(tFrontDepth, vUv).r;
        float behindInv = texture2D(tBehindDepth, vUv).r;
        float gap = frontInv > 1e-4 && behindInv > 1e-4 ? 1.0 / behindInv - 1.0 / frontInv : 1e3;
        float blurAmount = smoothstep(0.0, max(uBlurReach, 1e-3), gap);
        vec3 throughGlass = mix(acc, accBlur, blurAmount) * uGlassTint * uBehind * uStrength;
        color += (acc * (1.0 - cover) + throughGlass * cover) * (1.0 - goldInFront);
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
  toneMapped: false
}
// Output to the screen: glass + gold build-ups added; each screen pixel averages its
// uScale x uScale rendered pixels (supersampling) AFTER tone mapping each of them, so bright
// edges get proper in-between steps (averaging HDR values first would keep them nearly white).
// Then grain.
const OUTPUT_MATERIAL_PARAMS = {
  uniforms: {
    tCombined: { value: null },
    tCombinedGold: { value: null },
    uScale: { value: 1 },
    uGrain: { value: 0 },
    uGrainFrame: { value: 0 },
    uGrainSize: { value: 1 },
    uGrainColor: { value: 0 }
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tCombined;
    uniform sampler2D tCombinedGold;
    uniform int uScale;
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
    void main() {
      ivec2 base = ivec2(gl_FragCoord.xy) * uScale;
      vec3 sum = vec3(0.0);
      for (int y = 0; y < 2; y++) {
        for (int x = 0; x < 2; x++) {
          if (x < uScale && y < uScale) {
            // toneMapping() = AgX with the renderer's exposure (three.js adds it for screen output)
            ivec2 p = base + ivec2(x, y);
            sum += toneMapping(texelFetch(tCombined, p, 0).rgb + texelFetch(tCombinedGold, p, 0).rgb);
          }
        }
      }
      gl_FragColor = vec4(sum / float(uScale * uScale), 1.0);
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

// Smooth (cubic B-spline) reads of the reflection map instead of three.js' bilinear ones. The
// blurred levels are tiny (glass roughness 0.14 reads ~32 px faces, the coat 16 px), magnified
// over the wide bands; bilinear filtering has a kink at every texel that showed as parallel
// streaks and stepped edges in the reflections. 4 bilinear taps per read, kept inside the face
// (its 1-texel border included) so no tap picks up a neighbouring face in the atlas.
const BICUBIC_CUBE_UV = /* glsl */ `
	vec3 cubeUVTap( sampler2D envMap, vec2 uv ) {
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}

	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		highp vec2 origin = vec2( 0.0 );
		if ( face > 2.0 ) {
			origin.y += faceSize;
			face -= 3.0;
		}
		origin.x += face * faceSize + filterInt * 3.0 * cubeUV_minTileSize;
		origin.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );

		highp vec2 st = uv - 0.5;
		highp vec2 i = floor( st );
		vec2 f = st - i;
		vec2 f2 = f * f;
		vec2 f3 = f2 * f;
		vec2 w0 = ( 1.0 - 3.0 * f + 3.0 * f2 - f3 ) / 6.0;
		vec2 w1 = ( 4.0 - 6.0 * f2 + 3.0 * f3 ) / 6.0;
		vec2 w2 = ( 1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3 ) / 6.0;
		vec2 w3 = f3 / 6.0;
		vec2 g0 = w0 + w1;
		vec2 g1 = w2 + w3;
		highp vec2 h0 = clamp( i - 0.5 + w1 / g0, 0.5, faceSize - 0.5 ) + origin;
		highp vec2 h1 = clamp( i + 1.5 + w3 / g1, 0.5, faceSize - 0.5 ) + origin;
		return g0.y * ( g0.x * cubeUVTap( envMap, h0 ) + g1.x * cubeUVTap( envMap, vec2( h1.x, h0.y ) ) ) +
			g1.y * ( g0.x * cubeUVTap( envMap, vec2( h0.x, h1.y ) ) + g1.x * cubeUVTap( envMap, h1 ) );
	}
`
{
  const chunk = THREE.ShaderChunk.cube_uv_reflection_fragment
  const start = chunk.indexOf('\tvec3 bilinearCubeUV(')
  const end = chunk.indexOf('#define cubeUV_r0') // (the built chunk has no comments)
  if (start < 0 || end < start) console.warn('gyro: three.js cube_uv chunk changed; reflections stay bilinear')
  else THREE.ShaderChunk.cube_uv_reflection_fragment = chunk.slice(0, start) + BICUBIC_CUBE_UV + '\n\t' + chunk.slice(end)
}

// Bakes the two walls of light (exported from Blender) into a reflection map.
// Size per cube face: at the default 256 the rough glass/coat read coarse levels that show as
// faint straight lines in the reflections (still faintly visible at 512, gone at 1024).
// GPU memory (3*size x 4*size half-float): 1024 = ~100 MB, 512 = ~25 MB (touch devices).
const isTouchDevice = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
const reflectionMapSize = () => (isTouchDevice() ? 512 : 1024)
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

  // Shared by every scene material (see PEEL_GLSL); set per pass by drawLayer()
  const peel = {
    tPeelNear: { value: null },
    tPeelFar: { value: null },
    uPeelNear: { value: 0 },
    uPeelFar: { value: 0 },
    uPeelSize: { value: new THREE.Vector2(1, 1) },
    uPeelEpsilon: { value: PEEL_EPSILON }
  }
  const addPeel = (material) => {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, peel)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${PEEL_GLSL}`)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\npeelTest(vViewPosition.z);')
    }
    return material
  }

  // Glass on black: the band's reflections are added in full and what is behind it is
  // dimmed by `opacity` (src * 1 + dst * (1 - alpha)). Black base colour: a fully
  // transmissive glass has no diffuse part.
  const glassMaterial = addPeel(new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor
  }))

  const ringGeometry = createBandGeometry(RING.radius - RING.thickness, RING.height, RING.thickness)
  const rings = RINGS.map((cfg) => {
    const mesh = new THREE.Mesh(ringGeometry, glassMaterial)
    mesh.scale.setScalar(cfg.scale)
    mesh.rotation.order = 'ZYX' // = Blender's XYZ Euler
    root.add(mesh)
    return { mesh, end: cfg.end }
  })

  const goldMaterial = addPeel(new THREE.MeshStandardMaterial())
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

  // Images (sizes set in setSize). Layer images are rendered at `scale` x the canvas and get
  // 4x MSAA only at scale 1 (at 2x, MSAA on top would cost hundreds of MB of GPU memory).
  //  depth[i]   = 1/depth of the i-th surface (red only, nearest filtering, never MSAA)
  //  layerGlass / layerGold = one layer's glass reflections / gold (premultiplied)
  //  layerNear  = that layer's glass coverage (alpha, antialiased) and gold in front (green)
  //  acc*       = glass / gold built up so far (ping-pong), linear HDR
  //  down       = acc box-filtered to 1x / 1/2 / 1/4 of the canvas, then blurred: the gold at
  //               1/2 (`blur`), the glass at 1/4 (`glassBlur`, bigger)
  const hdr = { type: THREE.HalfFloatType }
  const flat = { ...hdr, depthBuffer: false }
  const layerGlassTarget = new THREE.WebGLRenderTarget(1, 1, { ...hdr, samples: 4 })
  const layerGoldTarget = new THREE.WebGLRenderTarget(1, 1, { ...hdr, samples: 4 })
  const layerNearTarget = new THREE.WebGLRenderTarget(1, 1, { ...flat, samples: 4 })
  const supersampled = [layerGlassTarget, layerGoldTarget, layerNearTarget]
  const depthTargets = Array.from({ length: MAX_PEEL_LAYERS + 1 }, () => {
    const target = new THREE.WebGLRenderTarget(1, 1, { ...flat, format: THREE.RedFormat })
    target.texture.minFilter = THREE.NearestFilter
    target.texture.magFilter = THREE.NearestFilter
    return target
  })
  const accGlass = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, flat))
  const accGold = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, flat))
  const downTargets = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(1, 1, flat))
  const goldBlurTargets = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, flat))
  const glassBlurTargets = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, flat))
  const allTargets = [...supersampled, ...depthTargets, ...accGlass, ...accGold, ...downTargets, ...goldBlurTargets, ...glassBlurTargets]
  const blurQuad = new FullScreenQuad(new THREE.ShaderMaterial(BLUR_MATERIAL_PARAMS))
  const depthParams = { ...DEPTH_MATERIAL_PARAMS, uniforms: peel }
  const glassDepthMaterial = new THREE.ShaderMaterial(depthParams)
  const goldDepthMaterial = new THREE.ShaderMaterial(depthParams)
  const goldOccluderMaterial = new THREE.ShaderMaterial({ ...depthParams, defines: { OCCLUDER: '' } })
  // Writes only the gold's depth, so glass behind the gold within the same layer is hidden
  const goldHiderMaterial = new THREE.ShaderMaterial({
    ...depthParams,
    blending: THREE.NoBlending,
    colorWrite: false,
    depthTest: true,
    depthWrite: true
  })
  const depthMaterials = [glassDepthMaterial, goldDepthMaterial, goldOccluderMaterial, goldHiderMaterial]
  const compositeQuad = new FullScreenQuad(new THREE.ShaderMaterial(COMPOSITE_MATERIAL_PARAMS))
  const composite = compositeQuad.material.uniforms
  composite.uGlassTint.value.setRGB(...GLASS_TINT)
  const outputQuad = new FullScreenQuad(new THREE.ShaderMaterial(OUTPUT_MATERIAL_PARAMS))
  const output = outputQuad.material.uniforms

  // Number of peeled layers: each one blurs what is behind it again. Desktop 4, touch 1.
  const defaultPeelLayers = isTouchDevice() ? 1 : 4
  let peelLayers = defaultPeelLayers
  const setPeelLayers = (count) => {
    peelLayers = THREE.MathUtils.clamp(Math.round(count), 1, MAX_PEEL_LAYERS)
  }

  // Gaussian blur of `source` into targets[1]; `amount` = radius as a fraction of the height.
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

  // Halves `source` once per target (the blur shader with step 0 = one bilinear tap, which
  // lands between 2x2 source pixels: an exact box filter); returns the last target.
  const downsample = (source, targets) => {
    const blur = blurQuad.material
    blur.uniforms.uStep.value.set(0, 0)
    targets.forEach((target) => {
      blur.uniforms.tInput.value = source.texture
      renderer.setRenderTarget(target)
      blurQuad.render(renderer)
      source = target
    })
    return source
  }

  // Everything the glass adds (reflections, coat, haze); the dimming of what is behind it
  // (opacity) is set separately.
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
    output.uGrain.value = atm.grain
    output.uGrainSize.value = atm.grainSize
    output.uGrainColor.value = atm.grainColor
    composite.uBehind.value = atm.behind
    composite.uBlurReach.value = atm.blurReach
  }
  applyLook()

  const drawingSize = new THREE.Vector2()
  const halfSize = new THREE.Vector2()
  const quarterSize = new THREE.Vector2()
  // Supersampling: 2x on desktop; 1x (with 4x MSAA) on touch devices and on canvases above
  // 1920 px (4K / high-DPI screens: tiny pixels, and 2x would need too much GPU memory/fill).
  // 1x + MSAA averages before tone mapping, so thin bright edges (the gold) look stepped; at
  // 2560x1440 (1664 px canvas) 2x costs the same GPU time as 1x + MSAA (~9 ms, K = 4 on an
  // RTX 3060) and ~300 MB more memory (~670 MB).
  const MAX_SUPERSAMPLED = 3840
  let scale = 0
  let maxScale = 2 // lowered to 1 by the adaptive quality (quality.js)
  const finishPixel = new Uint8Array(4)
  const lastSize = [0, 0]
  // Width/height in drawing-buffer pixels. The caller sizes the canvas so one buffer pixel is
  // one screen pixel (no browser resampling, which would smear the grain).
  const setSize = (width, height) => {
    if (!width || !height) return
    lastSize[0] = width
    lastSize[1] = height
    renderer.setPixelRatio(1)
    renderer.setSize(width, height, false)
    renderer.getDrawingBufferSize(drawingSize)
    const { x, y } = drawingSize
    const nextScale = maxScale >= 2 && !isTouchDevice() && Math.max(x, y) * 2 <= MAX_SUPERSAMPLED ? 2 : 1
    if (nextScale !== scale) {
      scale = nextScale
      supersampled.forEach((target) => {
        target.samples = scale === 1 ? 4 : 0
        target.dispose() // re-created with the new sample count on next use
      })
      output.uScale.value = scale
    }
    ;[...supersampled, ...depthTargets, ...accGlass, ...accGold].forEach((target) => target.setSize(x * scale, y * scale))
    halfSize.set(Math.ceil(x / 2), Math.ceil(y / 2))
    quarterSize.set(Math.ceil(x / 4), Math.ceil(y / 4))
    downTargets[0].setSize(x, y)
    downTargets[1].setSize(halfSize.x, halfSize.y)
    downTargets[2].setSize(quarterSize.x, quarterSize.y)
    goldBlurTargets.forEach((target) => target.setSize(halfSize.x, halfSize.y))
    glassBlurTargets.forEach((target) => target.setSize(quarterSize.x, quarterSize.y))
    camera.aspect = width / height
    // Behave like object-fit: cover: wide boxes keep the width, tall boxes keep the height
    const vertical = camera.aspect > 1 ? tanHalf / camera.aspect : tanHalf
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(vertical))
    camera.updateProjectionMatrix()
  }

  // Draws `passes` ([camera layer, override material or null = own material]) into `target`,
  // keeping only surfaces behind the depth image `near` and up to `far` (null = no limit).
  // The first pass clears; the others add (and keep the depth buffer).
  const drawLayer = (target, near, far, passes) => {
    peel.uPeelNear.value = near ? 1 : 0
    peel.uPeelFar.value = far ? 1 : 0
    peel.tPeelNear.value = near ? near.texture : null
    peel.tPeelFar.value = far ? far.texture : null
    peel.uPeelSize.value.set(target.width, target.height)
    renderer.setRenderTarget(target)
    passes.forEach(([layer, material], i) => {
      scene.overrideMaterial = material
      camera.layers.set(layer)
      renderer.autoClear = i === 0
      renderer.render(scene, camera)
    })
    renderer.autoClear = true
    scene.overrideMaterial = null
  }
  const depthPasses = [[0, glassDepthMaterial], [GOLD_LAYER, goldDepthMaterial]]

  // Adds one layer over the glass or gold built up so far (ping-pong: reads `acc[from]`,
  // writes `acc[1 - from]`)
  const compositeStep = (acc, from, layerTarget, blurTargets, blurSize, strength) => {
    composite.tLayer.value = layerTarget.texture
    composite.tAcc.value = acc[from].texture
    composite.tAccBlur.value = blurTargets[1].texture
    composite.uAccBlurSize.value.copy(blurSize)
    composite.uStrength.value = strength
    renderer.setRenderTarget(acc[1 - from])
    compositeQuad.render(renderer)
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

    const count = peelLayers
    // Depth of the 1st .. count-th surface, and depth[count] = front of the rest
    for (let i = 0; i <= count; i += 1) {
      drawLayer(depthTargets[i], i > 0 ? depthTargets[i - 1] : null, null, depthPasses)
    }

    // Back to front: layer `count` is the rest (everything behind the last peeled layer)
    let from = 0
    const atm = look.atmosphere
    for (let i = count; i >= 0; i -= 1) {
      const hasBehind = i < count
      const near = i > 0 ? depthTargets[i - 1] : null
      const far = hasBehind ? depthTargets[i] : null
      drawLayer(layerGlassTarget, near, far, [[GOLD_LAYER, goldHiderMaterial], [0, null]])
      drawLayer(layerGoldTarget, near, far, [[GOLD_LAYER, null]])
      composite.uHasBehind.value = hasBehind ? 1 : 0
      if (hasBehind) {
        drawLayer(layerNearTarget, near, far, [[0, glassDepthMaterial], [GOLD_LAYER, goldOccluderMaterial]])
        const fullSize = scale === 2 ? [downTargets[0]] : []
        blurInto(downsample(accGold[from], [...fullSize, downTargets[1]]), goldBlurTargets, atm.blur)
        blurInto(downsample(accGlass[from], [...fullSize, downTargets[1], downTargets[2]]), glassBlurTargets, atm.glassBlur)
        composite.tLayerNear.value = layerNearTarget.texture
        composite.tFrontDepth.value = depthTargets[i].texture
        composite.tBehindDepth.value = depthTargets[i + 1].texture
      }
      compositeStep(accGlass, from, layerGlassTarget, glassBlurTargets, quarterSize, atm.glassBehind)
      compositeStep(accGold, from, layerGoldTarget, goldBlurTargets, halfSize, 1)
      from = 1 - from
    }
    peel.tPeelNear.value = null
    peel.tPeelFar.value = null
    camera.layers.set(0)

    // New grain pattern grainFps times per second (0 = frozen; a frozen frame keeps its grain).
    // The wrap keeps the float uniform an exact whole number however long the page runs.
    const grainFps = atm.grainFps
    output.uGrainFrame.value = grainFps > 0 ? Math.floor(seconds * grainFps) % 65536 : 0
    output.tCombined.value = accGlass[from].texture
    output.tCombinedGold.value = accGold[from].texture
    renderer.setRenderTarget(null)
    outputQuad.render(renderer)
  }

  const dispose = () => {
    ringGeometry.dispose()
    goldGeometry.dispose()
    glassMaterial.dispose()
    goldMaterial.dispose()
    depthMaterials.forEach((material) => material.dispose())
    allTargets.forEach((target) => target.dispose())
    ;[blurQuad, compositeQuad, outputQuad].forEach((quad) => {
      quad.material.dispose()
      quad.dispose()
    })
    envTarget.dispose()
    renderer.dispose()
  }

  return {
    render,
    setSize,
    dispose,
    look,
    applyLook,
    rebuildLights,
    getScale: () => scale,
    // Waits until the GPU has finished the frame (reads 1 pixel). Only for timing behind the
    // preloader: frame intervals alone look fast at first, while the GPU is still queueing work.
    finish: () => {
      const gl = renderer.getContext()
      renderer.setRenderTarget(null)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, finishPixel)
    },
    // 2 = supersample where the canvas allows it, 1 = never (re-creates the images)
    setMaxScale: (value) => {
      maxScale = value
      if (lastSize[0]) setSize(lastSize[0], lastSize[1])
    },
    defaultPeelLayers,
    getPeelLayers: () => peelLayers,
    setPeelLayers
  }
}
