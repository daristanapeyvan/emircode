import React from 'react';

interface AppLogoProps {
  size?: number;
  className?: string;
}

/** The "EC" monogram in one flat color (the current text color). */
export const AppLogo: React.FC<AppLogoProps> = ({ size = 20, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`shrink-0 text-zinc-100 ${className}`}
    >
      <rect x="2" y="2" width="20" height="20" rx="4" className="fill-zinc-900 stroke-zinc-700" strokeWidth="1.2" />
      <path d="M10 7.5H5.5V16.5H10M5.5 12H8.8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M18.5 7.5H14.5C13.4 7.5 12.5 8.4 12.5 9.5V14.5C12.5 15.6 13.4 16.5 14.5 16.5H18.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
