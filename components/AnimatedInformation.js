import { useEffect, useRef, useState } from 'react'
import { gsap } from '../lib/gsap'

const defaultTexts = [
  'Motion Design / Animation / Editing / SFX / Automation / Code',
  'Branding / Campaigns / UI / UX / Social media',
  'AI content generation / Websites / Tools',
  'After Effects / Blender / C4D / Spline 3D / Premiere / Audition / Photoshop / Illustrator / Figma / Google',
  'Team leading / Mentoring'
]

export default function AnimatedInformation({
  texts = defaultTexts,
  displayInterval = 3000
}) {
  const containerRef = useRef(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [displayText, setDisplayText] = useState(texts[0] || '')
  const intervalRef = useRef(null)
  const animatingRef = useRef(false)
  const visibleRef = useRef(true)

  // Initialize display text
  useEffect(() => {
    setDisplayText(texts[0] || '')
  }, [texts])

  // Skip switching while scrolled out of view (saves work; resumes on return)
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([entry]) => { visibleRef.current = entry.isIntersecting })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Restarting the interval on each index change keeps the cadence anchored to the last switch
  useEffect(() => {
    if (texts.length <= 1) return

    intervalRef.current = setInterval(() => {
      if (!animatingRef.current && visibleRef.current) {
        switchToNext()
      }
    }, displayInterval)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [texts.length, displayInterval, currentIndex])

  const switchToNext = () => {
    if (animatingRef.current || !containerRef.current) {
      return
    }

    animatingRef.current = true

    // Get the CURRENT index from state at the time of execution
    setCurrentIndex(prevIndex => {
      const nextIndex = (prevIndex + 1) % texts.length
      const nextText = texts[nextIndex]

      // Get current character spans
      const currentChars = containerRef.current.querySelectorAll('.char-span')
      
      if (currentChars.length === 0) {
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
        setDisplayText(nextText)
      })
      
      // Step 4: Wait for React to update DOM
      tl.to({}, { duration: 0.1 })
      
      // Step 5: Show container and animate new characters in
      tl.call(() => {
        const newChars = containerRef.current?.querySelectorAll('.char-span')
        
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
    <div ref={containerRef} className="animated-information">
      {characters.map((char, index) => (
        <span
          key={`${currentIndex}-${index}`}
          className={char === ' ' ? 'char-span char-span--space' : 'char-span'}
        >
          {char}
        </span>
      ))}
    </div>
  )
}