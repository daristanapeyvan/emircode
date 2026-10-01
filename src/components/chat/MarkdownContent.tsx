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

// A list item line: "- x", "* x", "+ x", "1. x" or "1) x", with its indentation.
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

type ListType = 'ul' | 'ol';
type ItemBlock = { kind: 'text'; key: string; text: string } | { kind: 'list'; list: ListBlock };
interface ListItem {
  key: string;
  text: string;
  blocks: ItemBlock[];
}
interface ListBlock {
  key: string;
  type: ListType;
  /** The number of the first item of a numbered list ("3." after a code block starts at 3). */
  start: number;
  indent: number;
  items: ListItem[];
}

function indentOf(line: string): number {
  return line.match(/^\s*/)![0].replace(/\t/g, '    ').length;
}

function renderList(list: ListBlock, nested: boolean): React.ReactNode {
  const items = list.items.map((item) => (
    <li key={item.key}>
      {renderInline(item.text)}
      {item.blocks.map((block) =>
        block.kind === 'text' ? (
          <div key={block.key} className="mt-1">
            {renderInline(block.text)}
          </div>
        ) : (
          renderList(block.list, true)
        )
      )}
    </li>
  ));
  const spacing = nested ? 'space-y-1 mt-1' : 'space-y-1 my-2 text-zinc-300';
  return list.type === 'ul' ? (
    <ul key={list.key} className={`list-disc pl-5 ${spacing}`}>
      {items}
    </ul>
  ) : (
    <ol key={list.key} start={list.start !== 1 ? list.start : undefined} className={`list-decimal pl-5 ${spacing}`}>
      {items}
    </ol>
  );
}

function renderTextChunk(chunk: string, keyPrefix: string): React.ReactNode {
  const lines = chunk.split('\n');
  const renderedNodes: React.ReactNode[] = [];
  let inList: ListBlock | null = null;
  let inTable: string[] | null = null;

  const flushList = () => {
    if (inList) {
      renderedNodes.push(renderList(inList, false));
      inList = null;
    }
  };

  /**
   * Adds a list item line to the open list. Items indented deeper than the list become a sub-list
   * of its last item, so "1. Step / - detail / 2. Step" keeps counting 1, 2 instead of starting a
   * new numbered list after the detail.
   */
  const addListItem = (line: string, i: number, marker: string, text: string) => {
    const type: ListType = /\d/.test(marker) ? 'ol' : 'ul';
    const indent = indentOf(line);
    const start = type === 'ol' ? parseInt(marker, 10) : 1;
    const item: ListItem = { key: `li_${i}`, text, blocks: [] };
    const list = inList as ListBlock | null;
    if (list && indent >= list.indent + 2 && list.items.length > 0) {
      const parent = list.items[list.items.length - 1];
      const last = parent.blocks[parent.blocks.length - 1];
      if (last && last.kind === 'list' && last.list.type === type) {
        last.list.items.push(item);
      } else {
        parent.blocks.push({ kind: 'list', list: { key: `sub_${i}`, type, start, indent, items: [item] } });
      }
      return;
    }
    if (!list || list.type !== type) {
      flushList();
      inList = { key: `list_${i}`, type, start, indent, items: [item] };
      return;
    }
    list.items.push(item);
  };

  /** A blank line inside a list keeps it open when the list goes on after it. */
  const listContinuesAfter = (i: number): boolean => {
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      return LIST_ITEM.test(lines[j]) || indentOf(lines[j]) >= 2;
    }
    return false;
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

    // Lists (bulleted and numbered, with nested items)
    const itemMatch = line.match(LIST_ITEM);
    if (itemMatch) {
      addListItem(line, i, itemMatch[2], itemMatch[3]);
      continue;
    }

    if (inList) {
      const list = inList as ListBlock;
      // Blank line between items, or before an indented continuation: the list goes on.
      if (!line.trim() && listContinuesAfter(i)) continue;
      // Indented text under an item belongs to that item.
      if (line.trim() && indentOf(line) >= 2 && list.items.length > 0) {
        list.items[list.items.length - 1].blocks.push({ kind: 'text', key: `lt_${i}`, text: line.trim() });
        continue;
      }
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
