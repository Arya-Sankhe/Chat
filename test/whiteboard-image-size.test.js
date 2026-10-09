import test from "node:test";
import assert from "node:assert/strict";
import { fitImageSize } from "../whiteboard/src/image-size.js";

test("new images fit a reasonable screen size while keeping their aspect ratio", () => {
  for (const zoom of [.5, 1, 2]) {
    const state = { width: 1280, height: 748, zoom: { value: zoom } };
    const size = fitImageSize(4000, 3000, state);
    assert.equal(size.width * zoom, 320);
    assert.equal(size.height * zoom, 240);
    assert.equal(size.width / size.height, 4 / 3);
  }
  assert.deepEqual(fitImageSize(80, 60, { width: 1280, height: 748, zoom: { value: 1 } }), { width: 80, height: 60 });
  const mobile = fitImageSize(4000, 1000, { width: 390, height: 748, zoom: { value: 1 } });
  assert.equal(mobile.width, 156);
  assert.equal(mobile.height, 39);
});
