import type { MindmapView } from './mindmap-view';
import { showRelationKindMenu } from './relations-overlay';

const NS = 'http://www.w3.org/2000/svg';

interface LinkSession {
  id: number;
  sourceLine: number;
  preview: SVGSVGElement;
  line: SVGLineElement;
}

/** Pencil-only tool: drawing ordinary handwriting never generates relationships.
 * Tap the explicit "Collega" button before dragging from one node to another.
 * Fingers still select/pan as usual, and a cancelled gesture changes no data.
 */
export class RelationGestureController {
  private session: LinkSession | null = null;
  constructor(private readonly view: MindmapView, private readonly wrapper: HTMLElement) {}

  pointerDown(event: PointerEvent): boolean {
    if (!this.view.connectionMode || (event.pointerType !== 'pen' && event.pointerType !== 'mouse') || event.button !== 0 ||
        this.session) return false;
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== 'function' ||
        target.closest('button, input, textarea, .vertical-toolbar, .eome-relation-hit')) return false;
    const nodeBox = target.closest<HTMLElement>('.mindmap-overlay[data-node-line]');
    const lineNumber = Number(nodeBox?.dataset.nodeLine);
    if (!nodeBox || !Number.isFinite(lineNumber) || !this.view.getNodeByLine(lineNumber)) return false;

    const nodeImage = nodeBox.querySelector('img');
    const rect = (nodeImage ?? nodeBox).getBoundingClientRect();
    const doc = this.wrapper.ownerDocument;
    const preview = doc.createElementNS(NS, 'svg');
    preview.classList.add('eome-connect-preview');
    preview.setAttribute('viewBox', '0 0 ' +
      Math.max(1, doc.documentElement.clientWidth) + ' ' +
      Math.max(1, doc.documentElement.clientHeight));
    preview.style.position = 'fixed';
    preview.style.inset = '0';
    preview.style.width = '100vw';
    preview.style.height = '100dvh';
    preview.style.pointerEvents = 'none';
    preview.style.zIndex = '9999';
    const line = doc.createElementNS(NS, 'line');
    line.setAttribute('x1', String(rect.left + rect.width / 2));
    line.setAttribute('y1', String(rect.top + rect.height / 2));
    line.setAttribute('x2', String(event.clientX));
    line.setAttribute('y2', String(event.clientY));
    line.setAttribute('stroke', 'var(--interactive-accent, #487cf7)');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '6 5');
    preview.appendChild(line);
    doc.body.appendChild(preview);
    this.session = { id: event.pointerId, sourceLine: lineNumber, preview, line };
    try { this.wrapper.setPointerCapture(event.pointerId); } catch { /* iOS may decline */ }
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  pointerMove(event: PointerEvent): boolean {
    const current = this.session;
    if (!current || current.id !== event.pointerId) return false;
    current.line.setAttribute('x2', String(event.clientX));
    current.line.setAttribute('y2', String(event.clientY));
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  pointerEnd(event: PointerEvent): boolean {
    const current = this.session;
    if (!current || current.id !== event.pointerId) return false;
    this.session = null;
    current.preview.remove();
    try { this.wrapper.releasePointerCapture(event.pointerId); } catch { /* may already be released */ }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'pointercancel') return true;
    const doc = this.wrapper.ownerDocument;
    const candidates = typeof doc.elementsFromPoint === 'function'
      ? doc.elementsFromPoint(event.clientX, event.clientY)
      : [doc.elementFromPoint(event.clientX, event.clientY)].filter(
        (e): e is Element => Boolean(e));
    let targetLine: number | null = null;
    for (const element of candidates) {
      const overlay = element.closest<HTMLElement>('.mindmap-overlay[data-node-line]');
      if (!overlay || !this.wrapper.contains(overlay)) continue;
      const lineNumber = Number(overlay.dataset.nodeLine);
      if (Number.isFinite(lineNumber) && lineNumber !== current.sourceLine) {
        targetLine = lineNumber;
        break;
      }
    }
    const source = this.view.getNodeByLine(current.sourceLine);
    const target = targetLine === null ? null : this.view.getNodeByLine(targetLine);
    if (source && target) {
      showRelationKindMenu(this.view, source, target, { x: event.clientX, y: event.clientY });
    }
    return true;
  }

  cancel(): void {
    this.session?.preview.remove();
    this.session = null;
  }
}
