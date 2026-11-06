import { Menu, Notice, TFile, type MarkdownPostProcessorContext } from 'obsidian';
import type MindmapPlugin from '../main';
import type { OutlineNode } from '../utils/outline';
import { createDrawingSvg, parseDrawingSvg, hasLegacyOpaqueBacking } from '../drawing/drawing-svg';
import { extractDrawingLink } from '../drawing/drawing-link';
import { PenPreferenceStore } from '../drawing/pen-preferences';
import { InlineInkController } from '../drawing/inline-ink';
import { AttachmentVersions } from '../view/attachment-versions';
import type { MindmapView } from '../view/mindmap-view';
import type { EomeRelation, RelationArrowMode, RelationKind } from '../view/relations';
import { createOrUpdateRelation, normalizeRelations, relationNodeKey, RELATIONS_FIELD, setRelationArrow } from '../view/relations';
import { isInlineMindmapSource, insertHandwrittenNode, replaceInlineMindmapFence } from './inline-eome-source';
import type { ExportedDrawingItem } from '../drawing/types';

const ARROWS: Array<[RelationArrowMode, string]> = [
  ['none', 'Nessuna freccia'],
  ['start', 'Freccia all’inizio'],
  ['end', 'Freccia alla fine'],
  ['both', 'Frecce a entrambe le estremità']
];

interface InlineContext {
  plugin: MindmapPlugin;
  file: TFile;
  source: string;
  container: HTMLElement;
  ctx: MarkdownPostProcessorContext;
}

function showAt(menu: Menu, place: { x: number; y: number }, context: InlineContext): void {
  menu.showAtPosition(place, context.container.ownerDocument);
}

/** Modify only the exact fenced block, preserving every surrounding line.
 * Multiple identical blocks are refused unless getSectionInfo identifies one.
 */
async function updateFence(context: InlineContext, next: string): Promise<void> {
  const section = context.ctx.getSectionInfo(context.container);
  let replaced = false;
  await context.plugin.app.vault.process(context.file, markdown => {
    const updated = replaceInlineMindmapFence(
      markdown, context.source, next, section?.lineStart
    );
    if (updated === null) return markdown;
    replaced = true;
    return updated;
  });
  if (!replaced) throw new Error('Il blocco è cambiato o non è identificabile senza ambiguità.');
}

/** Each arrow belongs to its pair relation; do not overwrite other map
 * connections in the host note if another code block is being edited.
 */
async function updatePairRelation(context: InlineContext, source: string, target: string,
  kind: RelationKind, arrow: RelationArrowMode): Promise<void> {
  await context.plugin.app.fileManager.processFrontMatter(context.file, frontmatter => {
    const current = normalizeRelations(frontmatter[RELATIONS_FIELD]);
    frontmatter[RELATIONS_FIELD] = createOrUpdateRelation(current, source, target, kind, arrow);
  });
}

export async function changeInlineArrow(context: InlineContext, relation: EomeRelation,
  mode: RelationArrowMode): Promise<void> {
  await context.plugin.app.fileManager.processFrontMatter(context.file, frontmatter => {
    const current = normalizeRelations(frontmatter[RELATIONS_FIELD]);
    frontmatter[RELATIONS_FIELD] = setRelationArrow(current, relation.id, mode);
  });
}

export function showInlineArrowMenu(context: InlineContext, relation: EomeRelation,
  place: { x: number; y: number }): void {
  const menu = new Menu();
  for (const [arrow, title] of ARROWS) {
    menu.addItem(item => item.setTitle(title).onClick(() => {
      void changeInlineArrow(context, relation, arrow).catch(error => {
        console.error('Inline EOME arrow update failed', error);
        new Notice('Non è stato possibile modificare la freccia.');
      });
    }));
  }
  showAt(menu, place, context);
}

export async function addInlineDrawing(context: InlineContext, nodes: OutlineNode[],
  line: number | null, kind: RelationKind, arrow: RelationArrowMode): Promise<void> {
  if (!isInlineMindmapSource(context.source)) return;
  const flatten = (values: OutlineNode[]): OutlineNode[] =>
    values.reduce((acc, node) => [...acc, node, ...flatten(node.children)], [] as OutlineNode[]);
  const selected = line === null ? null : flatten(nodes).find(n => n.line === line);
  if (line !== null && !selected) {
    new Notice('Il nodo selezionato non è più presente nel blocco.');
    return;
  }
  let attachment: TFile | null = null;
  try {
    const path = await context.plugin.app.fileManager.getAvailablePathForAttachment(
      'EOME manoscritto.svg', context.file.path
    );
    attachment = await context.plugin.app.vault.create(path, createDrawingSvg([]));
    const link = context.plugin.app.metadataCache.fileToLinktext(attachment, context.file.path, true);
    const embed = '![[ ' + link + ' ]]';
    const normalizedEmbed = embed.replace('![[ ', '![[').replace(' ]]', ']]');
    const next = insertHandwrittenNode(context.source, line, normalizedEmbed);
    if (next === null) throw new Error('Impossibile inserire il nodo in questo blocco.');
    await updateFence(context, next);
    if (selected) {
      await updatePairRelation(context,
        relationNodeKey(context.plugin.app, context.file, selected),
        'svg:' + link.trim(), kind, arrow);
    } else {
      await context.plugin.app.fileManager.processFrontMatter(context.file, frontmatter => {
        if (!Array.isArray(frontmatter[RELATIONS_FIELD])) frontmatter[RELATIONS_FIELD] = [];
      });
    }
  } catch (error) {
    console.error('Inline EOME node creation failed', error);
    new Notice(attachment
      ? 'SVG creato, ma non collegato al blocco: ' + attachment.path
      : 'Impossibile creare il nodo manoscritto.');
  }
}

export function showInlineCreateMenu(context: InlineContext, nodes: OutlineNode[],
  selected: number | null, place: { x: number; y: number }): void {
  if (selected === null && nodes.length > 0) {
    new Notice('Tocca prima la parola alla quale collegare il nuovo nodo.');
    return;
  }
  if (selected === null) {
    void addInlineDrawing(context, nodes, null, 'figlio', 'none');
    return;
  }
  const geometryMenu = new Menu();
  const choices: Array<[RelationKind, string]> = [
    ['figlio', 'Nuovo parallelo —'],
    ['dettaglio', 'Nuovo a L └']
  ];
  for (const [kind, title] of choices) {
    geometryMenu.addItem(item => item.setTitle(title).onClick(() => {
      const arrowMenu = new Menu();
      for (const [arrow, label] of ARROWS) {
        arrowMenu.addItem(option => option.setTitle(label).onClick(() => {
          void addInlineDrawing(context, nodes, selected, kind, arrow);
        }));
      }
      showAt(arrowMenu, place, context);
    }));
  }
  showAt(geometryMenu, place, context);
}

/** Reuse EOME's existing pressure- and vector-aware ink engine, but scope its
 * attachment refresh to this code block instead of opening an Obsidian leaf.
 */
export function connectInlineHandwriting(
  context: InlineContext, wrapper: HTMLElement, flat: OutlineNode[],
  refresh: () => Promise<void>
): () => void {
  const host = {
    app: context.plugin.app,
    file: context.file,
    inlineInkEnabled: true,
    connectionMode: false,
    getNodeByLine: (line: number) => flat.find(node => node.line === line) ?? null,
    penPreferences: new PenPreferenceStore(context.plugin),
    attachmentVersions: new AttachmentVersions(),
    refreshRenderedAttachments: refresh
  } as unknown as MindmapView;
  const controller = new InlineInkController(host, wrapper);
  // Compact pen controls work on the selected SVG node, without opening a modal.
  const toolbar = wrapper.createDiv({ cls: 'mindmap-eome-ink-tools' });
  const undo = toolbar.createEl('button', { text: '↶', attr: { 'aria-label': 'Annulla ultimo tratto' } });
  const redo = toolbar.createEl('button', { text: '↷', attr: { 'aria-label': 'Ripristina ultimo tratto' } });
  const selectedLine = (): number | null => {
    const selected = wrapper.querySelector<HTMLElement>('.mindmap-eome-overlay.selected[data-node-line]');
    if (!selected) return null;
    const line = Number(selected.dataset.nodeLine);
    return Number.isFinite(line) ? line : null;
  };
  const run = (action: 'undo' | 'redo') => {
    const line = selectedLine();
    if (line === null) { new Notice('Seleziona prima il nodo manoscritto.'); return; }
    void (action === 'undo' ? controller.undoLastStroke(line) : controller.redoLastStroke(line))
      .then(ok => { if (!ok) new Notice('Nessun tratto disponibile.'); })
      .catch(error => { console.error('EOME inline ink history failed', error); new Notice('Impossibile modificare il tratto.'); });
  };
  undo.addEventListener('click', () => run('undo'));
  redo.addEventListener('click', () => run('redo'));
  const down = (e: PointerEvent) => { controller.pointerDown(e); };
  const move = (e: PointerEvent) => { controller.pointerMove(e); };
  const up = (e: PointerEvent) => { controller.pointerEnd(e); };
  wrapper.addEventListener('pointerdown', down, true);
  wrapper.addEventListener('pointermove', move, true);
  wrapper.addEventListener('pointerup', up, true);
  wrapper.addEventListener('pointercancel', up, true);
  return () => {
    controller.cancel();
    toolbar.remove();
    wrapper.removeEventListener('pointerdown', down, true);
    wrapper.removeEventListener('pointermove', move, true);
    wrapper.removeEventListener('pointerup', up, true);
    wrapper.removeEventListener('pointercancel', up, true);
  };
}

/** Edit a drawing in the full-size whiteboard without leaving the host note.
 * Follow-up buttons add the chosen parallel/L relationship to this same fence.
 */
export async function editInlineDrawing(context: InlineContext, roots: OutlineNode[],
  node: OutlineNode): Promise<void> {
  const link = extractDrawingLink(node.text);
  if (!link) return;
  const file = context.plugin.app.metadataCache.getFirstLinkpathDest(link, context.file.path);
  if (!(file instanceof TFile)) return;
  const before = await context.plugin.app.vault.read(file);
  const drawing = parseDrawingSvg(before);
  if (!drawing) return;
  const { openDrawingModal } = await import('../drawing/drawing-modal');
  const result = await openDrawingModal(context.plugin.app, drawing.items as ExportedDrawingItem[],
    undefined, new PenPreferenceStore(context.plugin), true);
  if (!result) return;
  if (await context.plugin.app.vault.read(file) !== before) {
    new Notice('Il disegno è cambiato mentre era aperto; nessuna sovrascrittura.');
    return;
  }
  await context.plugin.app.vault.modify(file,
    createDrawingSvg(result.items, drawing.createdAt, undefined, hasLegacyOpaqueBacking(before)));
  if (result.next) {
    await addInlineDrawing(context, roots, node.line,
      result.next === 'parallel' ? 'figlio' : 'dettaglio', 'none');
  }
}
