import test from "node:test";
import assert from "node:assert/strict";
import { createComposerKlui } from "../public/js/composerKlui.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Just enough DOM for the composer sprite; animations finish after their duration and stay held
// (while running or filled forwards) until cancelled.
function fakeElement() {
  const animations = [];
  const element = {
    dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {} },
    setAttribute() {}, append() {}, prepend() {}, remove() {},
    getAnimations: () => animations.filter((a) => !a.cancelled && (a.running || a.options.fill === "forwards")),
    animate(frames, options) {
      const animation = { frames, options, running: true, cancelled: false, cancel() { this.cancelled = true; } };
      animation.finished = wait(options.duration).then(() => { animation.running = false; });
      animations.push(animation);
      return animation;
    }
  };
  return element;
}

test("a reply that ends mid-teleport brings Klui back fully on screen", async (t) => {
  const original = Object.getOwnPropertyDescriptors(globalThis);
  t.after(() => {
    for (const key of ["document", "matchMedia"]) {
      if (original[key]) Object.defineProperty(globalThis, key, original[key]);
      else delete globalThis[key];
    }
  });
  let sprite;
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.document = {
    body: fakeElement(),
    createElement() {
      const element = fakeElement();
      Object.defineProperty(element, "innerHTML", { set() { sprite = fakeElement(); element.firstElementChild = sprite; } });
      return element;
    }
  };

  const klui = createComposerKlui({ host: fakeElement(), findTarget: () => null });
  klui.sync({ show: true, running: false, key: "a" });
  await wait(600); // pops up out of its portal

  klui.sync({ show: true, running: true, key: "a" }); // starts sinking into a portal
  await wait(100); // mid-sink (60 ms portal + 150 ms sink)
  klui.sync({ show: true, running: false, key: "a" }); // the reply stops
  await wait(600);

  assert.equal(klui.root.dataset.shown, "true");
  const held = sprite.getAnimations().filter((a) => a.options.fill === "forwards");
  assert.deepEqual(held, [], "the sink's held transform must not outlast the teleport");
  klui.sync({ show: false, running: false, key: "a" });
});
