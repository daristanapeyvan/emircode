import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { tokenizeCode, getTokenClassName } from '@/lib/utils/SyntaxHighlighter';

interface CodeBlockProps {
  language?: string;
  code: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language = 'text', code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  return (
    <div className="my-3 rounded-md border border-zinc-800 bg-[#0e0f12] overflow-hidden text-xs font-mono">
      {/* Code Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800/80 text-zinc-400 select-none">
        <span className="text-[11px] font-medium tracking-wide uppercase text-zinc-400">
          {language || 'text'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" strokeWidth={1.5} />
              <span className="text-emerald-400 font-sans">Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} strokeWidth={1.5} />
              <span className="font-sans">Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Body */}
      <div className="p-3.5 overflow-x-auto text-zinc-200 leading-relaxed selectable-text">
        <pre className="font-mono">
          <code>
            {tokenizeCode(code, language).map((token, idx) => (
              <span key={idx} className={getTokenClassName(token.type)}>
                {token.value}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
};
