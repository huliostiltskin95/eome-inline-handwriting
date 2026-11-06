import { describe, expect, it } from 'vitest';
import { layoutRelationNodes } from '../src/view/relations-layout';
import { routeRelations } from '../src/view/relations-routing';
import type { EomeRelation } from '../src/view/relations';
const nodes = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, x: i * 200, y: 80, w: 120, h: 50 }));
const relation = (source: string, target: string, kind: EomeRelation['kind']): EomeRelation =>
  ({ id: source + target, source, target, kind, arrow: 'none' });
describe('semantic node placement', () => {
  it('places the screenshot chain below each preceding node with one L corner', () => {
    const links = [relation('a', 'b', 'figlio'), relation('b', 'c', 'dettaglio'), relation('c', 'd', 'causa')];
    const placed = layoutRelationNodes(nodes, links);
    expect(placed[1].y).toBe(placed[0].y);
    for (const i of [2, 3]) {
      expect(placed[i].y - placed[i].h / 2).toBeGreaterThan(placed[i - 1].y + placed[i - 1].h / 2);
      expect(placed[i].x - placed[i].w / 2).toBeGreaterThan(placed[i - 1].x);
    }
    const routed = routeRelations(placed, links).paths;
    expect(routed[0].points[0]).toEqual({
      x: placed[0].x + placed[0].w / 2, y: placed[0].y
    });
    expect(routed[0].points.at(-1)).toEqual({
      x: placed[1].x - placed[1].w / 2, y: placed[1].y
    });
    for (const [offset, path] of routed.slice(1).entries()) {
      const parent = placed[offset + 1], detail = placed[offset + 2];
      expect(path.points[0]).toEqual({ x: parent.x, y: parent.y + parent.h / 2 });
      expect(path.points.at(-1)).toEqual({ x: detail.x - detail.w / 2, y: detail.y });
      expect(path.points).toHaveLength(3);
      expect(path.points[0].x).toBe(path.points[1].x);
      expect(path.points[1].y).toBe(path.points[2].y);
      expect(path.points[1].y).toBeGreaterThan(path.points[0].y);
      expect(path.points[2].x).toBeGreaterThan(path.points[1].x);
    }
  });
  it('reserves subtrees so multiple details do not overlap', () => {
    const placed = layoutRelationNodes(nodes, [relation('a','b','dettaglio'), relation('a','c','causa'), relation('b','d','dettaglio')]);
    expect(placed[2].y - 25).toBeGreaterThan(placed[3].y + 25);
  });
  it('handles cycles and cross-links without moving a node twice', () => {
    const links = [relation('a','b','dettaglio'), relation('b','a','causa'), relation('c','b','trasversale')];
    const placed = layoutRelationNodes(nodes, links);
    expect(placed.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect(layoutRelationNodes(placed, links)).toEqual(placed);
  });
  it('preserves legacy layouts without structural relations', () => {
    expect(layoutRelationNodes(nodes, [])).toEqual(nodes);
  });
});
