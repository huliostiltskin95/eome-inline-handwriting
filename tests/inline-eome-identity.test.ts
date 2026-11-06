import { describe, expect, it } from 'vitest';
import { inlineMapId, inlineNodeId, outlineWithoutMapMarker, stampInlineMap } from '../src/embeds/inline-eome-identity';

describe('persistent EOME inline identity', () => {
  it('stamps the same ID on repeated edits and different IDs on duplicate labels', () => {
    const source = '- Stesso\n- Stesso\n';
    const once = stampInlineMap(source);
    const twice = stampInlineMap(once.source);
    expect(twice.source).toBe(once.source);
    expect(inlineMapId(once.source)).toBe(once.id);
    const lines = once.source.split('\n');
    expect(inlineNodeId(lines[0])).toBeTruthy();
    expect(inlineNodeId(lines[1])).toBeTruthy();
    expect(inlineNodeId(lines[0])).not.toBe(inlineNodeId(lines[1]));
    expect(outlineWithoutMapMarker(once.source).split('\n')[0]).toContain('Stesso');
  });
  it('preserves existing node line numbers when adding metadata', () => {
    const source = '- Radice\n  - Dettaglio';
    const result = stampInlineMap(source);
    expect(result.source.split('\n')[0]).toContain('Radice');
    expect(result.source.split('\n')[1]).toContain('Dettaglio');
    expect(result.source.split('\n')[2]).toContain('eome-map-id');
  });
  it('keeps the identity of a map distinct from a copied new map', () => {
    const source = stampInlineMap('- Parola').source;
    expect(inlineMapId(source)).toBeTruthy();
    expect(inlineMapId(stampInlineMap('- Parola').source)).not.toBe(inlineMapId(source));
  });
});
