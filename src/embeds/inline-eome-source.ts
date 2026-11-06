/**
 * A mindmap-eome fence may contain either a link to another note (legacy
 * preview) or its own handwritten SVG outline (self-contained interactive
 * map). Never rewrite the surrounding note without an exact fence match.
 */
export function isInlineMindmapSource(source: string): boolean {
  const body = source.trim();
  return body === '' || /^<!-- eome-map-id: [a-z0-9-]{8,64} -->$/m.test(body)
    || /^(?:[-*+]\s+|\d+\.\s+)/m.test(body);
}

export interface InlineEomeFence { open: number; close: number; content: string; prefix: string }
type Fence = InlineEomeFence;

/** Locate exactly one fenced EOME map. This never scans frontmatter or
 * ordinary list content as though it were the selected map.
 */
export function findInlineFenceAtLine(markdown: string, line: number): InlineEomeFence | null {
  return fences(markdown).find(fence => line >= fence.open && line <= fence.close) ?? null;
}

export function findInlineFenceById(markdown: string, id: string): InlineEomeFence | null {
  const matches = fences(markdown).filter(fence =>
    fence.content.split(/\\r?\\n/).some(line => line.trim() === '<!-- eome-map-id: ' + id + ' -->'));
  return matches.length === 1 ? matches[0] : null;
}

export function findInlineFenceByContent(markdown: string, content: string): InlineEomeFence | null {
  const normalized = (value: string): string => value.replace(/\\r\\n/g, '\\n').trim();
  const matches = fences(markdown).filter(fence => normalized(fence.content) === normalized(content));
  return matches.length === 1 ? matches[0] : null;
}

function fences(markdown: string): Fence[] {
  const lines = markdown.split(/\r?\n/);
  const result: Fence[] = [];
  for (let i = 0; i < lines.length; i++) {
    const opening = /^(\s*)(`{3,}|~{3,})\s*mindmap-eome\s*$/.exec(lines[i]);
    if (!opening) continue;
    const marker = opening[2][0];
    const closePattern = new RegExp('^\\s*' + (marker === '`' ? '`' : '~') + '{' + opening[2].length + ',}\\s*$');
    for (let j = i + 1; j < lines.length; j++) {
      if (!closePattern.test(lines[j])) continue;
      result.push({ open: i, close: j, content: lines.slice(i + 1, j).join('\n'), prefix: opening[1] });
      i = j;
      break;
    }
  }
  return result;
}

/** Positions are 0-based Markdown source line numbers. If Obsidian provides
 * a nearby lineStart use it to distinguish identical code fences; otherwise
 * refuse to edit when more than one matching fence exists.
 */
export function replaceInlineMindmapFence(
  markdown: string,
  expected: string,
  updated: string,
  sectionLine?: number
): string | null {
  const normalized = (s: string): string => s.replace(/\r\n/g, '\n').trim();
  const candidates = fences(markdown).filter(f => normalized(f.content) === normalized(expected));
  if (candidates.length === 0) return null;
  const selected = typeof sectionLine === 'number'
    ? candidates.find(f => sectionLine >= f.open && sectionLine <= f.close) ??
      (candidates.length === 1 ? candidates[0] : null)
    : candidates.length === 1 ? candidates[0] : null;
  if (!selected) return null;
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  const replacement = updated.replace(/\r\n/g, '\n').split('\n');
  lines.splice(selected.open + 1, selected.close - selected.open - 1, ...replacement);
  return lines.join(eol);
}

export function insertHandwrittenNode(source: string, targetLine: number | null, embed: string): string | null {
  const lines = source.trim() ? source.replace(/\r\n/g, '\n').split('\n') : [];
  if (targetLine === null) {
    if (lines.some(line => /^\s*[-*+]\s+/.test(line))) return null;
    // Preserve the persistent map marker rather than replacing the whole fence.
    lines.unshift('- ' + embed);
    return lines.join('\n');
  }
  const { parseOutline } = requireOutline();
  const roots = parseOutline(source);
  const flatten = (nodes: ReturnType<typeof parseOutline>): ReturnType<typeof parseOutline> =>
    nodes.reduce((all, node) => all.concat(node, flatten(node.children)), [] as ReturnType<typeof parseOutline>);
  const target = flatten(roots).find(n => n.line === targetLine);
  if (!target) return null;
  lines.splice(target.endLine + 1, 0, target.indent + '  - ' + embed);
  return lines.join('\n');
}

// Kept out of module initialization so the fence parser can be unit-tested
// without importing Obsidian UI globals.
import { parseOutline as parseOutlineNodes } from '../utils/outline';
function requireOutline(): { parseOutline: typeof parseOutlineNodes } {
  return { parseOutline: parseOutlineNodes };
}
