import React from 'react';
import { CodeBlock } from './CodeBlock';

interface MarkdownContentProps {
  content: string;
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  if (!content) return null;

  // Split content by code fences ```
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Text before the code block
    if (match.index > lastIndex) {
      const textChunk = content.slice(lastIndex, match.index);
      elements.push(renderTextChunk(textChunk, `text_${lastIndex}`));
    }

    const language = match[1] || 'text';
    const code = match[2].trimEnd();
    elements.push(
      <CodeBlock key={`code_${match.index}`} language={language} code={code} />
    );

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < content.length) {
    const textChunk = content.slice(lastIndex);
    elements.push(renderTextChunk(textChunk, `text_${lastIndex}`));
  }

  return <div className="space-y-2 leading-relaxed text-sm">{elements}</div>;
};

function renderTextChunk(chunk: string, keyPrefix: string): React.ReactNode {
  const lines = chunk.split('\n');
  const renderedNodes: React.ReactNode[] = [];
  let inList: { type: 'ul' | 'ol'; items: React.ReactNode[] } | null = null;
  let inTable: string[] | null = null;

  const flushList = () => {
    if (inList) {
      if (inList.type === 'ul') {
        renderedNodes.push(
          <ul key={`ul_${renderedNodes.length}`} className="list-disc pl-5 space-y-1 my-2 text-zinc-300">
            {inList.items}
          </ul>
        );
      } else {
        renderedNodes.push(
          <ol key={`ol_${renderedNodes.length}`} className="list-decimal pl-5 space-y-1 my-2 text-zinc-300">
            {inList.items}
          </ol>
        );
      }
      inList = null;
    }
  };

  const flushTable = () => {
    if (inTable && inTable.length > 0) {
      renderedNodes.push(renderTable(inTable, `tbl_${renderedNodes.length}`));
      inTable = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Table line: starts and ends with '|'
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      flushList();
      if (!inTable) inTable = [];
      inTable.push(line.trim());
      continue;
    } else {
      flushTable();
    }

    // Headings
    if (line.startsWith('### ')) {
      flushList();
      renderedNodes.push(
        <h4 key={`h4_${i}`} className="text-sm font-semibold text-zinc-100 mt-3 mb-1">
          {renderInline(line.slice(4))}
        </h4>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      renderedNodes.push(
        <h3 key={`h3_${i}`} className="text-base font-semibold text-zinc-100 mt-3.5 mb-1.5">
          {renderInline(line.slice(3))}
        </h3>
      );
      continue;
    }
    if (line.startsWith('# ')) {
      flushList();
      renderedNodes.push(
        <h2 key={`h2_${i}`} className="text-lg font-bold text-zinc-100 mt-4 mb-2">
          {renderInline(line.slice(2))}
        </h2>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      flushList();
      renderedNodes.push(
        <blockquote key={`bq_${i}`} className="border-l-2 border-zinc-700 pl-3 my-2 text-zinc-400 italic">
          {renderInline(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    if (ulMatch) {
      if (!inList || inList.type !== 'ul') {
        flushList();
        inList = { type: 'ul', items: [] };
      }
      inList.items.push(
        <li key={`li_${i}`}>{renderInline(ulMatch[2])}</li>
      );
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (olMatch) {
      if (!inList || inList.type !== 'ol') {
        flushList();
        inList = { type: 'ol', items: [] };
      }
      inList.items.push(
        <li key={`li_${i}`}>{renderInline(olMatch[2])}</li>
      );
      continue;
    }

    flushList();

    // Paragraph
    if (line.trim()) {
      renderedNodes.push(
        <p key={`p_${i}`} className="my-1 text-zinc-200">
          {renderInline(line)}
        </p>
      );
    }
  }

  flushList();
  flushTable();

  return <div key={keyPrefix}>{renderedNodes}</div>;
}

function renderTable(tableLines: string[], key: string): React.ReactNode {
  if (tableLines.length < 2) return null;

  const parseRow = (line: string) => {
    return line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
  };

  const headers = parseRow(tableLines[0]);
  const rows = tableLines.slice(2).map(parseRow);

  return (
    <div key={key} className="my-3 overflow-x-auto rounded border border-zinc-800/40">
      <table className="min-w-full text-xs text-left">
        <thead className="bg-zinc-800/40 border-b border-zinc-800/40 text-zinc-300 font-medium">
          <tr>
            {headers.map((h, idx) => (
              <th key={idx} className="px-3 py-2 border-r border-zinc-800/40 last:border-r-0">
                {renderInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/40">
          {rows.map((row, rIdx) => (
            <tr key={rIdx} className="hover:bg-zinc-800/20">
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-3 py-2 text-zinc-300 border-r border-zinc-800/40 last:border-r-0">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  // Regex to match inline code, bold, italic, and links
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono text-xs border border-zinc-700/50">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-zinc-100">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index} className="italic text-zinc-300">{part.slice(1, -1)}</em>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-100 underline decoration-zinc-500 underline-offset-2 hover:decoration-zinc-200"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return part;
  });
}
