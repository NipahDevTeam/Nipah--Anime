import { useId } from 'react'

export default function NipahLogo({ className = '', title = 'Nipah! Anime' }) {
  const gradientId = `nipah-logo-gradient-${useId().replace(/:/g, '')}`
  const sheenId = `nipah-logo-sheen-${useId().replace(/:/g, '')}`

  return (
    <svg
      className={className}
      viewBox="0 0 96 116"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="10%" y1="8%" x2="82%" y2="92%">
          <stop offset="0%" stopColor="#f5d682" />
          <stop offset="45%" stopColor="#efbf62" />
          <stop offset="100%" stopColor="#cf8733" />
        </linearGradient>
        <linearGradient id={sheenId} x1="12%" y1="10%" x2="85%" y2="88%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.58)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      <path
        d="M12 104V12h18l34 45V12h20v92H66L32 58v46H12Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M38 12h16l34 46v34L38 26V12Z"
        fill="#0b0c0f"
        opacity="0.58"
      />
      <path
        d="M16 14h12l56 76v14h-9L16 25V14Z"
        fill={`url(#${sheenId})`}
        opacity="0.72"
      />
    </svg>
  )
}
