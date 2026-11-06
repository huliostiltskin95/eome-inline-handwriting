/** Mask non-map content without changing source line numbers: editing still
 * targets the original note and never replaces its frontmatter or prose. */
export function mindmapSource(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const visible = lines.map(() => '');
  let start = 0;
  if (lines[0]?.replace(/^\uFEFF/, '').trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)$/.test(line.trim()));
    start = end < 0 ? lines.length : end + 1;
  }
  let found = false;
  for (let i = start; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!open) continue;
    const isMap = open[2].trim() === 'mindmap-eome';
    const close = new RegExp('^ {0,3}' + open[1][0] + '{' + open[1].length + ',}\\s*$');
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    if (isMap) {
      found = true;
      for (let k = i + 1; k < j; k++) visible[k] = lines[k];
    }
    i = j;
  }
  return (found ? visible : lines.map((line, i) => i < start ? '' : line)).join('\n');
}
