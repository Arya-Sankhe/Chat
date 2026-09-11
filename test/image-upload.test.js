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
