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
        getAllLoadedFiles: () => Array.from(entries.values()),
        adapter: { exists: async (path: string) => Array.from(entries.keys()).some(value => value.toLowerCase() === path.toLowerCase()) },
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

  it('uses the existing folder spelling and avoids collisions on case-insensitive macOS', async () => {
    const entries = new Map<string, TFolder | TFile>();
    entries.set('eome', new TFolder('eome'));
    entries.set('eome/svg', new TFolder('eome/svg'));
    const old = new TFile();
    old.path = 'eome/svg/eome MANOSCRITTO.SVG';
    entries.set(old.path, old);
    const folders: string[] = [];
    const created: string[] = [];
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
        getAllLoadedFiles: () => Array.from(entries.values()),
        adapter: { exists: async (path: string) => Array.from(entries.keys()).some(value => value.toLowerCase() === path.toLowerCase()) },
        createFolder: async (path: string) => { folders.push(path); entries.set(path, new TFolder(path)); },
        create: async (path: string, _svg: string) => {
          if (Array.from(entries.keys()).some(value => value.toLowerCase() === path.toLowerCase())) {
            throw new Error('File already exists on case-insensitive volume');
          }
          const file = new TFile();
          file.path = path;
          file.extension = 'svg';
          entries.set(path, file);
          created.push(path);
          return file;
        }
      }
    };
    const result = await createEomeSvg(app as never, 'EOME/SVG', 'EOME manoscritto.svg', '<svg/>');
    expect(folders).toEqual([]);
    expect(result.path).toBe('eome/svg/EOME manoscritto 1.svg');
    expect(entries.get(old.path)).toBe(old);
    expect(created).toEqual([result.path]);
  });

  it('returns the underlying folder creation error instead of hiding the cause', async () => {
    const app = {
      vault: {
        getAbstractFileByPath: () => null,
        getAllLoadedFiles: () => [],
        createFolder: async () => { throw new Error('EACCES: permission denied'); },
      }
    };
    await expect(createEomeSvg(app as never, 'EOME/SVG', 'a.svg', '<svg/>'))
      .rejects.toThrow('EACCES: permission denied');
  });
});
