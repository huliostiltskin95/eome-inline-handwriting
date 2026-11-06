import { Menu } from 'obsidian';
import type { OutlineNode } from '../../utils/outline';
import type { MindmapView } from '../../view/mindmap-view';
import { addBlankDrawingWithRelation } from '../../drawing/drawing-actions';
import type { RelationArrowMode, RelationKind } from '../../view/relations';

export type NewNodeGeometry = 'parallel' | 'elbow';
export const NEW_NODE_CHOICES: ReadonlyArray<{ geometry: NewNodeGeometry; kind: RelationKind; title: string }> = [
  { geometry: 'parallel', kind: 'figlio', title: 'Nuovo nodo parallelo —' },
  { geometry: 'elbow', kind: 'dettaglio', title: 'Nuovo nodo a L └' }
];
export const ARROW_CHOICES: ReadonlyArray<{ mode: RelationArrowMode; title: string }> = [
  { mode: 'none', title: 'Senza freccia' },
  { mode: 'start', title: 'Freccia all’inizio' },
  { mode: 'end', title: 'Freccia alla fine' },
  { mode: 'both', title: 'Frecce a entrambe le estremità' }
];

function openAt(menu: Menu, view: MindmapView, position: { x: number; y: number }): void {
  menu.showAtPosition(position, view.wrapper.ownerDocument);
}

export function showNewNodeArrowMenu(
  view: MindmapView, node: OutlineNode, kind: RelationKind,
  position: { x: number; y: number }
): void {
  const menu = new Menu();
  const heading = kind === 'figlio' ? 'Parallelo —' : 'A L └';
  menu.addItem(item => item.setTitle(heading + ' · scegli frecce').setDisabled(true));
  for (const choice of ARROW_CHOICES) {
    menu.addItem(item => item
      .setTitle(choice.title)
      .setIcon(choice.mode === 'none' ? 'minus' :
        choice.mode === 'both' ? 'move-horizontal' : 'arrow-right')
      .onClick(() => { void addBlankDrawingWithRelation(view, node, kind, choice.mode); }));
  }
  openAt(menu, view, position);
}

export function appendNewNodeChoices(
  menu: Menu, view: MindmapView, node: OutlineNode,
  position: { x: number; y: number }
): void {
  for (const choice of NEW_NODE_CHOICES) {
    menu.addItem(item => item
      .setTitle(choice.title)
      .setIcon(choice.geometry === 'parallel' ? 'minus' : 'corner-down-right')
      .onClick(() => showNewNodeArrowMenu(view, node, choice.kind, position)));
  }
}

export function showNewNodeMenu(
  view: MindmapView, node: OutlineNode,
  position: { x: number; y: number }
): void {
  const menu = new Menu();
  appendNewNodeChoices(menu, view, node, position);
  openAt(menu, view, position);
}
