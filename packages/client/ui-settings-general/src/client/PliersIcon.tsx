/**
 * Local pliers glyph replacing the settings gear on the sidebar trigger row
 * and the settings nav fallback. Stroke-based, mirroring the icon set's
 * {size, className} contract so it drops into the same render sites.
 */

export interface PliersIconProps {
  /** Rendered width/height in CSS pixels (square). */
  size?: number
  /** Optional CSS class applied to the <svg>. */
  className?: string | undefined
}

/** Combination pliers: two gripping jaws, a pivot bolt, and flared handles. */
export function PliersIcon({ size = 16, className }: PliersIconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.5 6.9L6.7 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 6.9L9.3 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="8.2" r="1.1" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M8 9.4L3.6 13.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 9.4L12.4 13.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
