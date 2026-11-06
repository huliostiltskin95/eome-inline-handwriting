import type { Core } from 'cytoscape';

export interface Point { x: number; y: number }
export function pinchViewport(oldCenter: Point, center: Point, ratio: number, zoom: number, pan: Point) {
  const next = Math.max(0.05, Math.min(8, zoom * ratio));
  return { zoom: next, pan: { x: center.x - (oldCenter.x - pan.x) * next / zoom,
    y: center.y - (oldCenter.y - pan.y) * next / zoom } };
}

/** Pane-local gestures. Pen events are left to the ink controller; touch never inks. */
export function bindMapNavigation(wrapper: HTMLElement, cy: Core): () => void {
  const fingers = new Map<number, Point>();
  let pen: number | null = null;
  let moved = false;
  let suppressClickUntil = 0;
  const point = (e: PointerEvent): Point => {
    const r = wrapper.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const down = (e: PointerEvent) => {
    if ((e.target as Element).closest('button, select, input')) return;
    if (e.pointerType === 'pen') { pen = e.pointerId; fingers.clear(); return; }
    if (e.pointerType !== 'touch') return;
    if (pen !== null) { stop(e); return; }
    if (!fingers.size) moved = false;
    fingers.set(e.pointerId, point(e));
    // Keep the native click for selection, but do not arm node long-press
    // handlers while fingers are navigating or a palm is resting.
    e.stopImmediatePropagation();
    // Preserve the original target for a stationary tap; capture only on drag.
  };
  const move = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    if (pen !== null) { stop(e); return; }
    const old = fingers.get(e.pointerId);
    if (!old) return;
    const next = point(e);
    if (!moved && Math.hypot(next.x - old.x, next.y - old.y) < 5) return;
    const other = [...fingers.entries()].find(([id]) => id !== e.pointerId)?.[1];
    if (other) {
      const distance = Math.hypot(old.x - other.x, old.y - other.y);
      const center = (p: Point) => ({ x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 });
      cy.viewport(pinchViewport(center(old), center(next), distance > 1
        ? Math.hypot(next.x - other.x, next.y - other.y) / distance : 1, cy.zoom(), cy.pan()));
    } else cy.panBy({ x: next.x - old.x, y: next.y - old.y });
    fingers.set(e.pointerId, next);
    moved = true;
    wrapper.setPointerCapture(e.pointerId);
    stop(e);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId === pen) { pen = null; return; }
    if (!fingers.delete(e.pointerId)) return;
    if (wrapper.hasPointerCapture(e.pointerId)) wrapper.releasePointerCapture(e.pointerId);
    if (moved) { suppressClickUntil = Date.now() + 400; stop(e); }
  };
  const click = (e: MouseEvent) => { if (Date.now() < suppressClickUntil) stop(e); };
  const wheel = (e: WheelEvent) => {
    if (pen !== null || (e.target as Element).closest('button, select')) return;
    const rect = wrapper.getBoundingClientRect();
    const center = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    cy.viewport(pinchViewport(center, center, Math.exp(-e.deltaY * 0.002), cy.zoom(), cy.pan()));
    stop(e);
  };
  wrapper.addEventListener('pointerdown', down, { capture: true });
  wrapper.addEventListener('pointermove', move, { capture: true });
  wrapper.addEventListener('pointerup', end, { capture: true });
  wrapper.addEventListener('pointercancel', end, { capture: true });
  wrapper.addEventListener('click', click, { capture: true });
  wrapper.addEventListener('wheel', wheel, { capture: true, passive: false });
  return () => {
    wrapper.removeEventListener('pointerdown', down, { capture: true });
    wrapper.removeEventListener('pointermove', move, { capture: true });
    wrapper.removeEventListener('pointerup', end, { capture: true });
    wrapper.removeEventListener('pointercancel', end, { capture: true });
    wrapper.removeEventListener('click', click, { capture: true });
    wrapper.removeEventListener('wheel', wheel, { capture: true });
  };
}
