import type { EomeRelation, RelationGeometry } from './relations';

export interface RouteNode { id: string; x: number; y: number; w: number; h: number }
export interface RoutePoint { x: number; y: number }
export interface RoutedRelation {
  relation: EomeRelation;
  geometry: RelationGeometry;
  points: RoutePoint[];
}
export interface RouteSegment { a: RoutePoint; b: RoutePoint }
export interface RoutingResult { paths: RoutedRelation[]; segments: RouteSegment[] }

const round = (value: number): number => Math.round(value * 2) / 2;
const point = (x: number, y: number): RoutePoint => ({ x: round(x), y: round(y) });
const dist = (a: RoutePoint, b: RoutePoint): number => Math.hypot(b.x - a.x, b.y - a.y);
const same = (a: RoutePoint, b: RoutePoint): boolean => a.x === b.x && a.y === b.y;

export function polylineLength(points: readonly RoutePoint[]): number {
  return points.slice(1).reduce((total, p, i) => total + dist(points[i], p), 0);
}

export function atFraction(points: readonly RoutePoint[], fraction: number): { point: RoutePoint; tangent: RoutePoint } {
  const total = polylineLength(points);
  if (!points.length) return { point: point(0, 0), tangent: point(1, 0) };
  if (points.length === 1 || total === 0) return { point: points[0], tangent: point(1, 0) };
  let left = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], len = dist(a, b);
    if (len <= 0.01) continue;
    if (left <= len || i === points.length - 1)
      return { point: point(a.x + (b.x - a.x) * left / len, a.y + (b.y - a.y) * left / len),
        tangent: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
    left -= len;
  }
  return { point: points[points.length - 1], tangent: point(1, 0) };
}

/** Fraction of the nearest point on a polyline. Used to place arrows at the
 * exact location tapped with Pencil, even when the route shares a stem. */
export function fractionNearest(points: readonly RoutePoint[], x: number, y: number): number {
  const total = polylineLength(points);
  if (!total) return 0.5;
  let traversed = 0, best = Infinity, bestAt = 0.5;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = dist(a, b);
    if (!length) continue;
    const t = Math.max(0, Math.min(1,
      ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (length * length)));
    const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < best) { best = d; bestAt = (traversed + t * length) / total; }
    traversed += length;
  }
  return bestAt;
}

function crossesObstacle(a: RoutePoint, b: RoutePoint, obstacle: RouteNode): boolean {
  const margin = 7;
  const left = obstacle.x - obstacle.w / 2 - margin;
  const right = obstacle.x + obstacle.w / 2 + margin;
  const top = obstacle.y - obstacle.h / 2 - margin;
  const bottom = obstacle.y + obstacle.h / 2 + margin;
  if (Math.abs(a.y - b.y) < 1) {
    return a.y > top && a.y < bottom && Math.min(a.x, b.x) < right && Math.max(a.x, b.x) > left;
  }
  if (Math.abs(a.x - b.x) < 1) {
    return a.x > left && a.x < right && Math.min(a.y, b.y) < bottom && Math.max(a.y, b.y) > top;
  }
  return true;
}

function pathCost(points: readonly RoutePoint[], obstacles: RouteNode[]): number {
  let cost = 0;
  for (let i = 1; i < points.length; i++)
    for (const obstacle of obstacles)
      if (crossesObstacle(points[i - 1], points[i], obstacle)) cost++;
  return cost;
}

/** Penalize crossings against previously routed connections, but permit
 * segments that only meet at a shared endpoint. This is a stable, bounded
 * greedy optimization, not an expensive all-pairs graph search.
 */
function intersectionPenalty(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint): number {
  const ah = Math.abs(a.y - b.y) < 0.75;
  const bh = Math.abs(c.y - d.y) < 0.75;
  if (ah !== bh) {
    const h1 = ah ? a : c, h2 = ah ? b : d;
    const v1 = ah ? c : a, v2 = ah ? d : b;
    const x = v1.x, y = h1.y;
    const innerH = x > Math.min(h1.x, h2.x) + 0.75 && x < Math.max(h1.x, h2.x) - 0.75;
    const innerV = y > Math.min(v1.y, v2.y) + 0.75 && y < Math.max(v1.y, v2.y) - 0.75;
    return innerH && innerV ? 1 : 0;
  }
  if (ah && Math.abs(a.y - c.y) < 0.75) {
    const overlap = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
      - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
    return overlap > 1 ? 0.15 : 0;
  }
  if (!ah && Math.abs(a.x - c.x) < 0.75) {
    const overlap = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
      - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
    return overlap > 1 ? 0.15 : 0;
  }
  return 0;
}

function routeScore(points: RoutePoint[], obstacles: RouteNode[], routed: readonly RoutedRelation[]): number {
  let crossings = 0;
  for (let i = 1; i < points.length; i++) {
    for (const route of routed) for (let j = 1; j < route.points.length; j++)
      crossings += intersectionPenalty(points[i - 1], points[i], route.points[j - 1], route.points[j]);
  }
  return pathCost(points, obstacles) * 10000 + crossings * 550
    + Math.max(0, points.length - 2) * 5 + polylineLength(points) * 0.015;
}

function chooseRoute(options: RoutePoint[][], obstacles: RouteNode[],
  routed: readonly RoutedRelation[]): RoutePoint[] {
  return options.reduce((best, candidate) =>
    routeScore(candidate, obstacles, routed) < routeScore(best, obstacles, routed)
      ? candidate : best);
}

/**
 * Endpoint anchors sit just outside the visible handwriting, never at the
 * centre of the glyph. A small buffer avoids arrowheads touching ink.
 */
export function sideAnchors(source: RouteNode, target: RouteNode): { start: RoutePoint; end: RoutePoint } {
  const toRight = target.x >= source.x;
  return {
    start: point(source.x + (toRight ? 1 : -1) * (source.w / 2 + 7), source.y),
    end: point(target.x - (toRight ? 1 : -1) * (target.w / 2 + 7), target.y)
  };
}

function elbow(a: RoutePoint, b: RoutePoint, obstacles: RouteNode[]): RoutePoint[] {
  if (Math.abs(a.x - b.x) < 1) return [a, b];
  if (Math.abs(a.y - b.y) < 1) {
    // A genuine one-corner L requires a height difference. When Dagre puts
    // two nodes on the same row, use a small orthogonal detour rather than
    // allowing the "detail/cause" relationship to look horizontal.
    const gap = 24;
    const mid = point((a.x + b.x) / 2, a.y);
    const up = [a, mid, point(mid.x, a.y - gap), point(b.x, a.y - gap), b];
    const down = [a, mid, point(mid.x, a.y + gap), point(b.x, a.y + gap), b];
    return pathCost(up, obstacles) <= pathCost(down, obstacles) ? up : down;
  }
  const horizontalFirst = [a, point(b.x, a.y), b];
  const verticalFirst = [a, point(a.x, b.y), b];
  return pathCost(horizontalFirst, obstacles) <= pathCost(verticalFirst, obstacles)
    ? horizontalFirst : verticalFirst;
}

function sharedStemX(source: RouteNode, children: RouteNode[], obstacles: RouteNode[]): number {
  const faces = children.map(child => sideAnchors(source, child));
  const origin = faces[0].start.x;
  const nearest = faces.reduce((best, face) =>
    Math.abs(face.end.x - origin) < Math.abs(best - origin) ? face.end.x : best,
    faces[0].end.x);
  const room = nearest - origin;
  if (Math.abs(room) < 36) return round((nearest + origin) / 2);
  const candidates = [0.27, 0.38, 0.5, 0.62].map(t => round(origin + t * room));
  let best = candidates[0], bestCost = Infinity;
  for (const x of candidates) {
    const stroke = [point(x, Math.min(source.y, ...children.map(n => n.y))),
      point(x, Math.max(source.y, ...children.map(n => n.y)))];
    const cost = pathCost(stroke, obstacles);
    if (cost < bestCost) { best = x; bestCost = cost; }
  }
  return best;
}

function mergedSegments(paths: readonly RoutedRelation[]): RouteSegment[] {
  const groups = new Map<string, Array<[number, number]>>();
  for (const route of paths) for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i];
    if (same(a, b)) continue;
    const vertical = Math.abs(a.x - b.x) < 0.75;
    const fixed = vertical ? round(a.x) : round(a.y);
    const first = vertical ? a.y : a.x, last = vertical ? b.y : b.x;
    const key = (vertical ? 'v:' : 'h:') + fixed;
    const list = groups.get(key) ?? [];
    list.push([Math.min(first, last), Math.max(first, last)]);
    groups.set(key, list);
  }
  const segments: RouteSegment[] = [];
  for (const [key, list] of groups) {
    const vertical = key.startsWith('v:');
    const fixed = Number(key.slice(2));
    list.sort((a, b) => a[0] - b[0]);
    let min = list[0][0], max = list[0][1];
    const push = () => segments.push({
      a: vertical ? point(fixed, min) : point(min, fixed),
      b: vertical ? point(fixed, max) : point(max, fixed)
    });
    for (const [lo, hi] of list.slice(1)) {
      if (lo <= max + 0.75) max = Math.max(max, hi);
      else { push(); min = lo; max = hi; }
    }
    push();
  }
  return segments;
}

/** Route explicit pair relations, not a derived Markdown tree. Multiple
 * horizontal descendants of one source share a single orthogonal stem. The
 * geometric segments are merged, but each relationship keeps its own ID and
 * independent arrow position.
 */
export function routeRelations(nodes: readonly RouteNode[], relations: readonly EomeRelation[]): RoutingResult {
  const indexed = new Map(nodes.map(n => [n.id, n]));
  const valid = relations.filter(r => indexed.has(r.source) && indexed.has(r.target) && r.source !== r.target);
  const stems = new Map<string, number>();
  const groups = new Map<string, RouteNode[]>();
  for (const rel of valid) {
    if (rel.kind !== 'figlio' && rel.kind !== 'conseguenza') continue;
    const items = groups.get(rel.source) ?? [];
    const target = indexed.get(rel.target)!;
    if (!items.some(n => n.id === target.id)) items.push(target);
    groups.set(rel.source, items);
  }
  for (const [id, items] of groups) {
    const source = indexed.get(id)!;
    if (items.length > 1 || items.some(n => Math.abs(n.y - source.y) > 2))
      stems.set(id, sharedStemX(source, items, nodes.filter(n => n.id !== id && !items.some(child => child.id === n.id))));
  }
  const paths: RoutedRelation[] = [];
  for (const relation of valid) {
    const source = indexed.get(relation.source)!, target = indexed.get(relation.target)!;
    const { start: a, end: b } = sideAnchors(source, target);
    const obstacles = nodes.filter(n => n.id !== source.id && n.id !== target.id);
    const geometry = relation.kind === 'figlio' || relation.kind === 'conseguenza' ? 'horizontal' : 'elbow';
    let points: RoutePoint[];
    if (geometry === 'horizontal') {
      const stem = stems.get(relation.source);
      // The visible link always leaves and enters horizontally at the outer
      // side of the SVG. When rows differ, one shared vertical stem joins
      // horizontal exits and never crosses the written words.
      if (stem !== undefined) {
        points = [a, point(stem, a.y), point(stem, b.y), b];
      } else if (Math.abs(a.y - b.y) < 1) {
        points = [a, b];
      } else {
        const options = [0.27, 0.38, 0.5, 0.62, 0.73].map(fraction => {
          const x = round(a.x + (b.x - a.x) * fraction);
          return [a, point(x, a.y), point(x, b.y), b];
        });
        points = chooseRoute(options, obstacles, paths);
      }
    } else {
      // A detail leaves the bottom of its source, descends, then turns
      // once into the left side of the indented node below.
      if ((relation.kind === 'dettaglio' || relation.kind === 'causa')
        && target.y - target.h / 2 > source.y + source.h / 2) {
        const start = point(source.x - source.w / 2 + 20, source.y + source.h / 2 + 7);
        const end = point(target.x - target.w / 2 - 7, target.y);
        // A detail must descend first and then turn *right* into the
        // indented child; choose only anchors left of its entry point.
        const starts = [12, 20, 28, 36].map(offset =>
          point(source.x - source.w / 2 + offset,
            source.y + source.h / 2 + 7))
          .filter(candidate => candidate.x < end.x - 5);
        if (!starts.length)
          starts.push(point(Math.min(end.x - 8, source.x - source.w / 2 + 12),
            source.y + source.h / 2 + 7));
        points = chooseRoute(starts.map(s => [s, point(s.x, end.y), end]), obstacles, paths);
      } else {
        // Search both orthogonal orientations against *all* earlier routes.
        // Retain the legacy detour for aligned endpoints.
        points = Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1
          ? elbow(a, b, obstacles)
          : chooseRoute([[a, point(a.x, b.y), b], [a, point(b.x, a.y), b]], obstacles, paths);
      }
    }
    points = points.filter((p, i) => i === 0 || !same(p, points[i - 1]));
    paths.push({ relation, geometry, points });
  }
  return { paths, segments: mergedSegments(paths) };
}
