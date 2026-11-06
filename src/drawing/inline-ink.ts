import { Notice, TFile } from 'obsidian';
import type { MindmapView } from '../view/mindmap-view';
import { extractDrawingLink } from './drawing-link';
import { createDrawingSvg, parseDrawingSvg, hasLegacyOpaqueBacking } from './drawing-svg';
import type { ExportedDrawingItem, InkPoint } from './types';

interface Sample {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  time: number;
}
interface InkSession {
  pointerId: number;
  attachment: TFile;
  rect: DOMRect;
  preview: SVGSVGElement;
  line: SVGPathElement;
  points: Sample[];
}
const NS = 'http://www.w3.org/2000/svg';
const MAX_POINTS = 10000;
const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

function getViewBox(svg: string): [number, number, number, number] | null {
  const match = /\bviewBox\s*=\s*["']\s*([^"']+)["']/i.exec(svg);
  if (!match) return null;
  const numbers = match[1].trim().split(/[\s,]+/).map(Number);
  return numbers.length === 4 && numbers.every(Number.isFinite) && numbers[2] > 0 && numbers[3] > 0
    ? numbers as [number, number, number, number] : null;
}

/** Inline pen capture is deliberately limited to native EOME SVG drawing nodes.
 * Finger contacts retain the existing navigation/selection gestures.
 */
export class InlineInkController {
  private session: InkSession | null = null;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly pendingPreviews = new Set<SVGSVGElement>();
  private refreshTimer: number | null = null;
  private readonly compactTimers = new Map<string, number>();
  private readonly redoItems = new Map<string, ExportedDrawingItem>();
  private eraserEnabled = false;
  public setEraserEnabled(enabled: boolean): void { this.eraserEnabled = enabled; }
  public isEraserEnabled(): boolean { return this.eraserEnabled; }

  constructor(private readonly view: MindmapView, private readonly wrapper: HTMLElement) {}

  pointerDown(event: PointerEvent): boolean {
    if (!this.view.inlineInkEnabled ||
        (event.pointerType !== 'pen' && event.pointerType !== 'mouse') ||
        event.button !== 0 || this.session || this.view.connectionMode) return false;
    const target = event.target instanceof Element ? event.target : null;
    // Embedded SVGs may be wrapped by an Obsidian anchor. Restrict drawing by
    // the SVG image rectangle below, rather than rejecting all ancestor links.
    if (!target || target.closest('button, input, textarea, [contenteditable="true"]')) return false;
    const overlay = target.closest<HTMLElement>('.mindmap-overlay[data-node-line]');
    if (!overlay || !this.wrapper.contains(overlay) || !this.view.file) return false;
    const node = this.view.getNodeByLine(Number(overlay.dataset.nodeLine));
    const link = node && extractDrawingLink(node.text);
    if (!link) return false;
    const file = this.view.app.metadataCache.getFirstLinkpathDest(link, this.view.file.path);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'svg') return false;
    const image = overlay.querySelector<HTMLImageElement>('.markdown-rendered img');
    if (!image) return false;
    const rect = image.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 ||
        event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) return false;

    if (this.eraserEnabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void this.enqueueErase(file, rect, event.clientX, event.clientY);
      return true;
    }

    // Avoid changing the SVG viewBox during a burst of handwritten strokes.
    const compactTimer = this.compactTimers.get(file.path);
    if (compactTimer !== undefined) {
      window.clearTimeout(compactTimer);
      this.compactTimers.delete(file.path);
    }

    const doc = this.wrapper.ownerDocument;
    const preview = doc.createElementNS(NS, 'svg');
    preview.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    preview.setAttribute('aria-hidden', 'true');
    preview.style.position = 'fixed';
    preview.style.left = `${rect.left}px`;
    preview.style.top = `${rect.top}px`;
    preview.style.width = `${rect.width}px`;
    preview.style.height = `${rect.height}px`;
    preview.style.pointerEvents = 'none';
    preview.style.overflow = 'hidden';
    preview.style.zIndex = '1000';
    const line = doc.createElementNS(NS, 'path');
    line.setAttribute('stroke', '#242424');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    preview.appendChild(line);
    doc.body.appendChild(preview);
    this.session = { pointerId: event.pointerId, attachment: file, rect, preview, line, points: [] };
    this.addSample(event);
    try { this.wrapper.setPointerCapture(event.pointerId); } catch { /* optional in iPad WebKit */ }
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  pointerMove(event: PointerEvent): boolean {
    if (!this.session || this.session.pointerId !== event.pointerId) return false;
    const coalesced = event.getCoalescedEvents?.() ?? [];
    for (const sample of coalesced.length ? coalesced : [event]) this.addSample(sample);
    const s = this.session;
    const path = s.points.map((p, i) =>
      `${i === 0 ? 'M' : 'L'} ${(p.x * s.rect.width).toFixed(2)} ${(p.y * s.rect.height).toFixed(2)}`
    ).join(' ');
    s.line.setAttribute('d', s.points.length === 1 ? `${path} l .01 .01` : path);
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  pointerEnd(event: PointerEvent): boolean {
    const session = this.session;
    if (!session || session.pointerId !== event.pointerId) return false;
    if (event.type !== 'pointercancel') this.addSample(event);
    this.session = null;
    try { this.wrapper.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'pointercancel' || !session.points.length) {
      session.preview.remove();
      return true;
    }
    this.pendingPreviews.add(session.preview);
    void this.enqueueSave(session);
    return true;
  }

  /** Remove the most recent inline pen stroke on the selected SVG only. */
  async undoLastStroke(line: number): Promise<boolean> {
    const attachment = this.drawingAtLine(line);
    if (!attachment) return false;
    await (this.queues.get(attachment.path) ?? Promise.resolve()).catch(() => {});
    const before = await this.view.app.vault.read(attachment);
    const drawing = parseDrawingSvg(before);
    if (!drawing || !drawing.items.length) return false;
    const last = drawing.items[drawing.items.length - 1];
    if (!last.id?.startsWith('inline-')) return false;
    this.redoItems.set(attachment.path, last);
    await this.view.app.vault.modify(attachment, createDrawingSvg(
      drawing.items.slice(0, -1), drawing.createdAt, undefined, hasLegacyOpaqueBacking(before)));
    this.view.attachmentVersions.markCurrent(attachment);
    await this.view.refreshRenderedAttachments(attachment);
    return true;
  }

  async redoLastStroke(line: number): Promise<boolean> {
    const attachment = this.drawingAtLine(line);
    if (!attachment) return false;
    await (this.queues.get(attachment.path) ?? Promise.resolve()).catch(() => {});
    const item = this.redoItems.get(attachment.path);
    if (!item) return false;
    const before = await this.view.app.vault.read(attachment);
    const drawing = parseDrawingSvg(before);
    if (!drawing || drawing.items.some(existing => existing.id === item.id)) return false;
    await this.view.app.vault.modify(attachment, createDrawingSvg(
      [...drawing.items, item], drawing.createdAt, undefined, hasLegacyOpaqueBacking(before)));
    this.redoItems.delete(attachment.path);
    this.view.attachmentVersions.markCurrent(attachment);
    await this.view.refreshRenderedAttachments(attachment);
    return true;
  }

  private drawingAtLine(line: number): TFile | null {
    const node = this.view.getNodeByLine(line);
    const link = node && extractDrawingLink(node.text);
    if (!link || !this.view.file) return null;
    const found = this.view.app.metadataCache.getFirstLinkpathDest(link, this.view.file.path);
    return found instanceof TFile && found.extension.toLowerCase() === 'svg' ? found : null;
  }

  cancel(): void {
    if (this.session) this.session.preview.remove();
    this.session = null;
  }

  private addSample(event: PointerEvent): void {
    const session = this.session;
    if (!session || session.points.length >= MAX_POINTS) return;
    const rect = session.rect;
    const next: Sample = {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
      pressure: clamp(event.pressure || 0.5, 0.05, 1),
      tiltX: event.tiltX || 0,
      tiltY: event.tiltY || 0,
      time: event.timeStamp || Date.now()
    };
    const last = session.points[session.points.length - 1];
    if (!last || Math.hypot(last.x - next.x, last.y - next.y) > 0.0005) session.points.push(next);
  }

  /** Vector eraser: remove the nearest *complete pen stroke*, never rasterize
   * or flatten other geometry. Pencil or mouse taps work inside a node SVG.
   */
  private async enqueueErase(attachment: TFile, rect: DOMRect, clientX: number, clientY: number): Promise<void> {
    const key = attachment.path;
    const prior = this.queues.get(key) ?? Promise.resolve();
    const current = prior.catch(() => {}).then(async () => {
      const before = await this.view.app.vault.read(attachment);
      const drawing = parseDrawingSvg(before);
      const bounds = getViewBox(before);
      if (!drawing || !bounds) return;
      const [x, y, w, h] = bounds;
      const px = x + clamp((clientX - rect.left) / rect.width, 0, 1) * w;
      const py = y + clamp((clientY - rect.top) / rect.height, 0, 1) * h;
      const tolerance = Math.max(w / rect.width, h / rect.height) * 12;
      const segmentDistance = (a: InkPoint, b: InkPoint): number => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const factor = dx * dx + dy * dy;
        const t = factor ? clamp(((px - a.x) * dx + (py - a.y) * dy) / factor, 0, 1) : 0;
        return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
      };
      let nearest = -1, distance = tolerance;
      drawing.items.forEach((item, index) => {
        if (item.type !== 'pen' || !Array.isArray(item.data.path)) return;
        const path = item.data.path as InkPoint[];
        if (!path.length) return;
        let score = Math.hypot(px - path[0].x, py - path[0].y);
        for (let i = 1; i < path.length; i++)
          score = Math.min(score, segmentDistance(path[i - 1], path[i]));
        if (score < distance) { distance = score; nearest = index; }
      });
      if (nearest < 0) return;
      const items = drawing.items.filter((_, index) => index !== nearest);
      if (await this.view.app.vault.read(attachment) !== before)
        throw new Error('Concurrent SVG edit; erasure cancelled.');
      await this.view.app.vault.modify(attachment,
        createDrawingSvg(items, drawing.createdAt, undefined, hasLegacyOpaqueBacking(before)));
      this.redoItems.delete(key);
      this.view.attachmentVersions.markCurrent(attachment);
    });
    this.queues.set(key, current);
    try {
      await current;
      this.scheduleRefresh();
      this.scheduleCompaction(attachment);
    } catch (error) {
      console.error('Inline vector eraser failed:', error);
      new Notice('Non è stato possibile cancellare il tratto.');
    } finally {
      if (this.queues.get(key) === current) this.queues.delete(key);
    }
  }

  private async enqueueSave(session: InkSession): Promise<void> {
    const key = session.attachment.path;
    const prior = this.queues.get(key) ?? Promise.resolve();
    const current = prior.catch(() => {}).then(() => this.save(session));
    this.queues.set(key, current);
    try {
      await current;
      this.scheduleRefresh();
      this.scheduleCompaction(session.attachment);
    } catch (error) {
      console.error('Inline handwriting save failed:', error);
      session.preview.remove();
      this.pendingPreviews.delete(session.preview);
      new Notice('Unable to save handwritten stroke.');
    } finally {
      if (this.queues.get(key) === current) this.queues.delete(key);
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (this.session || this.queues.size > 0) {
        this.scheduleRefresh();
        return;
      }
      if (!this.wrapper.isConnected) {
        this.clearPreviews();
        return;
      }
      void this.view.refreshRenderedAttachments().then(
        () => this.clearPreviews(),
        (error) => {
          console.error('Inline handwriting refresh failed:', error);
          this.clearPreviews();
        }
      );
    }, 400);
  }

  /**
   * Auto-fit the SVG to its real vector bounds only after the pen has rested.
   * Keeping the viewBox fixed during the stroke prevents the live writing
   * surface from shifting under Apple Pencil with every new letter.
   */
  private scheduleCompaction(attachment: TFile): void {
    const previous = this.compactTimers.get(attachment.path);
    if (previous !== undefined) window.clearTimeout(previous);
    const timeout = window.setTimeout(() => {
      this.compactTimers.delete(attachment.path);
      if (this.session?.attachment.path === attachment.path ||
          this.queues.has(attachment.path)) {
        this.scheduleCompaction(attachment);
        return;
      }
      if (!this.wrapper.isConnected) return;
      void this.compactDrawing(attachment).catch((error) => {
        console.warn('Could not adapt handwriting SVG to its stroke bounds:', error);
      });
    }, 1800);
    this.compactTimers.set(attachment.path, timeout);
  }

  private async compactDrawing(attachment: TFile): Promise<void> {
    if (this.session?.attachment.path === attachment.path || this.queues.has(attachment.path)) return;
    const before = await this.view.app.vault.read(attachment);
    const doc = parseDrawingSvg(before);
    if (!doc || doc.items.length === 0) return;
    const compacted = createDrawingSvg(doc.items, doc.createdAt,
      undefined, hasLegacyOpaqueBacking(before));
    const oldBounds = getViewBox(before);
    const newBounds = getViewBox(compacted);
    if (!oldBounds || !newBounds || oldBounds.every((value, i) => value === newBounds[i])) return;
    if (this.session?.attachment.path === attachment.path || this.queues.has(attachment.path)) return;
    // Another editor can update the same attachment; do not silently overwrite.
    if (await this.view.app.vault.read(attachment) !== before) return;
    await this.view.app.vault.modify(attachment, compacted);
    this.view.attachmentVersions.markCurrent(attachment);
    await this.view.refreshRenderedAttachments(attachment);
  }

  private clearPreviews(): void {
    for (const preview of this.pendingPreviews) preview.remove();
    this.pendingPreviews.clear();
  }

  private async save(session: InkSession): Promise<void> {
    const before = await this.view.app.vault.read(session.attachment);
    const doc = parseDrawingSvg(before);
    const bounds = getViewBox(before);
    if (!doc || !bounds) throw new Error('Not an editable EOME SVG.');
    const [x, y, w, h] = bounds;
    const points: InkPoint[] = session.points.map(point => ({
      x: x + point.x * w,
      y: y + point.y * h,
      pressure: point.pressure,
      tiltX: point.tiltX,
      tiltY: point.tiltY,
      time: point.time
    }));
    if (points.length === 1) points.push({ ...points[0], x: points[0].x + 0.01 });
    const pen = await this.view.penPreferences.load();
    this.redoItems.delete(session.attachment.path);
    const item: ExportedDrawingItem = {
      id: `inline-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: 'pen',
      data: { path: points, rawPath: points, options: { color: pen.color, size: pen.size } }
    };
    // Do not overwrite an SVG modified by a second editor during this read.
    if (await this.view.app.vault.read(session.attachment) !== before) {
      throw new Error('Concurrent SVG edit; stroke not saved.');
    }
    await this.view.app.vault.modify(
      session.attachment,
      createDrawingSvg([...doc.items, item], doc.createdAt, { x, y, width: w, height: h }, hasLegacyOpaqueBacking(before))
    );
    this.view.attachmentVersions.markCurrent(session.attachment);
  }
}
