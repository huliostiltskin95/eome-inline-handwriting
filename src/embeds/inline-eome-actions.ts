import { readSummaryGroups, writeSummaryGroups, pointInLasso } from './summary-groups';
import { resolveDrawingFile } from '../drawing/live-svg';
import { Menu, Notice, TFile, parseYaml, stringifyYaml, type MarkdownPostProcessorContext } from 'obsidian';
import type MindmapPlugin from '../main';
import { parseOutline, type OutlineNode } from '../utils/outline';
import { INLINE_MAPS_FIELD, inlineMapId, stampInlineMap, readInlineRelations, writeInlineRelations } from './inline-eome-identity';
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

export interface InlineContext {
  plugin: MindmapPlugin;
  file: TFile;
  source: string;
  container: HTMLElement;
  ctx: MarkdownPostProcessorContext;
}

/** The complete vector editor is mounted inside the map tab, never in a new window. */
async function openMapDrawing(context: InlineContext, items: ExportedDrawingItem[], related = false,
  tool = 'pen'): Promise<import('../drawing/drawing-modal').DrawingModalResult | null> {
  const tab = context.container.closest<HTMLElement>('.eome-scoped-tab');
  const { openDrawingModal } = await import('../drawing/drawing-modal');
  if (!tab) return openDrawingModal(context.plugin.app, items, undefined,
    new PenPreferenceStore(context.plugin), related);
  const existing = tab.querySelector<HTMLElement>('.eome-map-drawing-panel');
  if (existing) {
    existing.dispatchEvent(new CustomEvent('eome-tool', { detail: tool }));
    return null;
  }
  const pane = tab.querySelector<HTMLElement>('.eome-scoped-lower-pane') ?? tab;
  const panel = pane.createDiv({ cls: 'eome-map-drawing-panel' });
  tab.dispatchEvent(new CustomEvent('eome-editor-opened', { detail: panel }));
  try {
    return await openDrawingModal(context.plugin.app, items, close => {
      const observer = new MutationObserver(() => { if (!panel.isConnected) close(); });
      observer.observe(tab.ownerDocument.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    }, new PenPreferenceStore(context.plugin), related, panel, tool);
  } finally {
    panel.remove();
    tab.dispatchEvent(new CustomEvent('eome-editor-closed'));
  }
}

export async function createInlineSummary(context: InlineContext, lines: number[], side: 'left' | 'right'): Promise<void> {
  if (new Set(lines).size < 2) { new Notice('Seleziona almeno due nodi con il lazo.'); return; }
  const result = await openMapDrawing(context, []);
  if (!result?.items.length) return;
  // Stamp before deriving keys; existing unstamped nodes acquire stable identities.
  await modifyInlineRelations(context, stampInlineMap(context.source).source, relations => relations);
  const flatten = (nodes: OutlineNode[]): OutlineNode[] => nodes.reduce((all, n) => all.concat(n, flatten(n.children)), [] as OutlineNode[]);
  const members = flatten(parseOutline(outlineWithoutMapMarker(context.source))).filter(n => lines.includes(n.line));
  if (members.length !== new Set(lines).size) throw new Error('La selezione è cambiata.');
  const attachment = await createEomeSvg(context.plugin.app, context.plugin.svgFolder,
    'EOME sintesi.svg', createDrawingSvg(result.items));
  const link = context.plugin.app.metadataCache.fileToLinktext(attachment, context.file.path, true);
  const next = stampInlineMap(context.source + '\n- ![[' + link + ']]').source;
  const target = flatten(parseOutline(outlineWithoutMapMarker(next))).find(n => extractDrawingLink(n.text) === link);
  if (!target) throw new Error('Nodo riassuntivo non identificato.');
  const groups = readSummaryGroups(next);
  groups.push({ id: crypto.randomUUID(), side,
    members: members.map(n => relationNodeKey(context.plugin.app, context.file, n)),
    target: relationNodeKey(context.plugin.app, context.file, target) });
  await updateFence(context, writeSummaryGroups(next, groups));
}

export function showSummaryMenu(context: InlineContext, id: string, position: { x: number; y: number }): void {
  const menu = new Menu();
  const apply = (side: 'left' | 'right' | null): void => {
    const groups = readSummaryGroups(context.source);
    const next = side === null ? groups.filter(g => g.id !== id)
      : groups.map(g => g.id === id ? { ...g, side } : g);
    void updateFence(context, writeSummaryGroups(context.source, next))
      .catch(error => new Notice('Graffa: ' + String(error)));
  };
  menu.addItem(item => item.setTitle('{ Sintesi a sinistra').onClick(() => apply('left')));
  menu.addItem(item => item.setTitle('} Sintesi a destra').onClick(() => apply('right')));
  menu.addItem(item => item.setTitle('Rimuovi collegamento collettivo (conserva i nodi)').onClick(() => apply(null)));
  showAt(menu, position, context);
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
  context.source = next;
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
  let saved = stamped;
  const section = context.ctx.getSectionInfo(context.container);
  await context.plugin.app.vault.process(context.file, markdown => {
    const header = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    const fm = header ? (parseYaml(header[1]) ?? {}) as Record<string, unknown> : {};
    const maps = fm[INLINE_MAPS_FIELD] && typeof fm[INLINE_MAPS_FIELD] === 'object'
      && !Array.isArray(fm[INLINE_MAPS_FIELD])
      ? { ...fm[INLINE_MAPS_FIELD] as Record<string, unknown> } : {};
    const local = readInlineRelations(stamped);
    const scoped = Object.prototype.hasOwnProperty.call(maps, id);
    const legacyRaw = fm[RELATIONS_FIELD];
    const legacy = normalizeRelations(legacyRaw);
    if (local === null && scoped && (!Array.isArray(maps[id]) || normalizeRelations(maps[id]).length !== (maps[id] as unknown[]).length)) {
      throw new Error('Metadati EOME non validi: migrazione interrotta senza cancellare dati.');
    }
    const migrated = migrateLegacy(context, stamped, legacy);
    const old = local ?? (scoped ? normalizeRelations(maps[id]) : migrated);
    saved = writeInlineRelations(stamped, action(old));
    let updated = replaceInlineMindmapFence(markdown, context.source, saved, section?.lineStart);
    if (updated === null) throw new Error('Il blocco è cambiato: riaprilo prima di salvare.');
    let cleaned = false;
    // Remove only the exact per-map copy transferred in this transaction.
    if (local === null && scoped) {
      delete maps[id];
      if (Object.keys(maps).length) fm[INLINE_MAPS_FIELD] = maps;
      else delete fm[INLINE_MAPS_FIELD];
      cleaned = true;
    } else if (local === null && !scoped && migrated.length && Array.isArray(legacyRaw) && legacy.length === legacyRaw.length) {
      // Shared legacy relations can be ambiguous across maps. Keep them unless
      // both endpoint identities occur exactly once in the whole document.
      const all = markdown.split(/\r?\n/).filter(line => /^\s*[-*+]\s/.test(line));
      const counts = new Map<string, number>();
      for (const line of all) for (const n of parseOutline(line.trim())) {
        const key = relationNodeKey(context.plugin.app, context.file, n);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const ids = new Set(migrated.map(r => r.id));
      const remaining = legacy.filter(r => !ids.has(r.id) || counts.get(r.source) !== 1 || counts.get(r.target) !== 1);
      if (remaining.length !== legacy.length) {
        if (remaining.length) fm[RELATIONS_FIELD] = remaining;
        else delete fm[RELATIONS_FIELD];
        cleaned = true;
      }
    }
    if (header && cleaned) {
      const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
      const yaml = Object.keys(fm).length ? '---' + eol + stringifyYaml(fm).replace(/\s+$/, '').replace(/\n/g, eol) + eol + '---' + eol : '';
      updated = yaml + updated.slice(header[0].length);
    }
    return updated;
  });
  context.source = saved;
  (context.ctx as MarkdownPostProcessorContext & { onInlineEomeSaved?: (source: string) => void })
    .onInlineEomeSaved?.(saved);
}

export async function changeInlineArrow(context: InlineContext, relation: EomeRelation,
  mode: RelationArrowMode): Promise<void> {
  const stamped = stampInlineMap(context.source).source;
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
  initialItems?: ExportedDrawingItem[], sibling = false): Promise<{ source: string; line: number; link: string } | null> {
  if (!isInlineMindmapSource(context.source)) return null;
  const flatten = (values: OutlineNode[]): OutlineNode[] =>
    values.reduce((acc, node) => [...acc, node, ...flatten(node.children)], [] as OutlineNode[]);
  const selected = line === null ? null : flatten(nodes).find(n => n.line === line);
  if (line !== null && !selected) {
    new Notice('Il nodo selezionato non è più presente nel blocco.');
    return null;
  }
  await modifyInlineRelations(context, stampInlineMap(context.source).source, relations => relations);
  let attachment: TFile | null = null;
  try {
    attachment = await createEomeSvg(context.plugin.app, context.plugin.svgFolder,
      'EOME manoscritto.svg', createDrawingSvg(initialItems ?? []));
    const link = context.plugin.app.metadataCache.fileToLinktext(attachment, context.file.path, true);
    const embed = '![[ ' + link + ' ]]';
    const normalizedEmbed = embed.replace('![[ ', '![[').replace(' ]]', ']]');
    const base = stampInlineMap(context.source).source;
    const inserted = insertHandwrittenNode(base, line, normalizedEmbed, sibling);
    if (inserted === null) throw new Error('Impossibile inserire il nodo in questo blocco.');
    const next = stampInlineMap(inserted).source;
    const flatten = (values: OutlineNode[]): OutlineNode[] =>
      values.reduce((all, node) => all.concat(node, flatten(node.children)), [] as OutlineNode[]);
    const updated = flatten(parseOutline(next));
    const newNode = updated.find(node => extractDrawingLink(node.text)?.trim() === link.trim());
    const previous = selected ? updated.find(node => node.line === selected.line) : null;
    const parent = sibling && previous ? updated.find(n => n.children.some(c => c.line === previous.line)) : null;
    if (!newNode || (selected && !previous)) throw new Error('Identità del nodo non trovata.');
    pendingFocus.set(focusKey(context.file, next), { link: link.trim(), remaining: 3 });
    await updateFence(context, next);
    await modifyInlineRelations(context, next, existing => {
      const from = sibling ? parent : previous;
      if (!from) return existing;
      const sourceKey = relationNodeKey(context.plugin.app, context.file, from);
      const inherited = sibling && previous ? existing.find(r => r.source === sourceKey &&
        r.target === relationNodeKey(context.plugin.app, context.file, previous)) : undefined;
      return createOrUpdateRelation(existing, sourceKey,
        relationNodeKey(context.plugin.app, context.file, newNode), inherited?.kind ?? kind, arrow);
    });
    return { source: context.source, line: newNode.line, link };

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
    return null;
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
  const result = await openMapDrawing(context, []);
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
    } as unknown as MarkdownPostProcessorContext
  };
  await addInlineDrawing(latestContext, [], null, 'figlio', 'none', result.items);
}

/** Serial handwritten creation. The next canvas opens directly on Save +
 * parallel/L, without navigating through the map. A cancelled or blank
 * drawing creates no SVG or Markdown entry.
 */
async function createInlineDrawingSeries(
  context: InlineContext, parentLine: number,
  relation: RelationKind,
  sibling = false,
  initialResult?: { items: ExportedDrawingItem[]; next?: 'parallel' | 'elbow' | 'sibling' }
): Promise<void> {

  let source = context.source;
  let line = parentLine;
  let kind = relation;
  let queued = initialResult;
  while (true) {
    const result = queued ?? await openMapDrawing(context, [], true);
    queued = undefined;
    if (!result) return;
    const hasContent = result.items.some(item =>
      item.type !== 'pen' || (Array.isArray(item.data.path) && item.data.path.length > 0));
    if (!hasContent) {
      new Notice('Disegno vuoto: nessun nuovo nodo creato.');
      return;
    }
    const appended = await addInlineDrawing(
      { ...context, source }, parseOutline(source), line, kind, 'none', result.items, sibling);
    if (!appended) return;
    source = appended.source;
    line = appended.line;
    if (!result.next) return;
    sibling = result.next === 'sibling';
    kind = result.next === 'parallel' ? 'figlio' : 'dettaglio';
  }
}

/** Open an advanced drawing editor for a related node, and keep it open across
 * Save + parallel/L actions. Intended for menus and touch long presses.
 */
export async function createRelatedInlineDrawing(
  context: InlineContext, node: OutlineNode, kind: RelationKind, sibling = false
): Promise<void> {
  await createInlineDrawingSeries(context, node.line, kind, sibling);
}

/** One context menu for the graph and the SVG fallback gallery. */
export function showInlineNodeMenu(context: InlineContext, roots: OutlineNode[],
  node: OutlineNode, position: { x: number; y: number }): void {
  const menu = new Menu();
  menu.addItem(item => item.setTitle('Modifica nodo · editor avanzato')
    .setIcon('pencil').onClick(() => {
      void editInlineDrawing(context, roots, node);
    }));
  menu.addSeparator();
  menu.addItem(item => item.setTitle('Nuovo parallelo —')
    .setIcon('plus').onClick(() => {
      void createRelatedInlineDrawing(context, node, 'figlio');
    }));
  menu.addItem(item => item.setTitle('Nuovo ramo a L └')
    .setIcon('corner-down-right').onClick(() => {
      void createRelatedInlineDrawing(context, node, 'dettaglio');
    }));
  menu.addItem(item => item.setTitle('Nuovo fratello').setIcon('plus').onClick(() => {
    void createRelatedInlineDrawing(context, node, 'figlio', true);
  }));
  showAt(menu, position, context);
}

/** Native right-click and reliable touch long-press (> 550 ms) on a node.
 * Normal taps and touches remain free for selecting the node.
 */
export function bindInlineNodeContextMenu(
  element: HTMLElement, open: (position: { x: number; y: number }) => void
): () => void {
  let timer: number | null = null;
  let origin: { x: number; y: number } | null = null;
  let pointerId: number | null = null;
  const cancel = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    origin = null;
    pointerId = null;
  };
  const contextmenu = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    cancel();
    open({ x: event.clientX, y: event.clientY });
  };
  const down = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    cancel();
    pointerId = event.pointerId;
    origin = { x: event.clientX, y: event.clientY };
    timer = window.setTimeout(() => {
      timer = null;
      open({ x: origin?.x ?? event.clientX, y: origin?.y ?? event.clientY });
      origin = null;
    }, 550);
  };
  const move = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId || !origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 12) cancel();
  };
  element.addEventListener('contextmenu', contextmenu);
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', cancel);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('pointerleave', cancel);
  return () => {
    cancel();
    element.removeEventListener('contextmenu', contextmenu);
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', cancel);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('pointerleave', cancel);
  };
}

export function showInlineCreateMenu(context: InlineContext, nodes: OutlineNode[],
  selected: number | null, place: { x: number; y: number }): void {
  if (selected === null && nodes.length > 0) {
    new Notice('Tocca prima la parola alla quale collegare il nuovo nodo.');
    return;
  }
  if (selected === null) {
    // Every entry point for the initial root must use the complete editor.
    void createFirstInlineDrawing(context).catch(error => {
      console.error('EOME first node menu failed', error);
      new Notice('Impossibile aprire l’editor del primo nodo: ' +
        (error instanceof Error ? error.message : String(error)));
    });
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
    refreshRenderedAttachments: async () => {
      if (readInlineRelations(context.source) === null) {
        await modifyInlineRelations(context, stampInlineMap(context.source).source, relations => relations);
      }
      await refresh();
    }
  } as unknown as MindmapView;
  const controller = new InlineInkController(host, wrapper);
  // Compact pen controls work on the selected SVG node, without opening a modal.
  const toolbar = wrapper.ownerDocument.createElement('div');
  toolbar.className = 'mindmap-eome-ink-tools';
  wrapper.parentElement!.insertBefore(toolbar, wrapper);
  const undo = toolbar.createEl('button', { text: '↶ Annulla', attr: { 'aria-label': 'Annulla ultimo tratto' } });
  const redo = toolbar.createEl('button', { text: '↷ Ripristina', attr: { 'aria-label': 'Ripristina ultimo tratto' } });
  const eraser = toolbar.createEl('button', { text: 'Gomma', attr: { 'aria-label': 'Cancellino vettoriale' } });
  eraser.setAttribute('aria-pressed', 'false');
  eraser.addEventListener('click', () => {
    const panel = context.container.closest('.eome-scoped-tab')?.querySelector('.eome-map-drawing-panel');
    if (panel) { panel.dispatchEvent(new CustomEvent('eome-tool', { detail: 'eraser' })); return; }
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
  const editSelected = (tool = 'pen'): void => {
    const panel = context.container.closest('.eome-scoped-tab')?.querySelector('.eome-map-drawing-panel');
    if (panel) { panel.dispatchEvent(new CustomEvent('eome-tool', { detail: tool })); return; }
    const line = selectedLine();
    const node = line === null ? null : flat.find(item => item.line === line);
    if (!node) {
      new Notice('Seleziona prima il nodo manoscritto da modificare.');
      return;
    }
    void editInlineDrawing(context, parseOutline(context.source), node, tool).catch(error => {
      console.error('EOME advanced node editor failed', error);
      new Notice('Non è stato possibile aprire l’editor avanzato del nodo.');
    });
  };
  advanced.addEventListener('click', () => editSelected());
  for (const [tool, label] of [['pen', 'Penna'], ['pointer', 'Seleziona tratti'], ['move', 'Sposta'], ['line', 'Linea'], ['rect', 'Rettangolo'], ['circle', 'Ellisse']]) {
    const button = toolbar.createEl('button', { text: label });
    button.addEventListener('click', () => editSelected(tool));
  }
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
    const node = flat.find(n => n.line === line);
    if (node) void createRelatedInlineDrawing(context, node, kind).catch(error => new Notice(String(error)));
  };
  parallel.addEventListener('click', () => quickAdd('figlio'));
  detail.addEventListener('click', () => quickAdd('dettaglio'));
  const sibling = toolbar.createEl('button', { text: '+ Fratello' });
  sibling.addEventListener('click', () => {
    const node = flat.find(n => n.line === selectedLine());
    if (node) void createRelatedInlineDrawing(context, node, 'figlio', true).catch(error => new Notice(String(error)));
  });
  const run = (action: 'undo' | 'redo') => {
    const panel = context.container.closest('.eome-scoped-tab')?.querySelector('.eome-map-drawing-panel');
    if (panel) { panel.dispatchEvent(new CustomEvent('eome-history', { detail: action })); return; }
    const line = selectedLine();
    if (line === null) { new Notice('Seleziona prima il nodo manoscritto.'); return; }
    void (action === 'undo' ? controller.undoLastStroke(line) : controller.redoLastStroke(line))
      .then(ok => { if (!ok) new Notice('Nessun tratto disponibile.'); })
      .catch(error => { console.error('EOME inline ink history failed', error); new Notice('Impossibile modificare il tratto.'); });
  };
  undo.addEventListener('click', () => run('undo'));
  redo.addEventListener('click', () => run('redo'));
  // Touch taps select nodes; a stylus remains the primary in-place ink tool.
  // Mouse clicks select by default. Opt into mouse drawing explicitly to avoid
  // starting a stroke before the click or context-menu event can fire.
  let mouseDrawing = false;
  const mouseMode = toolbar.createEl('button', {
    text: 'Disegna col mouse',
    cls: 'mindmap-eome-mouse-ink-mode',
    attr: { 'aria-pressed': 'false', 'aria-label': 'Attiva disegno diretto con mouse' }
  });
  mouseMode.addEventListener('click', () => {
    mouseDrawing = !mouseDrawing;
    mouseMode.setAttribute('aria-pressed', String(mouseDrawing));
    mouseMode.setText(mouseDrawing ? 'Mouse: disegno' : 'Disegna col mouse');
  });
  let lassoMode = false;
  let lassoPointer: number | null = null;
  let polygon: Array<{ x: number; y: number }> = [];
  let lassoSvg: SVGSVGElement | null = null;
  let selectedLines: number[] = [];
  const lasso = toolbar.createEl('button', { text: 'Lazo nodi', attr: { 'aria-pressed': 'false' } });
  const side = toolbar.createEl('select', { attr: { 'aria-label': 'Orientamento graffa' } });
  side.createEl('option', { text: '} Sintesi a destra', value: 'right' });
  side.createEl('option', { text: '{ Sintesi a sinistra', value: 'left' });
  const summarize = toolbar.createEl('button', { text: 'Crea sintesi (0)' });
  summarize.disabled = true;
  lasso.addEventListener('click', () => {
    lassoMode = !lassoMode;
    lasso.setAttribute('aria-pressed', String(lassoMode));
    wrapper.classList.toggle('eome-lasso-active', lassoMode);
  });
  summarize.addEventListener('click', () => {
    summarize.disabled = true;
    void createInlineSummary(context, selectedLines, side.value as 'left' | 'right')
      .catch(error => new Notice('Sintesi: ' + String(error)))
      .then(() => { summarize.disabled = selectedLines.length < 2; });
  });
  const lassoEvent = (e: PointerEvent): boolean => {
    if (!lassoMode || (e.target instanceof Element && e.target.closest('button, select, .eome-map-drawing-panel'))) return false;
    if (e.type === 'pointerdown') {
      // A finger/palm cannot start a selection while using the stylus.
      if (e.pointerType === 'touch' || e.button !== 0 || lassoPointer !== null) return true;
      lassoPointer = e.pointerId;
      polygon = [{ x: e.clientX, y: e.clientY }];
      lassoSvg = wrapper.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
      lassoSvg.classList.add('eome-lasso-outline');
      wrapper.appendChild(lassoSvg);
      wrapper.setPointerCapture(e.pointerId);
    } else if (lassoPointer === e.pointerId) {
      polygon.push({ x: e.clientX, y: e.clientY });
      if (e.type === 'pointermove' && lassoSvg) {
        const rect = wrapper.getBoundingClientRect();
        const path = wrapper.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', polygon.map((p, i) => (i ? 'L' : 'M') + (p.x - rect.left) + ',' + (p.y - rect.top)).join(' '));
        lassoSvg.replaceChildren(path);
      } else if (e.type === 'pointerup' || e.type === 'pointercancel') {
        selectedLines = [];
        if (e.type !== 'pointercancel') wrapper.querySelectorAll<HTMLElement>('.mindmap-eome-overlay').forEach(node => {
          const r = node.getBoundingClientRect();
          const selected = pointInLasso({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, polygon);
          node.classList.toggle('eome-group-selected', selected);
          if (selected) selectedLines.push(Number(node.dataset.nodeLine));
        });
        summarize.setText('Crea sintesi (' + selectedLines.length + ')');
        summarize.disabled = selectedLines.length < 2;
        lassoSvg?.remove(); lassoSvg = null; lassoPointer = null;
        if (wrapper.hasPointerCapture(e.pointerId)) wrapper.releasePointerCapture(e.pointerId);
      }
    }
    e.preventDefault(); e.stopImmediatePropagation();
    return true;
  };
  const shouldInk = (e: PointerEvent): boolean =>
    e.button === 0 && (e.pointerType === 'pen' ||
      (e.pointerType === 'mouse' && (mouseDrawing || e.altKey)));
  const down = (e: PointerEvent) => {
    if (lassoEvent(e)) return;
    if (shouldInk(e)) controller.pointerDown(e);
  };
  const move = (e: PointerEvent) => { if (!lassoEvent(e)) controller.pointerMove(e); };
  const up = (e: PointerEvent) => { if (!lassoEvent(e)) controller.pointerEnd(e); };
  wrapper.addEventListener('pointerdown', down, true);
  wrapper.addEventListener('pointermove', move, true);
  wrapper.addEventListener('pointerup', up, true);
  wrapper.addEventListener('pointercancel', up, true);
  return () => {
    controller.cancel();
    lassoSvg?.remove();
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
  node: OutlineNode, tool = 'pen'): Promise<void> {
  const link = extractDrawingLink(node.text);
  if (!link) return;
  const file = resolveDrawingFile(context.plugin.app, link, context.file.path);
  if (!(file instanceof TFile)) return;
  const before = await context.plugin.app.vault.read(file);
  const drawing = parseDrawingSvg(before);
  if (!drawing) return;
  const result = await openMapDrawing(context, drawing.items as ExportedDrawingItem[], true, tool);
  if (!result) return;
  if (await context.plugin.app.vault.read(file) !== before) {
    new Notice('Il disegno è cambiato mentre era aperto; nessuna sovrascrittura.');
    return;
  }
  await modifyInlineRelations(context, stampInlineMap(context.source).source, relations => relations);
  await context.plugin.app.vault.modify(file,
    createDrawingSvg(result.items, drawing.createdAt, undefined, hasLegacyOpaqueBacking(before)));
  if (result.next) {
    await createInlineDrawingSeries(context, node.line,
      result.next === 'parallel' ? 'figlio' : 'dettaglio', result.next === 'sibling');
  }
}
