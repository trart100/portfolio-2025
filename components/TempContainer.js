import React, { useEffect, useState } from 'react'

// Temporary top-of-page container used for particle experiments.
// Fixed 500x500, dark-grey background, sits on top of page (pointer-events:none).
export default function TempContainer() {
  const [ParticlesComp, setParticlesComp] = useState(null)

  useEffect(() => {
    let mounted = true

    ;(async () => {
      try {
        // dynamic imports so build won't fail if packages are missing
        const particlesModule = await import('@tsparticles/react')
        const tspModule = await import('tsparticles')

        const Particles = particlesModule.Particles || particlesModule.default || particlesModule
        const initParticlesEngine = particlesModule.initParticlesEngine
        const loadFull = tspModule.loadFull || (tspModule.default && tspModule.default.loadFull)

        if (typeof initParticlesEngine === 'function' && typeof loadFull === 'function') {
          await initParticlesEngine(async (engine) => {
            try {
              await loadFull(engine)
            } catch (inner) {
              console.warn('TempContainer: loadFull(engine) failed', inner)
            }
          })
        }

        if (mounted) {
          setParticlesComp(() => Particles)
        }
      } catch (err) {
        console.warn('TempContainer: react-tsparticles / tsparticles not available', err)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  // Basic particle options suitable for the 500x500 area
  const options = {
    fullScreen: { enable: false },
    detectRetina: true,
    particles: {
      number: { value: 40 },
      color: { value: '#ffffff' },
      shape: { type: 'circle' },
      size: { value: { min: 2, max: 6 } },
      opacity: { value: 1 },
      move: { enable: true, speed: 0.8, outModes: { default: 'bounce' } }
    },
    interactivity: { events: { onHover: { enable: false }, onClick: { enable: false } } }
  }

  return (
    <div
      id="temp-container"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '500px',
        height: '500px',
        background: '#2b2b2b',
        zIndex: 99999,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box'
      }}
    >
      {ParticlesComp ? (
        <ParticlesComp
          id="temp-particles"
          options={options}
          style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
        />
      ) : null}
    </div>
  )
}

