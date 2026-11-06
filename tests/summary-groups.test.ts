import { describe, it, expect } from 'vitest';
import { readSummaryGroups, writeSummaryGroups, layoutSummaryNodes, summaryGeometry, pointInLasso, type SummaryGroup } from '../src/embeds/summary-groups';
import { outlineWithoutMapMarker, stampInlineMap, writeInlineRelations } from '../src/embeds/inline-eome-identity';
import { parseOutline } from '../src/utils/outline';
import { replaceInlineMindmapFence } from '../src/embeds/inline-eome-source';

const group: SummaryGroup = { id: 'group-1', members: ['a', 'b'], target: 's', side: 'right' };
const nodes = [{ id: 'a', x: 0, y: 0, w: 40, h: 20 }, { id: 'b', x: 0, y: 80, w: 80, h: 20 }, { id: 's', x: 0, y: 200, w: 60, h: 30 }];

describe('collective summaries', () => {
  it('round trips groups independently of pair relations and preserves outline offsets', () => {
    const source = stampInlineMap('- ![[A.svg]]\n- ![[B.svg]]\n- ![[S.svg]]').source;
    const saved = writeSummaryGroups(writeInlineRelations(source, []), [group]);
    expect(readSummaryGroups(saved)).toEqual([group]);
    expect(parseOutline(outlineWithoutMapMarker(saved)).map(n => n.line)).toEqual([0, 1, 2]);
    expect(readSummaryGroups(writeSummaryGroups(saved, [{ ...group, side: 'left' }]))[0].side).toBe('left');
  });
  it('rejects invalid members rather than silently erasing metadata', () => {
    for (const members of [['a'], ['a', 'a'], ['a', 's']]) {
      expect(() => readSummaryGroups(writeSummaryGroups('', [{ ...group, members }]))).toThrow();
    }
  });
  it('updates only the selected fenced block and leaves frontmatter and other maps intact', () => {
    const source = '- ![[A.svg]]';
    const other = '```mindmap-eome\n- ![[Other.svg]]\n```';
    const markdown = '---\ntitle: Test\n---\nText\n```mindmap-eome\n' + source + '\n```\n' + other;
    const saved = replaceInlineMindmapFence(markdown, source, writeSummaryGroups(source, [group]));
    expect(saved).toContain('---\ntitle: Test\n---\nText\n');
    expect(saved).toContain(other);
  });
  it('places the summary on either side without moving members or overlapping another node', () => {
    for (const side of ['left', 'right'] as const) {
      const placed = layoutSummaryNodes(nodes, [{ ...group, side }]);
      expect(placed.slice(0, 2)).toEqual(nodes.slice(0, 2));
      expect(placed[2].y).toBe(40);
      expect(side === 'right' ? placed[2].x > 40 : placed[2].x < -40).toBe(true);
      expect(summaryGeometry({ ...group, side }, placed)).toContain('Q');
    }
  });
  it('follows resized or moved members and omits dangling groups', () => {
    const before = layoutSummaryNodes(nodes, [group]);
    const moved = nodes.map(n => n.id === 'b' ? { ...n, y: 180, w: 160 } : n);
    const after = layoutSummaryNodes(moved, [group]);
    expect(after[2].x).toBeGreaterThan(before[2].x);
    expect(after[2].y).toBe(90);
    expect(summaryGeometry(group, [nodes[0], nodes[2]])).toBeNull();
  });
  it('selects by polygon instead of its bounding rectangle', () => {
    const polygon = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
    expect(pointInLasso({ x: 20, y: 20 }, polygon)).toBe(true);
    expect(pointInLasso({ x: 90, y: 90 }, polygon)).toBe(false);
    expect(pointInLasso({ x: 0, y: 0 }, [])).toBe(false);
  });
});
