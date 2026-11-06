import {
  Component,
  Notice,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
  TFile,
  setIcon,
} from 'obsidian';
import cytoscape, { ElementDefinition, type LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';

import type MindmapPlugin from '../main';
import { isOutlineCompatible, OutlineNode, parseOutline } from '../utils/outline';
import { parseHeadingSections } from '../utils/heading-sections';
import { sortByMarkdownOrder } from '../utils/cytoscape';
import { renderHeadingFrames } from '../view/heading-frames';
import { arrangeRelationNodes } from '../view/relations-layout';
import { arrangeTopLevelTrees } from '../view/tree-layout';
import { hasExplicitRelationSchema, readRelations, relationNodeKey, type EomeRelation } from '../view/relations';
import { routeRelations, type RouteNode } from '../view/relations-routing';
import { appendRelationGeometry } from '../view/relations-overlay';
import { extractDrawingLink } from '../drawing/drawing-link';
import { parseDrawingSvg } from '../drawing/drawing-svg';
import { isInlineMindmapSource, findInlineFenceAtLine, findInlineFenceByContent, findInlineFenceById } from './inline-eome-source';
import { inlineMapId, outlineWithoutMapMarker, INLINE_MAPS_FIELD } from './inline-eome-identity';
import { normalizeRelations } from '../view/relations';
import {
  addInlineDrawing,
  showInlineCreateMenu, showInlineArrowMenu,
  editInlineDrawing, connectInlineHandwriting
} from './inline-eome-actions';

cytoscape.use(dagre);

function getEmbedFileName(source: string): string | null {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 1) return null;

  return lines[0].replace(/^["']|["']$/g, '');
}

function flattenOutline(nodes: OutlineNode[]): OutlineNode[] {
  const flat: OutlineNode[] = [];

  const walk = (items: OutlineNode[]) => {
    items.forEach((node) => {
      flat.push(node);
      walk(node.children);
    });
  };

  walk(nodes);
  return flat;
}

async function waitForAsyncContent(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));

  await Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();

    return new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
      window.setTimeout(resolve, 1500);
    });
  }));

  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function measureNodes(
  plugin: MindmapPlugin,
  component: Component,
  file: TFile,
  flat: OutlineNode[]
): Promise<Map<number, { w: number; h: number }>> {
  const sizeMap = new Map<number, { w: number; h: number }>();
  const targetWidth = 300;
  const measureContainer = createDiv();
  measureContainer.className = 'mindmap-eome-measurement-container';
  document.body.appendChild(measureContainer);

  for (const node of flat) {
    // Native handwritten SVG nodes are sized by their own vector viewBox,
    // never by the old fixed 300px Markdown measurement column. Uniform
    // scaling preserves the original ink aspect ratio.
    const drawingLink = extractDrawingLink(node.text);
    const drawingFile = drawingLink
      ? plugin.app.metadataCache.getFirstLinkpathDest(drawingLink, file.path) : null;
    if (drawingFile instanceof TFile && drawingFile.extension.toLowerCase() === 'svg') {
      const svg = await plugin.app.vault.cachedRead(drawingFile);
      const drawing = parseDrawingSvg(svg);
      const viewBox = /\\bviewBox\\s*=\\s*["']\\s*([^"']+)["']/i.exec(svg);
      const box = viewBox?.[1].trim().split(/[\\s,]+/).map(Number) ?? [];
      if (drawing && box.length === 4 && box.every(Number.isFinite)
        && box[2] > 0 && box[3] > 0) {
        const scale = Math.min(1, 320 / box[2], 220 / box[3]);
        sizeMap.set(node.line, { w: box[2] * scale, h: box[3] * scale });
        continue;
      }
    }
    const box = createDiv();
    box.className = 'mindmap-measure-box';
    box.setCssProps({ '--mindmap-target-width': `${targetWidth}px` });

    if (node.text.trim() === '') {
      box.textContent = '\u00a0';
    } else {
      await MarkdownRenderer.render(plugin.app, node.text, box, file.path, component);
      await waitForAsyncContent(box);
    }

    measureContainer.appendChild(box);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    const rect = box.getBoundingClientRect();
    let measuredW = rect.width || targetWidth;
    let measuredH = rect.height || 40;

    if (measuredW > targetWidth) {
      const scale = targetWidth / measuredW;
      node.scaleFactor = scale;
      measuredW = targetWidth;
      measuredH = measuredH * scale;
    } else {
      measuredW = targetWidth;
    }

    sizeMap.set(node.line, {
      w: Math.max(80, measuredW),
      h: Math.max(40, measuredH),
    });
    measureContainer.removeChild(box);
  }

  document.body.removeChild(measureContainer);
  return sizeMap;
}

function buildElements(flat: OutlineNode[], sizeMap: Map<number, { w: number; h: number }>): ElementDefinition[] {
  const elements: ElementDefinition[] = [];
  const orderByLine = new Map<number, number>();
  flat.forEach((node, index) => orderByLine.set(node.line, index));

  flat.forEach((node) => {
    const dims = sizeMap.get(node.line);
    if (!dims) return;

    elements.push({
      data: {
        id: `n${node.line}`,
        node,
        width: dims.w,
        height: dims.h,
        order: orderByLine.get(node.line) ?? node.line,
      },
    });
  });

  flat.forEach((parent) => {
    parent.children.forEach((child) => {
      elements.push({
        data: {
          id: `e${parent.line}-${child.line}`,
          source: `n${parent.line}`,
          target: `n${child.line}`,
          order: orderByLine.get(child.line) ?? child.line,
        },
      });
    });
  });

  return elements;
}

async function renderOverlays(
  plugin: MindmapPlugin,
  component: Component,
  file: TFile,
  wrapper: HTMLElement,
  cy: cytoscape.Core,
  flat: OutlineNode[],
  sizeMap: Map<number, { w: number; h: number }>,
  inline = false
): Promise<void> {
  wrapper.querySelectorAll('[data-mindmap-eome-overlay]').forEach((overlay) => overlay.remove());

  const css = getComputedStyle(document.documentElement);
  const txt = css.getPropertyValue('--text-normal').trim() || '#000';
  const font = css.getPropertyValue('--font-family').trim() || 'inherit';
  const bg = css.getPropertyValue('--background-primary').trim() || '#fff';
  const zoom = cy.zoom();

  if (!inline) renderHeadingFrames(wrapper, cy, parseHeadingSections(await plugin.app.vault.read(file)), sizeMap, {
    attributeName: 'mindmapEomeOverlay',
  });

  for (const node of flat) {
    const cyNode = cy.getElementById(`n${node.line}`);
    const dims = sizeMap.get(node.line);
    if (!cyNode || cyNode.empty() || !dims) continue;

    const position = cyNode.renderedPosition();
    const box = createDiv();
    box.className = 'mindmap-overlay mindmap-eome-overlay';
    box.dataset.mindmapEomeOverlay = '1';
    box.dataset.nodeLine = String(node.line);
    box.setCssProps({
      '--mindmap-left': `${position.x}px`,
      '--mindmap-top': `${position.y}px`,
      '--mindmap-box-width': `${dims.w}px`,
      '--mindmap-box-height': `${dims.h}px`,
      '--mindmap-zoom': String(zoom),
      '--mindmap-border': '#000000',
      '--mindmap-bg': bg,
      '--mindmap-color': txt,
      '--mindmap-font': font,
    });

    const content = createDiv();
    content.className = 'markdown-rendered';
    if (node.scaleFactor && node.scaleFactor !== 1) {
      content.setCssProps({ '--mindmap-scale': String(node.scaleFactor) });
    }

    if (node.text.trim() === '') {
      content.textContent = '\u00a0';
    } else {
      await MarkdownRenderer.render(plugin.app, node.text, content, file.path, component);
      await waitForAsyncContent(content);
    }

    // The SVG is laid out at its intrinsic ink ratio; prevent the generic
    // Markdown paragraph/margin rules from changing the measured rectangle.
    const image = content.querySelector<HTMLImageElement>('img');
    if (inline && image && extractDrawingLink(node.text)) {
      image.style.width = dims.w + 'px';
      image.style.height = dims.h + 'px';
      image.style.maxWidth = 'none';
      image.style.objectFit = 'contain';
    }
    box.appendChild(content);
    wrapper.appendChild(box);
  }
}

/** Read-only live preview: render the same explicit vector routes and arrows
 * as the editor. The Markdown source note remains the only editable copy.
 * No PDF/SVG export is involved.
 */
function renderEmbeddedRelations(
  plugin: MindmapPlugin, file: TFile, wrapper: HTMLElement,
  cy: cytoscape.Core, flat: OutlineNode[],
  sizes: Map<number, { w: number; h: number }>,
  relations: EomeRelation[],
  onRelationClick?: (relation: EomeRelation, position: { x: number; y: number }) => void
): void {
  wrapper.querySelector('svg.eome-relations-layer')?.remove();
  if (!relations.length) return;
  const counts = new Map<string, number>();
  for (const node of flat) {
    const key = relationNodeKey(plugin.app, file, node);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const bounds = wrapper.getBoundingClientRect();
  const nodes: RouteNode[] = [];
  for (const node of flat) {
    const key = relationNodeKey(plugin.app, file, node);
    if (counts.get(key) !== 1) continue;
    const cyNode = cy.getElementById('n' + node.line);
    if (!cyNode || cyNode.empty()) continue;
    const position = cyNode.renderedPosition();
    const dim = sizes.get(node.line) ?? { w: 80, h: 40 };
    const image = wrapper.querySelector<HTMLImageElement>(
      '.mindmap-eome-overlay[data-node-line="' + node.line + '"] img');
    const rect = image?.getBoundingClientRect();
    nodes.push({
      id: key,
      x: rect ? rect.left + rect.width / 2 - bounds.left : position.x,
      y: rect ? rect.top + rect.height / 2 - bounds.top : position.y,
      w: rect?.width ?? dim.w * cy.zoom(),
      h: rect?.height ?? dim.h * cy.zoom()
    });
  }
  const routes = routeRelations(nodes, relations);
  const doc = wrapper.ownerDocument;
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('eome-relations-layer');
  svg.setAttribute('aria-hidden', 'true');
  const w = Math.max(1, wrapper.clientWidth);
  const h = Math.max(1, wrapper.clientHeight);
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  const color = doc.defaultView?.getComputedStyle(wrapper).getPropertyValue('--text-normal').trim() || '#424242';
  appendRelationGeometry(svg, routes, color);
  if (onRelationClick) {
    for (const route of routes.paths) {
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.classList.add('eome-relation-hit');
      path.setAttribute('d', route.points.map((p, i) =>
        (i ? 'L' : 'M') + p.x + ',' + p.y).join(' '));
      path.setAttribute('stroke', 'transparent');
      path.setAttribute('stroke-width', '20');
      path.setAttribute('fill', 'none');
      path.setAttribute('pointer-events', 'stroke');
      path.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        onRelationClick(route.relation, { x: event.clientX, y: event.clientY });
      });
      svg.appendChild(path);
    }
  }
  wrapper.appendChild(svg);
}

function renderError(el: HTMLElement, message: string): void {
  el.empty();
  el.createDiv({ cls: 'mindmap-eome-error', text: message });
}

export async function renderMindmapEomeEmbed(
  plugin: MindmapPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  mode: 'preview' | 'editor' = 'preview'
): Promise<void> {
  el.classList.add('mindmap-eome-host');
  el.parentElement?.classList.add('mindmap-eome-codeblock');

  // Unlike the former read-only preview, a code fence containing an outline
  // now owns the map *inside the same Markdown note*. A single path still
  // keeps the old linked-note preview working for existing vaults.
  const inline = isInlineMindmapSource(source);
  const fileName = inline ? null : getEmbedFileName(source);
  if (!inline && !fileName) {
    renderError(el, 'mindmap-eome: usa un elenco manoscritto oppure il percorso di una nota .md.');
    return;
  }
  const file = inline
    ? plugin.app.vault.getAbstractFileByPath(ctx.sourcePath)
    : plugin.app.metadataCache.getFirstLinkpathDest(fileName!, ctx.sourcePath);
  if (!(file instanceof TFile) || file.extension !== 'md') {
    renderError(el, 'mindmap-eome: nota Markdown non trovata.');
    return;
  }

  const markdown = inline ? outlineWithoutMapMarker(source) : await plugin.app.vault.read(file);
  const explicitConnections = inline || hasExplicitRelationSchema(plugin.app, file);
  // A fenced map may only draw links whose endpoints belong to that fence.
  // The host note can contain multiple maps and unrelated YAML metadata.
  const mapId = inline ? inlineMapId(source) : null;
  const scoped = mapId
    ? plugin.app.metadataCache.getFileCache(file)?.frontmatter?.[INLINE_MAPS_FIELD] : null;
  const maps = scoped && typeof scoped === 'object' && !Array.isArray(scoped)
    ? scoped as Record<string, unknown> : {};
  const allRelations = inline && mapId
    ? normalizeRelations(maps[mapId])
    : (explicitConnections ? readRelations(plugin.app, file) : []);
  const nodeKeys = new Set(flattenOutline(parseOutline(markdown)).map(node => relationNodeKey(plugin.app, file, node)));
  const relations = inline
    ? allRelations.filter(relation => nodeKeys.has(relation.source) && nodeKeys.has(relation.target))
    : allRelations;
  const inlineContext = inline && mode === 'editor' ? { plugin, file, source, container: el, ctx } : null;
  const openSelected = async (): Promise<void> => {
    if (!inline) return;
    const content = await plugin.app.vault.read(file);
    const id = inlineMapId(source);
    const position = ctx.getSectionInfo(el)?.lineStart;
    const atLine = typeof position === 'number' ? findInlineFenceAtLine(content, position) : null;
    const selected = (id ? findInlineFenceById(content, id) : null)
      ?? (atLine && atLine.content.trim() === source.trim() ? atLine : null)
      ?? findInlineFenceByContent(content, source);
    if (!selected) { new Notice('Blocco EOME non identificabile: aprilo con il cursore sul blocco.'); return; }
    const { openScopedEomeEditor } = await import('./eome-scoped-editor');
    openScopedEomeEditor(plugin, file, selected);
  };
  if (!isOutlineCompatible(markdown)) {
    renderError(el, `mindmap-eome: ${file.name} is not a compatible mindmap outline.`);
    return;
  }

  const roots = parseOutline(markdown);
  const flat = flattenOutline(roots);
  if (flat.length === 0) {
    if (!inline) {
      renderError(el, `mindmap-eome: ${file.name} has no outline nodes.`);
      return;
    }
    el.empty();
    const start = el.createDiv({ cls: 'mindmap-eome-empty' });
    start.createEl('p', { text: 'Mappa manoscritta vuota' });
    const add = start.createEl('button', { text: inlineContext ? '+ Prima parola' : 'Apri mappa EOME' });
    add.addEventListener('click', () => {
      if (inlineContext) void addInlineDrawing(inlineContext, [], null, 'figlio', 'none');
      else void openSelected();
    });
    return;
  }

  el.empty();
  const wrapper = el.createDiv({ cls: inline
    ? 'mindmap-eome-wrapper mindmap-eome-inline'
    : 'mindmap-eome-wrapper' });
  // Registered before anything renders. Markdown rendered into this embed
  // must be owned by something that dies with the embed; the plugin instance
  // lives for the whole session and would retain every embed ever drawn.
  const child = new MarkdownRenderChild(wrapper);
  ctx.addChild(child);
  const canvas = wrapper.createDiv({ cls: 'mindmap-canvas mindmap-eome-canvas' });
  let selectedLine: number | null = null;
  let stopInk: (() => void) | null = null;
  if (inlineContext) {
    const addButton = wrapper.createEl('button', {
      cls: 'mindmap-eome-inline-add',
      attr: { 'aria-label': 'Aggiungi nodo nella mappa' },
    });
    setIcon(addButton, 'plus');
    addButton.setAttribute('title', 'Nuovo nodo parallelo o a L');
    addButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      showInlineCreateMenu(inlineContext, roots, selectedLine, {
        x: event.clientX, y: event.clientY
      });
    });
    wrapper.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const overlay = target?.closest<HTMLElement>('.mindmap-eome-overlay[data-node-line]');
      if (!overlay) return;
      const line = Number(overlay.dataset.nodeLine);
      if (!Number.isFinite(line)) return;
      selectedLine = line;
      wrapper.querySelectorAll('.mindmap-eome-overlay').forEach(node =>
        node.classList.toggle('selected', node === overlay));
    });
    wrapper.addEventListener('dblclick', event => {
      const target = event.target instanceof Element ? event.target : null;
      const overlay = target?.closest<HTMLElement>('.mindmap-eome-overlay[data-node-line]');
      const line = Number(overlay?.dataset.nodeLine);
      const node = flat.find(n => n.line === line);
      if (!node || !inlineContext) return;
      event.preventDefault();
      void editInlineDrawing(inlineContext, roots, node);
    });
  } else if (inline) {
    const openButton = wrapper.createEl('button', {
      cls: 'mindmap-eome-open-button',
      attr: { 'aria-label': 'Apri questa mappa EOME' },
    });
    setIcon(openButton, 'expand');
    openButton.setAttribute('title', 'Apri questa mappa in una finestra');
    openButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void openSelected();
    });
  } else {
    const openButton = wrapper.createEl('button', {
      cls: 'mindmap-eome-open-button',
      attr: { 'aria-label': 'Open mindmap' },
    });
    setIcon(openButton, 'external-link');
    openButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void plugin.openMindmapReplacingLeaf(file);
    });
  }

  const sizeMap = await measureNodes(plugin, child, file, flat);
  const elements = buildElements(flat, sizeMap);
  const layoutOptions = {
    name: 'dagre',
    rankDir: 'LR',
    fit: false,
    padding: 24,
    nodeDimensionsIncludeLabels: false,
    spacingFactor: 1,
    sort: sortByMarkdownOrder,
  } as unknown as LayoutOptions;

  const cy = cytoscape({
    container: canvas,
    elements,
    layout: layoutOptions,
    boxSelectionEnabled: false,
    autoungrabify: true,
    autounselectify: true,
    userPanningEnabled: false,
    userZoomingEnabled: false,
    style: [
      {
        selector: 'node',
        style: {
          'shape': 'rectangle',
          'background-opacity': 0,
          width: 'data(width)',
          height: 'data(height)',
        },
      },
      {
        selector: 'edge',
        style: {
          width: 1,
          'line-color': '#000000',
          'curve-style': 'straight',
          'opacity': explicitConnections ? 0 : 1,
        },
      },
    ],
  });

  cy.on('layoutstop', () => {
    arrangeTopLevelTrees(cy, roots, sizeMap, 'vertical', 160);
    arrangeRelationNodes(cy, sizeMap, relations, node => relationNodeKey(plugin.app, file, node));
    cy.fit(cy.elements(), 28);
    cy.center(cy.elements());
    const redraw = async (): Promise<void> => {
      await renderOverlays(plugin, child, file, wrapper, cy, flat, sizeMap, inline);
      if (explicitConnections && wrapper.isConnected && !cy.destroyed()) {
        renderEmbeddedRelations(plugin, file, wrapper, cy, flat, sizeMap, relations,
          inlineContext ? (relation, position) =>
            showInlineArrowMenu(inlineContext, relation, position) : undefined);
      }
    };
    void redraw().then(() => {
      if (inlineContext && !stopInk) {
        stopInk = connectInlineHandwriting(inlineContext, wrapper, flat, redraw);
      }
    });
  });

  cy.layout(layoutOptions).run();

  child.onunload = () => {
    stopInk?.();
    cy.destroy();
  };
}
