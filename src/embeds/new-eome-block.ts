import type { Editor } from 'obsidian';
import { findInlineFenceAtLine } from './inline-eome-source';

/** Insert a self-contained EOME fenced map without touching existing YAML,
 * notes, or map contents. The caret lands on the empty line inside the fence.
 */
export function insertEomeFenceAtCursor(editor: Editor): void {
  const cursor = editor.getCursor();
  const existing = findInlineFenceAtLine(editor.getValue(), cursor.line);
  const row = existing ? existing.close : cursor.line;
  const lineText = editor.getLine(row);
  if (!existing && lineText.trim() === '') {
    editor.replaceRange('```mindmap-eome\n\n```',
      { line: row, ch: 0 }, { line: row, ch: lineText.length });
    editor.setCursor({ line: row + 1, ch: 0 });
    return;
  }
  editor.replaceRange('\n\n```mindmap-eome\n\n```\n',
    { line: row, ch: lineText.length });
  editor.setCursor({ line: row + 3, ch: 0 });
}
