// Lists in board text. Typing "- " or "* " at the start of a line makes a "• " bullet, Enter on
// a bullet or numbered line starts the next item, and Enter on an empty item ends the list.
// The bullet button (or Ctrl/Cmd+Shift+8) turns the selected lines into bullets, or back. Pure
// string helpers; the editor island wires them to Excalidraw's text box.

export const BULLET = "•";
const ITEM = /^([ \t]*)(?:(•)|(\d{1,3})([.)])) /;
const TYPED_BULLET = /^([ \t]*)[-*] $/;
const PASTED_BULLET = /^([ \t]*)[-*+] (?=\S)/gm;

/** The "- " or "* " just typed at the start of `line` (the text before the caret) as a bullet, or null. */
export function typedBullet(line) {
  const match = line.match(TYPED_BULLET);
  return match ? `${match[1]}${BULLET} ` : null;
}

/**
 * What Enter does on a list line, split at the caret into `before` and `after`: { remove, insert }
 * (characters to delete before the caret, then text to insert), or null for a plain new line.
 */
export function continueList(before, after) {
  const match = before.match(ITEM);
  if (!match) return null;
  const [marker, indent, bullet, number, dot] = match;
  // Enter on an item with nothing in it ends the list and leaves the line blank.
  if (before === marker && !after.trim()) return { remove: marker.length, insert: "" };
  return { remove: 0, insert: `\n${indent}${bullet ? BULLET : `${Number(number) + 1}${dot}`} ` };
}

/** Whether every non-blank line of `lines` is already a list item. */
export function isList(lines) {
  const filled = lines.filter((line) => line.trim());
  return filled.length > 0 && filled.every((line) => ITEM.test(line));
}

/** The lines `lines` with bullets added, or taken off when every non-blank line has one already. */
export function toggleBullets(lines) {
  const off = isList(lines);
  return lines.map((line) => {
    if (!line.trim() || (!off && ITEM.test(line))) return line;
    if (off) return line.replace(ITEM, "$1");
    const [, indent, rest] = line.match(/^([ \t]*)(.*)$/);
    return `${indent}${BULLET} ${rest}`;
  });
}

/**
 * Pasted text as the text boxes it becomes: one box for the whole paste, with Markdown-style
 * "- " bullets drawn as "•". A paste longer than a box holds is split at blank lines, then lines.
 */
export function pastedBlocks(text, maxChars) {
  const clean = text.replace(/\r\n?/g, "\n").replace(PASTED_BULLET, `$1${BULLET} `);
  if (clean.length <= maxChars) return [clean];
  const cut = (part) => Array.from({ length: Math.ceil(part.length / maxChars) }, (_, index) => part.slice(index * maxChars, (index + 1) * maxChars));
  const pieces = clean.split(/(?<=\n\n)/).flatMap((paragraph) => (paragraph.length <= maxChars ? [paragraph]
    : paragraph.split(/(?<=\n)/).flatMap((line) => (line.length <= maxChars ? [line] : cut(line)))));
  const blocks = [""];
  for (const piece of pieces) {
    if (blocks.at(-1).length + piece.length > maxChars) blocks.push("");
    blocks[blocks.length - 1] += piece;
  }
  return blocks.map((block) => block.trim()).filter(Boolean);
}
