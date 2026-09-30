import assert from "node:assert/strict";
import test from "node:test";

import { filterPresets, normalizeDeckCatalog, presetById } from "../public/js/homeModes.js";

test("normalizeDeckCatalog tolerates missing and malformed fields", () => {
  const catalog = normalizeDeckCatalog({
    groups: [
      { id: "students", label: "Students", categories: [{ id: "lecture", label: "Lectures & courses" }, { id: "" }] },
      { id: "", label: "Bad group" },
      "not an object"
    ],
    presets: [
      {
        id: "ledger",
        name: "Ledger",
        group: "work",
        category: "finance",
        description: "One or two sentences.",
        swatches: ["FAF7F1", "A43C28"],
        cover: "/deck-presets/ledger/01.webp",
        slides: ["/deck-presets/ledger/01.webp", "/deck-presets/ledger/02.webp"]
      },
      { id: "no-cover", name: "Missing cover" },
      { id: "", name: "No id" },
      { id: "cover-only", cover: "/deck-presets/cover-only/01.webp" }
    ]
  });

  assert.equal(catalog.groups.length, 1);
  assert.equal(catalog.groups[0].id, "students");
  assert.equal(catalog.groups[0].categories.length, 1);

  assert.equal(catalog.presets.length, 2);
  const ledger = presetById(catalog.presets, "ledger");
  assert.ok(ledger);
  assert.equal(ledger.slides.length, 2);
  assert.equal(ledger.swatches.length, 2);

  const coverOnly = presetById(catalog.presets, "cover-only");
  assert.ok(coverOnly);
  assert.equal(coverOnly.name, "cover-only");
  assert.deepEqual(coverOnly.slides, ["/deck-presets/cover-only/01.webp"]);
});

test("normalizeDeckCatalog handles entirely missing/garbage input", () => {
  assert.deepEqual(normalizeDeckCatalog(null), { groups: [], presets: [] });
  assert.deepEqual(normalizeDeckCatalog({}), { groups: [], presets: [] });
  assert.deepEqual(normalizeDeckCatalog({ groups: "nope", presets: 42 }), { groups: [], presets: [] });
});

test("filterPresets filters by group and category", () => {
  const presets = [
    { id: "a", group: "work", category: "finance" },
    { id: "b", group: "work", category: "sales" },
    { id: "c", group: "students", category: "lecture" }
  ];
  assert.deepEqual(filterPresets(presets).map((p) => p.id), ["a", "b", "c"]);
  assert.deepEqual(filterPresets(presets, { group: "all" }).map((p) => p.id), ["a", "b", "c"]);
  assert.deepEqual(filterPresets(presets, { group: "work" }).map((p) => p.id), ["a", "b"]);
  assert.deepEqual(filterPresets(presets, { group: "work", category: "sales" }).map((p) => p.id), ["b"]);
  assert.deepEqual(filterPresets(presets, { group: "students" }).map((p) => p.id), ["c"]);
});

test("presetById looks up by id and tolerates missing ids", () => {
  const presets = [{ id: "a" }, { id: "b" }];
  assert.equal(presetById(presets, "b"), presets[1]);
  assert.equal(presetById(presets, "missing"), null);
  assert.equal(presetById(presets, ""), null);
  assert.equal(presetById([], "a"), null);
});

test("normalizeDeckCatalog reserves the Auto id for the Klui-picks card", () => {
  const { presets } = normalizeDeckCatalog({
    presets: [
      { id: "auto", cover: "/deck-presets/auto/cover.webp" },
      { id: "academy", cover: "/deck-presets/academy/cover.webp" }
    ]
  });
  assert.deepEqual(presets.map((preset) => preset.id), ["academy"]);
});

test("normalizeDeckCatalog resolves cover and slide images through the given resolver", () => {
  const resolveUrl = (src) => (src.startsWith("/") ? `https://klui.ai${src}` : src);
  const catalog = normalizeDeckCatalog({ presets: [
    { id: "ledger", cover: "/deck-presets/ledger/cover.webp", slides: ["/deck-presets/ledger/01.webp"] },
    { id: "slides-only", slides: ["/deck-presets/slides-only/01.webp"] }
  ] }, { resolveUrl });
  assert.equal(catalog.presets[0].cover, "https://klui.ai/deck-presets/ledger/cover.webp");
  assert.deepEqual(catalog.presets[0].slides, ["https://klui.ai/deck-presets/ledger/01.webp"]);
  assert.equal(catalog.presets[1].cover, "https://klui.ai/deck-presets/slides-only/01.webp");
});
