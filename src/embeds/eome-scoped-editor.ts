import {
  ItemView, MarkdownRenderChild, TFile, Notice, type MarkdownPostProcessorContext,
  type WorkspaceLeaf, type ViewStateResult
} from 'obsidian';
import type MindmapPlugin from '../main';
import { inlineMapId, outlineWithoutMapMarker } from './inline-eome-identity';
import { parseOutline } from '../utils/outline';
import { createFirstInlineDrawing, addInlineDrawing, editInlineDrawing } from './inline-eome-actions';
import { extractDrawingLink } from '../drawing/drawing-link';
import type { OutlineNode } from '../utils/outline';
import {
  findInlineFenceAtLine, findInlineFenceByContent, findInlineFenceById,
  type InlineEomeFence
} from './inline-eome-source';
import { renderMindmapEomeEmbed } from './eome-embed';

export const VIEW_TYPE_EOME_SCOPED = 'eome-scoped-map-tab';

interface ScopedViewState {
  file: string;
  line: number;
  id: string | null;
  source: string;
}

/**
 * A normal Obsidian ItemView: tabs, split panes, history and tab close are
 * managed by Workspace. The only editable document is the selected fence.
 * SVG writes and pair relations persist immediately to their vault files.
 */
export class EomeScopedEditor extends ItemView {
  private host: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private backup: HTMLElement | null = null;
  private diagramObserver: MutationObserver | null = null;
  private firstNodeButton: HTMLButtonElement | null = null;
  private creatingFirstNode = false;
  private children: MarkdownRenderChild[] = [];
  private refreshTimer: number | null = null;
  private renderGeneration = 0;
  private selectionObserver: MutationObserver | null = null;
  private file: TFile | null = null;
  private source = '';
  private line = 0;
  private mapId: string | null = null;
  private closed = false;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: MindmapPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_EOME_SCOPED; }
  getDisplayText(): string {
    return this.file ? `EOME · ${this.file.basename} · ${this.line + 1}` : 'Mappa EOME';
  }
  getIcon(): string { return 'network'; }

  getState(): Record<string, unknown> {
    return {
      file: this.file?.path ?? '',
      id: this.mapId,
      line: this.line,
      source: this.source,
    };
  }

  async setState(state: ScopedViewState, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const file = typeof state?.file === 'string'
      ? this.app.vault.getAbstractFileByPath(state.file) : null;
    this.file = file instanceof TFile && file.extension === 'md' ? file : null;
    this.line = Number.isSafeInteger(state?.line) && state.line >= 0 ? state.line : 0;
    this.mapId = typeof state?.id === 'string' ? state.id : null;
    this.source = typeof state?.source === 'string' ? state.source : '';
    if (this.host) await this.refresh();
  }

  async onOpen(): Promise<void> {
    this.closed = false;
    this.contentEl.empty();
    this.contentEl.addClass('eome-scoped-tab');
    const toolbar = this.contentEl.createDiv({ cls: 'eome-scoped-main-toolbar' });
    this.firstNodeButton = toolbar.createEl('button', {
      cls: 'mod-cta eome-create-first-node',
      text: '+ Crea il primo nodo',
      attr: { 'aria-label': 'Crea il primo nodo nell’editor avanzato' }
    });
    this.firstNodeButton.addEventListener('click', () => {
      void this.createFirstNode().catch(error => {
        console.error('EOME first node toolbar failed:', error);
        new Notice('Impossibile aprire il primo nodo: ' +
          (error instanceof Error ? error.message : String(error)));
      });
    });
    toolbar.createDiv({
      cls: 'eome-scoped-instructions',
      text: 'Primo nodo: editor avanzato obbligatorio. Per i successivi, seleziona un nodo e usa —+ oppure └+.'
    });
    this.status = this.contentEl.createDiv({ cls: 'eome-tab-render-status' });
    this.host = this.contentEl.createDiv({ cls: 'eome-scoped-editor-host' });
    this.registerEvent(this.app.vault.on('modify', changed => {
      if (!this.file) return;
      if (changed.path === this.file.path || (changed instanceof TFile && changed.extension.toLowerCase() === 'svg')) {
        this.scheduleRefresh(changed.path === this.file.path ? 120 : 500);
      }
    }));
    if (this.file) await this.refresh();
  }

  private async createFirstNode(): Promise<void> {
    if (this.creatingFirstNode || this.closed || !this.file || !this.host) return;
    const current = this.locate(await this.app.vault.read(this.file));
    if (!current || parseOutline(outlineWithoutMapMarker(current.content)).length > 0) {
      new Notice('La mappa non è vuota o non è più identificabile.');
      return;
    }
    this.creatingFirstNode = true;
    if (this.firstNodeButton) this.firstNodeButton.disabled = true;
    const file = this.file;
    const context = {
      sourcePath: file.path,
      getSectionInfo: () => ({ lineStart: current.open, lineEnd: current.close }),
      onInlineEomeSaved: (next: string) => {
        this.source = next;
        this.mapId = inlineMapId(next);
      }
    } as unknown as MarkdownPostProcessorContext;
    try {
      await createFirstInlineDrawing({
        plugin: this.plugin, file, source: current.content,
        container: this.host, ctx: context
      });
    } finally {
      this.creatingFirstNode = false;
      if (this.firstNodeButton) this.firstNodeButton.disabled = false;
      if (!this.closed) this.scheduleRefresh(50);
    }
  }

  private scheduleRefresh(delay: number): void {
    if (this.closed) return;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, delay);
  }

  private locate(markdown: string): InlineEomeFence | null {
    if (this.mapId) return findInlineFenceById(markdown, this.mapId);
    const atLine = findInlineFenceAtLine(markdown, this.line);
    if (atLine && atLine.open === this.line) {
      if (atLine.content.replace(/\r\n/g, '\n').trim() === this.source.replace(/\r\n/g, '\n').trim()) return atLine;
      // The first write may insert the persistent map marker.
      if (inlineMapId(atLine.content)) return atLine;
    }
    return findInlineFenceByContent(markdown, this.source);
  }

  private renderBackup(fence: InlineEomeFence): void {
    if (!this.host || !this.file) return;
    const file = this.file;
    const roots = parseOutline(outlineWithoutMapMarker(fence.content));
    const flatten = (nodes: OutlineNode[]): OutlineNode[] =>
      nodes.reduce((all, node) => all.concat(node, flatten(node.children)), [] as OutlineNode[]);
    const nodes = flatten(roots);
    this.backup = this.host.createDiv({ cls: 'eome-tab-fallback' });
    if (!nodes.length) {
      this.backup.hidden = true;
      return;
    }
    this.backup.createDiv({
      cls: 'eome-tab-fallback-caption',
      text: 'Nodi della mappa · seleziona una parola per modificarla o aggiungere un collegamento'
    });
    const context = {
      sourcePath: file.path,
      getSectionInfo: () => ({ lineStart: fence.open, lineEnd: fence.close }),
      onInlineEomeSaved: (next: string) => {
        this.source = next;
        this.mapId = inlineMapId(next);
        this.scheduleRefresh(100);
      }
    } as unknown as MarkdownPostProcessorContext;
    const editContext = {
      plugin: this.plugin,
      file,
      source: fence.content,
      container: this.host,
      ctx: context
    };
    for (const node of nodes) {
      const row = this.backup.createDiv({ cls: 'eome-tab-fallback-node' });
      const drawingLink = extractDrawingLink(node.text);
      const destination = drawingLink
        ? this.app.metadataCache.getFirstLinkpathDest(drawingLink, file.path)
        : null;
      const fallbackName = drawingLink?.split('/').pop();
      const attachment = destination instanceof TFile ? destination
        : this.app.vault.getFiles().find(f => f.extension.toLowerCase() === 'svg' &&
          (f.path === drawingLink || f.name === fallbackName));
      if (attachment) {
        const image = row.createEl('img', {
          attr: {
            src: this.app.vault.getResourcePath(attachment),
            alt: drawingLink ?? 'Nodo manoscritto'
          }
        });
        image.addEventListener('click', () => {
          void editInlineDrawing(editContext, roots, node);
        });
      } else {
        row.createSpan({ text: drawingLink ?? node.text });
      }
      const actions = row.createDiv({ cls: 'eome-tab-fallback-actions' });
      const edit = actions.createEl('button', { text: 'Modifica nodo' });
      edit.addEventListener('click', () => {
        void editInlineDrawing(editContext, roots, node).catch(error => {
          console.error('EOME node edit failed:', error);
          new Notice('Editor nodo: ' + (error instanceof Error ? error.message : String(error)));
        });
      });
      const add = (label: string, kind: 'figlio' | 'dettaglio'): void => {
        const button = actions.createEl('button', { text: label });
        button.addEventListener('click', () => {
          void addInlineDrawing(editContext, roots, node.line, kind, 'none');
        });
      };
      add('—+ Parallelo', 'figlio');
      add('└+ Dettaglio', 'dettaglio');
    }
  }

  private unloadRenderedChildren(): void {
    for (const child of this.children) this.removeChild(child);
    this.children = [];
  }

  private async refresh(): Promise<void> {
    if (this.closed || !this.host || !this.file) return;
    const generation = ++this.renderGeneration;
    const markdown = await this.app.vault.read(this.file);
    if (this.closed || generation !== this.renderGeneration || !this.host) return;
    const fence = this.locate(markdown);
    if (!fence) {
      this.status?.setText('Blocco EOME non trovato o modificato fuori dalla mappa. Nessun altro contenuto è stato alterato.');
      this.host.setText('Blocco EOME non identificato. Torna alla nota e apri nuovamente la mappa.');
      return;
    }
    const selectedLine = this.host.querySelector<HTMLElement>(
      '.mindmap-eome-overlay.selected[data-node-line]')?.dataset.nodeLine;
    const restoreSelection = selectedLine !== undefined && this.source === fence.content;
    this.selectionObserver?.disconnect();
    this.selectionObserver = null;
    this.source = fence.content;
    this.mapId = inlineMapId(fence.content);
    this.line = fence.open;
    if (this.firstNodeButton) {
      this.firstNodeButton.hidden =
        parseOutline(outlineWithoutMapMarker(fence.content)).length > 0;
      this.firstNodeButton.disabled = this.creatingFirstNode;
    }
    this.diagramObserver?.disconnect();
    this.diagramObserver = null;
    this.unloadRenderedChildren();
    this.host.empty();
    this.status?.setText('');
    this.renderBackup(fence);
    const target = this.host.createDiv({ cls: 'eome-tab-diagram' });
    const context = {
      sourcePath: this.file.path,
      onInlineEomeSaved: (nextSource: string) => {
        this.source = nextSource;
        this.mapId = inlineMapId(nextSource);
      },
      requestFirstNode: () => this.createFirstNode(),
      getSectionInfo: () => ({ lineStart: fence.open, lineEnd: fence.close }),
      addChild: (child: MarkdownRenderChild) => {
        this.children.push(child);
        this.addChild(child);
      }
    } as unknown as MarkdownPostProcessorContext;
    if (restoreSelection) {
      const host = this.host;
      const restore = (): void => {
        const active = host?.querySelector('.mindmap-eome-overlay.selected');
        const overlay = host?.querySelector<HTMLElement>(
          '.mindmap-eome-overlay[data-node-line="' + selectedLine + '"]');
        if (overlay && !active) overlay.classList.add('selected');
        if (overlay || active) {
          this.selectionObserver?.disconnect();
          this.selectionObserver = null;
        }
      };
      this.selectionObserver = new MutationObserver(restore);
      this.selectionObserver.observe(target, { childList: true, subtree: true });
      restore();
    }
    // The native preview must never go blank if Cytoscape/MarkdownRender fails.
    // Keep a usable SVG/editor fallback until overlays have actually appeared.
    const updateBackup = (): void => {
      if (!this.backup || this.closed || generation !== this.renderGeneration) return;
      const overlays = Array.from(target.querySelectorAll<HTMLElement>('.mindmap-eome-overlay'));
      // Hiding the fallback before ink becomes visible recreates the blank-tab bug.
      this.backup.hidden = overlays.some(overlay => {
        const img = overlay.querySelector('img');
        const box = overlay.getBoundingClientRect();
        return !!img && img.complete && img.naturalWidth > 0 && box.width > 0 && box.height > 0;
      });
    };
    const observer = new MutationObserver(updateBackup);
    observer.observe(target, { childList: true, subtree: true });
    this.diagramObserver = observer;
    try {
      await renderMindmapEomeEmbed(this.plugin, fence.content, target, context, 'editor');
      updateBackup();
      target.querySelectorAll('img').forEach(img => {
        img.addEventListener('load', updateBackup, { once: true });
        img.addEventListener('error', updateBackup, { once: true });
      });
      if (target.querySelector('.mindmap-eome-error')) {
        this.status?.setText('Il rendering grafico non è disponibile. I nodi restano accessibili qui sotto.');
      }
    } catch (error) {
      console.error('EOME native tab map render failed:', error);
      this.status?.setText('Errore di rendering: ' +
        (error instanceof Error ? error.message : String(error)) +
        '. Puoi comunque aprire e modificare gli SVG qui sotto.');
      target.empty();
    }
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.renderGeneration++;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.selectionObserver?.disconnect();
    this.selectionObserver = null;
    this.diagramObserver?.disconnect();
    this.diagramObserver = null;
    this.unloadRenderedChildren();
    this.contentEl.empty();
    this.host = null;
    this.backup = null;
    this.status = null;
    this.firstNodeButton = null;
    // The source Markdown preview stays in its own tab, like a PDF embed.
    // A rerender accounts for SVG-only modifications without changing prose.
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as unknown as {
        file?: TFile;
        previewMode?: { rerender?: (force?: boolean) => void };
      };
      if (view.file?.path === this.file?.path) view.previewMode?.rerender?.(true);
    }
  }
}

export async function openScopedEomeEditor(
  plugin: MindmapPlugin, file: TFile, fence: InlineEomeFence
): Promise<void> {
  const leaf = plugin.app.workspace.getLeaf('tab');
  await leaf.setViewState({
    type: VIEW_TYPE_EOME_SCOPED,
    state: {
      file: file.path, line: fence.open,
      id: inlineMapId(fence.content), source: fence.content
    } satisfies ScopedViewState,
    active: true
  });
  await plugin.app.workspace.revealLeaf(leaf);
}
