import { Notice, type TFile } from 'obsidian';
import type { Core } from 'cytoscape';
import type MindmapPlugin from '../main';

const NS = 'http://www.w3.org/2000/svg';

/** Export model-space geometry, independent of pan/zoom, with no UI or PDF pane. */
export async function exportInlineMap(plugin: MindmapPlugin, file: TFile,
  wrapper: HTMLElement, cy: Core, format: 'png' | 'pdf'): Promise<void> {
  const bounds = cy.nodes().boundingBox();
  const padding = 60;
  const width = bounds.w + padding * 2, height = bounds.h + padding * 2;
  if (!Number.isFinite(width + height) || width <= 0 || height <= 0) throw new Error('Mappa vuota.');
  const doc = wrapper.ownerDocument;
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('viewBox', `${bounds.x1 - padding} ${bounds.y1 - padding} ${width} ${height}`);
  // Bound memory on mobile while keeping the complete map in the export.
  const scale = Math.min(2, 4096 / Math.max(width, height), Math.sqrt(12000000 / (width * height)));
  const w = Math.max(1, Math.ceil(width * scale)), h = Math.max(1, Math.ceil(height * scale));
  svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h));
  const background = doc.createElementNS(NS, 'rect');
  background.setAttribute('x', String(bounds.x1 - padding)); background.setAttribute('y', String(bounds.y1 - padding));
  background.setAttribute('width', String(width)); background.setAttribute('height', String(height));
  background.setAttribute('fill', '#ffffff'); svg.appendChild(background);
  const routes = wrapper.querySelector('.eome-relations-layer');
  if (routes) for (const item of Array.from(routes.children)) {
    if (item.getAttribute('stroke') === 'transparent') continue;
    const clone = item.cloneNode(true) as Element;
    if (clone.hasAttribute('stroke')) clone.setAttribute('stroke', '#242424');
    svg.appendChild(clone);
  }
  for (const overlay of Array.from(wrapper.querySelectorAll<HTMLElement>('.mindmap-eome-overlay'))) {
    const node = cy.getElementById('n' + overlay.dataset.nodeLine);
    if (node.empty()) continue;
    const p = node.position(), nw = node.width(), nh = node.height();
    const image = overlay.querySelector('img');
    if (image) {
      if (!image.src.startsWith('data:image/svg+xml')) throw new Error('Esportazione: immagine non ancora pronta.');
      const out = doc.createElementNS(NS, 'image');
      out.setAttribute('href', image.src);
      out.setAttribute('x', String(p.x - nw / 2)); out.setAttribute('y', String(p.y - nh / 2));
      out.setAttribute('width', String(nw)); out.setAttribute('height', String(nh));
      svg.appendChild(out);
    } else {
      const out = doc.createElementNS(NS, 'text');
      out.setAttribute('x', String(p.x - nw / 2)); out.setAttribute('y', String(p.y));
      out.setAttribute('fill', '#242424'); out.setAttribute('font-size', '16');
      out.textContent = overlay.textContent ?? ''; svg.appendChild(out);
    }
  }
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  let png: ArrayBuffer;
  try {
    const image = doc.createElement('img');
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error('Impossibile renderizzare la mappa.'));
      image.src = url;
    });
    const canvas = doc.createElement('canvas'); canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas non disponibile.');
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG non disponibile.')), 'image/png'));
    png = await blob.arrayBuffer();
  } finally { URL.revokeObjectURL(url); }
  let bytes = png;
  if (format === 'pdf') {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(png);
    const pageScale = Math.min(1, 14000 / Math.max(width, height));
    const page = pdf.addPage([width * pageScale, height * pageScale]);
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    bytes = new Uint8Array(await pdf.save()).buffer;
  }
  const base = file.path.replace(/\.md$/i, '') + ' - mappa';
  let path = `${base}.${format}`, i = 1;
  while (await plugin.app.vault.adapter.exists(path)) path = `${base} ${i++}.${format}`;
  const exported = await plugin.app.vault.createBinary(path, bytes);
  const embed = plugin.app.fileManager.generateMarkdownLink(exported, file.path);
  const link = embed.startsWith('!') ? embed : '!' + embed;
  try {
    await navigator.clipboard.writeText(link);
    new Notice(`Salvato ${exported.name}. Collegamento copiato: incollalo nella nota.`);
  } catch {
    // Mobile WebKit may require another user gesture after asynchronous export.
    const button = wrapper.parentElement?.createEl('button', { text: 'Copia collegamento esportazione', cls: 'eome-export-copy' });
    button?.addEventListener('click', () => {
      void navigator.clipboard.writeText(link).then(() => button.remove())
        .catch(() => new Notice(`File salvato: ${exported.path}. Inseriscilo dalla nota.`));
    });
    new Notice(`Salvato ${exported.name}. Tocca «Copia collegamento esportazione».`);
  }
}
