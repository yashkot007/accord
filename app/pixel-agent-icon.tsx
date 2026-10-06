import type { SVGProps } from 'react';

/** A decorative assistant glyph; the adjacent name and status carry meaning. */
export function PixelAgentIcon({ size = 24, className = '', ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg {...props} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={`pixel-agent-icon ${className}`} aria-hidden="true" focusable="false" shapeRendering="crispEdges">
    <path fillRule="evenodd" d="M7 1h2v2H7V1ZM4 3h8v1h2v8h-2v2H4v-2H2V4h2V3Zm1 3v3h2V6H5Zm4 0v3h2V6H9Zm-3 5v1h4v-1H6Z" />
    <path d="M0 6h1v4H0V6Zm15 0h1v4h-1V6Z" />
  </svg>;
}
