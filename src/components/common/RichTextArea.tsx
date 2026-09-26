import React, { useLayoutEffect, useRef, useState } from 'react';
import { Bold, Italic, Heading2, List, ListOrdered, Quote, Link2, Eye, PenLine } from 'lucide-react';
import { MarkdownContent } from '@/components/chat/MarkdownContent';
import { toggleWrap, toggleLinePrefix, insertLink, continueList, EditResult } from '@/lib/wizard/markdownEdit';
import { cn } from '@/lib/utils/cn';

export interface RichTextLabels {
  bold: string;
  italic: string;
  heading: string;
  bullets: string;
  numbers: string;
  quote: string;
  link: string;
  preview: string;
  write: string;
  emptyPreview: string;
  /** "{words} … {chars}" */
  count: string;
  boldPlaceholder: string;
  italicPlaceholder: string;
  linkPlaceholder: string;
}

interface RichTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  labels: RichTextLabels;
  placeholder?: string;
  minRows?: number;
  id?: string;
  ariaLabel?: string;
}

/**
 * The wizard's smart text box: Markdown with a formatting toolbar, shortcuts (Ctrl+B / I / K),
 * list continuation on Enter and a preview. Edits go through the browser's own text insertion so
 * Ctrl+Z keeps working after toolbar actions.
 */
export const RichTextArea: React.FC<RichTextAreaProps> = ({ value, onChange, labels, placeholder, minRows = 6, id, ariaLabel }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const [preview, setPreview] = useState(false);

  // Restore the selection after a toolbar edit re-rendered the text; keep the box tall enough.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minRows * 22 + 16), 520)}px`;
    if (pendingSelection.current) {
      const { start, end } = pendingSelection.current;
      pendingSelection.current = null;
      el.focus();
      el.setSelectionRange(start, end);
    }
  }, [value, preview, minRows]);

  const apply = (edit: (text: string, start: number, end: number) => EditResult | null) => {
    const el = ref.current;
    if (!el) return;
    const result = edit(el.value, el.selectionStart, el.selectionEnd);
    if (!result) return;
    const before = el.value;
    // Replace only the changed middle part, through the browser (keeps undo history).
    let prefix = 0;
    while (prefix < before.length && prefix < result.text.length && before[prefix] === result.text[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < result.text.length - prefix &&
      before[before.length - 1 - suffix] === result.text[result.text.length - 1 - suffix]
    ) {
      suffix++;
    }
    el.focus();
    el.setSelectionRange(prefix, before.length - suffix);
    const inserted = result.text.slice(prefix, result.text.length - suffix);
    let native = false;
    try {
      native = inserted.length > 0 ? document.execCommand('insertText', false, inserted) : document.execCommand('delete', false);
    } catch {
      native = false;
    }
    pendingSelection.current = { start: result.selStart, end: result.selEnd };
    if (!native || el.value !== result.text) onChange(result.text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'b') {
        e.preventDefault();
        apply((t, s, en) => toggleWrap(t, s, en, '**', labels.boldPlaceholder));
        return;
      }
      if (key === 'i') {
        e.preventDefault();
        apply((t, s, en) => toggleWrap(t, s, en, '*', labels.italicPlaceholder));
        return;
      }
      if (key === 'k') {
        e.preventDefault();
        apply((t, s, en) => insertLink(t, s, en, labels.linkPlaceholder));
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey) {
      const el = e.currentTarget;
      if (el.selectionStart !== el.selectionEnd) return;
      const result = continueList(el.value, el.selectionStart);
      if (result) {
        e.preventDefault();
        apply(() => result);
      }
    }
  };

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const tool = (label: string, icon: React.ReactNode, action: () => void) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={preview}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
    >
      {icon}
    </button>
  );

  return (
    <div className="rounded border border-zinc-750 bg-zinc-900 focus-within:border-zinc-600 transition-colors">
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-zinc-800/80" role="toolbar" aria-label={ariaLabel}>
        {tool(labels.bold, <Bold size={14} />, () => apply((t, s, e) => toggleWrap(t, s, e, '**', labels.boldPlaceholder)))}
        {tool(labels.italic, <Italic size={14} />, () => apply((t, s, e) => toggleWrap(t, s, e, '*', labels.italicPlaceholder)))}
        {tool(labels.heading, <Heading2 size={14} />, () => apply((t, s, e) => toggleLinePrefix(t, s, e, 'heading')))}
        <span className="w-px h-4 bg-zinc-800 mx-1" aria-hidden="true" />
        {tool(labels.bullets, <List size={14} />, () => apply((t, s, e) => toggleLinePrefix(t, s, e, 'bullet')))}
        {tool(labels.numbers, <ListOrdered size={14} />, () => apply((t, s, e) => toggleLinePrefix(t, s, e, 'numbered')))}
        {tool(labels.quote, <Quote size={14} />, () => apply((t, s, e) => toggleLinePrefix(t, s, e, 'quote')))}
        {tool(labels.link, <Link2 size={14} />, () => apply((t, s, e) => insertLink(t, s, e, labels.linkPlaceholder)))}
        <div className="ml-auto flex items-center rounded-md bg-zinc-900 border border-zinc-800 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setPreview(false)}
            aria-pressed={!preview}
            className={cn('flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer transition-colors', !preview ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300')}
          >
            <PenLine size={11} /> {labels.write}
          </button>
          <button
            type="button"
            onClick={() => setPreview(true)}
            aria-pressed={preview}
            className={cn('flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer transition-colors', preview ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300')}
          >
            <Eye size={11} /> {labels.preview}
          </button>
        </div>
      </div>
      {preview ? (
        <div className="px-3.5 py-3 min-h-[120px] text-zinc-200 select-text">
          {value.trim() ? <MarkdownContent content={value} /> : <p className="text-xs text-zinc-500 italic">{labels.emptyPreview}</p>}
        </div>
      ) : (
        <textarea
          ref={ref}
          id={id}
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck
          className="block w-full resize-none bg-transparent px-3.5 py-2.5 text-sm leading-[22px] text-zinc-100 placeholder-zinc-600 focus:outline-none selectable-text"
        />
      )}
      <div className="flex items-center justify-end px-3 py-1 border-t border-zinc-800/60 text-[11px] text-zinc-600 font-mono">
        {labels.count.replace('{words}', String(words)).replace('{chars}', String(value.length))}
      </div>
    </div>
  );
};
