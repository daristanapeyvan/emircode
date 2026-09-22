import React, { useMemo, useState } from 'react';
import { tokenizeCode, getTokenClassName } from '@/lib/utils/SyntaxHighlighter';
import { Check, Copy, Columns, AlignJustify } from 'lucide-react';

export interface DiffViewerProps {
  originalContent: string;
  newContent: string;
  filePath?: string;
  language?: string;
  className?: string;
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

function computeLineDiff(original: string, modified: string): DiffLine[] {
  const origLines = original ? original.split('\n') : [];
  const modLines = modified ? modified.split('\n') : [];

  if (origLines.length === 0) {
    return modLines.map((content, idx) => ({
      type: 'added',
      newLineNumber: idx + 1,
      content,
    }));
  }

  if (modLines.length === 0) {
    return origLines.map((content, idx) => ({
      type: 'removed',
      oldLineNumber: idx + 1,
      content,
    }));
  }

  // LCS Matrix
  const n = origLines.length;
  const m = modLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (origLines[i - 1] === modLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  let i = n;
  let j = m;
  const resultReversed: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
      resultReversed.push({
        type: 'unchanged',
        oldLineNumber: i,
        newLineNumber: j,
        content: origLines[i - 1],
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      resultReversed.push({
        type: 'added',
        newLineNumber: j,
        content: modLines[j - 1],
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      resultReversed.push({
        type: 'removed',
        oldLineNumber: i,
        content: origLines[i - 1],
      });
      i--;
    }
  }

  return resultReversed.reverse();
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  originalContent,
  newContent,
  filePath,
  language = 'ts',
  className = '',
}) => {
  const [copied, setCopied] = useState(false);
  const [showOnlyChanges, setShowOnlyChanges] = useState(false);

  const diffLines = useMemo(
    () => computeLineDiff(originalContent, newContent),
    [originalContent, newContent]
  );

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const line of diffLines) {
      if (line.type === 'added') additions++;
      else if (line.type === 'removed') deletions++;
    }
    return { additions, deletions };
  }, [diffLines]);

  const displayedLines = useMemo(() => {
    if (!showOnlyChanges) return diffLines;
    return diffLines.filter((l) => l.type !== 'unchanged');
  }, [diffLines, showOnlyChanges]);

  const handleCopyNew = () => {
    navigator.clipboard.writeText(newContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden text-xs font-mono shadow-inner ${className}`}
    >
      {/* Diff Header Bar */}
      <div className="px-4 py-2 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          {filePath && <span className="text-zinc-200 font-semibold">{filePath}</span>}
          <div className="flex items-center gap-1 text-[11px] font-medium">
            <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-400">
              +{stats.additions}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-800/60 text-rose-400">
              -{stats.deletions}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOnlyChanges(!showOnlyChanges)}
            title={showOnlyChanges ? 'Tüm satırları göster' : 'Sadece değişiklikleri göster'}
            className={`px-2 py-1 rounded text-[11px] font-sans flex items-center gap-1 border transition-colors cursor-pointer ${
              showOnlyChanges
                ? 'bg-cyan-950 border-cyan-700 text-cyan-300'
                : 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {showOnlyChanges ? <AlignJustify size={12} /> : <Columns size={12} />}
            <span>{showOnlyChanges ? 'Tüm Kod' : 'Sadece Değişiklikler'}</span>
          </button>

          <button
            onClick={handleCopyNew}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Yeni içeriği kopyala"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      {/* Diff Body Lines */}
      <div className="overflow-auto max-h-[500px] divide-y divide-zinc-900/40 select-text leading-relaxed">
        {displayedLines.length === 0 ? (
          <div className="p-6 text-center text-zinc-500 font-sans">
            Fark bulunamadı (İçerikler aynı).
          </div>
        ) : (
          displayedLines.map((line, idx) => {
            const isAdded = line.type === 'added';
            const isRemoved = line.type === 'removed';
            const tokens = tokenizeCode(line.content, language);

            return (
              <div
                key={idx}
                className={`flex items-stretch font-mono text-[12px] group ${
                  isAdded
                    ? 'bg-emerald-950/25 border-l-2 border-emerald-500 hover:bg-emerald-950/40'
                    : isRemoved
                    ? 'bg-rose-950/25 border-l-2 border-rose-500 hover:bg-rose-950/40'
                    : 'hover:bg-zinc-900/40 border-l-2 border-transparent'
                }`}
              >
                {/* Old Line Number */}
                <span className="w-10 text-right pr-2 py-0.5 text-[11px] text-zinc-600 select-none shrink-0 font-sans">
                  {line.oldLineNumber || ''}
                </span>

                {/* New Line Number */}
                <span className="w-10 text-right pr-2 py-0.5 text-[11px] text-zinc-600 select-none shrink-0 font-sans border-r border-zinc-800/80">
                  {line.newLineNumber || ''}
                </span>

                {/* Sign Indicator */}
                <span
                  className={`w-6 text-center py-0.5 select-none shrink-0 font-bold ${
                    isAdded
                      ? 'text-emerald-400'
                      : isRemoved
                      ? 'text-rose-400'
                      : 'text-zinc-600'
                  }`}
                >
                  {isAdded ? '+' : isRemoved ? '-' : ' '}
                </span>

                {/* Line Tokens */}
                <div className="flex-1 py-0.5 pr-4 whitespace-pre overflow-x-auto">
                  {tokens.map((token, tIdx) => (
                    <span
                      key={tIdx}
                      className={
                        isRemoved
                          ? 'text-rose-300 line-through opacity-80'
                          : isAdded
                          ? 'text-emerald-200'
                          : getTokenClassName(token.type)
                      }
                    >
                      {token.value}
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
