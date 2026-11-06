import type { RouteNode } from '../view/relations-routing';

export interface SummaryGroup {
  id: string;
  members: string[];
  target: string;
  side: 'left' | 'right';
}
export const SUMMARY_MARKER = /^<!-- eome-summaries-v1: (.+) -->$/m;
export function readSummaryGroups(source: string): SummaryGroup[] {
  const match = SUMMARY_MARKER.exec(source);
  if (!match) return [];
  const value: unknown = JSON.parse(decodeURIComponent(match[1]));
  if (!Array.isArray(value) || value.some(g => !g || typeof g.id !== 'string' ||
    typeof g.target !== 'string' || !Array.isArray(g.members) || g.members.length < 2 ||
    g.members.some((m: unknown) => typeof m !== 'string' || m === g.target) ||
    new Set(g.members).size !== g.members.length || !['left', 'right'].includes(g.side))) {
    throw new Error('Gruppi riassuntivi EOME non validi');
  }
  return value;
}
export function writeSummaryGroups(source: string, groups: SummaryGroup[]): string {
  const marker = '<!-- eome-summaries-v1: ' + encodeURIComponent(JSON.stringify(groups)) + ' -->';
  return SUMMARY_MARKER.test(source) ? source.replace(SUMMARY_MARKER, () => marker) : source + '\n' + marker;
}
export function groupBounds(nodes: RouteNode[]): { left: number; right: number; top: number; bottom: number } | null {
  if (!nodes.length) return null;
  return {
    left: Math.min(...nodes.map(n => n.x - n.w / 2)),
    right: Math.max(...nodes.map(n => n.x + n.w / 2)),
    top: Math.min(...nodes.map(n => n.y - n.h / 2)),
    bottom: Math.max(...nodes.map(n => n.y + n.h / 2))
  };
}
/** One brace and one connector; coordinates are model units so all ink scales together. */
export function summaryGeometry(group: SummaryGroup, nodes: RouteNode[]): string | null {
  const lookup = new Map(nodes.map(n => [n.id, n]));
  const members = group.members.map(id => lookup.get(id));
  const target = lookup.get(group.target);
  if (!target || members.some(n => !n)) return null;
  const b = groupBounds(members as RouteNode[])!;
  const sign = group.side === 'right' ? 1 : -1;
  const edge = group.side === 'right' ? b.right : b.left;
  const x = edge + sign * 24, tip = x + sign * 18;
  const mid = (b.top + b.bottom) / 2, bend = Math.min(12, (b.bottom - b.top) / 4);
  const end = target.x - sign * target.w / 2 - sign * 6;
  return `M ${x} ${b.top} Q ${tip} ${b.top} ${tip} ${b.top + bend} L ${tip} ${mid - bend} Q ${tip} ${mid} ${tip + sign * 12} ${mid} Q ${tip} ${mid} ${tip} ${mid + bend} L ${tip} ${b.bottom - bend} Q ${tip} ${b.bottom} ${x} ${b.bottom} M ${tip + sign * 12} ${mid} L ${end} ${mid} L ${end} ${target.y}`;
}
export function pointInLasso(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function layoutSummaryNodes(nodes: RouteNode[], groups: SummaryGroup[]): RouteNode[] {
  const result = nodes.map(n => ({ ...n }));
  const lookup = new Map(result.map(n => [n.id, n]));
  // Creation order allows a later summary to collect previous summaries.
  for (const group of groups) {
    const members = group.members.map(id => lookup.get(id));
    const target = lookup.get(group.target);
    if (!target || members.some(n => !n)) continue;
    const b = groupBounds(members as RouteNode[])!;
    const sign = group.side === 'right' ? 1 : -1;
    target.y = (b.top + b.bottom) / 2;
    target.x = (sign === 1 ? b.right : b.left) + sign * (110 + target.w / 2);
    for (let attempt = 0; attempt < result.length; attempt++) {
      const collision = result.find(n => n.id !== target.id &&
        Math.abs(n.x - target.x) < (n.w + target.w) / 2 + 24 &&
        Math.abs(n.y - target.y) < (n.h + target.h) / 2 + 24);
      if (!collision) break;
      target.x = collision.x + sign * ((collision.w + target.w) / 2 + 48);
    }
  }
  return result;
}
