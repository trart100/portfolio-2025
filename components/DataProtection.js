import { useEffect, useState } from 'react'

export default function DataProtection() {
  const [isExpanded, setIsExpanded] = useState(false)
  const [hasConsented, setHasConsented] = useState(null) // null = no choice, true/false = yes/no

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Check for existing consent choice
    const savedConsent = localStorage.getItem('datenschutz-consent')

    if (savedConsent !== null) {
      setHasConsented(savedConsent === 'true')
      setIsExpanded(false) // Collapse if user has already made a choice
    } else {
      // First visit - expand automatically
      setIsExpanded(true)
    }
  }, [])

  const handleConsent = (consent) => {
    setHasConsented(consent)
    
    // Store in localStorage
    localStorage.setItem('datenschutz-consent', consent.toString())
    localStorage.setItem('datenschutz-timestamp', new Date().toISOString())
    
    // Collapse after choice
    setTimeout(() => setIsExpanded(false), 800)
  }

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded)
  }

  const handleHeaderKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleExpanded()
    }
  }

  return (
    <div className={`data-protection ${isExpanded ? 'data-protection--expanded' : ''}`}>
      <div
        className="data-protection-header"
        onClick={toggleExpanded}
        onKeyDown={handleHeaderKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
      >
        <span className="data-protection-label">
          {hasConsented === null ? 'Privacy' : hasConsented ? 'Privacy ✓' : 'Privacy ✗'}
        </span>
        <span className={`data-protection-toggle ${isExpanded ? 'data-protection-toggle--open' : ''}`}>
          {isExpanded ? '−' : '+'}
        </span>
      </div>
      
      {isExpanded && (
        <div className="data-protection-content">
          <div className="data-protection-text">
            This website uses analytics to improve user experience. 
            Your data is processed according to GDPR compliance.
          </div>
          <div className="data-protection-actions">
            <button 
              className="data-protection-btn data-protection-btn--yes"
              onClick={() => handleConsent(true)}
              type="button"
            >
              Accept
            </button>
            <button 
              className="data-protection-btn data-protection-btn--no"
              onClick={() => handleConsent(false)}
              type="button"
            >
              Decline
            </button>
          </div>
        </div>
      )}
    </div>
  )
}