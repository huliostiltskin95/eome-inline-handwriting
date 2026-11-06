import {
  ItemView, MarkdownRenderChild, TFile, type MarkdownPostProcessorContext,
  type WorkspaceLeaf, type ViewStateResult
} from 'obsidian';
import type MindmapPlugin from '../main';
import { inlineMapId } from './inline-eome-identity';
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
    this.contentEl.createDiv({
      cls: 'eome-scoped-instructions',
      text: 'Seleziona un nodo per scrivere con la penna, usa Modifica nodo per l’editor avanzato, —+ per il ramo parallelo o └+ per il dettaglio.'
    });
    this.host = this.contentEl.createDiv({ cls: 'eome-scoped-editor-host' });
    this.registerEvent(this.app.vault.on('modify', changed => {
      if (!this.file) return;
      if (changed.path === this.file.path || (changed instanceof TFile && changed.extension.toLowerCase() === 'svg')) {
        this.scheduleRefresh(changed.path === this.file.path ? 120 : 500);
      }
    }));
    if (this.file) await this.refresh();
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
      this.host.setText('Blocco EOME non trovato o modificato fuori dalla mappa. Nessun altro contenuto è stato alterato.');
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
    this.unloadRenderedChildren();
    this.host.empty();
    const target = this.host.createDiv();
    const context = {
      sourcePath: this.file.path,
      onInlineEomeSaved: (nextSource: string) => {
        this.source = nextSource;
        this.mapId = inlineMapId(nextSource);
      },
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
    await renderMindmapEomeEmbed(this.plugin, fence.content, target, context, 'editor');
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.renderGeneration++;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.selectionObserver?.disconnect();
    this.selectionObserver = null;
    this.unloadRenderedChildren();
    this.contentEl.empty();
    this.host = null;
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
