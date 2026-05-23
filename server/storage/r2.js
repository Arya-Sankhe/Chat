import crypto from "node:crypto";
import { HttpError } from "../http/responses.js";

const supportedImageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const supportedDocumentTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "text/tab-separated-values"
]);
const documentExtensions = new Map([
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".csv", "text/csv"],
  [".tsv", "text/tab-separated-values"]
]);
const region = "auto";
const service = "s3";

function clean(value) {
  return String(value || "").trim();
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodePath(path) {
  return path.split("/").map(encodeRfc3986).join("/");
}

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function amzDate(date) {
  return `${yyyymmdd(date)}T${date.toISOString().slice(11, 19).replace(/:/g, "")}Z`;
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function signingKey(secret, dateStamp) {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

function canonicalQuery(params) {
  return [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

export function isSupportedImageType(contentType) {
  return supportedImageTypes.has(clean(contentType).toLowerCase());
}

export function documentKindFromFileName(fileName) {
  const lower = clean(fileName).toLowerCase();
  for (const ext of documentExtensions.keys()) {
    if (lower.endsWith(ext)) return ext.slice(1);
  }
  return "";
}

export function isSupportedDocumentType(contentType, fileName = "") {
  const normalized = clean(contentType).toLowerCase().split(";")[0];
  if (supportedDocumentTypes.has(normalized)) return true;
  const extType = documentExtensions.get(`.${documentKindFromFileName(fileName)}`);
  return Boolean(extType && (!normalized || normalized === "application/octet-stream"));
}

export function uploadCategoryFromType(contentType, fileName = "") {
  if (isSupportedImageType(contentType)) return "image";
  if (isSupportedDocumentType(contentType, fileName)) return "document";
  return "";
}

export function safeFileName(fileName) {
  const base = clean(fileName).split(/[\\/]/).pop() || "upload";
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "upload";
}

export function assertImageUpload({ contentType, sizeBytes }, maxImageBytes) {
  if (!isSupportedImageType(contentType)) {
    throw new HttpError(400, "Upload must be a png, jpeg, webp, or gif image.");
  }

  const size = Number(sizeBytes);
  if (!Number.isInteger(size) || size <= 0) {
    throw new HttpError(400, "Upload size is required.");
  }

  if (size > maxImageBytes) {
    throw new HttpError(413, `Upload must be ${Math.floor(maxImageBytes / 1024 / 1024)}MB or smaller.`);
  }
}

export function assertDocumentUpload({ contentType, fileName, sizeBytes }, maxDocumentBytes) {
  if (!isSupportedDocumentType(contentType, fileName)) {
    throw new HttpError(400, "Upload must be a PDF, DOCX, XLSX, CSV, or TSV file.");
  }

  const size = Number(sizeBytes);
  if (!Number.isInteger(size) || size <= 0) {
    throw new HttpError(400, "Upload size is required.");
  }

  if (size > maxDocumentBytes) {
    throw new HttpError(413, `Upload must be ${Math.floor(maxDocumentBytes / 1024 / 1024)}MB or smaller.`);
  }
}

export function assertUpload({ category, contentType, fileName, sizeBytes }, limits = {}) {
  const normalized = clean(category || uploadCategoryFromType(contentType, fileName)).toLowerCase();
  if (normalized === "image") {
    assertImageUpload({ contentType, sizeBytes }, limits.maxImageBytes);
    return "image";
  }
  if (normalized === "document") {
    assertDocumentUpload({ contentType, fileName, sizeBytes }, limits.maxDocumentBytes);
    return "document";
  }
  throw new HttpError(400, "Upload must be an image or supported document file.");
}

export class R2Client {
  constructor(config) {
    this.config = config.r2;
  }

  get configured() {
    return Boolean(this.config.endpoint && this.config.accessKeyId && this.config.secretAccessKey && this.config.bucket);
  }

  requireConfigured() {
    if (!this.configured) {
      throw new HttpError(503, "Cloudflare R2 is not configured.");
    }
  }

  objectKey({ userId, fileName }) {
    return `users/${userId}/${crypto.randomUUID()}/${safeFileName(fileName)}`;
  }

  presign(method, key, expiresSeconds, extraParams = {}) {
    this.requireConfigured();

    const now = new Date();
    const dateStamp = yyyymmdd(now);
    const endpoint = new URL(this.config.endpoint);
    const credential = `${this.config.accessKeyId}/${dateStamp}/${region}/${service}/aws4_request`;
    const signedHeaders = "host";
    const params = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": credential,
      "X-Amz-Date": amzDate(now),
      "X-Amz-Expires": String(expiresSeconds),
      "X-Amz-SignedHeaders": signedHeaders
    });
    for (const [paramKey, paramValue] of Object.entries(extraParams || {})) {
      if (paramValue !== undefined && paramValue !== null && paramValue !== "") {
        params.set(paramKey, String(paramValue));
      }
    }

    const canonicalUri = `/${encodePath(`${this.config.bucket}/${key}`)}`;
    const canonicalHeaders = `host:${endpoint.host}\n`;
    const canonicalRequest = [
      method.toUpperCase(),
      canonicalUri,
      canonicalQuery(params),
      canonicalHeaders,
      signedHeaders,
      "UNSIGNED-PAYLOAD"
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      params.get("X-Amz-Date"),
      `${dateStamp}/${region}/${service}/aws4_request`,
      crypto.createHash("sha256").update(canonicalRequest).digest("hex")
    ].join("\n");
    const signature = hmac(signingKey(this.config.secretAccessKey, dateStamp), stringToSign, "hex");

    params.set("X-Amz-Signature", signature);
    return `${this.config.endpoint}${canonicalUri}?${canonicalQuery(params)}`;
  }

  uploadUrl(key, expiresSeconds = this.config.uploadExpiresSeconds) {
    return this.presign("PUT", key, expiresSeconds);
  }

  readUrl(key, { fileName } = {}) {
    return this.presign("GET", key, this.config.readExpiresSeconds, {
      ...(fileName ? { "response-content-disposition": `attachment; filename="${safeFileName(fileName)}"` } : {})
    });
  }

  deleteUrl(key) {
    return this.presign("DELETE", key, 60);
  }

  headUrl(key) {
    return this.presign("HEAD", key, 60);
  }

  async headObject(key, { signal } = {}) {
    const response = await fetch(this.headUrl(key), { method: "HEAD", signal });
    if (!response.ok) {
      throw new HttpError(400, "Uploaded file could not be verified.");
    }

    return {
      contentType: response.headers.get("content-type") || "",
      sizeBytes: Number.parseInt(response.headers.get("content-length") || "0", 10),
      etag: clean(response.headers.get("etag")).replace(/^"|"$/g, "")
    };
  }

  async deleteObject(key, { signal } = {}) {
    const response = await fetch(this.deleteUrl(key), { method: "DELETE", signal });
    if (!response.ok && response.status !== 404) {
      throw new HttpError(502, "Uploaded file could not be deleted from storage.");
    }

    return true;
  }

  async deleteObjects(keys = [], { signal } = {}) {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    for (const key of uniqueKeys) {
      await this.deleteObject(key, { signal });
    }
    return uniqueKeys.length;
  }
}
