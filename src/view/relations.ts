import { Notice, type App, type TFile } from 'obsidian';
import type { OutlineNode } from '../utils/outline';
import { extractDrawingLink } from '../drawing/drawing-link';

export type RelationKind = 'figlio' | 'conseguenza' | 'dettaglio' | 'causa' | 'trasversale';
export type RelationGeometry = 'horizontal' | 'elbow';
export type RelationArrowMode = 'none' | 'start' | 'end' | 'both' | 'custom';
export interface EomeRelation {
  id: string;
  source: string;
  target: string;
  kind: RelationKind;
  arrow: RelationArrowMode;
  arrowAt?: number;
}
export const RELATIONS_FIELD = 'eome-relations-v1';
export const RELATION_KINDS: readonly RelationKind[] = ['figlio', 'conseguenza', 'dettaglio', 'causa', 'trasversale'];
const modes = new Set<string>(['none', 'start', 'end', 'both', 'custom']);
const kinds = new Set<string>(RELATION_KINDS);

export function relationGeometry(kind: RelationKind): RelationGeometry {
  return kind === 'dettaglio' || kind === 'causa' || kind === 'trasversale' ? 'elbow' : 'horizontal';
}

/** File-path identity survives Markdown reordering and outline indentation.
 * Plain-text nodes use their content; identical text nodes cannot be linked
 * unambiguously and must first be given unique labels or SVG attachments.
 */
export function relationNodeKey(app: App, file: TFile, node: OutlineNode): string {
  const link = extractDrawingLink(node.text);
  if (link) {
    // Use the literal embed identity: Obsidian's link resolver can lag after
    // creating an SVG, which would otherwise change the key after first save.
    // This survives Markdown reordering; explicit rename migration is future work.
    return 'svg:' + link.trim();
  }
  return 'text:' + node.text.trim();
}

export function normalizeRelations(value: unknown): EomeRelation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: EomeRelation[] = [];
  for (const item of value.slice(0, 2000)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const v = item as Record<string, unknown>;
    if (typeof v.id !== 'string' || v.id.length > 160 || !v.id ||
        typeof v.source !== 'string' || v.source.length > 1024 ||
        typeof v.target !== 'string' || v.target.length > 1024 ||
        !kinds.has(String(v.kind)) || !modes.has(String(v.arrow))) continue;
    if (!v.source || !v.target || v.source === v.target || seen.has(v.id)) continue;
    const rel: EomeRelation = {
      id: v.id, source: v.source, target: v.target,
      kind: v.kind as RelationKind,
      arrow: v.arrow as RelationArrowMode
    };
    if (rel.arrow === 'custom' && typeof v.arrowAt === 'number' && Number.isFinite(v.arrowAt))
      rel.arrowAt = Math.min(0.97, Math.max(0.03, v.arrowAt));
    seen.add(rel.id);
    result.push(rel);
  }
  return result;
}

/** Presence of an empty relation array marks a new-style map with intentionally
 * no lines. Legacy maps have no field, keeping their 0.2.8 presentation. */
export function hasExplicitRelationSchema(app: App, file: TFile): boolean {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  return !!frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, RELATIONS_FIELD);
}

export function readRelations(app: App, file: TFile): EomeRelation[] {
  return normalizeRelations(app.metadataCache.getFileCache(file)?.frontmatter?.[RELATIONS_FIELD]);
}

export function findRelationForPair(relations: readonly EomeRelation[], source: string, target: string): EomeRelation | undefined {
  return relations.find((rel) => rel.source === source && rel.target === target);
}

export function createOrUpdateRelation(relations: readonly EomeRelation[], source: string,
  target: string, kind: RelationKind, arrow?: RelationArrowMode): EomeRelation[] {
  if (source === target) return [...relations];
  const existing = findRelationForPair(relations, source, target);
  if (existing) return relations.map((rel) => rel.id === existing.id ?
    { ...rel, kind, ...(arrow ? { arrow, arrowAt: undefined } : {}) } : rel);
  const id = 'rel-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
  return [...relations, { id, source, target, kind, arrow: arrow ?? 'none' }];
}

export function setRelationArrow(relations: readonly EomeRelation[], id: string,
  mode: RelationArrowMode, at?: number): EomeRelation[] {
  return relations.map(rel => rel.id === id ? {
    ...rel, arrow: mode,
    ...(mode === 'custom' ? { arrowAt: Math.min(0.97, Math.max(0.03, at ?? 0.5)) } : { arrowAt: undefined })
  } : rel);
}

/** One transaction per note, performed through Obsidian's frontmatter API.
 * The callback reconciles the latest stored copy, so edits from another
 * feature (zoom, settings, arrows) do not overwrite unrelated YAML keys.
 */
export async function persistRelations(app: App, file: TFile, relations: EomeRelation[]): Promise<void> {
  if (typeof app.fileManager.processFrontMatter !== 'function') {
    new Notice('Per salvare le relazioni occorre una versione aggiornata di Obsidian.');
    throw new Error('processFrontMatter not available');
  }
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    frontmatter[RELATIONS_FIELD] = relations.map(r => ({
      id: r.id, source: r.source, target: r.target, kind: r.kind,
      arrow: r.arrow, ...(r.arrow === 'custom' ? { arrowAt: r.arrowAt ?? 0.5 } : {})
    }));
  });
}
