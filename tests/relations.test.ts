import { describe, expect, it } from 'vitest';
import {
  relationGeometry, normalizeRelations, createOrUpdateRelation,
  findRelationForPair, setRelationArrow, type EomeRelation
} from '../src/view/relations';
import {
  routeRelations, atFraction, fractionNearest, polylineLength
} from '../src/view/relations-routing';

const sample = (kind: EomeRelation['kind'], source = 'svg:NOTA.svg', target = 'svg:ARG.svg'): EomeRelation => ({
  id: 'r1', source, target, kind, arrow: 'none'
});

describe('explicit semantic relation model', () => {
  it('keeps geometry independent of Dagre rank and Markdown nesting', () => {
    expect(relationGeometry('figlio')).toBe('horizontal');
    expect(relationGeometry('conseguenza')).toBe('horizontal');
    expect(relationGeometry('dettaglio')).toBe('elbow');
    expect(relationGeometry('causa')).toBe('elbow');
  });

  it('stores chosen initial arrow in the same relation transaction', () => {
    const first = createOrUpdateRelation([], 'svg:a.svg', 'svg:b.svg', 'figlio', 'end');
    expect(first[0]).toMatchObject({ kind: 'figlio', arrow: 'end' });
    const changed = createOrUpdateRelation(first, 'svg:a.svg', 'svg:b.svg', 'dettaglio', 'start');
    expect(changed[0]).toMatchObject({ id: first[0].id, kind: 'dettaglio', arrow: 'start' });
  });

  it('preserves explicit pair IDs when changing semantic kind', () => {
    const first = createOrUpdateRelation([], 'svg:a.svg', 'svg:b.svg', 'figlio');
    const second = createOrUpdateRelation(first, 'svg:a.svg', 'svg:b.svg', 'causa');
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].kind).toBe('causa');
    expect(findRelationForPair(second, 'svg:a.svg', 'svg:b.svg')?.kind).toBe('causa');
  });

  it('keeps distinct relationships between the same source and two targets', () => {
    let list = createOrUpdateRelation([], 'svg:a.svg', 'svg:b.svg', 'figlio');
    list = createOrUpdateRelation(list, 'svg:a.svg', 'svg:c.svg', 'dettaglio');
    expect(list).toHaveLength(2);
    expect(new Set(list.map(r => r.id)).size).toBe(2);
  });

  it('rejects malformed YAML data and clamps custom arrow positions', () => {
    const list = normalizeRelations([
      { id: 'a', source: 'svg:s', target: 'svg:t', kind: 'causa', arrow: 'custom', arrowAt: 1.2 },
      { id: 'b', source: 'svg:s', target: 'svg:s', kind: 'figlio', arrow: 'none' },
      { id: 'c', source: 'svg:s', target: 'svg:t', kind: 'invalid', arrow: 'none' },
      { id: 'a', source: 'svg:s', target: 'svg:q', kind: 'figlio', arrow: 'none' },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].arrowAt).toBe(0.97);
  });

  it('offers freely positioned arrows without altering semantic geometry', () => {
    const first = sample('dettaglio');
    const after = setRelationArrow([first], 'r1', 'custom', 0.37)[0];
    expect(after).toMatchObject({ kind: 'dettaglio', arrow: 'custom', arrowAt: 0.37 });
    expect(setRelationArrow([after], 'r1', 'both')[0]).toMatchObject({
      kind: 'dettaglio', arrow: 'both', arrowAt: undefined
    });
  });
});

describe('routing mode compatibility', () => {
  it('distinguishes legacy notes from notes with an explicit empty schema', async () => {
    const { hasExplicitRelationSchema } = await import('../src/view/relations');
    const file = { path: 'sample.md' } as never;
    const makeApp = (frontmatter: Record<string, unknown>) => ({
      metadataCache: { getFileCache: () => ({ frontmatter }) }
    }) as never;
    expect(hasExplicitRelationSchema(makeApp({}), file)).toBe(false);
    expect(hasExplicitRelationSchema(makeApp({ 'eome-relations-v1': [] }), file)).toBe(true);
  });
});

describe('side-of-handwriting attachment', () => {
  it('starts and finishes parallel connections outside the visible SVG', async () => {
    const { routeRelations } = await import('../src/view/relations-routing');
    const nodes = [
      { id: 'a', x: 50, y: 80, w: 60, h: 30 },
      { id: 'b', x: 210, y: 80, w: 80, h: 30 }
    ];
    const route = routeRelations(nodes, [{
      id: 'ab', source: 'a', target: 'b', kind: 'figlio', arrow: 'end'
    }]).paths[0];
    expect(route.points).toHaveLength(2);
    expect(route.points[0].x).toBe(80);
    expect(route.points[1].x).toBe(170);
    expect(route.points.every(p => p.y === 80)).toBe(true);
  });

  it('uses a visible elbow rather than a straight line for details on the same row', async () => {
    const { routeRelations } = await import('../src/view/relations-routing');
    const paths = routeRelations([
      { id: 'a', x: 50, y: 80, w: 60, h: 30 },
      { id: 'b', x: 210, y: 80, w: 80, h: 30 }
    ], [{ id: 'ab', source: 'a', target: 'b', kind: 'dettaglio', arrow: 'none' }]).paths;
    expect(paths[0].geometry).toBe('elbow');
    expect(paths[0].points.length).toBeGreaterThanOrEqual(4);
    expect(paths[0].points.some(p => p.y !== 80)).toBe(true);
  });
});

describe('orthogonal routing for pair relationships', () => {
  const nodes = [
    { id: 'svg:NOTA.svg', x: 30, y: 100, w: 60, h: 24 },
    { id: 'svg:ARG.svg', x: 240, y: 30, w: 72, h: 24 },
    { id: 'svg:ARG2.svg', x: 240, y: 100, w: 72, h: 24 },
    { id: 'svg:ARG3.svg', x: 240, y: 170, w: 72, h: 24 },
    { id: 'svg:DET.svg', x: 410, y: 240, w: 70, h: 24 }
  ];

  it('merges a shared parent stem into one physical segment', () => {
    const relations = [
      sample('figlio', 'svg:NOTA.svg', 'svg:ARG.svg'),
      { ...sample('figlio', 'svg:NOTA.svg', 'svg:ARG2.svg'), id: 'r2' },
      { ...sample('conseguenza', 'svg:NOTA.svg', 'svg:ARG3.svg'), id: 'r3' }
    ];
    const routed = routeRelations(nodes, relations);
    expect(routed.paths).toHaveLength(3);
    expect(routed.paths.every(p => p.geometry === 'horizontal')).toBe(true);
    const trunkX = routed.paths[0].points[1].x;
    expect(routed.paths.every(p => p.points[1].x === trunkX)).toBe(true);
    const vertical = routed.segments.filter(s => Math.abs(s.a.x - s.b.x) < 0.01
      && Math.abs(s.a.x - trunkX) < 0.01);
    expect(vertical).toHaveLength(1);
    expect(vertical[0].a.y).toBeLessThanOrEqual(30);
    expect(vertical[0].b.y).toBeGreaterThanOrEqual(170);
  });

  it('renders a detail as a single right-angle elbow', () => {
    const result = routeRelations(nodes, [sample('dettaglio', 'svg:ARG3.svg', 'svg:DET.svg')]);
    const pts = result.paths[0].points;
    expect(pts).toHaveLength(3);
    expect(pts[0].x === pts[1].x || pts[0].y === pts[1].y).toBe(true);
    expect(pts[1].x === pts[2].x || pts[1].y === pts[2].y).toBe(true);
  });

  it('keeps semantic directions when nodes are visually reordered', () => {
    const rel = sample('causa', 'svg:DET.svg', 'svg:ARG.svg');
    const first = routeRelations(nodes, [rel]);
    const reordered = routeRelations([...nodes].reverse(), [rel]);
    expect(first.paths[0].relation).toEqual(reordered.paths[0].relation);
  });

  it('finds a free arrow position on a selected path', () => {
    const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(polylineLength(path)).toBe(200);
    expect(fractionNearest(path, 100, 50)).toBeCloseTo(0.75, 5);
    const samplePoint = atFraction(path, 0.75);
    expect(samplePoint.point).toMatchObject({ x: 100, y: 50 });
    expect(samplePoint.tangent).toMatchObject({ x: 0, y: 1 });
  });
});
