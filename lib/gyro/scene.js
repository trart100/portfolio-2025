import * as THREE from 'three'
import { CAMERA, FIRST_FRAME, FPS, GOLD, LOOK, LOOP_FRAMES, RING, RINGS } from './config'
import { LIGHT_WALLS } from './lightWalls'

const clone = (value) => JSON.parse(JSON.stringify(value))

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

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
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
    gold.add(mesh)
    return mesh
  })

  const applyLook = () => {
    renderer.toneMappingExposure = look.exposure
    const g = look.glass
    glassMaterial.roughness = g.roughness
    glassMaterial.ior = g.ior
    glassMaterial.clearcoat = g.coat
    glassMaterial.clearcoatRoughness = g.coatRoughness
    glassMaterial.envMapIntensity = g.reflection
    glassMaterial.opacity = g.dim
    const a = look.gold
    goldMaterial.color.setRGB(a.color[0], a.color[1], a.color[2])
    goldMaterial.metalness = a.metalness
    goldMaterial.roughness = a.roughness
    goldMaterial.envMapIntensity = a.reflection
  }
  applyLook()

  const setSize = (width, height) => {
    if (!width || !height) return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height, false)
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
    renderer.render(scene, camera)
  }

  const dispose = () => {
    ringGeometry.dispose()
    goldGeometry.dispose()
    glassMaterial.dispose()
    goldMaterial.dispose()
    envTarget.dispose()
    renderer.dispose()
  }

  return { render, setSize, dispose, look, applyLook, rebuildLights }
}
