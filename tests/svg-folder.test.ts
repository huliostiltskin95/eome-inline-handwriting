import { describe, expect, it } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import { createEomeSvg, validateSvgFolder } from '../src/drawing/svg-folder';

describe('configurable EOME SVG folder', () => {
  it('accepts nested vault-relative folders and rejects unsafe paths', () => {
    expect(validateSvgFolder('Materiali/Mappe SVG')).toBe('Materiali/Mappe SVG');
    for (const invalid of ['', '/', '../altro', 'A/../B', '.obsidian/config', 'C:/Users/a', 'A//B']) {
      expect(() => validateSvgFolder(invalid)).toThrow();
    }
  });

  it('creates folders lazily and avoids overwriting existing SVG assets', async () => {
    const entries = new Map<string, TFolder | TFile>();
    const created: string[] = [];
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
        createFolder: async (path: string) => { entries.set(path, new TFolder(path)); },
        create: async (path: string, _svg: string) => {
          if (entries.has(path)) throw new Error('collision');
          const file = new TFile();
          file.path = path;
          file.extension = 'svg';
          entries.set(path, file);
          created.push(path);
          return file;
        }
      }
    };
    const a = await createEomeSvg(app as never, 'Studio/EOME/SVG', 'Parola.svg', '<svg/>');
    const b = await createEomeSvg(app as never, 'Studio/EOME/SVG', 'Parola.svg', '<svg/>');
    expect(a.path).toBe('Studio/EOME/SVG/Parola.svg');
    expect(b.path).toBe('Studio/EOME/SVG/Parola 1.svg');
    expect(created).toHaveLength(2);
    expect(entries.get('Studio/EOME/SVG')).toBeInstanceOf(TFolder);
  });
});
