import { expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { liveDrawingSvg, resolveDrawingFile, svgImageSource } from '../src/drawing/live-svg';

it('resolves a just-created SVG without waiting for metadata indexing, never guesses duplicate names', () => {
  const a = Object.assign(new TFile(), { path: 'drawings/word.svg', name: 'word.svg' });
  const b = Object.assign(new TFile(), { path: 'other/word.svg', name: 'word.svg' });
  const files = [a];
  const app = { metadataCache: { getFirstLinkpathDest: () => null }, vault: {
    getAbstractFileByPath: (path: string) => files.find(f => f.path === path), getFiles: () => files,
  }} as unknown as App;
  expect(resolveDrawingFile(app, 'word.svg', 'note.md')).toBe(a);
  files.push(b);
  expect(resolveDrawingFile(app, 'word.svg', 'note.md')).toBeNull();
  expect(resolveDrawingFile(app, 'drawings/word.svg', 'note.md')).toBe(a);
});
it('reads current SVG bytes on every render even if the resource URL and mtime are unchanged', async () => {
  let svg = '<svg viewBox="-10 -20 200 100"></svg>';
  const app = { vault: { read: vi.fn(async () => svg) } } as unknown as App;
  const file = new TFile();
  const before = svgImageSource(await liveDrawingSvg(app, file));
  svg = '<svg viewBox="-10 -20 200 100"><path d="M0 0L10 20"/></svg>';
  const after = svgImageSource(await liveDrawingSvg(app, file));
  expect(after).not.toBe(before);
  expect(decodeURIComponent(after.split(',')[1])).toBe(svg);
});
