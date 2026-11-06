import { normalizeRelations, type EomeRelation } from '../view/relations';
/**
 * Persistent identities live inside the fence, not in the host note heading
 * or a positional index. Appending metadata leaves existing outline line
 * offsets unchanged, including handwritten SVG attachment links.
 */
export const INLINE_MAPS_FIELD = 'eome-inline-maps-v1';
const MAP = /^<!-- eome-map-id: ([a-z0-9-]{8,64}) -->$/m;
const NODE = /<!-- eome-node-id: ([a-z0-9-]{8,64}) -->/;
const LIST = /^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/;

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
}

export function inlineMapId(source: string): string | null {
  return MAP.exec(source)?.[1] ?? null;
}
export function inlineNodeId(text: string): string | null {
  return NODE.exec(text)?.[1] ?? null;
}
/** Keep blank lines in place to preserve every OutlineNode.line. */
export function outlineWithoutMapMarker(source: string): string {
  return source.replace(MAP, '').replace(DATA, '');
}
export function stampInlineMap(source: string): { source: string; id: string } {
  const id = inlineMapId(source) ?? newId();
  const lines = source.replace(/\r\n/g, '\n').split('\n').filter((line, i, arr) =>
    !(i === arr.length - 1 && line === ''));
  const stamped = lines.map(line => {
    const match = LIST.exec(line);
    if (!match || NODE.test(line)) return line;
    return line + ' <!-- eome-node-id: ' + newId() + ' -->';
  });
  if (!inlineMapId(source)) stamped.push('<!-- eome-map-id: ' + id + ' -->');
  return { source: stamped.join('\n'), id };
}
/** Uniqueness is enforced by the node annotation, even for repeated labels. */
export function hasInlineNodeIdentity(text: string): boolean { return NODE.test(text); }

const DATA = /^<!-- eome-data-v1: (.+) -->$/m;
/** Encoded JSON cannot close its HTML comment or introduce outline lines. */
export function readInlineRelations(source: string): EomeRelation[] | null {
  const match = DATA.exec(source);
  if (!match) return null;
  const parsed = JSON.parse(decodeURIComponent(match[1]));
  if (!Array.isArray(parsed)) throw new Error('Dati EOME del blocco non validi');
  const relations = normalizeRelations(parsed);
  if (relations.length !== parsed.length) throw new Error('Relazioni EOME del blocco non valide');
  return relations;
}
export function writeInlineRelations(source: string, relations: EomeRelation[]): string {
  const marker = '<!-- eome-data-v1: ' + encodeURIComponent(JSON.stringify(relations)) + ' -->';
  return DATA.test(source) ? source.replace(DATA, () => marker) : source + '\n' + marker;
}
