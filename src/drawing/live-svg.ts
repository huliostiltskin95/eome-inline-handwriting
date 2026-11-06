import { TFile, type App } from 'obsidian';

/** New files may not yet be indexed by metadataCache. Never guess between
 * duplicate basenames: use an exact path, then a unique basename fallback. */
export function resolveDrawingFile(app: App, link: string, sourcePath: string): TFile | null {
  const indexed = app.metadataCache.getFirstLinkpathDest(link, sourcePath);
  if (indexed instanceof TFile) return indexed;
  const exact = app.vault.getAbstractFileByPath(link);
  if (exact instanceof TFile) return exact;
  const matches = app.vault.getFiles().filter(file => file.path === link || file.name === link);
  return matches.length === 1 ? matches[0] : null;
}

/** Read actual bytes instead of an app:// URL that can still show the blank
 * placeholder. Preserve the viewBox used by the direct-ink coordinate system. */
export async function liveDrawingSvg(app: App, file: TFile): Promise<string> {
  return app.vault.read(file);
}

export function svgImageSource(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
