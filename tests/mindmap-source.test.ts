import { expect, it } from 'vitest';
import { parseOutline, isOutlineCompatible, isEmptyContent } from '../src/utils/outline';
import { parseHeadingSections } from '../src/utils/heading-sections';
it('renders only the map fence and retains original edit offsets', () => {
  const note = '---\nrelations:\n  - id: hidden\n---\n# Outside\n- unrelated\n```mindmap-eome\n- Root\n  - Child\n```\n- after';
  expect(isOutlineCompatible(note)).toBe(true);
  const roots = parseOutline(note);
  expect(roots).toHaveLength(1);
  expect(roots[0]).toMatchObject({ text: 'Root', line: 7, endLine: 8 });
  expect(roots[0].children[0].line).toBe(8);
  expect(parseHeadingSections(note)).toEqual([]);
});
it('ignores frontmatter in legacy outlines too', () => {
  expect(parseOutline('---\ntags:\n - hidden\n---\n- real').map(n => n.text)).toEqual(['real']);
});
it('supports tilde fences, CRLF, and an empty map in a nonempty note', () => {
  expect(isEmptyContent('text\r\n~~~mindmap-eome\r\n\r\n~~~\r\n- outside')).toBe(true);
});
it('does not interpret an example inside a different code fence as a map', () => {
  expect(isOutlineCompatible('````text\n```mindmap-eome\n- example\n```\n````')).toBe(false);
});
