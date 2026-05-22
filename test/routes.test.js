import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { installStableRequestSignal } from "../server/routes.js";

test("installStableRequestSignal shadows Node's request signal getter", () => {
  const native = new AbortController();
  const req = new EventEmitter();

  Object.defineProperty(req, "signal", {
    configurable: true,
    get: () => native.signal
  });

  const stable = installStableRequestSignal(req);
  assert.equal(req.signal, stable);
  assert.equal(stable.aborted, false);

  native.abort();
  assert.equal(stable.aborted, false);

  req.emit("aborted");
  assert.equal(stable.aborted, true);
});

test("installStableRequestSignal preserves already aborted requests", () => {
  const req = new EventEmitter();
  req.aborted = true;

  const stable = installStableRequestSignal(req);
  assert.equal(stable.aborted, true);
});
