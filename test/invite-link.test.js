import assert from "node:assert/strict";
import test from "node:test";
import { clearPendingCoupon, pendingCoupon, savePendingCoupon, takeCouponFromUrl } from "../clients/web/src/islands/inviteLink.js";

function memoryStorage() {
  const items = new Map();
  const storage = {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key)
  };
  return () => storage;
}

function page(url) {
  const location = new URL(url);
  return {
    location,
    history: {
      state: null,
      replaceState(_state, _title, next) {
        const target = new URL(next, location);
        location.search = target.search;
        location.hash = target.hash;
      }
    }
  };
}

test("a code link is taken from the address and kept through sign-up for a week", () => {
  const win = page("https://klui.ai/?coupon=tryklui&utm=qr#home");
  assert.equal(takeCouponFromUrl(win), "TRYKLUI");
  assert.equal(win.location.href, "https://klui.ai/?utm=qr#home");
  assert.equal(takeCouponFromUrl(win), "");

  const storage = memoryStorage();
  savePendingCoupon("TRYKLUI", storage, 1_000);
  assert.equal(pendingCoupon(storage, 1_000 + 6 * 24 * 3600_000), "TRYKLUI");
  assert.equal(pendingCoupon(storage, 1_000 + 8 * 24 * 3600_000), "");
  assert.equal(storage().getItem("klui.pendingCoupon"), null);

  savePendingCoupon("TRYKLUI", storage);
  clearPendingCoupon(storage);
  assert.equal(pendingCoupon(storage), "");
});

test("malformed codes and broken storage are ignored", () => {
  const win = page("https://klui.ai/?coupon=%3Cscript%3E");
  assert.equal(takeCouponFromUrl(win), "");
  assert.equal(win.location.search, "");

  const storage = memoryStorage();
  storage().setItem("klui.pendingCoupon", "{not json");
  assert.equal(pendingCoupon(storage), "");
  // Blocked site data: even reading localStorage throws.
  const blocked = () => { throw new Error("SecurityError"); };
  assert.doesNotThrow(() => savePendingCoupon("TRYKLUI", blocked));
  assert.equal(pendingCoupon(blocked), "");
  assert.doesNotThrow(() => clearPendingCoupon(blocked));
});
