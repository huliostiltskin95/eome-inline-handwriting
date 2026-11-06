import {
  Plugin,
  WorkspaceLeaf,
  TFile,
  MarkdownView,
  Notice,
  PluginSettingTab,
  Setting,
} from 'obsidian';
import { VIEW_TYPE_MINDMAP } from './constants';
import { DEFAULT_SVG_FOLDER, validateSvgFolder } from './drawing/svg-folder';
import { MindmapView } from './view/mindmap-view';
import {
  addBlankDrawingAsChild,
  addBlankDrawingAsSibling,
  addBlankDrawingAsRoot,
  addBlankDrawingWithRelation
} from './drawing/drawing-actions';
import { openInternalLink } from './utils/outline';
import type { RelationKind } from './view/relations';
import { renderMindmapEomeEmbed } from './embeds/eome-embed';
import { findInlineFenceAtLine, isInlineMindmapSource } from './embeds/inline-eome-source';
import { openScopedEomeEditor } from './embeds/eome-scoped-editor';
import { exportMindmapViewToCanvas } from './commands/export-canvas';
import { exportMindmapViewToPdf, exportMindmapViewToSvg } from './commands/export-vector';

export default class MindmapPlugin extends Plugin {
  public svgFolder = DEFAULT_SVG_FOLDER;

  public async saveSvgFolder(value: string): Promise<void> {
    const folder = validateSvgFolder(value);
    const current = (await this.loadData() as Record<string, unknown> | null) ?? {};
    current.svgFolder = folder;
    await this.saveData(current);
    this.svgFolder = folder;
  }

  private suppressNextAutoOpen = new Set<string>();
  private autoOpenTimer: number | null = null;
  private autoOpenRunning = false;
  private autoOpenQueued = false;

  async onload() {
    const saved = (await this.loadData() as Record<string, unknown> | null)?.svgFolder;
    if (typeof saved === 'string') {
      try { this.svgFolder = validateSvgFolder(saved); }
      catch (error) { console.warn('Invalid saved EOME SVG folder; using default.', error); }
    }
    this.addSettingTab(new EomeSettingsTab(this.app, this));
    this.registerView(
      VIEW_TYPE_MINDMAP,
      (leaf: WorkspaceLeaf) => new MindmapView(leaf, this)
    );

    this.registerMarkdownCodeBlockProcessor('mindmap-eome', async (source, el, ctx) => {
      await renderMindmapEomeEmbed(this, source, el, ctx);
    });

    // Available through Obsidian's Slash Commands and the command palette.
    // It intentionally reads only the fence under the current cursor.
    this.addCommand({
      id: 'open-eome-fence-at-cursor',
      name: 'EOME: apri la mappa del blocco al cursore',
      editorCheckCallback: (checking, editor, view) => {
        const fence = findInlineFenceAtLine(editor.getValue(), editor.getCursor().line);
        const canOpen = Boolean(view.file && fence && isInlineMindmapSource(fence.content));
        if (checking) return canOpen;
        if (!canOpen || !fence || !view.file) return false;
        const file = view.file;
        void view.save().then(async () => {
          const current = findInlineFenceAtLine(await this.app.vault.read(file), fence.open);
          if (!current || current.content.trim() !== fence.content.trim()) {
            new Notice('Il blocco EOME è cambiato: riposiziona il cursore e riprova.');
            return;
          }
          openScopedEomeEditor(this, file, current);
        }).catch(error => {
          console.error('EOME scoped editor startup failed', error);
          new Notice('Impossibile aprire la mappa EOME.');
        });
        return true;
      },
    });

    this.addCommand({
      id: 'copy-selection-as-markdown',
      name: 'Copy selection as Markdown',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveMindmapView();
        const canRun = !!view && view.selectedNodeLines.size > 0;
        if (checking) return canRun;
        if (view) void view.copySelectionAsMarkdown();
        return canRun;
      },
    });

    this.addCommand({
      id: 'toggle-inline-handwriting',
      name: 'Toggle direct handwriting on drawing nodes',
      checkCallback: (checking) => {
        const view = this.getActiveMindmapView();
        if (checking) return Boolean(view);
        if (!view) return false;
        new Notice(view.toggleInlineInk() ? 'Penna sui nodi: attiva' : 'Penna sui nodi: disattiva');
        return true;
      }
    });
    this.addCommand({
      id: 'add-handwritten-child-node',
      name: 'Add a handwritten child node (or first root)',
      checkCallback: (checking) => {
        const view = this.getActiveMindmapView();
        const node = view?.getSelectedNodes()[0];
        const canRun = Boolean(view && (node || view.getFlatNodes().length === 0));
        if (checking) return canRun;
        if (!view) return false;
        if (!view.inlineInkEnabled) view.toggleInlineInk();
        if (node) void addBlankDrawingAsChild(view, node);
        else if (canRun) void addBlankDrawingAsRoot(view);
        return canRun;
      }
    });
    this.addCommand({
      id: 'add-handwritten-sibling-node',
      name: 'Add a handwritten sibling node',
      checkCallback: (checking) => {
        const view = this.getActiveMindmapView();
        const node = view?.getSelectedNodes()[0];
        if (checking) return Boolean(view && node);
        if (!view || !node) return false;
        if (!view.inlineInkEnabled) view.toggleInlineInk();
        void addBlankDrawingAsSibling(view, node);
        return true;
      }
    });

    this.addCommand({
      id: 'toggle-eome-connect-mode',
      name: 'Collega due nodi con Apple Pencil',
      checkCallback: (checking) => {
        const view = this.getActiveMindmapView();
        if (checking) return Boolean(view);
        if (!view) return false;
        new Notice(view.toggleConnectionMode()
          ? 'Collega: trascina la penna fra due nodi.' : 'Collega: disattivato.');
        return true;
      }
    });

    const newKinds: Array<[RelationKind, string]> = [
      ['figlio', 'Nuovo figlio —'],
      ['conseguenza', 'Nuova conseguenza —'],
      ['dettaglio', 'Nuovo dettaglio a L'],
      ['causa', 'Nuova causa a L']
    ];
    for (const [kind, name] of newKinds) {
      this.addCommand({
        id: 'add-handwritten-' + kind,
        name,
        checkCallback: checking => {
          const view = this.getActiveMindmapView();
          const node = view?.getSelectedNodes()[0];
          if (checking) return Boolean(view && node);
          if (!view || !node) return false;
          void addBlankDrawingWithRelation(view, node, kind);
          return true;
        }
      });
    }

    this.addCommand({
      id: 'export-current-mindmap-to-canvas',
      name: 'Canvas export of the current mindmap',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveMindmapView();
        const canRun = !!view?.file;
        if (checking) return canRun;
        if (view) void exportMindmapViewToCanvas(this, view);
        return canRun;
      },
    });

    this.addCommand({
      id: 'export-current-mindmap-to-svg',
      name: 'Export current mindmap to SVG',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveMindmapView();
        const canRun = !!view?.file;
        if (checking) return canRun;
        if (view) void exportMindmapViewToSvg(this, view);
        return canRun;
      },
    });

    this.addCommand({
      id: 'export-current-mindmap-to-pdf',
      name: 'Export current mindmap to PDF',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveMindmapView();
        const canRun = !!view?.file;
        if (checking) return canRun;
        if (view) void exportMindmapViewToPdf(this, view);
        return canRun;
      },
    });

    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          void this.updateMindmapViews(file);
        }
      })
    );


  }

  onunload() {
    // Do not detach leaves on unload; preserve user layout and leaf locations.
  }

  public async openMindmapReplacingLeaf(file: TFile): Promise<void> {
    const existingLeaf = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_MINDMAP)
      .find((leaf) => {
        const v = leaf.view as MindmapView;
        return v.file?.path === file.path;
      });
    if (existingLeaf) {
      this.revealLeaf(existingLeaf);
      return;
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
    const matchingLeaf = markdownLeaves.find((leaf) => {
      const mv = leaf.view as MarkdownView;
      return mv.file?.path === file.path;
    });

    let targetLeaf: WorkspaceLeaf;

    if (matchingLeaf) {
      targetLeaf = matchingLeaf;
    } else {
      targetLeaf = this.getWorkspaceLeaf(true);
    }

    await targetLeaf.setViewState({
      type: VIEW_TYPE_MINDMAP,
      state: {
        file: file.path,
      },
      active: true,
    });

    this.revealLeaf(targetLeaf);
  }

  public async openMarkdownReplacingLeaf(file: TFile): Promise<void> {
    this.suppressNextAutoOpen.add(file.path);
    window.setTimeout(() => this.suppressNextAutoOpen.delete(file.path), 1500);

    const existingLeaf = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_MINDMAP)
      .find((leaf) => {
        const v = leaf.view as MindmapView;
        return v.file?.path === file.path;
      });

    if (existingLeaf) {
      await existingLeaf.setViewState({
        type: 'markdown',
        state: {
          file: file.path,
        },
        active: true,
      });
      this.revealLeaf(existingLeaf);
      return;
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
    const matchingMdLeaf = markdownLeaves.find((leaf) => {
      const mv = leaf.view as MarkdownView;
      return mv.file?.path === file.path;
    });
    if (matchingMdLeaf) {
      this.revealLeaf(matchingMdLeaf);
    } else {
      await openInternalLink(this.app, file.path, '');
    }
  }

  private scheduleOpenedFileMindmapAutoOpen(file: TFile): void {
    if (file.extension !== 'md') return;

    if (this.autoOpenTimer !== null) {
      window.clearTimeout(this.autoOpenTimer);
      this.autoOpenTimer = null;
    }

    this.autoOpenTimer = window.setTimeout(() => {
      this.autoOpenTimer = null;
      void this.openMarkedOpenedFileAsMindmap(file);
    }, 80);
  }

  private async openMarkedOpenedFileAsMindmap(file: TFile, attempt: number = 0): Promise<void> {
    if (this.autoOpenRunning) {
      this.autoOpenQueued = true;
      return;
    }

    this.autoOpenRunning = true;
    try {
      const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null;
      if (!activeLeaf || !this.leafHasMarkdownFileState(activeLeaf, file)) {
        if (attempt < 5) {
          window.setTimeout(() => {
            void this.openMarkedOpenedFileAsMindmap(file, attempt + 1);
          }, 80);
        }
        return;
      }
      if (this.suppressNextAutoOpen.has(file.path)) return;
      if (!(await this.hasMindmapFrontmatterMarker(file))) return;

      await activeLeaf.setViewState({
        type: VIEW_TYPE_MINDMAP,
        state: {
          file: file.path,
        },
        active: true,
      });
    } finally {
      this.autoOpenRunning = false;
      if (this.autoOpenQueued) {
        this.autoOpenQueued = false;
        window.setTimeout(() => {
          void this.openMarkedOpenedFileAsMindmap(file, attempt + 1);
        }, 100);
      }
    }
  }

  private leafHasMarkdownFileState(leaf: WorkspaceLeaf, file: TFile): boolean {
    const viewState = leaf.getViewState();
    if (viewState.type === 'markdown' && viewState.state?.file === file.path) {
      return true;
    }

    const view = leaf.view;
    return view instanceof MarkdownView && view.file?.path === file.path;
  }

  private async hasMindmapFrontmatterMarker(file: TFile): Promise<boolean> {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, 'excerpt-outline-mindmap')) {
      return true;
    }

    const contents = await this.app.vault.cachedRead(file);
    const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return false;

    return /^excerpt-outline-mindmap(?:\s*:|$)/m.test(match[1]);
  }

  private getWorkspaceLeaf(split: boolean): WorkspaceLeaf {
    return this.app.workspace.getLeaf(split);
  }

  private revealLeaf(leaf: WorkspaceLeaf): void {
    void this.app.workspace.revealLeaf(leaf);
  }

  private getActiveMindmapView(): MindmapView | null {
    return this.app.workspace.getActiveViewOfType(MindmapView);
  }

  private async updateMindmapViews(file: TFile): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP);
    for (const leaf of leaves) {
      const view = leaf.view as MindmapView;
      if (view.file?.path === file.path) {
        // Enhanced check for active editing or drag operations
        const hasActiveTextarea = view.wrapper?.querySelector('textarea');
        const hasActiveDrag = view.wrapper?.querySelector('.mm-src, .mm-tgt');
        
        if (hasActiveTextarea || hasActiveDrag) {
          continue; // Skip update during user interactions
        }
        
        // Use incremental update for external changes
        await view.reloadDataIncremental();
      }
    }
  }
}

/** Location for native EOME SVGs, independent of Obsidian's default attachment folder. */
class EomeSettingsTab extends PluginSettingTab {
  constructor(app: MindmapPlugin['app'], private readonly plugin: MindmapPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName('Cartella degli SVG EOME')
      .setDesc('Percorso relativo alla radice del vault. La cartella viene creata automaticamente al primo disegno; gli SVG già esistenti non vengono spostati.')
      .addText(input => {
        input.setPlaceholder(DEFAULT_SVG_FOLDER).setValue(this.plugin.svgFolder);
        const save = async (): Promise<void> => {
          try {
            await this.plugin.saveSvgFolder(input.getValue());
          } catch (error) {
            new Notice(error instanceof Error ? error.message : 'Cartella SVG non valida.');
            input.setValue(this.plugin.svgFolder);
          }
        };
        input.inputEl.addEventListener('change', () => { void save(); });
        input.inputEl.addEventListener('keydown', event => {
          if (event.key === 'Enter') input.inputEl.blur();
        });
      });
    new Setting(containerEl)
      .setName('Ripristina cartella predefinita')
      .addButton(button => button.setButtonText('Ripristina').onClick(async () => {
        await this.plugin.saveSvgFolder(DEFAULT_SVG_FOLDER);
        this.display();
      }));
  }
}
