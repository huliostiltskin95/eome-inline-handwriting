import { Menu } from 'obsidian';
import type { MindmapView } from './mindmap-view';
import type { EomeRelation, RelationArrowMode, RelationKind } from './relations';
import { RELATION_KINDS, relationNodeKey } from './relations';
import { atFraction, fractionNearest, routeRelations, type RouteNode, type RoutePoint,
  type RoutingResult } from './relations-routing';
import type { OutlineNode } from '../utils/outline';

const SVG = 'http://www.w3.org/2000/svg';
const LABELS: Record<RelationKind, string> = {
  figlio: 'Figlio —', conseguenza: 'Conseguenza —',
  dettaglio: 'Dettaglio └', causa: 'Causa └', trasversale: 'Trasversale'
};

function pathData(points: readonly RoutePoint[]): string {
  return points.map((p, i) => (i ? 'L' : 'M') + p.x + ',' + p.y).join(' ');
}

function trianglePoints(tip: RoutePoint, vx: number, vy: number): string {
  const length = Math.max(0.001, Math.hypot(vx, vy));
  const x = vx / length, y = vy / length;
  const baseX = tip.x - x * 9, baseY = tip.y - y * 9;
  return [
    tip.x + ',' + tip.y,
    (baseX - y * 4.1) + ',' + (baseY + x * 4.1),
    (baseX + y * 4.1) + ',' + (baseY - x * 4.1)
  ].join(' ');
}

function addArrow(svg: SVGSVGElement, points: readonly RoutePoint[], fraction: number,
  backwards: boolean, color: string): void {
  const { point: tip, tangent } = atFraction(points, fraction);
  const polygon = svg.ownerDocument.createElementNS(SVG, 'polygon');
  polygon.setAttribute('points', trianglePoints(tip,
    backwards ? -tangent.x : tangent.x,
    backwards ? -tangent.y : tangent.y));
  polygon.setAttribute('fill', color);
  polygon.classList.add('eome-link-arrowhead');
  svg.appendChild(polygon);
}

function arrowShapes(svg: SVGSVGElement, relation: EomeRelation,
  points: readonly RoutePoint[], color: string): void {
  if (relation.arrow === 'start' || relation.arrow === 'both')
    addArrow(svg, points, 0, true, color);
  if (relation.arrow === 'end' || relation.arrow === 'both')
    addArrow(svg, points, 1, false, color);
  if (relation.arrow === 'custom')
    addArrow(svg, points, relation.arrowAt ?? 0.5, false, color);
}

function addMenuItem(menu: Menu, title: string, handler: () => void): void {
  menu.addItem(item => item.setTitle(title).onClick(handler));
}

export function showRelationKindMenu(view: MindmapView, source: OutlineNode,
  target: OutlineNode, at: { x: number; y: number }, kinds: readonly RelationKind[] = RELATION_KINDS): void {
  const menu = new Menu();
  for (const kind of kinds) {
    addMenuItem(menu, LABELS[kind], () => { void view.addRelation(source, target, kind); });
  }
  menu.showAtPosition(at);
}

function showRelationEditMenu(view: MindmapView, rel: EomeRelation,
  points: readonly RoutePoint[], event: MouseEvent, location: { x: number; y: number }): void {
  const menu = new Menu();
  for (const kind of RELATION_KINDS)
    addMenuItem(menu, 'Tipo: ' + LABELS[kind] + (kind === rel.kind ? ' ✓' : ''),
      () => { void view.changeRelationKind(rel.id, kind); });
  menu.addSeparator();
  const modes: Array<[RelationArrowMode, string]> = [
    ['none', 'Senza frecce'], ['start', 'Freccia all’origine'],
    ['end', 'Freccia alla destinazione'], ['both', 'Frecce a entrambe le estremità']
  ];
  for (const [mode, label] of modes)
    addMenuItem(menu, label, () => { void view.changeRelationArrow(rel.id, mode); });
  const fraction = fractionNearest(points, location.x, location.y);
  addMenuItem(menu, 'Freccia esattamente qui', () =>
    { void view.changeRelationArrow(rel.id, 'custom', fraction); });
  menu.addSeparator();
  addMenuItem(menu, 'Rimuovi solo il collegamento', () => { void view.removeRelation(rel.id); });
  menu.showAtMouseEvent(event);
}

function uniqueRenderedNodes(view: MindmapView): RouteNode[] {
  const file = view.file, cy = view.cy;
  if (!file || !cy) return [];
  const counts = new Map<string, number>();
  for (const node of view.getFlatNodes()) {
    const key = relationNodeKey(view.app, file, node);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const output: RouteNode[] = [];
  const wrapperRect = view.wrapper.getBoundingClientRect();
  for (const cyNode of cy.nodes()) {
    const node = cyNode.data('node') as OutlineNode | undefined;
    if (!node) continue;
    const key = relationNodeKey(view.app, file, node);
    // A duplicate text key would select arbitrary nodes. Do not draw it.
    if (counts.get(key) !== 1) continue;
    const pos = cyNode.renderedPosition();
    const dims = view.sizeMap.get(node.line) ?? { w: 100, h: 45 };
    const zoom = cy.zoom();
    const img = view.wrapper.querySelector<HTMLElement>(
      '.mindmap-overlay[data-node-line="' + node.line + '"] .markdown-rendered img');
    const bounds = img?.getBoundingClientRect();
    output.push({
      id: key,
      x: bounds ? bounds.left + bounds.width / 2 - wrapperRect.left : pos.x,
      y: bounds ? bounds.top + bounds.height / 2 - wrapperRect.top : pos.y,
      w: bounds?.width ?? dims.w * zoom,
      h: bounds?.height ?? dims.h * zoom,
    });
  }
  return output;
}

/** Shared path/arrow painting for the full editor and the read-only
 * Markdown code-block preview. The preview does not install hit controls. */
export function appendRelationGeometry(
  svg: SVGSVGElement, routes: RoutingResult, color: string
): void {
  const doc = svg.ownerDocument;
  for (const segment of routes.segments) {
    const line = doc.createElementNS(SVG, 'line');
    line.classList.add('eome-relation-line');
    line.setAttribute('x1', String(segment.a.x));
    line.setAttribute('y1', String(segment.a.y));
    line.setAttribute('x2', String(segment.b.x));
    line.setAttribute('y2', String(segment.b.y));
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '1.7');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
  }
  for (const route of routes.paths) {
    arrowShapes(svg, route.relation, route.points, color);
  }
}

/** A separate SVG layer renders only explicit pair relations. Dagre continues
 * to position nodes; legacy 0.2.8 links remain drawn by Cytoscape until the
 * user deliberately replaces that incoming relation.
 */
export function renderRelationsOverlay(view: MindmapView): void {
  if (!view.wrapper?.isConnected || !view.cy || view.cy.destroyed()) return;
  const previous = view.wrapper.querySelector<SVGSVGElement>('svg.eome-relations-layer');
  previous?.remove();
  if (!view.relations.length) return;
  const doc = view.wrapper.ownerDocument;
  const svg = doc.createElementNS(SVG, 'svg');
  svg.classList.add('eome-relations-layer');
  svg.setAttribute('aria-label', 'Collegamenti della mappa');
  svg.setAttribute('width', String(Math.max(1, view.wrapper.clientWidth)));
  svg.setAttribute('height', String(Math.max(1, view.wrapper.clientHeight)));
  svg.setAttribute('viewBox', '0 0 ' + Math.max(1, view.wrapper.clientWidth) + ' ' + Math.max(1, view.wrapper.clientHeight));
  const color = doc.defaultView?.getComputedStyle(view.wrapper).getPropertyValue('--text-normal').trim() || '#424242';
  const routes = routeRelations(uniqueRenderedNodes(view), view.relations);
  appendRelationGeometry(svg, routes, color);
  for (const route of routes.paths) {
    const hit = doc.createElementNS(SVG, 'path');
    hit.classList.add('eome-relation-hit');
    hit.setAttribute('d', pathData(route.points));
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '16');
    hit.setAttribute('pointer-events', 'stroke');
    hit.setAttribute('data-relation-id', route.relation.id);
    hit.addEventListener('click', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = view.wrapper.getBoundingClientRect();
      showRelationEditMenu(view, route.relation, route.points, event, {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    });
    svg.appendChild(hit);
  }
  // Node overlays use z-index 10+; the routes sit behind the handwriting.
  view.wrapper.appendChild(svg);
}
