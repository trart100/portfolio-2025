import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CAMERA, CORE, LOOP_SECONDS, MID_SLOWDOWN, RINGS } from './config'

const HALF = LOOP_SECONDS / 2
const b = MID_SLOWDOWN

// Eased progress through the loop, 0..2 (one unit per half loop). Speed is
// sin^2(2*pi*u) + b*sin^2(pi*u): zero at the rests, a dip (not a stop) mid-half.
export function loopProgress(seconds) {
  const t = ((seconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
  const half = Math.floor(t / HALF)
  const u = (t - half * HALF) / HALF
  const a = u / 2 - Math.sin(4 * Math.PI * u) / (8 * Math.PI)
  const c = u / 2 - Math.sin(2 * Math.PI * u) / (4 * Math.PI)
  return half + (a + b * c) / ((1 + b) / 2)
}

export function createGyroScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const envTarget = pmrem.fromScene(room, 0.04)
  scene.environment = envTarget.texture
  room.dispose()
  pmrem.dispose()

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 100)
  camera.position.set(0, 0, CAMERA.distance)

  // Placeholder frosted look; the real material comes in the materials step
  const ringMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.35,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false
  })

  const rings = RINGS.map((cfg) => {
    const geometry = new THREE.CylinderGeometry(cfg.radius, cfg.radius, cfg.height, 192, 1, true)
    geometry.rotateX(Math.PI / 2) // band axis toward the camera: flat ring at rest
    const mesh = new THREE.Mesh(geometry, ringMaterial)
    scene.add(mesh)
    return { mesh, geometry, axis: new THREE.Vector3(...cfg.axis).normalize(), halfTurns: cfg.halfTurns }
  })

  const goldMaterial = new THREE.MeshStandardMaterial({ color: CORE.color, metalness: 1, roughness: 0.25 })
  const core = new THREE.Group()
  const coreInner = new THREE.Group()
  const coreGeometries = [
    new THREE.TorusGeometry(CORE.outerRadius, CORE.tube, 16, 96),
    new THREE.TorusGeometry(CORE.innerRadius, CORE.tube, 16, 96)
  ]
  core.add(new THREE.Mesh(coreGeometries[0], goldMaterial))
  const innerA = new THREE.Mesh(coreGeometries[1], goldMaterial)
  const innerB = new THREE.Mesh(coreGeometries[1], goldMaterial)
  innerA.rotation.x = Math.PI / 2
  innerB.rotation.y = Math.PI / 2
  coreInner.add(innerA, innerB)
  core.add(coreInner)
  scene.add(core)

  const baseFov = CAMERA.fov
  const setSize = (width, height) => {
    if (!width || !height) return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    // Behave like object-fit: cover: wide boxes keep the width, tall boxes keep the height
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(baseFov / 2))
    camera.fov = camera.aspect > 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(tanHalf / camera.aspect)) : baseFov
    camera.updateProjectionMatrix()
  }

  const render = (seconds) => {
    const g = loopProgress(seconds)
    rings.forEach((ring) => {
      ring.mesh.quaternion.setFromAxisAngle(ring.axis, (ring.halfTurns * Math.PI * g) / 2)
    })
    const coreAngle = (CORE.halfTurns * Math.PI * g) / 2
    core.rotation.y = coreAngle
    coreInner.rotation.x = coreAngle
    renderer.render(scene, camera)
  }

  const dispose = () => {
    rings.forEach((ring) => ring.geometry.dispose())
    coreGeometries.forEach((geometry) => geometry.dispose())
    ringMaterial.dispose()
    goldMaterial.dispose()
    envTarget.dispose()
    renderer.dispose()
  }

  return { render, setSize, dispose }
}
