import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, validateRuntimeConfig } from "../server/config.js";
import { clientAddress } from "../server/http/rateLimit.js";

test("rate limits key on the address the local proxy saw, never on one a client claims", () => {
  const req = (peer, headers = {}) => ({ socket: { remoteAddress: peer }, headers });
  // Caddy reaches the app through Docker's loopback forward and appends the real client last.
  assert.equal(clientAddress(req("172.18.0.1", { "x-forwarded-for": "6.6.6.6, 203.0.113.9" })), "203.0.113.9");
  assert.equal(clientAddress(req("::ffff:127.0.0.1", { "x-forwarded-for": "203.0.113.9" })), "203.0.113.9");
  // Someone reaching the port directly cannot pick their own identity with either header.
  assert.equal(clientAddress(req("198.51.100.7", { "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "1.2.3.4" })), "198.51.100.7");
  assert.equal(clientAddress(req("172.18.0.1", { "cf-connecting-ip": "1.2.3.4" })), "172.18.0.1");
  assert.equal(clientAddress(req("172.18.0.1", { "x-forwarded-for": "not-an-ip" })), "172.18.0.1");
});

test("a public OnlyOffice server needs a real JWT secret", () => {
  const office = (secret) => () => validateRuntimeConfig(loadConfig({ ONLYOFFICE_PUBLIC_URL: "https://office.example.com", ONLYOFFICE_JWT_SECRET: secret }));
  assert.throws(office("klui-local-onlyoffice-change-me"), /ONLYOFFICE_JWT_SECRET/);
  assert.throws(office("short"), /ONLYOFFICE_JWT_SECRET/);
  assert.doesNotThrow(office("x".repeat(40)));
  assert.doesNotThrow(() => validateRuntimeConfig(loadConfig({ ONLYOFFICE_PUBLIC_URL: "http://localhost:8082", ONLYOFFICE_JWT_SECRET: "klui-local-onlyoffice-change-me" })));
});
