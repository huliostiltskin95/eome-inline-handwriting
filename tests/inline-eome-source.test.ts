import { describe, expect, it } from 'vitest';
import { insertHandwrittenNode, isInlineMindmapSource,
  replaceInlineMindmapFence, findInlineFenceAtLine, findInlineFenceById } from '../src/embeds/inline-eome-source';

describe('embedded handwritten mindmap fenced block', () => {
  it('resolves only the selected fenced map in a note with YAML and multiple maps', () => {
    const markdown = [
      '---', 'category: studio', '---', '', 'Introduzione',
      '```mindmap-eome', '- ![[a.svg]]', '<!-- eome-map-id: one-map-123 -->', '```',
      '', 'Un altro paragrafo', '', '```mindmap-eome',
      '- ![[b.svg]]', '<!-- eome-map-id: two-map-456 -->', '```',
    ].join('\\n');
    expect(findInlineFenceAtLine(markdown, 7)?.content).toContain('a.svg');
    expect(findInlineFenceAtLine(markdown, 13)?.content).toContain('b.svg');
    expect(findInlineFenceAtLine(markdown, 4)).toBeNull();
    expect(findInlineFenceById(markdown, 'two-map-456')?.content).toContain('b.svg');
    expect(findInlineFenceById(markdown, 'one-map-123')?.content).toContain('a.svg');
  });

  it('recognises an empty fence and an inline SVG outline, not a filename reference', () => {
    expect(isInlineMindmapSource('')).toBe(true);
    expect(isInlineMindmapSource('- ![[ink.svg]]')).toBe(true);
    expect(isInlineMindmapSource('- ![[a.svg]]\n  - ![[b.svg]]')).toBe(true);
    expect(isInlineMindmapSource('Map.md')).toBe(false);
  });

  it('creates the first SVG and inserts related nodes inside the fence outline', () => {
    const root = insertHandwrittenNode('', null, '![[A.svg]]');
    expect(root).toBe('- ![[A.svg]]');
    const branch = insertHandwrittenNode(root!, 0, '![[B.svg]]');
    expect(branch).toBe('- ![[A.svg]]\n  - ![[B.svg]]');
    const third = insertHandwrittenNode(branch!, 0, '![[C.svg]]');
    expect(third).toBe('- ![[A.svg]]\n  - ![[B.svg]]\n  - ![[C.svg]]');
  });

  it('replaces only the matching fence and preserves surrounding prose', () => {
    const original = [
      'Titolo', '',
      '```mindmap-eome',
      '- ![[A.svg]]',
      '```',
      '',
      'Testo ordinario', ''
    ].join('\n');
    expect(replaceInlineMindmapFence(original, '- ![[A.svg]]',
      '- ![[A.svg]]\n  - ![[B.svg]]')).toBe([
      'Titolo', '',
      '```mindmap-eome',
      '- ![[A.svg]]',
      '  - ![[B.svg]]',
      '```',
      '',
      'Testo ordinario', ''
    ].join('\n'));
  });

  it('does not update the wrong map when identical fences exist', () => {
    const original = [
      '```mindmap-eome', '- ![[A.svg]]', '```',
      '',
      '```mindmap-eome', '- ![[A.svg]]', '```'
    ].join('\n');
    expect(replaceInlineMindmapFence(original, '- ![[A.svg]]', '- ![[B.svg]]')).toBeNull();
    const selected = replaceInlineMindmapFence(original, '- ![[A.svg]]', '- ![[B.svg]]', 5);
    expect(selected).toBe([
      '```mindmap-eome', '- ![[A.svg]]', '```',
      '',
      '```mindmap-eome', '- ![[B.svg]]', '```'
    ].join('\n'));
  });

  it('refuses to overwrite a modified fence when the exact old content no longer matches', () => {
    expect(replaceInlineMindmapFence(
      '```mindmap-eome\n- ![[C.svg]]\n```',
      '- ![[A.svg]]', '- ![[B.svg]]'
    )).toBeNull();
  });

  it('preserves CRLF Markdown source formatting', () => {
    const data = '```mindmap-eome\r\n\r\n```';
    expect(replaceInlineMindmapFence(data, '', '- ![[A.svg]]')).toBe(
      '```mindmap-eome\r\n- ![[A.svg]]\r\n```'
    );
  });
});
