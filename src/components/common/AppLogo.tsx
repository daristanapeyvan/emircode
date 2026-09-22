import React from 'react';

interface AppLogoProps {
  size?: number;
  className?: string;
}

export const AppLogo: React.FC<AppLogoProps> = ({ size = 20, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id="ec-brand-grad" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38BDF8" /> {/* Cyan 400 */}
          <stop offset="1" stopColor="#818CF8" /> {/* Indigo 400 */}
        </linearGradient>
      </defs>

      {/* Chassis: Minimalist dark container with subtle border */}
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="5.5"
        className="fill-zinc-900/90 stroke-zinc-700/60"
        strokeWidth="1.2"
      />

      {/* Monogram 'E' (Modern code geometry) */}
      <path
        d="M10 7.5H5.5V16.5H10M5.5 12H8.8"
        stroke="url(#ec-brand-grad)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Monogram 'C' (Symmetric terminal bracket curve) */}
      <path
        d="M18.5 7.5H14.5C13.4 7.5 12.5 8.4 12.5 9.5V14.5C12.5 15.6 13.4 16.5 14.5 16.5H18.5"
        stroke="url(#ec-brand-grad)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Subtle AI active prompt node */}
      <circle cx="18.5" cy="12" r="1" className="fill-cyan-400" />
    </svg>
  );
};
