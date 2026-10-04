import assert from "node:assert/strict";
import test from "node:test";

import { downscaleImageForUpload, presignUpload, putUploadContent } from "../public/js/api.js";

test("oversized images are proportionally resized below 10MB", async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  let closed = false;
  let drawn = [];
  let smoothingQuality = "low";
  let bitmapOptions;

  globalThis.createImageBitmap = async (_file, options) => {
    bitmapOptions = options;
    return {
      width: 4000,
      height: 3000,
      close() { closed = true; }
    };
  };
  globalThis.document = {
    createElement() {
      const context = {
        imageSmoothingQuality: "low",
        drawImage: (...args) => {
          drawn = args;
          smoothingQuality = context.imageSmoothingQuality;
        }
      };
      let width = 0;
      let height = 0;
      return {
        get width() { return width; },
        set width(value) { width = value; context.imageSmoothingQuality = "low"; },
        get height() { return height; },
        set height(value) { height = value; context.imageSmoothingQuality = "low"; },
        getContext: () => context,
        toBlob(callback, type) {
          callback(new Blob([new Uint8Array(this.width * this.height)], { type }));
        }
      };
    }
  };

  try {
    const file = new File([new Uint8Array(12 * 1024 * 1024)], "photo.png", { type: "image/png" });
    const resized = await downscaleImageForUpload(file);
    assert.ok(resized.size <= 10 * 1024 * 1024);
    assert.equal(resized.type, "image/png");
    assert.equal(resized.name, "photo.png");
    assert.ok(Math.abs(drawn[3] / drawn[4] - 4 / 3) < 0.001);
    assert.equal(smoothingQuality, "high");
    assert.deepEqual(bitmapOptions, { imageOrientation: "from-image" });
    assert.equal(closed, true);

    let presignedSize = 0;
    let uploadedBody;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url) === "/api/uploads/presign") {
        presignedSize = JSON.parse(options.body).sizeBytes;
        return new Response(JSON.stringify({ uploadId: "upload-1", uploadUrl: "/r2", category: "image" }), {
          headers: { "content-type": "application/json" }
        });
      }
      uploadedBody = options.body;
      return { ok: true };
    };
    const prepared = await presignUpload(null, file);
    await putUploadContent(null, prepared.upload, prepared.file);
    assert.equal(presignedSize, prepared.file.size);
    assert.equal(uploadedBody, prepared.file);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("unsupported image types pass through for server validation", async () => {
  const file = new File([new Uint8Array(11 * 1024 * 1024)], "image.svg", { type: "image/svg+xml" });
  assert.equal(await downscaleImageForUpload(file), file);
});

test("cancelled and animated image resizing stops cleanly", async () => {
  const png = new File([new Uint8Array(11 * 1024 * 1024)], "image.png", { type: "image/png" });
  await assert.rejects(downscaleImageForUpload(png, undefined, { signal: AbortSignal.abort() }), { name: "AbortError" });

  const gif = new File([new Uint8Array(11 * 1024 * 1024)], "image.gif", { type: "image/gif" });
  await assert.rejects(downscaleImageForUpload(gif), /10MB or smaller/);
});

test("images already within the limit are untouched", async () => {
  const file = new File(["small"], "photo.webp", { type: "image/webp" });
  assert.equal(await downscaleImageForUpload(file), file);
});

function mockCanvasEnvironment({ width, height }) {
  const draws = [];
  const original = { createImageBitmap: globalThis.createImageBitmap, document: globalThis.document };
  let closed = false;
  globalThis.createImageBitmap = async () => ({ width, height, close() { closed = true; } });
  globalThis.document = {
    createElement() {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (_source, _x, _y, w, h) => draws.push([w, h])
        }),
        toBlob(callback, type, quality) {
          canvas.quality = quality;
          callback(new Blob([new Uint8Array(Math.round(canvas.width * canvas.height / 8))], { type }));
        }
      };
      return canvas;
    }
  };
  return {
    draws,
    get closed() { return closed; },
    restore() {
      globalThis.createImageBitmap = original.createImageBitmap;
      if (original.document === undefined) delete globalThis.document;
      else globalThis.document = original.document;
    }
  };
}

test("large photos under the byte cap are fit to a 2048px long edge in halving steps", async () => {
  const env = mockCanvasEnvironment({ width: 6000, height: 4000 });
  try {
    const file = new File([new Uint8Array(3 * 1024 * 1024)], "camera.jpg", { type: "image/jpeg" });
    const resized = await downscaleImageForUpload(file);
    assert.notEqual(resized, file);
    assert.equal(resized.type, "image/jpeg");
    assert.deepEqual(env.draws, [[3000, 2000], [2048, 1365]]);
    assert.equal(env.closed, true);
  } finally {
    env.restore();
  }
});

test("images already within 2048px and the byte cap are not re-encoded", async () => {
  const env = mockCanvasEnvironment({ width: 1920, height: 1080 });
  try {
    const file = new File([new Uint8Array(900 * 1024)], "shot.png", { type: "image/png" });
    assert.equal(await downscaleImageForUpload(file), file);
    assert.deepEqual(env.draws, []);
    assert.equal(env.closed, true);
  } finally {
    env.restore();
  }
});
