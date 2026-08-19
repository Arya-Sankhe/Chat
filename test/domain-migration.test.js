import assert from "node:assert/strict";
import test from "node:test";

import { isLegacyWebNavigation } from "../server/static.js";

const request = (host, accept = "text/html") => ({ method: "GET", headers: { host, accept } });

test("klui.tech browser navigation gets the moved page without intercepting APIs or Klui.ai", () => {
  assert.equal(isLegacyWebNavigation(request("klui.tech"), new URL("https://klui.tech/c/123")), true);
  assert.equal(isLegacyWebNavigation(request("www.klui.tech:443"), new URL("https://www.klui.tech/")), true);
  assert.equal(isLegacyWebNavigation(request("klui.tech", "application/json"), new URL("https://klui.tech/downloads/android/latest.json")), false);
  assert.equal(isLegacyWebNavigation(request("klui.ai"), new URL("https://klui.ai/")), false);
  assert.equal(isLegacyWebNavigation(request("klui.tech"), new URL("https://klui.tech/oauth/consent")), false);
});
