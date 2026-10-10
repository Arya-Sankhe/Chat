import test from "node:test";
import assert from "node:assert/strict";
import { clearOf, revealView } from "../whiteboard/src/make-room.js";

const view = { x: 0, y: 0, width: 1000, height: 600 };

test("a drawing inside the view stays where Klui put it", () => {
  assert.deepEqual(clearOf({ x: 100, y: 100, width: 200, height: 100 }, view, [{ x: 120, y: 120, width: 50, height: 50 }]), { dx: 0, dy: 0 });
});

test("a drawing past the view's edge moves clear of parts Klui couldn't see", () => {
  const below = { x: 100, y: 650, width: 200, height: 100 };
  assert.deepEqual(clearOf(below, view, []), { dx: 0, dy: 0 });
  assert.deepEqual(clearOf(below, view, [{ x: 50, y: 700, width: 300, height: 200 }]), { dx: 0, dy: 330 });
  const right = { x: 1050, y: 100, width: 200, height: 100 };
  // Two hidden notes in a row: it keeps going until nothing is in the way.
  const occupied = [{ x: 1100, y: 50, width: 100, height: 100 }, { x: 1300, y: 80, width: 100, height: 100 }];
  const { dx, dy } = clearOf(right, view, occupied);
  assert.equal(dy, 0);
  assert.equal(right.x + dx, 1480);
});

test("an addition on or beside a drawing Klui saw stays with it", () => {
  const house = { x: 700, y: 200, width: 280, height: 300 };
  const hidden = [{ x: 1100, y: 200, width: 300, height: 200 }];
  // A label 25 units right of the house, just past the view's edge.
  assert.deepEqual(clearOf({ x: 1005, y: 300, width: 120, height: 30 }, view, hidden, [house]), { dx: 0, dy: 0 });
  // A chimney poking out of the top of the view, on the house's roof.
  assert.deepEqual(clearOf({ x: 750, y: -40, width: 40, height: 260 }, { ...view, y: 0 }, [{ x: 740, y: -300, width: 80, height: 200 }], [house]), { dx: 0, dy: 0 });
  // Far from the house, the same label makes room.
  assert.notDeepEqual(clearOf({ x: 1150, y: 300, width: 120, height: 30 }, view, hidden, [house]), { dx: 0, dy: 0 });
});

test("the view moves only as far as needed to show the drawing", () => {
  assert.equal(revealView({ x: 100, y: 100, width: 200, height: 100 }, view, 60), null);
  assert.deepEqual(revealView({ x: 100, y: 650, width: 200, height: 100 }, view, 60), { x: 0, y: 210 });
  assert.deepEqual(revealView({ x: 1050, y: 100, width: 200, height: 100 }, view, 60), { x: 310, y: 0 });
  assert.deepEqual(revealView({ x: -300, y: -50, width: 200, height: 100 }, view, 60), { x: -360, y: -110 });
  assert.equal(revealView({ x: 900, y: 0, width: 1200, height: 100 }, view, 60), "fit");
});
