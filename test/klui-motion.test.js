import test from "node:test";
import assert from "node:assert/strict";
import { projectKluiFace, mountKluiMotion, kluiGazePose, playKluiReaction } from "../public/js/klui-motion.js";

test("Klui wraps over a curved surface, compresses the contour eye, and keeps poses bounded", () => {
  const right = projectKluiFace(.6, 0);
  const left = projectKluiFace(-.6, 0);
  const xy = (pose) => [...pose.face.matchAll(/translate\(([-\d.]+)px, ([-\d.]+)px\)/g)][0].slice(1).map(Number);
  const [x, y] = xy(right);
  assert.ok(x > 7 && x < 9);
  assert.ok(y > 1 && y < 2, "horizontal travel must arc vertically");
  assert.equal(xy(left)[0], -x);
  assert.equal(xy(left)[1], y);
  assert.match(right.left, /scale\(1, 1\)/);
  assert.match(left.right, /scale\(1, 1\)/);
  assert.match(right.right, /scale\(0\.7/);
  assert.match(left.left, /scale\(0\.7/);
  assert.ok(xy(projectKluiFace(.6, .3))[1] < y, "looking up raises the face");
  assert.deepEqual(projectKluiFace(100, -100), projectKluiFace(.65, -.35));
  assert.match(projectKluiFace(.3, 0, "reading").left, /, 0\.76\)/);
  assert.match(projectKluiFace(.3, 0, "sleepy").left, /, 0\.42\)/);
  assert.equal(projectKluiFace(0, 0).face, "translate(0px, 0px) rotate(0deg) scaleX(1)");
  for (const state of ["idle", "hello", "curious", "thinking", "reading", "searching", "writing", "generating", "reviewing", "sleepy"]) {
    const poses = Array.from({ length: 7 }, (_, i) => kluiGazePose(state, i));
    assert.ok(poses.some(([x, y]) => x === 0 && y === 0), `${state}: eye contact`);
    assert.ok(poses.some(([x, y]) => x === 0 && y > 0), `${state}: up`);
    assert.ok(poses.some(([x, y]) => x === 0 && y < 0), `${state}: down`);
    assert.ok(poses.some(([x]) => x < 0), `${state}: left`);
    assert.ok(poses.some(([x]) => x > 0), `${state}: right`);
  }
});

test("Klui mounts once, pauses for reduced motion and completion, and releases detached mascots", (t) => {
  const original = Object.getOwnPropertyDescriptors(globalThis);
  t.after(() => {
    for (const key of ["document", "matchMedia", "IntersectionObserver", "setTimeout"]) {
      if (original[key]) Object.defineProperty(globalThis, key, original[key]);
      else delete globalThis[key];
    }
  });
  let next, reduced = false, done = false, disconnected = 0, animations = 0;
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.method(Math, "random", () => .2);
  globalThis.document = { hidden: false };
  globalThis.matchMedia = () => ({ matches: reduced });
  globalThis.setTimeout = (fn) => { next = fn; return 1; };
  globalThis.IntersectionObserver = class {
    observe() {}
    disconnect() { disconnected++; }
  };
  const part = () => ({ style: {}, getAnimations: () => [], animate: () => { animations++; } });
  const face = part(), left = part(), right = part();
  let bodyMoves = 0;
  const body = { ...part(), animate: () => { bodyMoves++; } };
  const eyes = Array.from({ length: 6 }, part); // Capsules, stars, happy arcs.
  const element = {
    isConnected: true, dataset: {},
    querySelector: (selector) => ({ ".face": face, ".eye-surface-l": left, ".eye-surface-r": right, ".klui-svg": body })[selector],
    querySelectorAll: () => eyes,
    closest: () => ({ dataset: { state: "thinking" }, matches: () => done }),
    getAnimations: () => [],
    addEventListener: () => {},
  };
  mountKluiMotion(element);
  assert.ok(face.style.transform.includes("translate"));
  const count = animations;
  mountKluiMotion(element);
  next();
  assert.equal(animations, count, "holding a gaze should not restart its animation");
  now = 3000;
  next();
  assert.equal(bodyMoves, 1, "occasionally wiggle the whole squircle");
  assert.equal(animations - count, 9, "three gaze layers plus all six eye shapes blink during a gaze shift");
  const afterMovement = animations;
  reduced = true;
  next();
  assert.equal(element.dataset.motion, "paused");
  assert.equal(animations, afterMovement);
  now = 15000;
  next();
  assert.equal(bodyMoves, 1, "reduced motion suppresses body gestures");
  reduced = false;
  next();
  assert.equal(element.dataset.motion, "active");
  // A tap hops the body (1 animation on the squircle) and follows with a gaze
  // shift plus a blink (3 gaze layers + 6 eye shapes).
  const beforeTap = animations;
  const beforeTapBody = bodyMoves;
  playKluiReaction(element);
  assert.equal(bodyMoves, beforeTapBody + 1, "a tap hops the body");
  assert.equal(animations, beforeTap + 9, "the gaze shift and blink follow the hop");
  done = true;
  next();
  assert.equal(element.dataset.motion, "paused");
  playKluiReaction(element);
  assert.equal(bodyMoves, beforeTapBody + 1, "paused mascots ignore taps");
  assert.equal(animations, beforeTap + 9, "paused mascots ignore taps");
  // Partial markup is skipped. Mounting it would throw mid-tick and stop the
  // shared timer, freezing every mascot on the page.
  mountKluiMotion({ isConnected: true, dataset: {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [] });
  next();
  element.isConnected = false;
  next();
  assert.equal(disconnected, 1);
});
