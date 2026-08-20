import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type CommunityBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the community terminal-and-circuit mark at the host-requested size.
 * @param props - Host-supplied mark presentation.
 * @returns the DSH Desktop Community geometric mark.
 */
export function CommunityBrandMark({ size, className }: CommunityBrandMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-community-brand-mark=""
      fill="none"
      focusable="false"
      height={size}
      shapeRendering="geometricPrecision"
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7 3.75h7.75l3.5 3.5V17A3.25 3.25 0 0 1 15 20.25H7A3.25 3.25 0 0 1 3.75 17V7A3.25 3.25 0 0 1 7 3.75Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path d="M14.5 3.75v3.5h3.5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path
        d="m7.5 9 2.75 3-2.75 3M12.5 15h3.75"
        data-terminal-prompt=""
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path d="M3.75 8H1.8v3M18.25 15H21v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
      <circle cx="1.8" cy="12.5" fill="currentColor" r="1" />
      <circle cx="21" cy="19.5" fill="currentColor" r="1" />
    </svg>
  )
}

/**
 * Render the community name as a compact terminal label beside the mark.
 * @returns the DSH Desktop Community wordmark.
 */
export function CommunityBrandName() {
  return (
    <svg
      aria-label="DSH Desktop Community"
      data-community-brand-name=""
      fill="none"
      height="24"
      role="img"
      shapeRendering="geometricPrecision"
      viewBox="0 0 136 24"
      width="136"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">
        <path d="M1.5 4.5h5.25a5.25 5.25 0 0 1 0 10.5H1.5Z" />
        <path d="M19 5.25a5.5 5.5 0 0 0-3-.75c-2.25 0-3.75 1-3.75 2.65 0 3.7 7 1.45 7 5.25 0 1.75-1.55 2.85-3.95 2.85a6.3 6.3 0 0 1-3.45-1" />
        <path d="M23 4.5V15M31 4.5V15M23 9.75h8" />
        <path d="M35 5.5h4l2 2v4l-2 2h-4" />
        <circle cx="35" cy="5.5" fill="currentColor" r="1" stroke="none" />
        <circle cx="35" cy="13.5" fill="currentColor" r="1" stroke="none" />
      </g>
      <text
        fill="currentColor"
        fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace"
        fontSize="7.5"
        fontWeight="700"
        letterSpacing="1.2"
        x="46"
        y="9"
      >DESKTOP</text>
      <text
        fill="currentColor"
        fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace"
        fontSize="7.5"
        fontWeight="500"
        letterSpacing="0.75"
        x="46"
        y="19"
      >COMMUNITY</text>
    </svg>
  )
}
