import { Notice, TFile } from 'obsidian';
import type { OutlineNode } from '../utils/outline';
import type { MindmapView } from '../view/mindmap-view';
import type { RelationKind } from '../view/relations';
import { createDrawingSvg, parseDrawingSvg, hasLegacyOpaqueBacking } from './drawing-svg';
import { extractDrawingLink } from './drawing-link';
import { warmWhiteboardRuntime } from './whiteboard-runtime';
import {
  createExcalidrawDrawing,
  isExcalidrawAvailable,
  openExcalidrawFile,
  resolveExcalidrawEmbed,
} from './excalidraw-integration';
import type { DrawingModalResult } from './drawing-modal';
import type { ExportedDrawingItem } from './types';

/**
 * Opens the editor, loading it on first use.
 *
 * The import must stay dynamic. This module is reachable from the node
 * context menu and therefore part of the bundle's eagerly evaluated startup
 * graph, while the editor pulls in Lit and the whiteboard element
 * definitions - both of which touch `document` and `HTMLElement` at module
 * scope. A static import here would evaluate all of that during Obsidian's
 * plugin startup and defer nothing but the whiteboard module itself.
 */
async function openDrawingEditor(
  view: MindmapView,
  items: ExportedDrawingItem[],
  allowRelatedNodes = false
): Promise<DrawingModalResult | null> {
  let openDrawingModal: typeof import('./drawing-modal').openDrawingModal;
  try {
    ({ openDrawingModal } = await import('./drawing-modal'));
  } catch (error) {
    console.error('Could not load the drawing editor:', error);
    new Notice('Could not open the drawing editor. See the developer console for details.');
    return null;
  }

  return openDrawingModal(
    view.app,
    items,
    (close) => view.registerTransientCloser(close),
    view.penPreferences,
    allowRelatedNodes
  );
}

/**
 * Evaluates the editor and the whiteboard module ahead of the first drawing,
 * without blocking the caller. Called when the menu offering the drawing
 * actions opens, so the one-off cost overlaps with the user reading the menu.
 */
export function warmDrawingEditor(): void {
  void import('./drawing-modal').catch(() => {
    // Purely an optimisation: openDrawingEditor reports real failures when
    // the editor is actually opened.
  });
  warmWhiteboardRuntime();
}

function drawingBaseName(view: MindmapView, node: OutlineNode): string {
  const readableNode = node.text
    .replace(/!\[\[[^\]]+\]\]/g, '')
    .replace(/[*_`#[\]<>:"/\\|?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  const base = readableNode || view.file?.basename || 'Drawing';
  return `${base} drawing`;
}

async function createAttachment(view: MindmapView, node: OutlineNode, svg: string): Promise<TFile> {
  if (!view.file) throw new Error('No Markdown file is open.');
  const path = await view.app.fileManager.getAvailablePathForAttachment(
    `${drawingBaseName(view, node)}.svg`,
    view.file.path
  );
  return await view.app.vault.create(path, svg);
}

function attachmentEmbed(view: MindmapView, attachment: TFile): string {
  if (!view.file) return `![[${attachment.path}]]`;
  const link = view.app.metadataCache.fileToLinktext(attachment, view.file.path, true);
  return `![[${link}]]`;
}

function resolveLiveTarget(view: MindmapView, original: OutlineNode, sourcePath: string): OutlineNode | null {
  if (view.file?.path !== sourcePath) return null;
  const sameLine = view.getNodeByLine(original.line);
  if (sameLine?.text === original.text && sameLine.checkbox === original.checkbox) return sameLine;
  const matches = view.getFlatNodes().filter((node) =>
    node.text === original.text &&
    node.checkbox === original.checkbox &&
    node.indent === original.indent
  );
  return matches.length === 1 ? matches[0] : null;
}

export async function addDrawingAsChild(view: MindmapView, node: OutlineNode): Promise<void> {
  const sourcePath = view.file?.path;
  if (!sourcePath) return;
  const result = await openDrawingEditor(view, []);
  if (!result) return;
  const liveTarget = resolveLiveTarget(view, node, sourcePath);
  if (!liveTarget) {
    new Notice('The target node changed while the drawing editor was open. Nothing was saved.');
    return;
  }
  try {
    const attachment = await createAttachment(view, liveTarget, createDrawingSvg(result.items));
    try {
      await view.executeAddChildTextCommand(liveTarget, attachmentEmbed(view, attachment));
    } catch (error) {
      console.error('Drawing attachment was saved but its child node could not be inserted:', error);
      new Notice(`Drawing saved as ${attachment.path}, but the child node could not be inserted.`);
    }
  } catch (error) {
    console.error('Could not add drawing as child:', error);
    new Notice('Could not save the drawing.');
  }
}

export async function addDrawingAsSibling(view: MindmapView, node: OutlineNode): Promise<void> {
  const sourcePath = view.file?.path;
  if (!sourcePath) return;
  const result = await openDrawingEditor(view, []);
  if (!result) return;
  const liveTarget = resolveLiveTarget(view, node, sourcePath);
  if (!liveTarget) {
    new Notice('The target node changed while the drawing editor was open. Nothing was saved.');
    return;
  }
  try {
    const attachment = await createAttachment(view, liveTarget, createDrawingSvg(result.items));
    try {
      await view.executeAddSiblingTextCommand(liveTarget, attachmentEmbed(view, attachment));
    } catch (error) {
      console.error('Drawing attachment was saved but its sibling node could not be inserted:', error);
      new Notice(`Drawing saved as ${attachment.path}, but the sibling node could not be inserted.`);
    }
  } catch (error) {
    console.error('Could not add drawing as sibling:', error);
    new Notice('Could not save the drawing.');
  }
}

/**
 * Open the built-in handwriting editor for an existing editable SVG.
 * The associated markdown node is tracked by its unique attachment embed:
 * indentation and line numbers can change when siblings are inserted.
 */
async function editDrawingAttachment(
  view: MindmapView,
  attachment: TFile,
  sourcePath: string,
  nodeText: string
): Promise<void> {
  if (view.file?.path !== sourcePath) return;
  try {
    const originalSvg = await view.app.vault.read(attachment);
    const drawing = parseDrawingSvg(originalSvg);
    if (!drawing) {
      new Notice('This SVG is not an editable drawing created by EOME.');
      return;
    }
    const result = await openDrawingEditor(view, drawing.items, true);
    if (!result) return;
    if (view.file?.path !== sourcePath) {
      new Notice('The mindmap changed while editing. The drawing was not saved.');
      return;
    }
    if (await view.app.vault.read(attachment) !== originalSvg) {
      new Notice('The drawing changed while its editor was open. Your edit was not saved to avoid overwriting another change.');
      return;
    }
    await view.app.vault.modify(attachment, createDrawingSvg(result.items, drawing.createdAt, undefined, hasLegacyOpaqueBacking(originalSvg)));
    view.attachmentVersions.markCurrent(attachment);
    await view.refreshRenderedAttachments(attachment);
    if (result.next) {
      const matches = view.getFlatNodes().filter((node) => node.text === nodeText);
      if (matches.length !== 1) {
        new Notice('Drawing saved. Could not locate its node to create a related node.');
        return;
      }
      const added = await createBlankRelativeDrawing(
        view, matches[0], result.next, result.next === 'child' ? 'figlio' : undefined
      );
      if (!added) return;
      // Open the next handwriting sheet directly. No intermediate trip back to
      // the map, keyboard, or context menu is required.
      await editDrawingAttachment(view, added.attachment, sourcePath, added.embed);
    }
  } catch (error) {
    console.error('Could not edit drawing:', error);
    new Notice('Could not update the drawing.');
  }
}

export async function editDrawing(view: MindmapView, node: OutlineNode): Promise<void> {
  if (!view.file) return;
  const sourcePath = view.file.path;
  const link = extractDrawingLink(node.text);
  if (!link) return;
  const attachment = view.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
  if (!(attachment instanceof TFile) || attachment.extension.toLowerCase() !== 'svg') {
    new Notice('The drawing attachment could not be found.');
    return;
  }
  await editDrawingAttachment(view, attachment, sourcePath, node.text);
}

/**
 * Creates a drawing in Excalidraw's own format and folder, links it from a new
 * node, and hands editing over to Excalidraw's editor in a new tab.
 *
 * The drawing is created before the node so the node is never left pointing at
 * a file that does not exist; the tab opens last so a failed insert does not
 * pull the user away from the mindmap.
 */
async function addExcalidrawDrawing(
  view: MindmapView,
  node: OutlineNode,
  placement: 'child' | 'sibling'
): Promise<void> {
  const sourcePath = view.file?.path;
  if (!sourcePath) return;
  if (!isExcalidrawAvailable(view.app)) {
    new Notice('The Excalidraw plugin is not available.');
    return;
  }

  let attachment: TFile;
  try {
    attachment = await createExcalidrawDrawing(view.app, drawingBaseName(view, node));
  } catch (error) {
    console.error('Could not create the Excalidraw drawing:', error);
    new Notice('Could not create the Excalidraw drawing.');
    return;
  }

  const liveTarget = resolveLiveTarget(view, node, sourcePath);
  if (!liveTarget) {
    new Notice(`The target node changed. ${attachment.path} was created, but no node was inserted.`);
    return;
  }

  try {
    await (placement === 'child'
      ? view.executeAddChildTextCommand(liveTarget, attachmentEmbed(view, attachment))
      : view.executeAddSiblingTextCommand(liveTarget, attachmentEmbed(view, attachment)));
  } catch (error) {
    console.error(`Excalidraw drawing was created but its ${placement} node could not be inserted:`, error);
    new Notice(`Drawing created as ${attachment.path}, but the ${placement} node could not be inserted.`);
    return;
  }

  try {
    await openExcalidrawFile(view.app, attachment);
  } catch (error) {
    // The node and the drawing both exist; only the convenience of jumping
    // straight into the editor was lost.
    console.error('Could not open the new Excalidraw drawing:', error);
    new Notice(`Drawing created as ${attachment.path}, but its editor could not be opened.`);
  }
}

export function addExcalidrawAsChild(view: MindmapView, node: OutlineNode): Promise<void> {
  return addExcalidrawDrawing(view, node, 'child');
}

export function addExcalidrawAsSibling(view: MindmapView, node: OutlineNode): Promise<void> {
  return addExcalidrawDrawing(view, node, 'sibling');
}

/**
 * Routes the "Edit" action to whatever the node actually holds: a built-in
 * drawing, an Excalidraw drawing, or plain text. One entry point rather than
 * one menu entry per possible content type.
 */
export function editNodeContent(view: MindmapView, node: OutlineNode): Promise<void> {
  if (extractDrawingLink(node.text)) return editDrawing(view, node);
  if (view.file && resolveExcalidrawEmbed(view.app, node.text, view.file.path)) {
    return editExcalidrawDrawing(view, node);
  }
  new Notice('EOME accetta soltanto note manoscritte. Il testo preesistente resta visibile in sola lettura.');
  return Promise.resolve();
}

export async function editExcalidrawDrawing(view: MindmapView, node: OutlineNode): Promise<void> {
  const sourcePath = view.file?.path;
  if (!sourcePath) return;
  const attachment = resolveExcalidrawEmbed(view.app, node.text, sourcePath);
  if (!attachment) {
    new Notice('The Excalidraw drawing could not be found.');
    return;
  }

  try {
    await openExcalidrawFile(view.app, attachment);
  } catch (error) {
    console.error('Could not open the Excalidraw drawing:', error);
    new Notice('Could not open the Excalidraw drawing.');
  }
}

type BlankDrawing = { attachment: TFile; embed: string };

async function createBlankRelativeDrawing(
  view: MindmapView,
  node: OutlineNode,
  placement: 'child' | 'sibling',
  kind?: RelationKind,
  arrow: import('../view/relations').RelationArrowMode = 'none'
): Promise<BlankDrawing | null> {
  const sourcePath = view.file?.path;
  if (!sourcePath) return null;
  const liveTarget = resolveLiveTarget(view, node, sourcePath);
  if (!liveTarget) {
    new Notice('The selected node has changed; no drawing was created.');
    return null;
  }
  try {
    const attachment = await createAttachment(view, liveTarget, createDrawingSvg([]));
    const embed = attachmentEmbed(view, attachment);
    try {
      if (placement === 'child') {
        await view.executeAddChildTextCommand(liveTarget, embed);
      } else {
        await view.executeAddSiblingTextCommand(liveTarget, embed);
      }
    } catch (error) {
      console.error('Drawing attachment created without its node:', error);
      new Notice('Drawing saved as ' + attachment.path + ', but the node could not be inserted.');
      return null;
    }
    const newNode = view.getFlatNodes().find((candidate) => candidate.text === embed);
    if (newNode) {
      view.selectNode(newNode.line);
      if (kind) await view.addRelation(liveTarget, newNode, kind, arrow);
    }
    return { attachment, embed };
  } catch (error) {
    console.error('Could not create an empty drawing node:', error);
    new Notice('Could not create the handwritten node.');
    return null;
  }
}

/** Creates a first handwritten root in an empty mindmap, without typing text. */
export async function addBlankDrawingAsRoot(view: MindmapView): Promise<void> {
  const file = view.file;
  if (!file) return;
  if (view.getFlatNodes().length > 0) {
    new Notice('Select a node first, then add a handwritten child or sibling.');
    return;
  }
  try {
    // Only change the document if it is still empty. Do not overwrite other
    // markdown or a note modified externally while the button was pressed.
    let created = false;
    const attachment = await createAttachment(
      view, { text: file.basename } as OutlineNode, createDrawingSvg([])
    );
    const embed = attachmentEmbed(view, attachment);
    await view.app.vault.process(file, (contents) => {
      if (contents.trim() !== '') return contents;
      created = true;
      return '- ' + embed + '\n';
    });
    if (!created) {
      new Notice('The note is no longer empty. Select an existing node.');
      return;
    }
    await view.reloadDataIncremental();
    const node = view.getFlatNodes().find((candidate) => candidate.text === embed);
    if (node) view.selectNode(node.line);
    // From the first node onward, new handwritten maps contain only explicit
    // semantic edges. Creating a sibling alone never fabricates a connection.
    await view.activateExplicitRelations();
  } catch (error) {
    console.error('Could not create handwritten root:', error);
    new Notice('Could not create handwritten root.');
  }
}

export async function addBlankDrawingAsChild(view: MindmapView, node: OutlineNode): Promise<void> {
  await createBlankRelativeDrawing(view, node, 'child', 'figlio');
}

/** A named semantic relationship is chosen per node pair, never inferred from
 * the outline indentation. All four kinds create a handwritten child so that
 * the Markdown note retains a useful outline and Dagre can lay out the map.
 */
export async function addBlankDrawingWithRelation(
  view: MindmapView, node: OutlineNode, kind: RelationKind,
  arrow: import('../view/relations').RelationArrowMode = 'none'
): Promise<void> {
  await createBlankRelativeDrawing(view, node, 'child', kind, arrow);
}

export async function addBlankDrawingAsSibling(view: MindmapView, node: OutlineNode): Promise<void> {
  // UI compatibility: a new sibling from older commands is now a visual
  // parallel linked node, not an unconnected editable text placeholder.
  await createBlankRelativeDrawing(view, node, 'child', 'figlio');
}
