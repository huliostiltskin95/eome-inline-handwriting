import { describe, expect, it } from 'vitest';
import { lastMenu, TFile } from './obsidian-mock';
import { showNodeContextMenu } from '../src/view/context-menu';
import type { OutlineNode } from '../src/utils/outline';

function node(text: string): OutlineNode {
  return { text, indent: '', marker: '-', line: 4, endLine: 4, children: [], checkbox: 'none' };
}

function excalidrawApp(drawingPaths: string[] = []): unknown {
  const known = new Set(drawingPaths);
  return {
    plugins: {
      plugins: {
        'obsidian-excalidraw-plugin': {
          settings: {},
          isExcalidrawFile: (file: { path: string }) => known.has(file.path),
        },
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath: string) => {
        const file = new TFile();
        file.path = `Excalidraw/${linkpath}.md`;
        return file;
      },
    },
  };
}

function menuTitlesFor(targetNode: OutlineNode, app?: unknown): string[] {
  const overlay = { dataset: { nodeLine: String(targetNode.line) } };
  const ownerDocument = {} as Document;
  const event = {
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    clientX: 120,
    clientY: 80,
    composedPath: () => [{ closest: (selector: string) => selector === '.mindmap-overlay' ? overlay : null }],
    target: { closest: (selector: string) => selector === '.mindmap-overlay' ? overlay : null },
  } as unknown as MouseEvent;
  const view = {
    app,
    file: app ? { path: 'Map.md' } : null,
    wrapper: { classList: { contains: () => false }, focus: () => undefined, ownerDocument },
    isDirectNodeDragActive: () => false,
    selectedNodeLines: new Set<number>(),
    getNodeByLine: (line: number) => line === targetNode.line ? targetNode : null,
    selectNode: (line: number) => view.selectedNodeLines.add(line),
    getFlatNodes: () => [targetNode],
    setActiveNodeContextMenu: () => undefined,
  } as never;
  showNodeContextMenu(view, event);
  return lastMenu?.items.map((item) => item.title) ?? [];
}

describe('ink-only node context menu', () => {
  it('offers two handwritten geometries and no text editor/insertion', () => {
    const titles = menuTitlesFor(node('Idea'));
    expect(titles).toContain('Nuovo nodo parallelo —');
    expect(titles).toContain('Nuovo nodo a L └');
    expect(titles).not.toContain('Edit');
    expect(titles).not.toContain('Add child');
    expect(titles).not.toContain('Add sibling');
    expect(titles).not.toContain('Add heading for this tree');
    expect(titles).not.toContain('Paste');
  });

  it('opens handwriting but not plain text editing', () => {
    expect(menuTitlesFor(node('Idea'))).not.toContain('Espandi / modifica disegno');
    expect(menuTitlesFor(node('![[Idea drawing.svg]]')).toContain('Espandi / modifica disegno');
  });

  it('opens arrow choices after selecting the parallel geometry', () => {
    menuTitlesFor(node('Idea'));
    const parallel = lastMenu?.items.find(item => item.title === 'Nuovo nodo parallelo —');
    parallel?.click?.();
    const titles = lastMenu?.items.map(item => item.title) ?? [];
    expect(titles).toEqual(expect.arrayContaining([
      'Senza freccia', 'Freccia all’inizio',
      'Freccia alla fine', 'Frecce a entrambe le estremità'
    ]));
  });

  it('uses explicit node supplied by Pencil long-press on iPad', () => {
    const targetNode = node('Pencil target');
    const ownerDocument = {} as Document;
    const event = {
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
      clientX: 42, clientY: 64, target: {}, composedPath: () => [{}],
    } as unknown as MouseEvent;
    const view = {
      wrapper: { focus: () => undefined, ownerDocument },
      isDirectNodeDragActive: () => false,
      selectedNodeLines: new Set<number>(),
      getNodeByLine: (line: number) => line === targetNode.line ? targetNode : null,
      selectNode: (line: number) => view.selectedNodeLines.add(line),
      getFlatNodes: () => [targetNode],
      setActiveNodeContextMenu: () => undefined,
    } as never;

    showNodeContextMenu(view, event, targetNode.line);
    expect(lastMenu?.items.map(item => item.title)).toContain('Nuovo nodo a L └');
    expect(lastMenu?.position).toEqual({ x: 42, y: 64 });
    expect(lastMenu?.positionDocument).toBe(ownerDocument);
  });
});
