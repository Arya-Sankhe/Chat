import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { loadConfig } from "../server/config.js";
import { createApiHandler } from "../server/routes.js";
import { stripImageMetadata } from "../server/storage/stripImageMetadata.js";

const GPS = "GPSLAT99";

function jpegWithExif() {
  const app1 = Buffer.concat([Buffer.from("Exif\0\0"), Buffer.from(GPS)]);
  const app1Len = Buffer.alloc(2);
  app1Len.writeUInt16BE(app1.length + 2);
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    Buffer.from([0xff, 0xe1]),
    app1Len,
    app1,
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    Buffer.from([0x00, 0xff, 0xd9])
  ]);
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([
    length,
    Buffer.from(type),
    data,
    Buffer.alloc(4)
  ]);
}

function pngWithExif() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.alloc(13)),
    pngChunk("eXIf", Buffer.from(GPS)),
    pngChunk("IDAT", Buffer.from([0x00])),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function webpWithExif() {
  const vp8xFlags = Buffer.from([0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const vp8xSize = Buffer.alloc(4);
  vp8xSize.writeUInt32LE(vp8xFlags.length);
  const exif = Buffer.from(GPS);
  const exifSize = Buffer.alloc(4);
  exifSize.writeUInt32LE(exif.length);
  const payload = Buffer.concat([
    Buffer.from("VP8X"),
    vp8xSize,
    vp8xFlags,
    Buffer.from("EXIF"),
    exifSize,
    exif
  ]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(4 + payload.length);
  return Buffer.concat([Buffer.from("RIFF"), riffSize, Buffer.from("WEBP"), payload]);
}

const SUPABASE_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CROFAI_API_KEY: "crof-key",
  OPENROUTER_API_KEY: "or-key",
  SARVAM_API_KEY: "sarvam-key",
  R2_ACCOUNT_ID: "account-1",
  R2_ACCESS_KEY_ID: "r2-key",
  R2_SECRET_ACCESS_KEY: "r2-secret",
  R2_BUCKET: "uploads"
};

function makeReq({ method = "GET", path = "/api/health", headers = {}, body = null } = {}) {
  const chunks = body == null
    ? []
    : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = path;
  req.headers = { host: "test.local", ...headers };
  req.aborted = false;
  return req;
}

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(headers || {})) {
        this.headers[String(name).toLowerCase()] = value;
      }
      this.headersSent = true;
      return this;
    },
    write(chunk) {
      this.body += String(chunk);
      return true;
    },
    end(chunk) {
      if (chunk) this.body += String(chunk);
      this.writableEnded = true;
      return this;
    },
    on() {},
    json() {
      return JSON.parse(this.body);
    }
  };
}

async function dispatch({ method = "GET", path, headers, body, overrides } = {}) {
  const req = makeReq({ method, path, headers, body });
  const res = makeRes();
  await createApiHandler(loadConfig(SUPABASE_ENV), overrides)(req, res, new URL(path, "http://test.local"));
  return res;
}

test("JPEG APP1 GPS is dropped and JFIF is kept", () => {
  const original = jpegWithExif();
  assert.match(original.toString("latin1"), new RegExp(GPS));
  const cleaned = stripImageMetadata(original);
  assert.equal(cleaned[0], 0xff);
  assert.equal(cleaned[1], 0xd8);
  assert.doesNotMatch(cleaned.toString("latin1"), new RegExp(GPS));
  assert.match(cleaned.toString("latin1"), /JFIF/);
  assert.ok(cleaned.length < original.length);
});

test("PNG eXIf GPS is dropped", () => {
  const original = pngWithExif();
  const cleaned = stripImageMetadata(original);
  assert.doesNotMatch(cleaned.toString("latin1"), new RegExp(GPS));
  assert.match(cleaned.toString("latin1"), /IHDR/);
  assert.match(cleaned.toString("latin1"), /IDAT/);
});

test("WebP EXIF GPS is dropped and the EXIF flag is cleared", () => {
  const original = webpWithExif();
  const cleaned = stripImageMetadata(original);
  assert.doesNotMatch(cleaned.toString("latin1"), new RegExp(GPS));
  assert.doesNotMatch(cleaned.toString("latin1"), /EXIF/);
  assert.equal(cleaned[12 + 8] & 0x08, 0);
});

test("images without metadata are returned unchanged", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
  assert.equal(stripImageMetadata(jpeg), jpeg);
});

test("relay PUT strips GPS before R2 and shrinks the reserved size", async () => {
  const original = jpegWithExif();
  const stored = [];
  const patches = [];
  const res = await dispatch({
    method: "PUT",
    path: "/api/uploads/upload-1/content",
    headers: { "content-type": "image/jpeg" },
    body: original,
    overrides: {
      verifyUser: async () => ({ id: "user-1", email: "user@example.com", raw: {} }),
      createDb: () => ({
        async upsertProfile() { return { id: "user-1", role: "user" }; },
        async getAttachment() {
          return {
            id: "upload-1",
            user_id: "user-1",
            category: "image",
            object_key: "users/user-1/photo.jpg",
            file_name: "photo.jpg",
            content_type: "image/jpeg",
            size_bytes: original.length,
            status: "pending"
          };
        },
        async updateAttachment(_userId, _id, patch) {
          patches.push(patch);
        }
      }),
      createR2: () => ({
        async putObject(_key, body) {
          stored.push(body);
          return { etag: "etag-1" };
        }
      })
    }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(stored.length, 1);
  assert.doesNotMatch(stored[0].toString("latin1"), new RegExp(GPS));
  assert.equal(patches[0].size_bytes, stored[0].length);
  assert.ok(patches[0].size_bytes < original.length);
});

test("complete overwrites a direct PUT that still has GPS", async () => {
  const original = jpegWithExif();
  const cleaned = stripImageMetadata(original);
  const stored = [original];
  let completedSize = null;
  const res = await dispatch({
    method: "POST",
    path: "/api/uploads/complete",
    body: { uploadId: "upload-1" },
    overrides: {
      verifyUser: async () => ({ id: "user-1", email: "user@example.com", raw: {} }),
      createDb: () => ({
        async upsertProfile() { return { id: "user-1", role: "user" }; },
        async getAttachment() {
          return {
            id: "upload-1",
            user_id: "user-1",
            category: "image",
            object_key: "users/user-1/photo.jpg",
            file_name: "photo.jpg",
            content_type: "image/jpeg",
            size_bytes: original.length,
            status: "pending"
          };
        },
        async completeReservedAttachment(params) {
          completedSize = params.sizeBytes;
          return {
            id: "upload-1",
            file_name: "photo.jpg",
            content_type: "image/jpeg",
            category: "image",
            size_bytes: params.sizeBytes,
            status: "uploaded"
          };
        }
      }),
      createR2: () => ({
        async headObject() { return { sizeBytes: original.length, etag: "etag-raw" }; },
        async getObject() { return stored[0]; },
        async putObject(_key, body) {
          stored[0] = body;
          return { etag: "etag-clean" };
        }
      })
    }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(completedSize, cleaned.length);
  assert.doesNotMatch(stored[0].toString("latin1"), new RegExp(GPS));
  assert.equal(res.json().sizeBytes, cleaned.length);
});
