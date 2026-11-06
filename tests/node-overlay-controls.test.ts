import { describe, expect, it, vi } from 'vitest';
import type { OutlineNode } from '../src/utils/outline';
import { appendCheckboxToggle, appendNodeControls } from '../src/view/node-overlay-controls';

type Listener = EventListenerOrEventListenerObject;

class FakeClassList {
  private readonly values = new Set<string>();

  add(...names: string[]): void { names.forEach((name) => this.values.add(name)); }
  contains(name: string): boolean { return this.values.has(name); }
  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.values.has(name);
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();
  type = '';
  textContent = '';

  constructor(readonly ownerDocument: FakeDocument, readonly tagName: string) {}

  // Obsidian's createEl creates in this element's document and appends in one
  // step; the stub mirrors that so the assertions still see the same tree.
  createEl(tagName: string, options?: { prepend?: boolean }): FakeElement {
    const child = this.ownerDocument.createElement(tagName);
    if (options?.prepend) this.children.unshift(child);
    else this.appendChild(child);
    return child;
  }

  getBoundingClientRect(): DOMRect {
    return { top: 20, right: 120, left: 20, bottom: 60, width: 100, height: 40 } as DOMRect;
  }

  createDiv(options?: { prepend?: boolean }): FakeElement {
    return this.createEl('div', options);
  }

  set className(value: string) {
    value.split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name));
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(type: string, listener: Listener | null): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName.toUpperCase());
  }
}

function taskNode(): OutlineNode {
  return {
    text: 'Task', indent: '', marker: '-', line: 4, endLine: 4,
    children: [], checkbox: 'unchecked',
  };
}

function clickEvent(button: number, detail: number, pointerType?: string): MouseEvent {
  return {
    button,
    detail,
    pointerType,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as MouseEvent;
}

describe('node overlay controls', () => {
  it('activates a checkbox exactly once for keyboard and every primary pointer, never secondary', () => {
    const document = new FakeDocument();
    const box = document.createElement('div');
    const toggleNodeCheckbox = vi.fn();
    const view = {
      file: {},
      generalSettings: { showCheckboxesOnHover: false },
      toggleNodeCheckbox,
    } as never;
    const { checkboxToggle } = appendCheckboxToggle(
      box as unknown as HTMLElement,
      taskNode(),
      view
    );
    const button = checkboxToggle as unknown as FakeElement;

    button.emit('pointerdown', clickEvent(0, 1, 'pen'));
    button.emit('pointerup', clickEvent(0, 1, 'pen'));
    expect(toggleNodeCheckbox).not.toHaveBeenCalled();

    const activations = [
      clickEvent(0, 0),
      clickEvent(0, 1, 'mouse'),
      clickEvent(0, 1, 'touch'),
      clickEvent(0, 1, 'pen'),
    ];
    activations.forEach((event, index) => {
      button.emit('click', event);
      expect(toggleNodeCheckbox).toHaveBeenCalledTimes(index + 1);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    });

    const secondary = clickEvent(2, 1, 'mouse');
    button.emit('click', secondary);
    expect(toggleNodeCheckbox).toHaveBeenCalledTimes(activations.length);
    expect(secondary.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('renders add and delete affordances as semantic buttons', () => {
    const document = new FakeDocument();
    const box = document.createElement('div');
    const view = {
      file: {}, app: {}, wrapper: { ownerDocument: document },
    } as never;

    appendNodeControls(box as unknown as HTMLElement, taskNode(), view);

    const controls = box.children[0];
    const deleteButton = box.children[1];
    expect(controls.children.map((button) => button.tagName)).toEqual(['BUTTON']);
    expect(controls.children.every((button) => button.type === 'button')).toBe(true);
    expect(deleteButton.tagName).toBe('BUTTON');
    expect(deleteButton.type).toBe('button');
    expect(deleteButton.attributes.get('aria-label')).toBe('Delete node');

    const first = clickEvent(0, 0);
    controls.children[0].emit('click', first);
    expect(first.stopPropagation).toHaveBeenCalledTimes(1);
    const secondary = clickEvent(2, 1, 'mouse');
    controls.children[0].emit('click', secondary);
    expect(secondary.stopPropagation).toHaveBeenCalledTimes(1);
  });
});
