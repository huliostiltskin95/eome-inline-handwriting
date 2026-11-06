import { describe, expect, it } from 'vitest';
import type { Editor, EditorPosition } from 'obsidian';
import { insertEomeFenceAtCursor } from '../src/embeds/new-eome-block';

function editorFor(initial: string, line: number): {
  editor: Editor;
  source: () => string;
  caret: () => EditorPosition;
} {
  let value = initial, cursor: EditorPosition = { line, ch: 0 };
  const editor = {
    getValue: () => value,
    getCursor: () => cursor,
    getLine: (row: number) => value.split('\n')[row] ?? '',
    setCursor: (next: EditorPosition) => { cursor = next; },
    replaceRange: (newText: string, from: EditorPosition, to?: EditorPosition) => {
      const lines = value.split('\n');
      const start = lines.slice(0, from.line).reduce((n, part) => n + part.length + 1, 0) + from.ch;
      const endPos = to ?? from;
      const end = lines.slice(0, endPos.line).reduce((n, part) => n + part.length + 1, 0) + endPos.ch;
      value = value.slice(0, start) + newText + value.slice(end);
    },
  } as unknown as Editor;
  return { editor, source: () => value, caret: () => cursor };
}

describe('create EOME code block command', () => {
  it('inserts a blank EOME block into an empty line with the cursor inside', () => {
    const input = editorFor('Prima\n\nDopo', 1);
    insertEomeFenceAtCursor(input.editor);
    expect(input.source()).toBe('Prima\n```mindmap-eome\n\n```\nDopo');
    expect(input.caret()).toEqual({ line: 2, ch: 0 });
  });

  it('inserts after existing prose without overwriting frontmatter or text', () => {
    const input = editorFor('---\ntitle: Prova\n---\nParagrafo\nAltro', 3);
    insertEomeFenceAtCursor(input.editor);
    expect(input.source()).toContain('title: Prova');
    expect(input.source()).toContain('Paragrafo\n\n```mindmap-eome\n\n```\n\nAltro');
    expect(input.caret()).toEqual({ line: 6, ch: 0 });
  });

  it('places a second map after the existing fence rather than nesting it', () => {
    const input = editorFor('```mindmap-eome\n- ![[a.svg]]\n```\nFine', 1);
    insertEomeFenceAtCursor(input.editor);
    expect(input.source()).toBe('```mindmap-eome\n- ![[a.svg]]\n```\n\n```mindmap-eome\n\n```\n\nFine');
    expect(input.caret()).toEqual({ line: 5, ch: 0 });
  });
});
