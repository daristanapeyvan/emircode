import React from 'react';

/** The mode's icon above the heading of a start screen (chat, Code). */
export const StartIcon: React.FC<{ icon: React.ReactNode }> = ({ icon }) => (
  <div className="w-12 h-12 rounded-xl bg-zinc-800/70 flex items-center justify-center text-zinc-300" aria-hidden="true">
    {icon}
  </div>
);
