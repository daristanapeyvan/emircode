/**
 * markdown.ts — the small Markdown subset of the wizard's text boxes, converted to HTML.
 *
 * The site wizard hands the user's texts to the model as ready HTML fragments: small models copy
 * HTML faithfully, but converting Markdown themselves they left "**" and "- " in the page.
 * Supported: paragraphs, line breaks, # headings (h3/h4 — the section has its own h2), **bold**,
 * *italic* / _italic_, [links](https://…), - bullet and 1. numbered lists, > quotes.
 */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:|#|\/|\.{0,2}\/?[\w-]+\.html?(?:#[\w-]*)?$)/i;

export function inlineMarkdown(text: string): string {
  let out = escapeHtml(text);
  // links first, so that emphasis inside the label still works
  out = out.replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_m, label: string, url: string) => {
    const decoded = url.replace(/&amp;/g, '&');
    return SAFE_URL.test(decoded) ? `<a href="${escapeHtml(decoded)}">${label}</a>` : label;
  });
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^\w*])\*([^*\n]+?)\*(?![\w*])/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^\w])_([^_\n]+?)_(?![\w])/g, '$1<em>$2</em>');
  return out;
}

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'h'; level: number; text: string };

export function markdownToHtml(md: string): string {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const raw of (md || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      blocks.push({ kind: 'h', level: heading[1].length <= 2 ? 3 : 4, text: heading[2] });
      continue;
    }
    const bullet = line.match(/^\s*[-*+•]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      const cur = current as Block | null;
      if (!cur || cur.kind !== kind) {
        flush();
        current = { kind, items: [] };
      }
      (current as { items: string[] }).items.push((bullet || numbered)![1]);
      continue;
    }
    if (quote) {
      const cur = current as Block | null;
      if (!cur || cur.kind !== 'quote') {
        flush();
        current = { kind: 'quote', lines: [] };
      }
      (current as { lines: string[] }).lines.push(quote[1]);
      continue;
    }
    const cur = current as Block | null;
    if (!cur || cur.kind !== 'p') {
      flush();
      current = { kind: 'p', lines: [] };
    }
    (current as { lines: string[] }).lines.push(line.trim());
  }
  flush();

  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'h':
          return `<h${b.level}>${inlineMarkdown(b.text)}</h${b.level}>`;
        case 'ul':
        case 'ol':
          return `<${b.kind}>${b.items.map((i) => `<li>${inlineMarkdown(i)}</li>`).join('')}</${b.kind}>`;
        case 'quote':
          return `<blockquote><p>${b.lines.map(inlineMarkdown).join('<br>')}</p></blockquote>`;
        default:
          return `<p>${b.lines.map(inlineMarkdown).join('<br>')}</p>`;
      }
    })
    .join('\n');
}

/** Plain text length of a Markdown text (for the wizard's size hints). */
export function markdownTextLength(md: string): number {
  return (md || '').replace(/[*_#>`[\]()]/g, '').replace(/\s+/g, ' ').trim().length;
}
