/**
 * test_markdown.ts
 * The chat's Markdown renderer: numbered lists keep their numbers across blank lines, nested
 * bullets, indented explanations and code blocks between the items.
 *
 * Run: node scripts/run-ts-test.mjs test_markdown.ts
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from './src/components/chat/MarkdownContent';

let passed = 0;
const failures: string[] = [];
function check(condition: boolean, message: string, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`✅ ${message}`);
  } else {
    failures.push(message);
    console.error(`❌ ${message}${detail !== undefined ? `\n   → ${JSON.stringify(detail).slice(0, 900)}` : ''}`);
  }
}
const section = (title: string) => console.log(`\n--- ${title} ---`);

const html = (content: string) => renderToStaticMarkup(React.createElement(MarkdownContent, { content }));
const count = (text: string, part: string) => text.split(part).length - 1;

section('Numbered lists');
{
  const out = html('1. First\n2. Second\n3. Third');
  check(count(out, '<ol') === 1 && count(out, '<li') === 3, 'A plain list is one list of three items', out);
  check(!out.includes('start='), 'A list that starts at 1 has no start attribute', out);
}
{
  const out = html('1. First\n\n2. Second\n\n3. Third');
  check(count(out, '<ol') === 1 && count(out, '<li') === 3, 'Blank lines between items keep one list (1, 2, 3)', out);
}
{
  const out = html('1. Install\n   - download the file\n   - run it\n2. Configure\n3. Start');
  check(count(out, '<ol') === 1, 'Nested bullets do not split the numbered list', out);
  check(count(out, '<ul') === 1 && out.indexOf('<ul') > out.indexOf('<li'), 'The bullets are a sub-list of item 1', out);
  check(count(out, '<li') === 5, 'Three numbered items and two bullets', out);
}
{
  const out = html('1. Open the file\n   It is in the project root.\n2. Edit it');
  check(count(out, '<ol') === 1 && out.includes('It is in the project root.'), 'An indented explanation stays inside its item', out);
}
{
  const out = html('1. Create the file\n2. Add this code:\n\n```js\nconsole.log(1);\n```\n\n3. Run it');
  check(count(out, '<ol') === 2, 'A code block between items splits the list in two', out);
  check(out.includes('<ol start="3"'), 'The list after the code block starts at 3, not 1', out);
}
{
  const out = html('Steps:\n\n3. Third\n4. Fourth');
  check(out.includes('<ol start="3"'), 'A list keeps the number its first item was given', out);
}
{
  const out = html('1) One\n2) Two');
  check(count(out, '<ol') === 1 && count(out, '<li') === 2, '"1)" numbering is a numbered list', out);
}

section('Other blocks still end a list');
{
  const out = html('1. First\n2. Second\n\nA closing sentence.');
  check(count(out, '<ol') === 1 && out.includes('<p') && out.indexOf('<p') > out.indexOf('</ol>'), 'A paragraph after a blank line ends the list', out);
}
{
  const out = html('- a\n- b\n1. one\n2. two');
  check(count(out, '<ul') === 1 && count(out, '<ol') === 1, 'Switching from bullets to numbers starts a new list', out);
}
{
  const out = html('1. First\n## Heading\n2. Second');
  check(count(out, '<ol') === 2 && out.includes('<ol start="2"'), 'A heading ends the list; the next one keeps its number', out);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error(failures.map((f) => ` - ${f}`).join('\n'));
  process.exitCode = 1;
}
