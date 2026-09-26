import React from 'react';

/** Browser window with a page layout and a spark: the "Website Oluştur" icon. */
export const WebsiteIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <rect x="2.5" y="3.5" width="17" height="14" rx="2.5" />
    <path d="M2.5 7.5h17" />
    <circle cx="5.2" cy="5.5" r=".45" fill="currentColor" stroke="none" />
    <circle cx="6.9" cy="5.5" r=".45" fill="currentColor" stroke="none" />
    <rect x="5" y="10" width="6" height="4.5" rx="1" />
    <path d="M13 10.5h4M13 13h2.5" />
    <path d="M19.5 14.2l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="currentColor" strokeWidth={0.8} />
  </svg>
);
