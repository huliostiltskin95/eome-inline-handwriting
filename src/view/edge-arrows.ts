import { Notice, type App, type TFile } from 'obsidian';
import type { OutlineNode } from '../utils/outline';
import { extractDrawingLink } from '../drawing/drawing-link';
import type { MindmapView } from './mindmap-view';

export type EdgeArrowMode = 'none' | 'start' | 'end' | 'both';
export const ARROW_MODES: readonly EdgeArrowMode[] = ['none', 'end', 'start', 'both'];
const FRONTMATTER_FIELD = 'eome-edge-arrows';
const validModes = new Set<string>(ARROW_MODES);

/**
 * A native SVG node gets a stable vault-path key, independent of line numbers
 * and of its position in Dagre. Older, non-drawing nodes use their outline
 * content as a fallback; identical text nodes share the same arrow preference.
 */
export function arrowKeyForNode(app: App, source: TFile, node: OutlineNode): string {
  const link = extractDrawingLink(node.text);
  if (link) {
    const attachment = app.metadataCache.getFirstLinkpathDest(link, source.path);
    if (attachment?.path) return 'svg:' + attachment.path;
  }
  return 'text:' + node.text.trim();
}

export function readEdgeArrowModes(app: App, file: TFile): Record<string, EdgeArrowMode> {
  const value: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[FRONTMATTER_FIELD];
  const modes: Record<string, EdgeArrowMode> = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return modes;
  for (const [key, mode] of Object.entries(value as Record<string, unknown>)) {
    if (key.length <= 600 && typeof mode === 'string' && validModes.has(mode)) {
      modes[key] = mode as EdgeArrowMode;
    }
  }
  return modes;
}

export function arrowModeForNode(view: MindmapView, node: OutlineNode): EdgeArrowMode {
  if (!view.file) return 'none';
  return view.edgeArrowModes[arrowKeyForNode(view.app, view.file, node)] ?? 'none';
}

export function arrowShapesForMode(mode: EdgeArrowMode): { sourceArrow: string; targetArrow: string } {
  return {
    sourceArrow: mode === 'start' || mode === 'both' ? 'triangle' : 'none',
    targetArrow: mode === 'end' || mode === 'both' ? 'triangle' : 'none'
  };
}

export async function cycleIncomingEdgeArrow(view: MindmapView, node: OutlineNode): Promise<void> {
  const file = view.file;
  if (!file) return;
  const key = arrowKeyForNode(view.app, file, node);
  const previous = arrowModeForNode(view, node);
  const next = ARROW_MODES[(ARROW_MODES.indexOf(previous) + 1) % ARROW_MODES.length];
  // Update immediately; the edge marker should not need a complete relayout.
  view.edgeArrowModes[key] = next;
  view.updateIncomingEdgeArrow(node);
  try {
    await view.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const existing = frontmatter[FRONTMATTER_FIELD];
      const map: Record<string, EdgeArrowMode> = {};
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        for (const [existingKey, mode] of Object.entries(existing as Record<string, unknown>)) {
          if (validModes.has(String(mode))) map[existingKey] = mode as EdgeArrowMode;
        }
      }
      if (next === 'none') delete map[key];
      else map[key] = next;
      if (Object.keys(map).length) frontmatter[FRONTMATTER_FIELD] = map;
      else delete frontmatter[FRONTMATTER_FIELD];
    });
    new Notice('Freccia: ' + ({ none: 'nessuna', end: 'finale', start: 'iniziale', both: 'doppia' }[next]));
  } catch (error) {
    view.edgeArrowModes[key] = previous;
    view.updateIncomingEdgeArrow(node);
    console.error('Unable to save edge-arrow mode:', error);
    new Notice('Impossibile salvare la freccia nella nota Markdown.');
  }
}
