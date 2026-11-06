import cytoscape, { Core, ElementDefinition, type LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';

import { parseOutline, OutlineNode } from '../utils/outline';
import { VerticalToolbar } from '../ui/toolbar/vertical-toolbar';
import { MindmapView } from './mindmap-view';
import { sortByMarkdownOrder } from '../utils/cytoscape';
import { arrangeTopLevelTrees } from './tree-layout';
import { measureNodesForLayout } from './node-measurement';
import { arrowModeForNode, arrowShapesForMode } from './edge-arrows';
import { relationNodeKey } from './relations';

cytoscape.use(dagre);

export interface DrawRequest {
  generation: number;
  data: string;
  isCurrent(): boolean;
}

export async function draw(view: MindmapView, request: DrawRequest): Promise<void> {
  if (!view.file || !request.isCurrent()) return;

  const roots = parseOutline(request.data);
  const flat: OutlineNode[] = [];
  (function walk(arr: OutlineNode[]) {
    arr.forEach((node) => {
      flat.push(node);
      walk(node.children);
    });
  })(roots);

  // Measurements belong exclusively to this document snapshot. They become
  // visible to Cytoscape and overlays together only after the whole pass has
  // completed and this generation is still the newest one.
  const nextSizeMap = await measureNodesForLayout(view, flat);
  if (!request.isCurrent()) return;

  const isInitialDraw = !view.cy;
  if (isInitialDraw) {
    view.ensureMindmapWrapper();
    view.wrapper.empty();
    view.toolbar = new VerticalToolbar(view);
    view.refreshMobileToolbarPlacement();
  }

  view.sizeMap = nextSizeMap;

  const elements = buildElements(view, flat, nextSizeMap);
  const layoutOptions = createLayoutOptions(view);
  let cy = view.cy;

  if (!cy) {
    const canvas = view.wrapper.createDiv({ cls: 'mindmap-canvas' });
    cy = cytoscape({
      container: canvas,
      elements,
      // The generation-aware layout below is the single authoritative pass.
      layout: { name: 'preset' },
      boxSelectionEnabled: false,
      selectionType: 'single',
      style: [
        {
          selector: 'node',
          style: {
            'shape': 'rectangle',
            // Geometry and gesture targets only: handwriting stays in the overlay.
            'background-opacity': 0,
            width: 'data(width)',
            height: 'data(height)',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.35,
            'line-color': '#666666',
            'curve-style': 'taxi',
            'taxi-direction': 'vertical',
            'taxi-turn': '50%',
            'taxi-turn-min-distance': '8px',
            'line-cap': 'round',
            // The Cytoscape runtime accepts data() for arrow shapes; the
            // installed TypeScript declarations type these as static literals.
            'source-arrow-shape': 'data(sourceArrow)' as any,
            'target-arrow-shape': 'data(targetArrow)' as any,
            'source-arrow-color': '#666666',
            'target-arrow-color': '#666666',
            'arrow-scale': 0.65,
          },
        },
        {
          selector: 'edge.eome-layout-only',
          style: {
            'display': 'none',
          },
        },
        {
          selector: 'edge.eome-sibling',
          style: {
            // With the default TB layout siblings sit on the same row.
            'curve-style': 'straight',
          },
        },
      ],
      wheelSensitivity: 0.2,
    });
    view.cy = cy;

    cy.on('pan zoom', () => {
      view.requestOverlayGeometryFrame(() => {
        if (!view.updateOverlayGeometry()) {
          view.updateOverlays();
        }
      });
    });
    cy.on('layoutstop', () => applyCompletedLayout(view, cy!));
  } else {
    cy.json({ elements });
  }

  if (!request.isCurrent() || view.cy !== cy || cy.destroyed()) return;
  // The direction of the first leg should follow the chosen Dagre flow.
  cy.edges().style('taxi-direction',
    view.layoutOptions.rankDir === 'LR' || view.layoutOptions.rankDir === 'RL' ? 'horizontal' : 'vertical');

  cy.userPanningEnabled(false);
  cy.userZoomingEnabled(false);
  cy.scratch('_mindmapRoots', roots);
  cy.scratch('_mindmapRenderGeneration', request.generation);

  await runLayout(cy, layoutOptions);
  if (!request.isCurrent() || view.cy !== cy || cy.destroyed()) return;
  // Render-only sibling strokes are added after Dagre finishes. Including them
  // in the layout graph would introduce cycles and reorder the user's notes.
  const siblings = buildSiblingEdges(view, roots);
  if (siblings.length) cy.add(siblings);
}

function buildElements(
  view: MindmapView,
  flat: OutlineNode[],
  sizeMap: Map<number, { w: number; h: number }>
): ElementDefinition[] {
  const elements: ElementDefinition[] = [];
  const orderByLine = new Map<number, number>();
  flat.forEach((node, index) => orderByLine.set(node.line, index));

  for (const node of flat) {
    const dimensions = sizeMap.get(node.line);
    if (!dimensions) continue;
    elements.push({
      data: {
        id: `n${node.line}`,
        node,
        width: dimensions.w,
        height: dimensions.h,
        order: orderByLine.get(node.line) ?? node.line,
      },
    });
  }
  for (const parent of flat) {
    parent.children.forEach((child, index) => {
      const isExplicitTarget = !!view.file && view.relations.some(rel =>
        rel.target === relationNodeKey(view.app, view.file!, child));
      const arrows = arrowShapesForMode(arrowModeForNode(view, child));
      elements.push({
        classes: index === 0 && !isExplicitTarget ? 'eome-branch' : 'eome-layout-only',
        data: {
          id: `e${parent.line}-${child.line}`,
          source: `n${parent.line}`,
          target: `n${child.line}`,
          order: orderByLine.get(child.line) ?? child.line,
          ...arrows,
        },
      });
    });
  }

  return elements;
}

/** Horizontal (TB) sibling relations drawn as dash-like strokes, not boxes. */
function buildSiblingEdges(view: MindmapView, roots: OutlineNode[]): ElementDefinition[] {
  const edges: ElementDefinition[] = [];
  const visit = (node: OutlineNode): void => {
    node.children.forEach((child, index) => {
      if (index > 0) {
        if (view.file && view.relations.some(rel =>
          rel.target === relationNodeKey(view.app, view.file!, child))) {
          visit(child);
          return;
        }
        const previous = node.children[index - 1];
        const arrows = arrowShapesForMode(arrowModeForNode(view, child));
        edges.push({
          classes: 'eome-sibling',
          data: {
            id: `s${previous.line}-${child.line}`,
            source: `n${previous.line}`,
            target: `n${child.line}`,
            ...arrows,
          },
        });
      }
      visit(child);
    });
  };
  roots.forEach(visit);
  return edges;
}

function createLayoutOptions(view: MindmapView): LayoutOptions {
  const options = view.layoutOptions;
  return {
    name: 'dagre',
    rankDir: options.rankDir,
    align: options.align,
    nodeSep: options.nodeSep,
    edgeSep: options.edgeSep,
    rankSep: options.rankSep,
    marginx: options.marginx,
    marginy: options.marginy,
    acyclicer: options.acyclicer,
    ranker: options.ranker,
    fit: false,
    padding: 20,
    nodeDimensionsIncludeLabels: false,
    spacingFactor: options.spacingFactor,
    sort: sortByMarkdownOrder,
  } as unknown as LayoutOptions;
}

function applyCompletedLayout(view: MindmapView, cy: Core): void {
  const generation = cy.scratch('_mindmapRenderGeneration') as number | undefined;
  if (typeof generation !== 'number' || !view.isRenderContextCurrent(generation, cy)) return;

  const roots = cy.scratch('_mindmapRoots') as OutlineNode[] | undefined;
  if (!roots) return;

  arrangeTopLevelTrees(
    cy,
    roots,
    view.sizeMap,
    view.layoutOptions.headingTreeLayout ?? 'vertical',
    Math.max(160, (view.layoutOptions.rankSep ?? 50) * 3)
  );
  if (!view.firstFitDone) {
    cy.center(cy.elements());
    if (typeof view.layoutOptions.zoomFactor === 'number') {
      view.setZoomFactor(view.layoutOptions.zoomFactor, false);
    } else {
      cy.fit(cy.elements(), 50);
      cy.center(cy.elements());
      view.rememberCurrentZoom(false);
    }
    view.firstFitDone = true;
  }
  view.rememberCurrentZoom(false);
  view.updateOverlays();
}

async function runLayout(
  cy: Core,
  options: LayoutOptions
): Promise<void> {
  const layout = cy.layout(options);

  await new Promise<void>((resolve, reject) => {
    const onLayoutStop = () => resolve();

    layout.one('layoutstop', onLayoutStop);
    try {
      layout.run();
    } catch (error) {
      layout.off('layoutstop', onLayoutStop);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
