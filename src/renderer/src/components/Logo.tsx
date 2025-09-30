import React from 'react'

export function Logo() {
  return (
    <div className="logo-container">
      <div className="logo-icon">
        {/* Thread/spiral icon representing Ariadne's thread */}
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none" className="logo-symbol">
          <path
            d="M16 2C23.732 2 30 8.268 30 16C30 23.732 23.732 30 16 30C8.268 30 2 23.732 2 16C2 8.268 8.268 2 16 2Z"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
          />
          <path
            d="M16 6C20.418 6 24 9.582 24 14C24 18.418 20.418 22 16 22C11.582 22 8 18.418 8 14C8 9.582 11.582 6 16 6Z"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            opacity="0.7"
          />
          <path
            d="M16 10C17.657 10 19 11.343 19 13C19 14.657 17.657 16 16 16C14.343 16 13 14.657 13 13C13 11.343 14.343 10 16 10Z"
            stroke="currentColor"
            strokeWidth="1"
            fill="currentColor"
            opacity="0.5"
          />
        </svg>
      </div>
      <div className="logo-text">
        Ariadne
      </div>
    </div>
  )
}