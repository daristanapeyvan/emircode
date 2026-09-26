import React from 'react';
import { cn } from '@/lib/utils/cn';

export interface TabItem {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange, className }) => {
  return (
    <div role="tablist" className={cn('flex items-center gap-1 border-b border-zinc-800', className)}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px px-3 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer',
              isActive ? 'text-zinc-100 border-zinc-300' : 'text-zinc-400 border-transparent hover:text-zinc-200'
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
