import { normalizePath, TFile, TFolder, type App } from 'obsidian';

export const DEFAULT_SVG_FOLDER = 'EOME/SVG';

/** Reject absolute, parent-relative, hidden configuration, and vault-root paths. */
export function validateSvgFolder(value: string): string {
  const raw = value.trim().replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    throw new Error('Indica una cartella relativa alla radice del vault.');
  }
  const parts = raw.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part === '.obsidian')) {
    throw new Error('Il percorso contiene segmenti non consentiti.');
  }
  return normalizePath(parts.join('/'));
}

async function ensureFolders(app: App, folder: string): Promise<void> {
  let current = '';
  for (const segment of folder.split('/')) {
    current = current ? current + '/' + segment : segment;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;
    if (existing) throw new Error('Un file occupa il percorso della cartella: ' + current);
    try {
      await app.vault.createFolder(current);
    } catch (error) {
      // Another device or process may have created the folder concurrently.
      if (!(app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error;
    }
  }
}

/** New native EOME drawings use this path. Existing SVGs never move. */
export async function createEomeSvg(app: App, folderSetting: string,
  filename: string, svg: string): Promise<TFile> {
  const folder = validateSvgFolder(folderSetting);
  await ensureFolders(app, folder);
  const safe = filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().replace(/\.+$/, '');
  const base = (safe.toLowerCase().endsWith('.svg') ? safe.slice(0, -4) : safe) || 'EOME drawing';
  for (let n = 0; n < 10000; n++) {
    const suffix = n ? ' ' + n : '';
    const path = folder + '/' + base + suffix + '.svg';
    if (app.vault.getAbstractFileByPath(path)) continue;
    try { return await app.vault.create(path, svg); }
    catch (error) {
      if (!app.vault.getAbstractFileByPath(path)) throw error;
    }
  }
  throw new Error('Non è disponibile un nome per il disegno nella cartella selezionata.');
}
