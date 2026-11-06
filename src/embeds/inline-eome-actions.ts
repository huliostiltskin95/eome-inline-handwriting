import { Menu, Notice, TFile, type MarkdownPostProcessorContext } from 'obsidian';
import type MindmapPlugin from '../main';
import { parseOutline, type OutlineNode } from '../utils/outline';
import { INLINE_MAPS_FIELD, inlineMapId, stampInlineMap } from './inline-eome-identity';
import { createDrawingSvg, parseDrawingSvg, hasLegacyOpaqueBacking } from '../drawing/drawing-svg';
import { createEomeSvg } from '../drawing/svg-folder';
import { extractDrawingLink } from '../drawing/drawing-link';
import { PenPreferenceStore } from '../drawing/pen-preferences';
import { InlineInkController } from '../drawing/inline-ink';
import { AttachmentVersions } from '../view/attachment-versions';
import type { MindmapView } from '../view/mindmap-view';
import type { EomeRelation, RelationArrowMode, RelationKind } from '../view/relations';
import { createOrUpdateRelation, normalizeRelations, relationNodeKey, RELATIONS_FIELD, setRelationArrow } from '../view/relations';
import { isInlineMindmapSource, insertHandwrittenNode, replaceInlineMindmapFence, findInlineFenceAtLine, findInlineFenceById, findInlineFenceByContent } from './inline-eome-source';
import type { ExportedDrawingItem } from '../drawing/types';
import { outlineWithoutMapMarker } from './inline-eome-identity';

const pendingFocus = new Map<string, { link: string; remaining: number }>();
function focusKey(file: TFile, source: string): string {
  return file.path + ':' + (inlineMapId(source) ?? '');
}

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
  // The owning modal must learn a newly stamped map ID before frontmatter
  // writes shift the fence's original line number.
  const scoped = context.ctx as MarkdownPostProcessorContext & {
    onInlineEomeSaved?: (newSource: string) => void;
  };
  scoped.onInlineEomeSaved?.(next);
}

/**
 * One-time non-destructive migration from shared YAML relations. Only keys
 * that uniquely identify a node inside this fence are migrated: ambiguous
 * legacy labels are never guessed and remain untouched in the old field.
 */
function migrateLegacy(context: InlineContext, stamped: string, legacy: EomeRelation[]): EomeRelation[] {
  const flatten = (nodes: OutlineNode[]): OutlineNode[] =>
    nodes.reduce((all, node) => all.concat(node, flatten(node.children)), [] as OutlineNode[]);
  const before = flatten(parseOutline(context.source));
  const after = new Map(flatten(parseOutline(stamped)).map(node => [node.line, node]));
  const keys = new Map<string, string[]>();
  for (const node of before) {
    const key = relationNodeKey(context.plugin.app, context.file, node);
    const next = after.get(node.line);
    if (!next) continue;
    const entries = keys.get(key) ?? [];
    entries.push(relationNodeKey(context.plugin.app, context.file, next));
    keys.set(key, entries);
  }
  return legacy.reduce((result, relation) => {
    const source = keys.get(relation.source), target = keys.get(relation.target);
    if (source?.length === 1 && target?.length === 1)
      result.push({ ...relation, source: source[0], target: target[0] });
    return result;
  }, [] as EomeRelation[]);
}

async function modifyInlineRelations(context: InlineContext, stamped: string,
  action: (relations: EomeRelation[]) => EomeRelation[]): Promise<void> {
  const id = inlineMapId(stamped);
  if (!id) throw new Error('Identificatore EOME mancante');
  await context.plugin.app.fileManager.processFrontMatter(context.file, frontmatter => {
    const maps = frontmatter[INLINE_MAPS_FIELD] && typeof frontmatter[INLINE_MAPS_FIELD] === 'object'
      && !Array.isArray(frontmatter[INLINE_MAPS_FIELD])
      ? frontmatter[INLINE_MAPS_FIELD] as Record<string, unknown> : {};
    const old = Object.prototype.hasOwnProperty.call(maps, id)
      ? normalizeRelations(maps[id])
      : migrateLegacy(context, stamped, normalizeRelations(frontmatter[RELATIONS_FIELD]));
    maps[id] = action(old);
    frontmatter[INLINE_MAPS_FIELD] = maps;
  });
}

export async function changeInlineArrow(context: InlineContext, relation: EomeRelation,
  mode: RelationArrowMode): Promise<void> {
  const stamped = stampInlineMap(context.source).source;
  if (stamped !== context.source) await updateFence(context, stamped);
  await modifyInlineRelations(context, stamped, current => setRelationArrow(current, relation.id, mode));
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
  line: number | null, kind: RelationKind, arrow: RelationArrowMode,
  initialItems?: ExportedDrawingItem[]): Promise<void> {
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
    attachment = await createEomeSvg(context.plugin.app, context.plugin.svgFolder,
      'EOME manoscritto.svg', createDrawingSvg(initialItems ?? []));
    const link = context.plugin.app.metadataCache.fileToLinktext(attachment, context.file.path, true);
    const embed = '![[ ' + link + ' ]]';
    const normalizedEmbed = embed.replace('![[ ', '![[').replace(' ]]', ']]');
    const base = stampInlineMap(context.source).source;
    const inserted = insertHandwrittenNode(base, line, normalizedEmbed);
    if (inserted === null) throw new Error('Impossibile inserire il nodo in questo blocco.');
    const next = stampInlineMap(inserted).source;
    const flatten = (values: OutlineNode[]): OutlineNode[] =>
      values.reduce((all, node) => all.concat(node, flatten(node.children)), [] as OutlineNode[]);
    const updated = flatten(parseOutline(next));
    const newNode = updated.find(node => extractDrawingLink(node.text)?.trim() === link.trim());
    const previous = selected ? updated.find(node => node.line === selected.line) : null;
    if (!newNode || (selected && !previous)) throw new Error('Identità del nodo non trovata.');
    pendingFocus.set(focusKey(context.file, next), { link: link.trim(), remaining: 3 });
    await updateFence(context, next);
    await modifyInlineRelations(context, next, existing =>
      previous ? createOrUpdateRelation(existing,
        relationNodeKey(context.plugin.app, context.file, previous),
        relationNodeKey(context.plugin.app, context.file, newNode), kind, arrow) : existing);

  } catch (error) {
    console.error('Inline EOME node creation failed', {
      folder: context.plugin.svgFolder,
      note: context.file.path,
      attachment: attachment?.path ?? null,
      error,
    });
    const detail = error instanceof Error ? error.message : String(error);
    new Notice(attachment
      ? 'SVG creato in ' + attachment.path + ', ma il nodo non è stato collegato: ' + detail
      : 'Impossibile creare il nodo manoscritto in ' +
        context.plugin.svgFolder + ': ' + detail, 11000);
  }
}

/** The first word must be drawn in the advanced editor BEFORE the SVG or
 * Markdown node exists. Cancelling or saving a blank sheet creates nothing.
 * Recheck the live fence after the drawing is saved: other tabs or devices
 * may have added a root while the modal was open.
 */
export async function createFirstInlineDrawing(context: InlineContext): Promise<void> {
  const current = await context.plugin.app.vault.read(context.file);
  const locate = (markdown: string) => {
    const id = inlineMapId(context.source);
    if (id) return findInlineFenceById(markdown, id);
    const section = context.ctx.getSectionInfo(context.container);
    const byLine = section ? findInlineFenceAtLine(markdown, section.lineStart) : null;
    if (byLine && byLine.content.trim() === context.source.trim()) return byLine;
    return findInlineFenceByContent(markdown, context.source);
  };
  const initial = locate(current);
  if (!initial) {
    new Notice('Il blocco EOME non è più identificabile: riaprilo dalla nota.');
    return;
  }
  if (parseOutline(outlineWithoutMapMarker(initial.content)).length > 0) {
    new Notice('La mappa contiene già un primo nodo.');
    return;
  }
  const { openDrawingModal } = await import('../drawing/drawing-modal');
  const result = await openDrawingModal(context.plugin.app, [], undefined,
    new PenPreferenceStore(context.plugin), false);
  if (!result) return;
  const hasInk = result.items.some(item =>
    item.type === 'pen' && Array.isArray(item.data.path) && item.data.path.length > 0);
  if (!hasInk) {
    new Notice('Il primo nodo richiede almeno un tratto a penna. Nessun file è stato creato.');
    return;
  }

  const latest = locate(await context.plugin.app.vault.read(context.file));
  if (!latest || parseOutline(outlineWithoutMapMarker(latest.content)).length > 0) {
    new Notice('La mappa è stata modificata durante il disegno. Nessun nodo duplicato è stato creato.');
    return;
  }
  const latestContext: InlineContext = {
    ...context,
    source: latest.content,
    ctx: {
      ...context.ctx,
      getSectionInfo: () => ({ lineStart: latest.open, lineEnd: latest.close }),
      onInlineEomeSaved: (nextSource: string) => {
        const original = context.ctx as MarkdownPostProcessorContext & {
          onInlineEomeSaved?: (nextSource: string) => void;
        };
        original.onInlineEomeSaved?.(nextSource);
      }
    } as MarkdownPostProcessorContext
  };
  await addInlineDrawing(latestContext, [], null, 'figlio', 'none', result.items);
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
  const eraser = toolbar.createEl('button', { text: '⌫', attr: { 'aria-label': 'Cancellino vettoriale' } });
  eraser.setAttribute('aria-pressed', 'false');
  eraser.addEventListener('click', () => {
    const enabled = !controller.isEraserEnabled();
    controller.setEraserEnabled(enabled);
    eraser.setAttribute('aria-pressed', String(enabled));
    eraser.setAttribute('title', enabled ? 'Tocca un tratto per cancellarlo' : 'Attiva cancellino vettoriale');
  });
  const parallel = toolbar.createEl('button', { text: '—+', attr: { 'aria-label': 'Crea nodo parallelo' } });
  const detail = toolbar.createEl('button', { text: '└+', attr: { 'aria-label': 'Crea dettaglio sotto il nodo' } });
  // The advanced whiteboard editor was still implemented, but the compact
  // pen toolbar no longer exposed it. Restore an explicit touch-sized action.
  const advanced = toolbar.createEl('button', {
    text: 'Modifica nodo',
    cls: 'mindmap-eome-advanced-editor',
    attr: { 'aria-label': 'Apri editor avanzato del nodo selezionato' }
  });

  const selectedLine = (): number | null => {
    const selected = wrapper.querySelector<HTMLElement>('.mindmap-eome-overlay.selected[data-node-line]');
    if (!selected) return null;
    const line = Number(selected.dataset.nodeLine);
    return Number.isFinite(line) ? line : null;
  };
  const editSelected = (): void => {
    const line = selectedLine();
    const node = line === null ? null : flat.find(item => item.line === line);
    if (!node) {
      new Notice('Seleziona prima il nodo manoscritto da modificare.');
      return;
    }
    void editInlineDrawing(context, parseOutline(context.source), node).catch(error => {
      console.error('EOME advanced node editor failed', error);
      new Notice('Non è stato possibile aprire l’editor avanzato del nodo.');
    });
  };
  advanced.addEventListener('click', editSelected);
  const pending = pendingFocus.get(focusKey(context.file, context.source));
  if (pending) {
    const node = flat.find(item => extractDrawingLink(item.text)?.trim() === pending.link);
    const overlay = node && wrapper.querySelector<HTMLElement>(
      '.mindmap-eome-overlay[data-node-line="' + node.line + '"]');
    if (overlay) {
      overlay.classList.add('selected');
      if (--pending.remaining <= 0) pendingFocus.delete(focusKey(context.file, context.source));
    }
  }
  const quickAdd = (kind: RelationKind): void => {
    const line = selectedLine();
    if (line === null && flat.length) {
      new Notice('Seleziona prima il nodo dal quale proseguire.');
      return;
    }
    void addInlineDrawing(context, parseOutline(context.source), line, kind, 'none');
  };
  parallel.addEventListener('click', () => quickAdd('figlio'));
  detail.addEventListener('click', () => quickAdd('dettaglio'));
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
