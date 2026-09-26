import React from 'react';
import {
  Calculator,
  ArrowLeftRight,
  HeartPulse,
  Landmark,
  Receipt,
  CalendarDays,
  Timer,
  ListChecks,
  NotebookPen,
  CalendarCheck,
  Hourglass,
  Wallet,
  KeyRound,
  Palette,
  Type,
  Dices,
  CircleHelp,
  Layers,
  Keyboard,
  Brain,
  Gamepad2,
  FileText,
  Replace,
  AtSign,
  Sheet,
  FileJson,
  Merge,
  ChartColumn,
  FolderOpen,
  FolderTree,
  Files,
  Copy,
  Archive,
  HardDrive,
  Wrench,
  Braces,
  FileSearch,
  ListOrdered,
  Sparkles,
  LucideIcon,
} from 'lucide-react';

/** Catalog icon ids (kebab-case, as in lucide) → components. */
const ICONS: Record<string, LucideIcon> = {
  calculator: Calculator,
  'arrow-left-right': ArrowLeftRight,
  'heart-pulse': HeartPulse,
  landmark: Landmark,
  receipt: Receipt,
  'calendar-days': CalendarDays,
  timer: Timer,
  'list-checks': ListChecks,
  'notebook-pen': NotebookPen,
  'calendar-check': CalendarCheck,
  hourglass: Hourglass,
  wallet: Wallet,
  'key-round': KeyRound,
  palette: Palette,
  type: Type,
  dices: Dices,
  'circle-help': CircleHelp,
  layers: Layers,
  keyboard: Keyboard,
  brain: Brain,
  'gamepad-2': Gamepad2,
  'file-text': FileText,
  replace: Replace,
  'at-sign': AtSign,
  sheet: Sheet,
  'file-json': FileJson,
  merge: Merge,
  'chart-column': ChartColumn,
  'folder-open': FolderOpen,
  'folder-tree': FolderTree,
  files: Files,
  copy: Copy,
  archive: Archive,
  'hard-drive': HardDrive,
  wrench: Wrench,
  braces: Braces,
  'file-search': FileSearch,
  'list-ordered': ListOrdered,
};

export const ToolIcon: React.FC<{ id: string; size?: number; className?: string }> = ({ id, size = 18, className }) => {
  const Icon = ICONS[id] || Sparkles;
  return <Icon size={size} strokeWidth={1.6} className={className} aria-hidden="true" focusable="false" />;
};

const svgProps = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
  focusable: false,
});

/** A small app window with a key grid and a spark: the "Mini Uygulama" icon. */
export const MiniAppIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className }) => (
  <svg {...svgProps(size, className)}>
    <rect x="3.5" y="2.5" width="13" height="17" rx="2.5" />
    <rect x="6" y="5" width="8" height="3.2" rx=".8" />
    <circle cx="7" cy="11.4" r=".55" fill="currentColor" stroke="none" />
    <circle cx="10" cy="11.4" r=".55" fill="currentColor" stroke="none" />
    <circle cx="13" cy="11.4" r=".55" fill="currentColor" stroke="none" />
    <circle cx="7" cy="14.4" r=".55" fill="currentColor" stroke="none" />
    <circle cx="10" cy="14.4" r=".55" fill="currentColor" stroke="none" />
    <path d="M12.4 14.4h1.2" />
    <path d="M19.5 14.2l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="currentColor" strokeWidth={0.8} />
  </svg>
);

/** A terminal window with a prompt and a spark: the "Betik" icon. */
export const ScriptIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className }) => (
  <svg {...svgProps(size, className)}>
    <rect x="2.5" y="3.5" width="17" height="14" rx="2.5" />
    <path d="M6 8.5l2.6 2.2L6 12.9" />
    <path d="M10.5 13.2h4" />
    <path d="M19.5 14.2l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="currentColor" strokeWidth={0.8} />
  </svg>
);
