import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', async importOriginal => ({
  ...await importOriginal<typeof import('./obsidian-mock')>(),
  // JSON is also YAML; fixtures use this subset for the native API boundary.
  parseYaml: JSON.parse,
  stringifyYaml: JSON.stringify,
}));
import { TFile } from 'obsidian';
vi.mock('../src/drawing/drawing-modal', () => ({ openDrawingModal: vi.fn() }));
import { openDrawingModal } from '../src/drawing/drawing-modal';
import { readSummaryGroups } from '../src/embeds/summary-groups';
import { changeInlineArrow, addInlineDrawing, createInlineSummary } from '../src/embeds/inline-eome-actions';
import { inlineMapId, readInlineRelations, stampInlineMap, writeInlineRelations, outlineWithoutMapMarker } from '../src/embeds/inline-eome-identity';
import { findInlineFenceById, insertHandwrittenNode } from '../src/embeds/inline-eome-source';
import { isOutlineCompatible, parseOutline, flattenOutline } from '../src/utils/outline';
import { relationNodeKey, type EomeRelation } from '../src/view/relations';

const relation: EomeRelation = { id: 'r1', source: 'node:aaaa-1111', target: 'node:bbbb-2222', kind: 'dettaglio', arrow: 'end' };
const source = '- ![[a.svg]] <!-- eome-node-id: aaaa-1111 -->\n  - ![[b.svg]] <!-- eome-node-id: bbbb-2222 -->\n<!-- eome-map-id: map-123456 -->';
function fixture(fm: unknown, body = source) {
  let markdown = (fm ? '---\n' + JSON.stringify(fm) + '\n---\n' : '') + 'Prosa\n```mindmap-eome\n' + body + '\n```\nCoda';
  const file = Object.assign(new TFile(), { path: 'note.md' });
  const files: TFile[] = [];
  const plugin = { svgFolder: 'drawings', app: {
    vault: {
      adapter: { exists: async () => false },
      process: async (_file: TFile, action: (value: string) => string) => { markdown = action(markdown); },
      getAbstractFileByPath: () => null,
      createFolder: async () => {},
      create: async (path: string) => {
        const file = Object.assign(new TFile(), { path, name: path.split('/').pop(), extension: 'svg' });
        files.push(file); return file;
      },
      getFiles: () => files,
    },
    metadataCache: { fileToLinktext: (f: TFile) => f.path, getFirstLinkpathDest: () => null },
  }};
  const context = { plugin, file, source: body, container: { closest: () => null } as unknown as HTMLElement,
    ctx: { getSectionInfo: () => null, onInlineEomeSaved: vi.fn() } } as unknown as Parameters<typeof changeInlineArrow>[0];
  return { context, read: () => markdown };
}
describe('block-owned metadata and sibling regression', () => {
  it('keeps metadata out of the outline, safely roundtrips and rejects damaged metadata', () => {
    const data = writeInlineRelations(source, [relation]);
    expect(readInlineRelations(data)).toEqual([relation]);
    expect(isOutlineCompatible(outlineWithoutMapMarker(data))).toBe(true);
    expect(flattenOutline(parseOutline(data))).toHaveLength(2);
    expect(() => readInlineRelations(source + '\n<!-- eome-data-v1: %broken -->')).toThrow();
  });
  it('atomically migrates only this map and preserves unrelated YAML and other maps', async () => {
    const f = fixture({ title: 'Studio', 'eome-inline-maps-v1': { 'map-123456': [relation], 'other-map': [] } });
    await changeInlineArrow(f.context, relation, 'both');
    const saved = findInlineFenceById(f.read(), 'map-123456')!;
    expect(readInlineRelations(saved.content)).toEqual([{ ...relation, arrow: 'both' }]);
    const fm = JSON.parse(f.read().split('\n')[1]);
    expect(fm).toEqual({ title: 'Studio', 'eome-inline-maps-v1': { 'other-map': [] } });
    expect(f.read()).toContain('Prosa\n```');
    expect(f.read()).toContain('```\nCoda');
    await changeInlineArrow(f.context, relation, 'none');
    expect(readInlineRelations(findInlineFenceById(f.read(), 'map-123456')!.content)?.[0].arrow).toBe('none');
  });
  it('removes the final migrated YAML field without leaving empty frontmatter', async () => {
    const f = fixture({ 'eome-inline-maps-v1': { 'map-123456': [relation] } });
    await changeInlineArrow(f.context, relation, 'end');
    expect(f.read().startsWith('Prosa')).toBe(true);
  });
  it('rejects a stale fence without deleting its YAML', async () => {
    const f = fixture({ 'eome-inline-maps-v1': { 'map-123456': [relation] } });
    const before = f.read();
    f.context.source += '\n- changed';
    await expect(changeInlineArrow(f.context, relation, 'none')).rejects.toThrow();
    expect(f.read()).toBe(before);
  });
  it('migrates legacy SVG-key relations to stable node IDs and removes only resolved entries', async () => {
    const legacy = { ...relation, source: 'svg:a.svg', target: 'svg:b.svg' };
    const unrelated = { ...legacy, id: 'other', source: 'svg:x.svg', target: 'svg:y.svg' };
    const f = fixture({ title: 'Studio', 'eome-relations-v1': [legacy, unrelated] }, '- ![[a.svg]]\n  - ![[b.svg]]');
    await changeInlineArrow(f.context, legacy, 'both');
    const migrated = readInlineRelations(f.context.source)!;
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({ id: 'r1', arrow: 'both' });
    expect(migrated[0].source).toMatch(/^node:/);
    expect(JSON.parse(f.read().split('\n')[1])).toEqual({ title: 'Studio', 'eome-relations-v1': [unrelated] });
  });
  it('does not discard malformed per-map metadata', async () => {
    const f = fixture({ 'eome-inline-maps-v1': { 'map-123456': [relation, { unknown: true }] } });
    const before = f.read();
    await expect(changeInlineArrow(f.context, relation, 'both')).rejects.toThrow();
    expect(f.read()).toBe(before);
  });
  it('inserts a sibling after the full subtree and keeps root siblings root-level', () => {
    const nested = '- A\n  - B\n    - D\n  - E';
    expect(insertHandwrittenNode(nested, 1, 'C', true)).toBe('- A\n  - B\n    - D\n  - C\n  - E');
    expect(insertHandwrittenNode('- A', 0, 'B', true)).toBe('- A\n- B');
  });
  it('creates A→C with inherited type instead of B→C and keeps the same Markdown parent', async () => {
    const f = fixture(null, writeInlineRelations(source, [relation]));
    const added = await addInlineDrawing(f.context, parseOutline(f.context.source), 1, 'figlio', 'none', [], true);
    expect(added).not.toBeNull();
    const roots = parseOutline(added!.source);
    expect(roots[0].children).toHaveLength(2);
    const relations = readInlineRelations(added!.source)!;
    const cKey = relationNodeKey(f.context.plugin.app, f.context.file, roots[0].children[1]);
    expect(relations.find(r => r.target === cKey)).toMatchObject({ source: relation.source, kind: 'dettaglio' });
    expect(relations.some(r => r.source === relation.target && r.target === cKey)).toBe(false);
  });
  it('stamping a map twice retains its owned relations and identity', () => {
    const once = stampInlineMap(writeInlineRelations(source, [relation]));
    const twice = stampInlineMap(once.source);
    expect(inlineMapId(twice.source)).toBe(once.id);
    expect(readInlineRelations(twice.source)).toEqual([relation]);
  });
});

describe('summary creation transaction', () => {
  it('creates the summary after drawing and persists one group without changing existing hierarchy', async () => {
    vi.mocked(openDrawingModal).mockResolvedValue({ items: [{ id: 'ink', type: 'pen', data: {
      path: [{ x: 0, y: 0, pressure: 0.5 }, { x: 30, y: 20, pressure: 0.5 }], options: { size: 3, color: '#000' }
    } }] });
    const f = fixture(null, writeInlineRelations(source, [relation]));
    await createInlineSummary(f.context, [0, 1], 'left');
    const groups = readSummaryGroups(f.context.source);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ members: ['node:aaaa-1111', 'node:bbbb-2222'], side: 'left' });
    const outline = parseOutline(outlineWithoutMapMarker(f.context.source));
    expect(outline).toHaveLength(2);
    expect(outline[0].children).toHaveLength(1);
    expect(readInlineRelations(f.context.source)).toEqual([relation]);
    expect(relationNodeKey(f.context.plugin.app, f.context.file, outline[1])).toBe(groups[0].target);
  });
  it('cancellation and blank drawings do not create a group or change the note', async () => {
    for (const result of [null, { items: [] }]) {
      vi.mocked(openDrawingModal).mockResolvedValue(result);
      const f = fixture(null, source);
      const before = f.read();
      await createInlineSummary(f.context, [0, 1], 'right');
      expect(f.read()).toBe(before);
    }
  });
});
