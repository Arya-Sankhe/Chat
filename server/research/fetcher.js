import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
import { isDeniedUrl } from "../websearch/deny-domains.js";

const BLOCKED_HOSTS = new Set(["localhost", "metadata", "metadata.google.internal"]);
const BLOCKED_SUFFIXES = [".local", ".internal", ".lan", ".intranet"];
const RETRYABLE = new Set([429, 503]);
const domainReadyAt = new Map();

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    function done() {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function isPublicAddress(address) {
  let parsed;
  try {
    parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
  } catch {
    return false;
  }
  return parsed.range() === "unicast";
}

function allowedHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host || BLOCKED_HOSTS.has(host)) return false;
  return !BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export async function resolvePublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Source URL is invalid.");
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only public HTTP sources are supported.");
  if (url.username || url.password || !allowedHostname(url.hostname)) throw new Error("Source host is not allowed.");

  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new Error("Source resolved to a non-public address.");
  }
  return { url, address: addresses[0] };
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 5000);
  return Math.min(500 * 2 ** attempt, 3000);
}

async function throttle(hostname, signal) {
  const now = Date.now();
  const ready = domainReadyAt.get(hostname) || 0;
  if (ready > now) await sleep(ready - now, signal);
  domainReadyAt.set(hostname, Date.now() + 350);
}

function requestPinned(url, address, { timeoutMs, maxBytes, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      method: "GET",
      path: `${url.pathname}${url.search}`,
      servername: url.hostname,
      headers: {
        host: url.host,
        accept: "text/html,text/plain;q=0.9",
        "accept-language": "en-US,en;q=0.8",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36 KluiResearch/1.0"
      }
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          request.destroy(new Error("Source exceeded the maximum response size."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    const timer = setTimeout(() => request.destroy(new Error("Source request timed out.")), timeoutMs);
    const onAbort = () => request.destroy(abortError());
    signal?.addEventListener?.("abort", onAbort, { once: true });
    request.on("error", reject);
    request.on("close", () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    });
    request.end();
  });
}

export async function fetchPublicPage(value, {
  timeoutMs = 12_000,
  maxBytes = 5 * 1024 * 1024,
  maxRedirects = 5,
  signal,
  denyDomains = []
} = {}) {
  let current = String(value || "");
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    // Request-boundary hard block: deny before DNS, throttle, or network I/O.
    if (isDeniedUrl(current, denyDomains)) {
      throw new Error("Source URL is blocked by deny-domain policy.");
    }
    const { url, address } = await resolvePublicUrl(current);
    await throttle(url.hostname, signal);

    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await requestPinned(url, address, { timeoutMs, maxBytes, signal });
      if (!RETRYABLE.has(response.status) || attempt === 2) break;
      await sleep(retryDelay(response, attempt), signal);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location || redirect === maxRedirects) throw new Error("Source redirected too many times.");
      current = new URL(location, url).href;
      continue;
    }
    if (response.status === 403 || response.status === 429) throw new Error(`Source blocked the request (${response.status}).`);
    if (response.status < 200 || response.status >= 300) throw new Error(`Source returned HTTP ${response.status}.`);

    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("text/html") && !contentType.startsWith("text/plain")) {
      throw new Error("Source content type is not supported.");
    }
    return { url: url.href, contentType, html: response.body };
  }
  throw new Error("Source could not be fetched.");
}
