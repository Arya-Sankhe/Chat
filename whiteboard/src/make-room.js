// Room for a spoken drawing. When the student's view is full, Klui draws just past its edge; there
// it may land on parts of the board it couldn't see, so it moves clear of them, and the view then
// glides just far enough to show it. Boxes are { x, y, width, height } in scene coordinates.

const GAP = 80;

const overlaps = (a, b, gap) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

/**
 * The shift that keeps `box` clear of `occupied` boxes (parts Klui couldn't see). A box inside
 * `view`, or on or near a `seen` box (a label beside a house it saw), stays where it is; one past
 * an edge moves further out in that direction until nothing is in its way.
 */
export function clearOf(box, view, occupied, seen = [], gap = GAP) {
  const right = box.x + box.width > view.x + view.width;
  const below = box.y + box.height > view.y + view.height;
  const left = box.x < view.x;
  const above = box.y < view.y;
  if (!right && !below && !left && !above) return { dx: 0, dy: 0 };
  if (seen.some((rect) => overlaps(box, rect, gap))) return { dx: 0, dy: 0 };
  let dx = 0;
  let dy = 0;
  for (let pass = 0; pass <= occupied.length; pass += 1) {
    const moved = { ...box, x: box.x + dx, y: box.y + dy };
    const hit = occupied.find((rect) => overlaps(moved, rect, gap));
    if (!hit) break;
    if (right) dx = hit.x + hit.width + gap - box.x;
    else if (below) dy = hit.y + hit.height + gap - box.y;
    else if (left) dx = hit.x - gap - box.width - box.x;
    else dy = hit.y - gap - box.height - box.y;
  }
  return { dx, dy };
}

/**
 * Where the view's top-left should go so `box` is on screen with `margin` around it, moving as
 * little as possible: null when it is already on screen, "fit" when it is bigger than the view.
 */
export function revealView(box, view, margin) {
  const inside = box.x >= view.x && box.y >= view.y && box.x + box.width <= view.x + view.width && box.y + box.height <= view.y + view.height;
  if (inside) return null;
  if (box.width + margin * 2 > view.width || box.height + margin * 2 > view.height) return "fit";
  const x = Math.min(Math.max(view.x, box.x + box.width + margin - view.width), box.x - margin);
  const y = Math.min(Math.max(view.y, box.y + box.height + margin - view.height), box.y - margin);
  return x === view.x && y === view.y ? null : { x, y };
}

/**
 * Before folding a newer copy of a board saved elsewhere into this one: ids the server had at the
 * last sync (`known`) that the newer copy lacks were deleted elsewhere, so they're returned marked
 * deleted (via `markDeleted`) instead of surviving as if they were new here.
 */
export function deletedElsewhere(local, remote, known, markDeleted) {
  const there = new Set(remote.map((element) => element.id));
  return local.map((element) => (known.has(element.id) && !there.has(element.id) && !element.isDeleted ? markDeleted(element) : element));
}

/**
 * Keeps a replayed change from fighting the student: it remembers the animated fields of each
 * element as the replay last wrote them, and an element that no longer matches was edited by
 * someone else, so the replay leaves it alone from then on.
 */
export function replayGuard(elements, keys) {
  const sign = (element) => keys.map((key) => JSON.stringify(element[key] ?? null)).join("|");
  const written = new Map(elements.map((element) => [element.id, sign(element)]));
  return {
    owns(element) {
      if (!written.has(element.id)) return false;
      if (written.get(element.id) === sign(element)) return true;
      written.delete(element.id);
      return false;
    },
    wrote(element) { if (written.has(element.id)) written.set(element.id, sign(element)); }
  };
}
