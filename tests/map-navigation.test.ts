import { describe, expect, it } from 'vitest';
import { pinchViewport } from '../src/embeds/map-navigation';

describe('map zoom coordinates', () => {
  it('keeps the model point beneath a moving pinch center', () => {
    const before = { x: 120, y: 90 }, after = { x: 160, y: 100 };
    const pan = { x: 20, y: 30 }, zoom = 2;
    const result = pinchViewport(before, after, 1.5, zoom, pan);
    expect((after.x - result.pan.x) / result.zoom).toBe((before.x - pan.x) / zoom);
    expect((after.y - result.pan.y) / result.zoom).toBe((before.y - pan.y) / zoom);
  });
  it('clamps extreme zoom while preserving the gesture anchor', () => {
    const center = { x: 100, y: 100 };
    const result = pinchViewport(center, center, 100, 1, { x: 0, y: 0 });
    expect(result.zoom).toBe(8);
    expect((center.x - result.pan.x) / result.zoom).toBe(100);
    expect(pinchViewport(center, center, 0.00001, 1, center).zoom).toBe(0.05);
  });
});

import { vi } from 'vitest';
import type { Core } from 'cytoscape';
import { bindMapNavigation } from '../src/embeds/map-navigation';

it('routes fingers to navigation, blocks palm movement during ink, and cleans up', () => {
  const wrapper = new EventTarget() as EventTarget & {
    closest: () => null; getBoundingClientRect: () => { left: number; top: number };
    setPointerCapture: () => void; hasPointerCapture: () => boolean;
  };
  wrapper.closest = () => null;
  wrapper.getBoundingClientRect = () => ({ left: 0, top: 0 });
  wrapper.setPointerCapture = () => {};
  wrapper.hasPointerCapture = () => false;
  const panBy = vi.fn(), viewport = vi.fn();
  const cy = { panBy, viewport, zoom: () => 1, pan: () => ({ x: 0, y: 0 }) } as unknown as Core;
  const cleanup = bindMapNavigation(wrapper as unknown as HTMLElement, cy);
  const emit = (type: string, pointerId: number, pointerType: string, clientX: number, clientY: number) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId, pointerType, clientX, clientY });
    wrapper.dispatchEvent(event);
    return event;
  };
  emit('pointerdown', 1, 'touch', 20, 20);
  emit('pointermove', 1, 'touch', 50, 60);
  expect(panBy).toHaveBeenLastCalledWith({ x: 30, y: 40 });
  emit('pointerup', 1, 'touch', 50, 60);
  emit('pointerdown', 2, 'pen', 20, 20);
  expect(emit('pointerdown', 3, 'touch', 0, 0).defaultPrevented).toBe(true);
  emit('pointermove', 3, 'touch', 100, 100);
  expect(panBy).toHaveBeenCalledTimes(1);
  emit('pointerup', 2, 'pen', 20, 20);
  emit('pointerdown', 4, 'touch', 20, 20);
  emit('pointerdown', 5, 'touch', 100, 20);
  emit('pointermove', 5, 'touch', 180, 20);
  expect(viewport).toHaveBeenLastCalledWith({ zoom: 2, pan: { x: -20, y: -20 } });
  cleanup();
  emit('pointermove', 5, 'touch', 200, 20);
  expect(viewport).toHaveBeenCalledTimes(1);
});
