export function renderMindMap(title, content, escapeHtml) {
  const root = { label: title, children: [] };
  const stack = [{ depth: 1, node: root }];
  let headingDepth = 1;
  for (const line of String(content || "").split("\n")) {
    const heading = line.match(/^(#{2,5})\s+(.+)/);
    const bullet = line.match(/^(\s*)[-*]\s+(.+)/);
    if (!heading && !bullet) continue;
    const depth = heading ? heading[1].length : headingDepth + 1 + Math.floor(bullet[1].length / 2);
    if (heading) headingDepth = depth;
    while (stack.length > 1 && stack.at(-1).depth >= depth) stack.pop();
    const node = { label: (heading?.[2] || bullet[2]).trim(), children: [] };
    stack.at(-1).node.children.push(node);
    stack.push({ depth, node });
  }
  const render = (nodes) => `<ol class="dojo-map-branches">${nodes.map((node) => `<li class="dojo-map-node">${node.children.length
    ? `<details open class="dojo-map-branch"><summary>${escapeHtml(node.label)}</summary>${render(node.children)}</details>`
    : `<div class="dojo-map-leaf">${escapeHtml(node.label)}</div>`}</li>`).join("")}</ol>`;
  return `<div class="dojo-mindmap"><div class="dojo-map-root">${escapeHtml(title)}</div>${render(root.children)}</div>`;
}
