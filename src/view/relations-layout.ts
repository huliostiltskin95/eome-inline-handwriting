import type { Core } from 'cytoscape';
import type { OutlineNode } from '../utils/outline';
import type { EomeRelation } from './relations';
import type { RouteNode } from './relations-routing';

/** Explicit relations choose direction, not Markdown indentation. The first
 * incoming structural relation owns placement; cross-links and cycles only draw. */
export function layoutRelationNodes(nodes: RouteNode[], relations: readonly EomeRelation[]): RouteNode[] {
  const result = nodes.map(n => ({ ...n }));
  const indexed = new Map(result.map(n => [n.id, n]));
  const parents = new Map<string, string>();
  const children = new Map<string, EomeRelation[]>();
  for (const rel of relations) {
    if (rel.kind === 'trasversale' || rel.source === rel.target || parents.has(rel.target)
      || !indexed.has(rel.source) || !indexed.has(rel.target)) continue;
    let ancestor: string | undefined = rel.source;
    while (ancestor && ancestor !== rel.target) ancestor = parents.get(ancestor);
    if (ancestor === rel.target) continue;
    parents.set(rel.target, rel.source);
    const list = children.get(rel.source) ?? [];
    list.push(rel);
    children.set(rel.source, list);
  }
  if (!parents.size) return result;
  const gap = 60;
  const place = (node: RouteNode, left: number, top: number): number => {
    node.x = left + node.w / 2;
    node.y = top + node.h / 2;
    let bottom = top + node.h;
    let rightTop = top;
    // Reserve complete horizontal subtrees before stacking details beneath them.
    const links = children.get(node.id) ?? [];
    for (const rel of links.filter(r => r.kind === 'figlio' || r.kind === 'conseguenza')) {
      const child = indexed.get(rel.target)!;
      const childTop = Math.max(rightTop, node.y - child.h / 2);
      const end = place(child, left + node.w + gap, childTop);
      rightTop = end + gap;
      bottom = Math.max(bottom, end);
    }
    for (const rel of links.filter(r => r.kind === 'dettaglio' || r.kind === 'causa')) {
      const child = indexed.get(rel.target)!;
      bottom = place(child, left + 60, bottom + gap);
    }
    return bottom;
  };
  const left = Math.min(...result.map(n => n.x - n.w / 2));
  let top = Math.min(...result.map(n => n.y - n.h / 2));
  for (const root of result.filter(n => !parents.has(n.id))) top = place(root, left, top) + gap;
  return result;
}

export function arrangeRelationNodes(cy: Core, sizes: Map<number, { w: number; h: number }>,
  relations: readonly EomeRelation[], keyFor: (node: OutlineNode) => string): void {
  if (!relations.length) return;
  const entries = cy.nodes().map(n => ({ element: n, outline: n.data('node') as OutlineNode }));
  const counts = new Map<string, number>();
  for (const { outline } of entries) {
    if (outline) { const key = keyFor(outline); counts.set(key, (counts.get(key) ?? 0) + 1); }
  }
  const mapped = entries.filter(e => e.outline).map(({ element, outline }) => ({
    element, id: counts.get(keyFor(outline)) === 1 ? keyFor(outline) : `duplicate:${element.id()}`,
    ...element.position(), ...(sizes.get(outline.line) ?? { w: 100, h: 40 })
  }));
  const positions = layoutRelationNodes(mapped, relations);
  positions.forEach((pos, i) => mapped[i].element.position({ x: pos.x, y: pos.y }));
}
