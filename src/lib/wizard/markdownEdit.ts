/**
 * markdownEdit.ts — pure text operations behind the wizard's smart text box (toolbar buttons,
 * shortcuts and list continuation). Each returns the new text and the selection to restore.
 */

export interface EditResult {
  text: string;
  selStart: number;
  selEnd: number;
}

/** Wraps the selection in a marker (**bold**, *italic*); unwraps when it is already wrapped. */
export function toggleWrap(text: string, start: number, end: number, marker: string, placeholder: string): EditResult {
  const selected = text.slice(start, end);
  const before = text.slice(0, start);
  const after = text.slice(end);
  // already wrapped around the selection -> unwrap
  if (before.endsWith(marker) && after.startsWith(marker) && selected) {
    const b = before.slice(0, before.length - marker.length);
    return { text: b + selected + after.slice(marker.length), selStart: b.length, selEnd: b.length + selected.length };
  }
  // selection includes the markers -> unwrap
  if (selected.length > marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    return { text: before + inner + after, selStart: start, selEnd: start + inner.length };
  }
  // keep surrounding spaces outside of the markers ("kalın " -> "**kalın** ")
  const lead = selected.match(/^\s*/)![0];
  const trail = selected.match(/\s*$/)![0];
  const core = selected.trim() || placeholder;
  const inserted = `${lead}${marker}${core}${marker}${trail}`;
  const coreStart = start + lead.length + marker.length;
  return { text: before + inserted + after, selStart: coreStart, selEnd: coreStart + core.length };
}

function lineBounds(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', Math.max(end - (end > start && text[end - 1] === '\n' ? 1 : 0), start));
  return { from, to: nl === -1 ? text.length : nl };
}

const LINE_PREFIX = /^(\s*)(?:#{1,6}\s+|[-*+•]\s+|\d+[.)]\s+|>\s?)/;

/**
 * Toggles a block prefix on every selected line: "## " (heading), "- " (bullets), "1. " (numbered,
 * counted per line) or "> " (quote). Other block prefixes on those lines are replaced.
 */
export function toggleLinePrefix(text: string, start: number, end: number, kind: 'heading' | 'bullet' | 'numbered' | 'quote'): EditResult {
  const { from, to } = lineBounds(text, start, end);
  const lines = text.slice(from, to).split('\n');
  const has = (l: string) =>
    kind === 'heading' ? /^\s*#{1,6}\s+/.test(l) : kind === 'bullet' ? /^\s*[-*+•]\s+/.test(l) : kind === 'numbered' ? /^\s*\d+[.)]\s+/.test(l) : /^\s*>\s?/.test(l);
  const nonEmpty = lines.filter((l) => l.trim());
  const remove = nonEmpty.length > 0 && nonEmpty.every(has);
  let n = 0;
  const out = lines.map((l) => {
    if (!l.trim() && lines.length > 1) return l;
    const bare = l.replace(LINE_PREFIX, '$1');
    if (remove) return bare;
    const indent = bare.match(/^\s*/)![0];
    const body = bare.slice(indent.length);
    n++;
    const prefix = kind === 'heading' ? '## ' : kind === 'bullet' ? '- ' : kind === 'numbered' ? `${n}. ` : '> ';
    return `${indent}${prefix}${body}`;
  });
  const replaced = out.join('\n');
  const newText = text.slice(0, from) + replaced + text.slice(to);
  const delta = replaced.length - (to - from);
  if (start === end) {
    const caret = Math.max(from, Math.min(from + replaced.length, start + (out[0].length - lines[0].length)));
    return { text: newText, selStart: caret, selEnd: caret };
  }
  return { text: newText, selStart: from, selEnd: Math.max(from, end + delta) };
}

/** [selected text](https://) with the URL selected, ready to be typed over. */
export function insertLink(text: string, start: number, end: number, placeholder: string): EditResult {
  const label = text.slice(start, end).trim() || placeholder;
  const url = 'https://';
  const inserted = `[${label}](${url})`;
  const urlStart = start + label.length + 3;
  return { text: text.slice(0, start) + inserted + text.slice(end), selStart: urlStart, selEnd: urlStart + url.length };
}

/**
 * Enter inside a list item continues the list ("- " / "3. "); Enter on an empty item ends the list.
 * Returns null when Enter should behave normally.
 */
export function continueList(text: string, caret: number): EditResult | null {
  const from = text.lastIndexOf('\n', caret - 1) + 1;
  const line = text.slice(from, caret);
  const m = line.match(/^(\s*)([-*+•]|\d+[.)]|>)(\s+)(.*)$/);
  if (!m) return null;
  const [, indent, marker, space, body] = m;
  if (!body.trim() && text.slice(caret, text.indexOf('\n', caret) === -1 ? text.length : text.indexOf('\n', caret)).trim() === '') {
    // empty item: remove the marker and stop the list
    const newText = text.slice(0, from) + text.slice(caret);
    return { text: newText, selStart: from, selEnd: from };
  }
  const nextMarker = /^\d+/.test(marker) ? `${parseInt(marker, 10) + 1}${marker.slice(-1)}` : marker;
  const insert = `\n${indent}${nextMarker}${space}`;
  const newText = text.slice(0, caret) + insert + text.slice(caret);
  return { text: newText, selStart: caret + insert.length, selEnd: caret + insert.length };
}
