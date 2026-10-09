import test from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  SceneError,
  cleanScene,
  describeElements,
  proposalToSkeletons,
  validateContext,
  validateProposal,
  validateScene
} from "../public/js/whiteboard/schema.js";

let seed = 1;
function base(type, extra = {}) {
  seed += 1;
  return {
    id: `el-${seed}`, type, x: 10, y: 20, width: 100, height: 50, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2,
    strokeStyle: "solid", roughness: 1, opacity: 100, roundness: null, seed, version: 3, versionNonce: 99,
    index: `a${seed}`, isDeleted: false, groupIds: [], frameId: null, boundElements: null, updated: 1_700_000_000_000,
    link: null, locked: false, ...extra
  };
}

function boxWithLabel() {
  const box = base("rectangle", { roundness: { type: 3 } });
  const label = base("text", {
    text: "Heart", originalText: "Heart", fontSize: 20, fontFamily: 5, textAlign: "center",
    verticalAlign: "middle", containerId: box.id, autoResize: true, lineHeight: 1.25
  });
  box.boundElements = [{ id: label.id, type: "text" }];
  return { box, label };
}

test("a normal Excalidraw scene passes and keeps only known fields", () => {
  const { box, label } = boxWithLabel();
  const stroke = base("freedraw", { points: [[0, 0], [4, 5], [9, 3]], pressures: [0.5, 0.6, 0.4], simulatePressure: false, lastCommittedPoint: [9, 3], extra: "dropped" });
  const arrow = base("arrow", {
    points: [[0, 0], [120, 0]], lastCommittedPoint: null, startBinding: { elementId: box.id, focus: 0, gap: 4 }, endBinding: null,
    startArrowhead: null, endArrowhead: "arrow", elbowed: false
  });
  box.boundElements.push({ id: arrow.id, type: "arrow" });
  const scene = validateScene({ elements: [box, label, stroke, arrow], appState: { viewBackgroundColor: "#ffffff", zoom: 3 } });
  assert.equal(scene.elements.length, 4);
  assert.equal(scene.elements[2].extra, undefined);
  assert.equal(scene.elements[2].lastCommittedPoint, null);
  assert.deepEqual(scene.appState, { viewBackgroundColor: "#ffffff" });
});

test("scenes with unsafe or unsupported content are rejected", () => {
  const bad = [
    [base("rectangle", { strokeColor: "url(#x)" }), /colour/],
    [base("rectangle", { backgroundColor: "red;background:url(a)" }), /colour/],
    [base("frame"), /not allowed/],
    [base("embeddable"), /not allowed/],
    [base("rectangle", { frameId: "f1" }), /Frames/],
    [base("rectangle", { link: "javascript:alert(1)" }), /Links/],
    [base("rectangle", { customData: { evil: true } }), /Custom/],
    [base("rectangle", { customData: { klui: true, name: "<script>" } }), /Custom/],
    [base("rectangle", { x: Number.NaN }), /x is out of range/],
    [base("rectangle", { x: 1e12 }), /x is out of range/],
    [base("rectangle", { isDeleted: true }), /Deleted/],
    [base("freedraw", { points: Array.from({ length: LIMITS.pointsPerElement + 1 }, () => [0, 0]), pressures: [] }), /too many points/],
    [base("freedraw", { points: [[0, 0], [1, 1]], pressures: [0.5] }), /pressure/],
    [base("text", { text: "x".repeat(LIMITS.textChars + 1), fontSize: 20, fontFamily: 5, textAlign: "left", verticalAlign: "top" }), /too long/]
  ];
  for (const [element, message] of bad) {
    assert.throws(() => validateScene({ elements: [element] }), (error) => error instanceof SceneError && message.test(error.message), String(message));
  }
  // Klui names the parts it draws so a later command can find "the window".
  assert.deepEqual(validateScene({ elements: [base("rectangle", { customData: { klui: true, name: "left-window" } })] }).elements[0].customData, { klui: true, name: "left-window" });
  const { box } = boxWithLabel();
  assert.throws(() => validateScene({ elements: [box] }), /missing element/, "a bound label must exist");
  assert.throws(() => validateScene({ elements: [box, { ...box }] }), /share an id/);
  assert.throws(() => validateScene({ elements: Array.from({ length: LIMITS.elements + 1 }, () => base("rectangle")) }), /at most/);
});

test("cleanScene drops deleted elements and clears references to them, so the result validates", () => {
  const { box, label } = boxWithLabel();
  const arrow = base("arrow", {
    points: [[0, 0], [50, 0]], startBinding: { elementId: box.id, focus: 0, gap: 1 }, endBinding: { elementId: "gone", focus: 0, gap: 1 },
    startArrowhead: null, endArrowhead: "arrow", elbowed: false
  });
  const deleted = { ...box, isDeleted: true };
  const orphanLabel = { ...label, id: "orphan", containerId: "missing-box" };
  const cleaned = cleanScene({ elements: [deleted, label, arrow, orphanLabel, base("embeddable")], appState: {} });
  assert.deepEqual(cleaned.elements.map((element) => element.id), [label.id, arrow.id, "orphan"]);
  assert.equal(cleaned.elements[1].startBinding, null);
  assert.equal(cleaned.elements[1].endBinding, null);
  assert.equal(cleaned.elements[0].containerId, null);
  assert.doesNotThrow(() => validateScene(cleaned));
});

test("context keeps the frozen elements and area; references are not checked against the board", () => {
  const { box, label } = boxWithLabel();
  const context = validateContext({ captureMode: "selection", rect: { x: 0, y: 0, width: 120, height: 60 }, elements: [box, label], sceneRevision: 4 });
  assert.deepEqual(context.elementIds, [box.id, label.id]);
  assert.equal(context.sceneRevision, 4);
  assert.throws(() => validateContext({ captureMode: "everything", rect: { x: 0, y: 0, width: 1, height: 1 }, elements: [] }), /not allowed/);
  assert.throws(() => validateContext({ captureMode: "area", rect: { x: 0, y: 0, width: 1, height: 1 }, elements: Array.from({ length: LIMITS.contextElements + 1 }, () => base("rectangle")) }), /smaller part/);
});

test("the element description names labels, text, strokes and connections", () => {
  const { box, label } = boxWithLabel();
  const other = base("ellipse", { x: 300 });
  const arrow = base("arrow", { points: [[0, 0], [1, 0]], startBinding: { elementId: box.id, focus: 0, gap: 1 }, endBinding: { elementId: other.id, focus: 0, gap: 1 } });
  const note = base("text", { y: 200, text: "F = ma", fontSize: 20, fontFamily: 5, textAlign: "left", verticalAlign: "top", containerId: null });
  const stroke = base("freedraw", { points: [[0, 0]], pressures: [] });
  const text = describeElements([box, label, other, arrow, note, stroke]);
  assert.match(text, /rectangle "Heart"/);
  assert.match(text, /arrow from rectangle "Heart" to ellipse/);
  assert.match(text, /text at \(10, 200\): F = ma/);
  assert.match(text, /1 hand-drawn stroke/);
});

const proposal = () => ({
  summary: "A feedback loop",
  ops: [
    { op: "shape", key: "sensor", shape: "rectangle", x: 0, y: 0, width: 200, height: 90, text: "Sensor" },
    { op: "shape", key: "controller", shape: "ellipse", x: 300, y: 0, width: 200, height: 90, text: "Controller" },
    { op: "connect", from: "sensor", to: "controller", label: "signal" },
    { op: "text", key: "note", x: 0, y: 160, width: 500, text: "The controller reacts to the signal." }
  ]
});

test("a diagram proposal validates and compiles into labelled shapes and bound arrows", () => {
  const clean = validateProposal(proposal());
  const skeletons = proposalToSkeletons(clean);
  assert.equal(skeletons.length, 4);
  const arrow = skeletons.find((item) => item.type === "arrow");
  assert.deepEqual([arrow.start.id, arrow.end.id], ["klui-sensor", "klui-controller"]);
  assert.equal(arrow.label.text, "signal");
  assert.equal(skeletons[0].label.text, "Sensor");
  assert.equal(skeletons[0].label.fontFamily, 5);
});

test("diagram arrows meet shape edges instead of crossing labels", () => {
  const diagram = validateProposal(proposal());
  const arrow = proposalToSkeletons(diagram).find((item) => item.type === "arrow");
  assert.deepEqual([arrow.x, arrow.y], [208, 45]);
  assert.deepEqual(arrow.points, [[0, 0], [84, 0]]);
  for (const shape of ["rectangle", "ellipse", "diamond"]) {
    const clean = validateProposal({ summary: "Diagonal", ops: [
      { op: "shape", key: "a", shape, x: 0, y: 0, width: 200, height: 100, text: "A" },
      { op: "shape", key: "b", shape, x: 400, y: 300, width: 200, height: 100, text: "B" },
      { op: "connect", from: "b", to: "a" }
    ] });
    const connector = proposalToSkeletons(clean).at(-1);
    assert.ok(connector.x < 500 && connector.y < 350);
    assert.ok(connector.width < 0 && connector.height < 0);
    assert.ok(connector.x + connector.width > 100);
    assert.ok(connector.y + connector.height > 50);
  }
});

test("overlapping diagram nodes are rejected", () => {
  const diagram = proposal();
  diagram.ops[1].x = 100;
  assert.throws(() => validateProposal(diagram), /must not overlap/);
  // Drawings may layer shapes, like a circle inside a square.
  assert.equal(validateProposal(diagram, { overlap: true }).ops.length, diagram.ops.length);
});

test("diagram proposals cannot touch the board or smuggle content", () => {
  const cases = [
    [{ ...proposal(), extra: 1 }, /Unexpected/],
    [{ summary: "", ops: [] }, /1 to/],
    [{ summary: "", ops: Array.from({ length: LIMITS.proposalOps + 1 }, (_, i) => ({ op: "text", key: `t${i}`, x: 0, y: 0, width: 50, text: "a" })) }, /1 to/],
    [{ summary: "", ops: [{ op: "delete", id: "el-1" }] }, /unknown kind/],
    [{ summary: "", ops: [{ op: "shape", key: "a", shape: "frame", x: 0, y: 0, width: 50, height: 50 }] }, /not allowed/],
    [{ summary: "", ops: [{ op: "shape", key: "a", shape: "rectangle", x: 0, y: 0, width: 50, height: 50, strokeColor: "url(x)" }] }, /Unexpected/],
    [{ summary: "", ops: [{ op: "shape", key: "a", shape: "rectangle", x: 1500, y: 0, width: 400, height: 50 }] }, /too big/],
    [{ summary: "", ops: [{ op: "shape", key: "a", shape: "rectangle", x: 0, y: 0, width: 50, height: 50 }, { op: "connect", from: "a", to: "el-existing" }] }, /two shapes/],
    [{ summary: "", ops: [{ op: "shape", key: "a", shape: "rectangle", x: 0, y: 0, width: 50, height: 50 }, { op: "shape", key: "a", shape: "rectangle", x: 0, y: 0, width: 50, height: 50 }] }, /share a key/]
  ];
  for (const [value, message] of cases) assert.throws(() => validateProposal(value), message, String(message));
});

test("line ops draw polygons and open lines in Klui's ink", () => {
  const clean = validateProposal({ summary: "", ops: [
    { op: "line", key: "tri", points: [[0, 0], [0, 300], [400, 300]], closed: true },
    { op: "line", key: "axis", points: [[0, 400], [500, 400]], closed: false, arrow: true }
  ] });
  const [triangle, axis] = proposalToSkeletons(clean);
  assert.equal(triangle.type, "line");
  assert.deepEqual(triangle.points, [[0, 0], [0, 300], [400, 300], [0, 0]]);
  assert.equal(axis.type, "arrow");
  assert.throws(() => validateProposal({ summary: "", ops: [{ op: "line", key: "x", points: [[0, 0]] }] }), /2 to 64/);
  assert.throws(() => validateProposal({ summary: "", ops: [{ op: "line", key: "x", points: [[0, 0], [-5, 2]] }] }), /out of range/);
});

test("drawings can use colours, text sizes, curves and named points", () => {
  const clean = validateProposal({ summary: "", ops: [
    { op: "line", key: "tri", points: [[100, 100], [100, 400], [500, 400]], closed: true, labels: ["A", "B", "C"], color: "#e03131", fill: "#ffec99" },
    { op: "line", key: "wave", points: [[0, 500], [100, 450], [200, 500]], smooth: true },
    { op: "text", key: "big", x: 0, y: 0, width: 300, text: "E = mc²", color: "#2f9e44", size: "huge" },
    { op: "shape", key: "box", shape: "rectangle", x: 600, y: 0, width: 200, height: 100, text: "cat", fill: "#a5d8ff" }
  ] });
  const parts = proposalToSkeletons(clean);
  const byId = (id) => parts.find((part) => part.id === id);
  assert.equal(byId("klui-tri").strokeColor, "#e03131");
  assert.equal(byId("klui-tri").backgroundColor, "#ffec99");
  assert.deepEqual(byId("klui-wave").roundness, { type: 2 });
  assert.equal(byId("klui-big").fontSize, 40);
  assert.equal(byId("klui-box").fillStyle, "hachure");
  // A is the top corner, so its label sits above-left of it, outside the triangle.
  const a = byId("klui-tri-label-0");
  assert.equal(a.text, "A");
  assert.ok(a.x < 100 && a.y < 100);
  assert.throws(() => validateProposal({ summary: "", ops: [{ op: "text", key: "t", x: 0, y: 0, width: 50, text: "a", color: "url(x)" }] }), /colour/);
  assert.throws(() => validateProposal({ summary: "", ops: [{ op: "line", key: "l", points: [[0, 0], [5, 5]], labels: ["A", "B", "C"] }] }), /labels/);
});
