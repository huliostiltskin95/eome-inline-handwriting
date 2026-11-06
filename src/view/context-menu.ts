import { Menu } from 'obsidian';
import type { OutlineNode } from '../utils/outline';
import type { MindmapView } from './mindmap-view';
import { editNodeContent } from '../drawing/drawing-actions';
import { extractDrawingLink } from '../drawing/drawing-link';
import { resolveExcalidrawEmbed } from '../drawing/excalidraw-integration';
import { appendNewNodeChoices } from '../ui/menus/handwritten-node-menu';
import { showNodeRelationArrowsMenu } from './relations-overlay';

/** EOME is an ink-only canvas. Old text nodes are displayed in read-only
 * mode; the menu contains no operations opening a text input or adding
 * plaintext nodes. All new nodes are editable SVG drawings.
 */
export function showNodeContextMenu(
  view: MindmapView,
  event: MouseEvent,
  explicitNodeLine?: number
): void {
  event.preventDefault();
  event.stopPropagation();
  if (view.isDirectNodeDragActive()) return;
  const contextLine = explicitNodeLine ?? contextLineFromEvent(event);
  const contextNode = Number.isNaN(contextLine) ? null : view.getNodeByLine(contextLine);
  if (contextNode && !view.selectedNodeLines.has(contextNode.line)) {
    view.selectNode(contextNode.line);
  } else {
    view.wrapper?.focus();
  }
  const selectedNodes = getSelectedNodesForContext(view, contextNode);
  const targetNode = contextNode ?? (view.selectedNodeLines.size === 1 ? selectedNodes[0] : null);
  const menu = new Menu();
  if (targetNode) {
    const isDrawing = Boolean(extractDrawingLink(targetNode.text)) ||
      Boolean(view.file && view.app && resolveExcalidrawEmbed(view.app, targetNode.text, view.file.path));
    if (isDrawing) {
      menu.addItem(item => item
        .setTitle('Espandi / modifica disegno')
        .setIcon('maximize-2')
        .onClick(() => { void editNodeContent(view, targetNode); }));
      menu.addSeparator();
    }
    // First choose geometry, then an optional arrow at either endpoint.
    appendNewNodeChoices(menu, view, targetNode, { x: event.clientX, y: event.clientY });
    if (Array.isArray(view.relations) && view.relations.length > 0) {
      menu.addItem(item => item
        .setTitle('Frecce dei collegamenti...')
        .setIcon('move-horizontal')
        .onClick(() => showNodeRelationArrowsMenu(view, targetNode,
          { x: event.clientX, y: event.clientY })));
    }
    menu.addSeparator();
    menu.addItem(item => item
      .setTitle('Elimina nodo')
      .setIcon('trash')
      .onClick(() => { void view.deleteNodesWithConfirmation(selectedNodes); }));
  } else {
    menu.addItem(item => item.setTitle('Seleziona un nodo per crearne un altro').setDisabled(true));
  }
  view.setActiveNodeContextMenu(menu);
  if (explicitNodeLine !== undefined && typeof menu.showAtPosition === 'function') {
    menu.showAtPosition({ x: event.clientX, y: event.clientY }, view.wrapper.ownerDocument);
  } else {
    menu.showAtMouseEvent(event);
  }
}

function contextLineFromEvent(event: MouseEvent): number {
  const path = typeof event.composedPath === 'function'
    ? event.composedPath()
    : [event.target];

  for (const candidate of path) {
    if (!candidate || typeof candidate !== 'object') continue;
    const element = candidate as {
      classList?: { contains?: (className: string) => boolean };
      dataset?: { nodeLine?: string };
      closest?: (selector: string) => Element | null;
    };
    const overlay = element.classList?.contains?.('mindmap-overlay')
      ? element
      : element.closest?.('.mindmap-overlay');
    if (!overlay) continue;
    const line = Number((overlay as HTMLElement).dataset.nodeLine);
    if (!Number.isNaN(line)) return line;
  }

  return NaN;
}

function getSelectedNodesForContext(view: MindmapView, contextNode: OutlineNode | null): OutlineNode[] {
  const selected = view.getFlatNodes()
    .filter((node) => view.selectedNodeLines.has(node.line))
    .sort((a, b) => a.line - b.line);

  if (selected.length > 0 && (!contextNode || view.selectedNodeLines.has(contextNode.line))) {
    return selected;
  }

  return contextNode ? [contextNode] : [];
}
