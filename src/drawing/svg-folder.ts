import { normalizePath, TFile, TFolder, type App } from 'obsidian';

export const DEFAULT_SVG_FOLDER = 'EOME/SVG';

/** Only vault-relative, non-empty folders are valid destinations. */
export function validateSvgFolder(value: string): string {
  const raw = value.trim().replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    throw new Error('Indica una cartella relativa alla radice del vault.');
  }
  const parts = raw.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' ||
    part.toLowerCase() === '.obsidian')) {
    throw new Error('Il percorso della cartella SVG contiene segmenti non consentiti.');
  }
  return normalizePath(parts.join('/'));
}

/** Obsidian's vault lookup is case-sensitive, but the filesystem on most
 * macOS installations is not. Match existing folders using their actual
 * spelling instead of attempting to create the same folder twice.
 */
function findVaultEntry(app: App, path: string): TFile | TFolder | null {
  const exact = app.vault.getAbstractFileByPath(path);
  if (exact instanceof TFile || exact instanceof TFolder) return exact;
  const loaded = app.vault.getAllLoadedFiles?.() ?? [];
  return loaded.find(file => file.path.toLowerCase() === path.toLowerCase()) as TFile | TFolder | undefined ?? null;
}

async function ensureFolders(app: App, folder: string): Promise<string> {
  let current = '';
  for (const segment of folder.split('/')) {
    const intended = current ? current + '/' + segment : segment;
    const existing = findVaultEntry(app, intended);
    if (existing instanceof TFolder) {
      current = existing.path;
      continue;
    }
    if (existing) {
      throw new Error('Il percorso ' + existing.path +
        ' è già occupato da un file: scegli un’altra cartella SVG nelle impostazioni EOME.');
    }
    try {
      await app.vault.createFolder(intended);
    } catch (error) {
      // Filesystem changes can race with Syncthing or another Obsidian window.
      const created = findVaultEntry(app, intended);
      if (!(created instanceof TFolder)) throw error;
      current = created.path;
      continue;
    }
    current = intended;
  }
  return current;
}

/** Persist one native EOME SVG in a configurable vault folder.
 * It must not overwrite an earlier drawing, even on case-insensitive macOS.
 */
export async function createEomeSvg(app: App, folderSetting: string,
  filename: string, svg: string): Promise<TFile> {
  const folder = await ensureFolders(app, validateSvgFolder(folderSetting));
  // Every generated attachment receives a UUID v4. The requested descriptive
  // filename is deliberately ignored: names such as "Untitled 1.svg" are not
  // stable or unique across notes and synchronised devices.
  void filename;
  for (let attempt = 0; attempt < 100; attempt++) {
    const path = folder + '/' + crypto.randomUUID() + '.svg';
    if (findVaultEntry(app, path) || await app.vault.adapter.exists(path)) continue;
    try {
      return await app.vault.create(path, svg);
    } catch (error) {
      if (findVaultEntry(app, path) || await app.vault.adapter.exists(path)) continue;
      throw new Error('Impossibile salvare ' + path + ': ' +
        (error instanceof Error ? error.message : String(error)));
    }
  }
  throw new Error('Non è disponibile un nome per il disegno nella cartella selezionata.');
}
