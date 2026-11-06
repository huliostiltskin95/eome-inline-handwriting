/** Screen-space padding stays constant; map geometry shares one uniform zoom. */
export function previewHeight(width: number, mapWidth: number, mapHeight: number, padding = 28): number {
  const zoom = Math.max(1, width - 2 * padding) / Math.max(1, mapWidth);
  return Math.max(96, mapHeight * zoom + 2 * padding);
}
