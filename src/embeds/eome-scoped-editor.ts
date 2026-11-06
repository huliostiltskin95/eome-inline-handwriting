import { Modal, MarkdownRenderChild, TFile, type MarkdownPostProcessorContext, type EventRef } from 'obsidian';
import type MindmapPlugin from '../main';
import { inlineMapId } from './inline-eome-identity';
import { findInlineFenceAtLine, findInlineFenceByContent, findInlineFenceById, type InlineEomeFence } from './inline-eome-source';
import { renderMindmapEomeEmbed } from './eome-embed';

/** A single Markdown fence is the document for this editor, never the entire
 * host .md. Every interaction persists the fence (and its own relation data)
 * immediately; closing this modal merely returns to the refreshed preview.
 */
export class EomeScopedEditor extends Modal {
  private host: HTMLElement | null = null;
  private children: MarkdownRenderChild[] = [];
  private refreshTimer: number | null = null;
  private renderGeneration = 0;
  private closed = false;
  private modifyRef: EventRef | null = null;
  private source: string;
  private line: number;
  private id: string | null;

  constructor(private readonly plugin: MindmapPlugin,
    private readonly file: TFile, fence: InlineEomeFence) {
    super(plugin.app);
    this.source = fence.content;
    this.line = fence.open;
    this.id = inlineMapId(fence.content);
  }

  onOpen(): void {
    this.modalEl.addClass('eome-scoped-editor-modal');
    this.setTitle('EOME — modifica mappa');
    this.contentEl.createDiv({ cls: 'eome-scoped-instructions',
      text: 'Scrivi nei nodi con la penna. Seleziona un nodo e usa —+ per il ramo destro o └+ per il dettaglio sotto. Chiudi per tornare alla nota.' });
    this.host = this.contentEl.createDiv({ cls: 'eome-scoped-editor-host' });
    this.modifyRef = this.plugin.app.vault.on('modify', changed => {
      if (changed.path === this.file.path || (changed instanceof TFile && changed.extension.toLowerCase() === 'svg'))
        this.scheduleRefresh(changed.path === this.file.path ? 120 : 550);
    });
    void this.refresh();
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
    if (this.id) return findInlineFenceById(markdown, this.id);
    const atLine = findInlineFenceAtLine(markdown, this.line);
    if (atLine && atLine.open === this.line) {
      if (atLine.content.replace(/\r\n/g, '\n').trim() === this.source.replace(/\r\n/g, '\n').trim())
        return atLine;
      // First edit stamps the fence ID and potentially inserts a new SVG.
      // Do not lose the active map before its ID has been cached.
      if (!this.id && inlineMapId(atLine.content)) return atLine;
    }
    return findInlineFenceByContent(markdown, this.source);
  }

  private async refresh(): Promise<void> {
    if (this.closed || !this.host) return;
    const generation = ++this.renderGeneration;
    const markdown = await this.plugin.app.vault.read(this.file);
    if (this.closed || generation !== this.renderGeneration) return;
    const fence = this.locate(markdown);
    if (!fence) {
      this.host.setText('Il blocco EOME è stato spostato o modificato fuori dall’editor. Nessun altro blocco sarà modificato.');
      return;
    }
    this.id = inlineMapId(fence.content);
    this.source = fence.content;
    this.line = fence.open;
    for (const child of this.children) {
      child.unload();
    }
    this.children = [];
    this.host.empty();
    const target = this.host.createDiv();
    const context = {
      sourcePath: this.file.path,
      getSectionInfo: () => ({ lineStart: fence.open, lineEnd: fence.close }),
      addChild: (child: MarkdownRenderChild) => {
        this.children.push(child);
        child.load();
      },
    } as unknown as MarkdownPostProcessorContext;
    await renderMindmapEomeEmbed(this.plugin, fence.content, target, context, 'editor');
  }

  onClose(): void {
    this.closed = true;
    this.renderGeneration++;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    if (this.modifyRef) this.plugin.app.vault.offref(this.modifyRef);
    this.modifyRef = null;
    for (const child of this.children) child.unload();
    this.children = [];
    this.contentEl.empty();
    // The Markdown file owns the preview. Ask any visible reading-mode leaf
    // to refresh its code blocks, including after SVG-only edits.
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as unknown as {
        file?: TFile;
        previewMode?: { rerender?: (force?: boolean) => void };
      };
      if (view.file?.path === this.file.path) view.previewMode?.rerender?.(true);
    }
  }
}

export function openScopedEomeEditor(plugin: MindmapPlugin, file: TFile, fence: InlineEomeFence): void {
  new EomeScopedEditor(plugin, file, fence).open();
}
