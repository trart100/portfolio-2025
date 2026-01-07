import { useEffect, useRef, useState } from 'react'

const defaultTexts = [
  'Motion Design / Animation / Editing / SFX / Automation / Code',
  'Branding / Campaigns / UI / UX / Social media',
  'AI content generation / Websites / Tools',
  'After Effects / Blender / C4D / Spline 3D / Premiere / Audition / Photoshop / Illustrator / Figma / Google',
  'Team leading / Mentoring'
]

export default function AnimatedInformation({ 
  texts = defaultTexts,
  switchDuration = 0.8,
  displayInterval = 3000
}) {
  const containerRef = useRef(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [displayText, setDisplayText] = useState(texts[0] || '')
  const [gsapLoaded, setGsapLoaded] = useState(false)
  const intervalRef = useRef(null)
  const animatingRef = useRef(false)
  const gsapRef = useRef(null)

  // Initialize GSAP
  useEffect(() => {
    const initGsap = async () => {
      try {
        gsapRef.current = (await import('gsap')).default
        setGsapLoaded(true)
        console.log('GSAP loaded for AnimatedInformation')
      } catch (error) {
        console.error('Failed to load GSAP:', error)
      }
    }
    initGsap()
  }, [])

  // Initialize display text
  useEffect(() => {
    setDisplayText(texts[0] || '')
  }, [texts])

  // Set up the cycling interval ONLY after GSAP is loaded
  useEffect(() => {
    if (!gsapLoaded || texts.length <= 1) return

    console.log('Starting animation interval')
    intervalRef.current = setInterval(() => {
      if (!animatingRef.current) {
        console.log('Switching to next text...')
        switchToNext()
      }
    }, displayInterval)

    return () => {
      console.log('Clearing animation interval')
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [gsapLoaded, texts.length, displayInterval, currentIndex]) // Added currentIndex to dependencies

  const switchToNext = () => {
    if (animatingRef.current || !gsapRef.current || !containerRef.current) {
      console.log('Switch blocked - animating:', animatingRef.current, 'gsap:', !!gsapRef.current, 'container:', !!containerRef.current)
      return
    }
    
    animatingRef.current = true
    const gsap = gsapRef.current
    
    // Get the CURRENT index from state at the time of execution
    setCurrentIndex(prevIndex => {
      const nextIndex = (prevIndex + 1) % texts.length
      const nextText = texts[nextIndex]
      
      console.log(`Switching from index ${prevIndex} to ${nextIndex}`)
      console.log(`Text changing to "${nextText}"`)
      
      // Get current character spans
      const currentChars = containerRef.current.querySelectorAll('.char-span')
      console.log('Found', currentChars.length, 'character spans')
      
      if (currentChars.length === 0) {
        console.log('No character spans found, doing direct switch')
        setDisplayText(nextText)
        animatingRef.current = false
        return nextIndex
      }

      // Create a timeline for proper sequencing
      const tl = gsap.timeline()
      
      // Step 1: Animate characters out (with full completion)
      tl.to(currentChars, {
        y: -20,
        opacity: 0,
        duration: 0.4,
        stagger: 0.015,
        ease: 'power2.in'
      })
      
      // Step 2: Hide the entire container to prevent flash during DOM update
      tl.to(containerRef.current, {
        opacity: 0,
        duration: 0.1
      })
      
      // Step 3: Update the text (while container is hidden)
      tl.call(() => {
        console.log('Timeline: updating text while hidden')
        setDisplayText(nextText)
      })
      
      // Step 4: Wait for React to update DOM
      tl.to({}, { duration: 0.1 })
      
      // Step 5: Show container and animate new characters in
      tl.call(() => {
        const newChars = containerRef.current?.querySelectorAll('.char-span')
        console.log('Timeline: Found', newChars?.length || 0, 'new character spans')
        
        if (newChars && newChars.length > 0) {
          // Set initial state for new characters and container
          gsap.set(newChars, { y: 20, opacity: 0 })
          gsap.set(containerRef.current, { opacity: 1 })
          
          // Animate new characters in
          gsap.to(newChars, {
            y: 0,
            opacity: 1,
            duration: 0.4,
            stagger: 0.015,
            ease: 'power2.out',
            onComplete: () => {
              console.log('Timeline: Enter animation complete')
              animatingRef.current = false
            }
          })
        } else {
          gsap.set(containerRef.current, { opacity: 1 })
          animatingRef.current = false
        }
      })

      return nextIndex
    })
  }

  const characters = displayText.split('')

  return (
    <div 
      ref={containerRef}
      className="animated-information"
      style={{
        marginTop: '100px', // Space after title
        fontSize: '25pt',
        color: '#6e6e6e',
        textAlign: 'center',
        lineHeight: '1.2',
        marginLeft: '34px',
        marginRight: '34px'
      }}
    >
      {characters.map((char, index) => (
        <span
          key={`${currentIndex}-${index}`}
          className="char-span"
          style={{
            display: 'inline-block',
            whiteSpace: char === ' ' ? 'pre' : 'normal'
          }}
        >
          {char}
        </span>
      ))}
    </div>
  )
}