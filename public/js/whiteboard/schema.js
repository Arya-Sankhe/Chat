// Dojo whiteboard data rules, shared by the browser and the server (no DOM, no Node APIs).
// A board is a bounded subset of Excalidraw 0.18.1's element model: the browser trims a scene
// with cleanScene() before saving, and the server accepts it only if validateScene() passes.
// Klui's diagram proposals are checked with validateProposal() and turned into Excalidraw
// element skeletons with proposalToSkeletons().

export const SCENE_SCHEMA_VERSION = 1;
export const LIMITS = Object.freeze({
  sceneBytes: 4 * 1024 * 1024,
  elements: 5000,
  points: 250_000,
  pointsPerElement: 10_000,
  textChars: 4000,
  coordinate: 1_000_000,
  size: 200_000,
  idChars: 64,
  groupIds: 16,
  boundElements: 200,
  files: 20,
  title: 120,
  question: 2000,
  contextElements: 300,
  contextImageBytes: 1_500_000,
  proposalOps: 20,
  proposalText: 400,
  proposalTotalText: 3000,
  proposalWidth: 1600,
  proposalHeight: 1200
});

export const ELEMENT_TYPES = new Set(["rectangle", "ellipse", "diamond", "text", "line", "arrow", "freedraw", "image"]);
const FILL_STYLES = new Set(["hachure", "cross-hatch", "solid", "zigzag"]);
const STROKE_STYLES = new Set(["solid", "dashed", "dotted"]);
const ARROWHEADS = new Set(["arrow", "bar", "dot", "circle", "circle_outline", "triangle", "triangle_outline", "diamond", "diamond_outline", "crowfoot_one", "crowfoot_many", "crowfoot_one_or_many"]);
const TEXT_ALIGNS = new Set(["left", "center", "right"]);
const VERTICAL_ALIGNS = new Set(["top", "middle", "bottom"]);
const IMAGE_STATUSES = new Set(["pending", "saved", "error"]);
// Hex colours, "transparent", or a plain CSS colour name. Never anything with brackets or url().
const COLOR = /^(?:#[0-9a-f]{3,8}|transparent|[a-z]{3,24})$/i;
const ID = /^[\w-]{1,64}$/;
const FRACTIONAL_INDEX = /^[0-9A-Za-z]{1,64}$/;
const PART_NAME = /^[\w-]{1,40}$/;
const LINK = /^https?:\/\/[^\s"'<>\\]{1,2000}$/i;

export class SceneError extends Error {
  constructor(message) {
    super(message);
    this.name = "SceneError";
  }
}

const fail = (message) => { throw new SceneError(message); };
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function finite(value, label, { min = -LIMITS.coordinate, max = LIMITS.coordinate } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(`${label} is out of range.`);
  return value;
}

function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} is out of range.`);
  return value;
}

function color(value, label) {
  if (typeof value !== "string" || !COLOR.test(value)) fail(`${label} is not a colour.`);
  return value;
}

function oneOf(set, value, label) {
  if (!set.has(value)) fail(`${label} is not allowed.`);
  return value;
}

function nullableOneOf(set, value, label) {
  return value === null || value === undefined ? null : oneOf(set, value, label);
}

function text(value, label, max = LIMITS.textChars) {
  if (typeof value !== "string" || value.length > max) fail(`${label} is too long.`);
  return value;
}

function id(value, label) {
  if (typeof value !== "string" || !ID.test(value)) fail(`${label} is not a valid id.`);
  return value;
}

function points(value, label) {
  if (!Array.isArray(value) || value.length > LIMITS.pointsPerElement) fail(`${label} has too many points.`);
  return value.map((point) => {
    if (!Array.isArray(point) || point.length !== 2) fail(`${label} has a bad point.`);
    return [finite(point[0], label), finite(point[1], label)];
  });
}

function binding(value, label) {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) fail(`${label} is not valid.`);
  const out = { elementId: id(value.elementId, label), focus: finite(value.focus, label), gap: finite(value.gap, label) };
  if (value.fixedPoint !== undefined && value.fixedPoint !== null) {
    if (!Array.isArray(value.fixedPoint) || value.fixedPoint.length !== 2) fail(`${label} is not valid.`);
    out.fixedPoint = [finite(value.fixedPoint[0], label), finite(value.fixedPoint[1], label)];
  }
  return out;
}

function base(element) {
  const out = {
    id: id(element.id, "Element id"),
    type: oneOf(ELEMENT_TYPES, element.type, "Element type"),
    x: finite(element.x, "x"),
    y: finite(element.y, "y"),
    width: finite(element.width, "width", { min: -LIMITS.size, max: LIMITS.size }),
    height: finite(element.height, "height", { min: -LIMITS.size, max: LIMITS.size }),
    angle: finite(element.angle ?? 0, "angle", { min: -100, max: 100 }),
    strokeColor: color(element.strokeColor, "Stroke colour"),
    backgroundColor: color(element.backgroundColor, "Fill colour"),
    fillStyle: oneOf(FILL_STYLES, element.fillStyle, "Fill style"),
    strokeWidth: finite(element.strokeWidth, "Stroke width", { min: 0, max: 64 }),
    strokeStyle: oneOf(STROKE_STYLES, element.strokeStyle, "Stroke style"),
    roughness: finite(element.roughness, "Roughness", { min: 0, max: 4 }),
    opacity: finite(element.opacity, "Opacity", { min: 0, max: 100 }),
    roundness: null,
    seed: integer(element.seed, "seed"),
    version: integer(element.version, "version"),
    versionNonce: integer(element.versionNonce, "versionNonce", Number.MIN_SAFE_INTEGER),
    index: element.index === null || element.index === undefined ? null : (typeof element.index === "string" && FRACTIONAL_INDEX.test(element.index) ? element.index : fail("Element order is not valid.")),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: finite(element.updated ?? 0, "updated", { min: 0, max: 1e14 }),
    link: null,
    locked: element.locked === true
  };
  if (element.isDeleted === true) fail("Deleted elements are not saved.");
  if (element.frameId !== null && element.frameId !== undefined) fail("Frames are not available on boards.");
  if (element.roundness !== null && element.roundness !== undefined) {
    if (!isObject(element.roundness)) fail("Roundness is not valid.");
    out.roundness = { type: integer(element.roundness.type, "Roundness", 1, 3) };
    if (element.roundness.value !== undefined) out.roundness.value = finite(element.roundness.value, "Roundness", { min: 0, max: 10_000 });
  }
  if (element.groupIds !== undefined) {
    if (!Array.isArray(element.groupIds) || element.groupIds.length > LIMITS.groupIds) fail("Too many groups.");
    out.groupIds = element.groupIds.map((group) => id(group, "Group id"));
  }
  if (element.boundElements !== null && element.boundElements !== undefined) {
    if (!Array.isArray(element.boundElements) || element.boundElements.length > LIMITS.boundElements) fail("Too many bound elements.");
    out.boundElements = element.boundElements.map((bound) => {
      if (!isObject(bound) || !["arrow", "text"].includes(bound.type)) fail("Bound element is not valid.");
      return { id: id(bound.id, "Bound element id"), type: bound.type };
    });
  }
  if (element.link !== null && element.link !== undefined && element.link !== "") {
    if (typeof element.link !== "string" || !LINK.test(element.link)) fail("Links must be http or https web addresses.");
    out.link = element.link;
  }
  if (element.customData !== undefined && element.customData !== null) {
    const data = element.customData;
    if (!isObject(data) || Object.keys(data).some((key) => key !== "klui" && key !== "name") || data.klui !== true) fail("Custom element data is not allowed.");
    out.customData = { klui: true };
    // The name Klui gave a part it drew ("window"), so a later command can find it.
    if (data.name !== undefined) out.customData.name = typeof data.name === "string" && PART_NAME.test(data.name) ? data.name : fail("Custom element data is not allowed.");
  }
  return out;
}

function validateElement(element) {
  if (!isObject(element)) fail("Element is not valid.");
  const out = base(element);
  if (out.type === "text") {
    out.text = text(element.text, "Text");
    out.originalText = text(element.originalText ?? element.text, "Text");
    out.fontSize = finite(element.fontSize, "Font size", { min: 1, max: 2000 });
    out.fontFamily = integer(element.fontFamily, "Font", 1, 20);
    out.textAlign = oneOf(TEXT_ALIGNS, element.textAlign, "Text alignment");
    out.verticalAlign = oneOf(VERTICAL_ALIGNS, element.verticalAlign, "Text alignment");
    out.containerId = element.containerId === null || element.containerId === undefined ? null : id(element.containerId, "Text container");
    out.autoResize = element.autoResize !== false;
    out.lineHeight = finite(element.lineHeight ?? 1.25, "Line height", { min: 0.5, max: 5 });
  } else if (out.type === "line" || out.type === "arrow") {
    out.points = points(element.points, "Line");
    out.lastCommittedPoint = null;
    out.startBinding = binding(element.startBinding, "Arrow start");
    out.endBinding = binding(element.endBinding, "Arrow end");
    out.startArrowhead = nullableOneOf(ARROWHEADS, element.startArrowhead, "Arrowhead");
    out.endArrowhead = nullableOneOf(ARROWHEADS, element.endArrowhead, "Arrowhead");
    if (out.type === "line" && element.polygon !== undefined) out.polygon = element.polygon === true;
    if (out.type === "arrow") {
      out.elbowed = element.elbowed === true;
      if (out.elbowed) {
        out.fixedSegments = element.fixedSegments === null || element.fixedSegments === undefined ? null : (() => {
          if (!Array.isArray(element.fixedSegments) || element.fixedSegments.length > 100) fail("Arrow segments are not valid.");
          return element.fixedSegments.map((segment) => {
            if (!isObject(segment)) fail("Arrow segments are not valid.");
            const [start] = points([segment.start], "Arrow segment");
            const [end] = points([segment.end], "Arrow segment");
            return { start, end, index: integer(segment.index, "Arrow segment", 0, LIMITS.pointsPerElement) };
          });
        })();
        out.startIsSpecial = typeof element.startIsSpecial === "boolean" ? element.startIsSpecial : null;
        out.endIsSpecial = typeof element.endIsSpecial === "boolean" ? element.endIsSpecial : null;
      }
    }
  } else if (out.type === "freedraw") {
    out.points = points(element.points, "Stroke");
    if (!Array.isArray(element.pressures) || (element.pressures.length && element.pressures.length !== out.points.length)) fail("Stroke pressure does not match its points.");
    out.pressures = element.pressures.map((value) => finite(value, "Pressure", { min: 0, max: 1 }));
    out.simulatePressure = element.simulatePressure !== false;
    out.lastCommittedPoint = null;
  } else if (out.type === "image") {
    out.fileId = element.fileId === null || element.fileId === undefined ? null : id(element.fileId, "Image file");
    out.status = IMAGE_STATUSES.has(element.status) ? element.status : "pending";
    if (!Array.isArray(element.scale) || element.scale.length !== 2) fail("Image scale is not valid.");
    out.scale = [finite(element.scale[0], "Image scale", { min: -1, max: 1 }), finite(element.scale[1], "Image scale", { min: -1, max: 1 })];
    out.crop = null;
    if (element.crop !== null && element.crop !== undefined) {
      if (!isObject(element.crop)) fail("Image crop is not valid.");
      out.crop = Object.fromEntries(["x", "y", "width", "height", "naturalWidth", "naturalHeight"].map((key) => [key, finite(element.crop[key], "Image crop", { min: 0, max: LIMITS.size })]));
    }
  }
  return out;
}

/** Element count, point count and references. Throws SceneError. */
function checkReferences(elements) {
  const byId = new Map();
  let totalPoints = 0;
  for (const element of elements) {
    if (byId.has(element.id)) fail("Two elements share an id.");
    byId.set(element.id, element);
    totalPoints += element.points?.length || 0;
  }
  if (totalPoints > LIMITS.points) fail("The board has too many drawn points.");
  for (const element of elements) {
    const target = (ref, label, types) => {
      const found = byId.get(ref);
      if (!found || (types && !types.includes(found.type))) fail(`${label} refers to a missing element.`);
    };
    if (element.type === "text" && element.containerId) target(element.containerId, "Text", ["rectangle", "ellipse", "diamond", "arrow"]);
    if (element.startBinding) target(element.startBinding.elementId, "Arrow", ["rectangle", "ellipse", "diamond", "text", "image"]);
    if (element.endBinding) target(element.endBinding.elementId, "Arrow", ["rectangle", "ellipse", "diamond", "text", "image"]);
    for (const bound of element.boundElements || []) target(bound.id, "Shape", [bound.type]);
  }
}

/** Validates a scene sent for saving. Returns the stored form; throws SceneError when it is not acceptable. */
export function validateScene(scene) {
  if (!isObject(scene)) fail("Board data is not valid.");
  if (!Array.isArray(scene.elements)) fail("Board elements are missing.");
  if (scene.elements.length > LIMITS.elements) fail(`A board holds at most ${LIMITS.elements} elements.`);
  const elements = scene.elements.map(validateElement);
  checkReferences(elements);
  const files = new Set(elements.filter((element) => element.type === "image" && element.fileId).map((element) => element.fileId));
  if (files.size > LIMITS.files) fail(`A board holds at most ${LIMITS.files} images.`);
  const background = scene.appState?.viewBackgroundColor ?? "#ffffff";
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    elements,
    appState: { viewBackgroundColor: color(background, "Background colour") }
  };
}

/**
 * Trims a live Excalidraw scene to what is saved: deleted elements are dropped (undo history is
 * per visit), and references to anything dropped are cleared so validateScene() accepts it.
 */
export function cleanScene({ elements = [], appState = {} } = {}) {
  const kept = elements.filter((element) => element && !element.isDeleted && ELEMENT_TYPES.has(element.type));
  const ids = new Map(kept.map((element) => [element.id, element.type]));
  const bindable = new Set(["rectangle", "ellipse", "diamond", "text", "image"]);
  const fixBinding = (value) => (value && bindable.has(ids.get(value.elementId)) ? value : null);
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    elements: kept.map((element) => {
      const out = { ...element, frameId: null };
      if (out.boundElements) out.boundElements = out.boundElements.filter((bound) => ids.get(bound.id) === bound.type);
      if (out.type === "text" && out.containerId && !ids.has(out.containerId)) out.containerId = null;
      if (out.type === "line" || out.type === "arrow") {
        out.startBinding = fixBinding(out.startBinding);
        out.endBinding = fixBinding(out.endBinding);
        out.lastCommittedPoint = null;
      }
      if (out.type === "freedraw") out.lastCommittedPoint = null;
      if (out.customData && out.customData.klui !== true) delete out.customData;
      if (out.customData) out.customData = { klui: true, ...(PART_NAME.test(out.customData.name || "") ? { name: out.customData.name } : {}) };
      if (out.link && !LINK.test(out.link)) out.link = null;
      return out;
    }),
    appState: { viewBackgroundColor: appState.viewBackgroundColor || "#ffffff" }
  };
}

export function cleanTitle(value, fallback = "Whiteboard") {
  const title = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.title);
  return title || fallback;
}

const CAPTURE_MODES = new Set(["selection", "area", "view"]);

function rect(value) {
  if (!isObject(value)) fail("The captured area is not valid.");
  const out = {
    x: finite(value.x, "Area"),
    y: finite(value.y, "Area"),
    width: finite(value.width, "Area", { min: 0, max: LIMITS.size }),
    height: finite(value.height, "Area", { min: 0, max: LIMITS.size })
  };
  return out;
}

/**
 * The frozen context of a question: what was selected or framed, as elements, plus the board
 * revision. Element references are not resolved against the live board; they are only evidence.
 */
export function validateContext(context) {
  if (!isObject(context)) fail("Select something on the board first.");
  const captureMode = oneOf(CAPTURE_MODES, context.captureMode, "Capture mode");
  if (!Array.isArray(context.elements) || context.elements.length > LIMITS.contextElements) fail("Too much is selected. Select a smaller part of the board.");
  const elements = context.elements.map(validateElement);
  const ids = new Set(elements.map((element) => element.id));
  // A voice command sees the whole view; these are the parts the student had selected ("this").
  if (context.selectedIds !== undefined && (!Array.isArray(context.selectedIds) || context.selectedIds.some((value) => !ids.has(value)))) fail("The selection is not valid.");
  return {
    captureMode,
    rect: rect(context.rect),
    elementIds: [...ids],
    elements,
    ...(context.selectedIds?.length ? { selectedIds: [...new Set(context.selectedIds)] } : {}),
    // How the board looks: in the dark theme colours show differently from how they are stored.
    ...(context.theme === "dark" ? { theme: "dark" } : {}),
    ...(/^#[0-9a-f]{6}$/i.test(context.background || "") ? { background: context.background.toLowerCase() } : {}),
    sceneRevision: integer(context.sceneRevision ?? 0, "Board revision")
  };
}

function round(value) {
  return Math.round(value);
}

/**
 * A plain-text description of the selected elements for the model: labels and text first, then
 * shapes, drawings and connections. Order is top-to-bottom, left-to-right by position, which is
 * a guess at reading order, not a fact.
 */
export function describeElements(elements, { maxChars = 6000 } = {}) {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const labelOf = new Map();
  for (const element of elements) {
    if (element.type === "text" && element.containerId) labelOf.set(element.containerId, element.text);
  }
  const name = (element) => {
    const label = labelOf.get(element.id);
    return label ? `${element.type} "${label.replace(/\s+/g, " ").slice(0, 80)}"` : element.type;
  };
  const lines = [];
  const ordered = [...elements].sort((a, b) => (Math.abs(a.y - b.y) > 24 ? a.y - b.y : a.x - b.x));
  let strokes = 0;
  for (const element of ordered) {
    if (element.type === "text" && element.containerId) continue;
    const at = `at (${round(element.x)}, ${round(element.y)})`;
    if (element.type === "text") lines.push(`- text ${at}: ${element.text}`);
    else if (element.type === "freedraw") strokes += 1;
    else if (element.type === "arrow" || element.type === "line") {
      const from = element.startBinding && byId.get(element.startBinding.elementId);
      const to = element.endBinding && byId.get(element.endBinding.elementId);
      const label = labelOf.get(element.id);
      if (from || to) lines.push(`- ${element.type} from ${from ? name(from) : "open space"} to ${to ? name(to) : "open space"}${label ? ` labelled "${label}"` : ""}`);
      else lines.push(`- ${element.type} ${at}${label ? ` labelled "${label}"` : ""}`);
    } else if (element.type === "image") lines.push(`- image ${at}, ${round(element.width)}×${round(element.height)}`);
    else lines.push(`- ${name(element)} ${at}, ${round(element.width)}×${round(element.height)}`);
  }
  if (strokes) lines.push(`- ${strokes} hand-drawn ${strokes === 1 ? "stroke" : "strokes"} (handwriting or sketches; read them from the image)`);
  const out = lines.join("\n");
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n- …more not shown` : out;
}

// Klui's diagrams: new labelled shapes, free text, and arrows between the new shapes. Nothing in
// a proposal can change, move or delete what the student drew.
const PROPOSAL_SHAPES = new Set(["rectangle", "ellipse", "diamond"]);

function proposalText(value, label, budget) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") fail(`${label} is not text.`);
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (clean.length > LIMITS.proposalText) fail(`${label} is too long.`);
  budget.used += clean.length;
  if (budget.used > LIMITS.proposalTotalText) fail("The diagram has too much text.");
  return clean;
}

function onlyKeys(value, keys) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`Unexpected diagram field: ${key}.`);
}

export const TEXT_SIZES = Object.freeze({ small: 16, medium: 20, large: 28, huge: 40 });

/** Optional colours and sizes on a diagram part, for drawings that ask for them. */
function proposalStyle(op, fields) {
  const out = {};
  if (fields.includes("color") && op.color !== undefined) out.color = color(op.color, "Diagram colour");
  if (fields.includes("fill") && op.fill !== undefined) out.fill = color(op.fill, "Diagram fill");
  if (fields.includes("size") && op.size !== undefined) out.size = oneOf(new Set(Object.keys(TEXT_SIZES)), op.size, "Text size");
  return out;
}

/**
 * Validates a propose_diagram tool call. Returns the clean proposal; throws SceneError.
 * Diagrams keep their boxes apart; drawings (`overlap: true`) may layer shapes, like a face or a cell.
 */
export function validateProposal(proposal, { overlap = false, area = null } = {}) {
  // Voice commands draw in the student's view, which can be bigger than a diagram's space.
  const maxWidth = Math.min(LIMITS.size, Math.max(LIMITS.proposalWidth, area?.width || 0));
  const maxHeight = Math.min(LIMITS.size, Math.max(LIMITS.proposalHeight, area?.height || 0));
  if (!isObject(proposal)) fail("The diagram is not valid.");
  onlyKeys(proposal, ["summary", "ops"]);
  if (!Array.isArray(proposal.ops) || !proposal.ops.length || proposal.ops.length > LIMITS.proposalOps) fail(`A diagram has 1 to ${LIMITS.proposalOps} parts.`);
  const budget = { used: 0 };
  const keys = new Set();
  const ops = proposal.ops.map((op) => {
    if (!isObject(op)) fail("A diagram part is not valid.");
    // Shapes can be small details (a doorknob, an eye); text needs room for a word.
    const box = (withHeight, least = withHeight ? 4 : 20) => ({
      x: finite(op.x, "Diagram position", { min: 0, max: maxWidth }),
      y: finite(op.y, "Diagram position", { min: 0, max: maxHeight }),
      width: finite(op.width, "Diagram size", { min: least, max: maxWidth }),
      ...(withHeight ? { height: finite(op.height, "Diagram size", { min: least, max: maxHeight }) } : {})
    });
    const key = (value) => {
      if (typeof value !== "string" || !/^[\w-]{1,40}$/.test(value)) fail("A diagram key is not valid.");
      if (keys.has(value)) fail("Two diagram parts share a key.");
      keys.add(value);
      return value;
    };
    if (op.op === "shape") {
      onlyKeys(op, ["op", "key", "shape", "x", "y", "width", "height", "text", "color", "fill", "behind"]);
      const out = { op: "shape", key: key(op.key), shape: oneOf(PROPOSAL_SHAPES, op.shape, "Diagram shape"), ...box(true), text: proposalText(op.text, "Shape label", budget), ...proposalStyle(op, ["color", "fill"]), ...(op.behind === true ? { behind: true } : {}) };
      if (out.x + out.width > maxWidth || out.y + out.height > maxHeight) fail("The diagram is too big.");
      return out;
    }
    if (op.op === "text") {
      onlyKeys(op, ["op", "key", "x", "y", "width", "text", "color", "size"]);
      const out = { op: "text", key: key(op.key ?? `text-${keys.size}`), ...box(false), text: proposalText(op.text, "Diagram text", budget), ...proposalStyle(op, ["color", "size"]) };
      if (!out.text) fail("Diagram text is empty.");
      if (out.x + out.width > maxWidth) fail("The diagram is too big.");
      return out;
    }
    if (op.op === "line") {
      // Segments through points: any outline that isn't a box, circle or diamond (polygons when
      // closed), axes, graphs, and curves when smooth.
      onlyKeys(op, ["op", "key", "points", "closed", "arrow", "smooth", "color", "fill", "labels", "behind"]);
      if (!Array.isArray(op.points) || op.points.length < 2 || op.points.length > 64) fail("A line needs 2 to 64 points.");
      const points = op.points.map((point) => {
        if (!Array.isArray(point) || point.length !== 2) fail("A line point is not valid.");
        return [finite(point[0], "Line point", { min: 0, max: maxWidth }), finite(point[1], "Line point", { min: 0, max: maxHeight })];
      });
      const closed = op.closed === true;
      // A name per point (a triangle's A, B and C), drawn just outside it.
      if (op.labels !== undefined && (!Array.isArray(op.labels) || op.labels.length > points.length)) fail("Line labels must match its points.");
      const labels = (op.labels || []).map((label) => proposalText(label, "Point label", budget).slice(0, 40));
      return {
        op: "line", key: key(op.key ?? `line-${keys.size}`), points, closed, arrow: op.arrow === true && !closed, smooth: op.smooth === true,
        ...(labels.some(Boolean) ? { labels } : {}), ...(op.behind === true ? { behind: true } : {}),
        ...proposalStyle(op, closed ? ["color", "fill"] : ["color"])
      };
    }
    if (op.op === "connect") {
      onlyKeys(op, ["op", "from", "to", "label"]);
      if (typeof op.from !== "string" || typeof op.to !== "string" || op.from === op.to) fail("An arrow needs two different ends.");
      return { op: "connect", from: op.from, to: op.to, label: proposalText(op.label, "Arrow label", budget) };
    }
    return fail("A diagram part has an unknown kind.");
  });
  const shapeOps = ops.filter((op) => op.op === "shape");
  for (let i = 0; i < shapeOps.length && !overlap; i += 1) {
    for (const other of shapeOps.slice(i + 1)) {
      const shape = shapeOps[i];
      if (shape.x < other.x + other.width && shape.x + shape.width > other.x && shape.y < other.y + other.height && shape.y + shape.height > other.y) fail("Diagram shapes must not overlap.");
    }
  }
  const shapes = new Set(shapeOps.map((op) => op.key));
  for (const op of ops) {
    if (op.op === "connect" && (!shapes.has(op.from) || !shapes.has(op.to))) fail("An arrow must join two shapes in the same diagram.");
  }
  return { summary: proposalText(proposal.summary, "Diagram summary", { used: 0 }).slice(0, 200), ops };
}

export const KLUI_INK = "#1971c2";

/** Turns a validated proposal into Excalidraw element skeletons (local coordinates, Klui's blue ink). */
function connectionEdge(shape, toward) {
  const x = shape.x + shape.width / 2;
  const y = shape.y + shape.height / 2;
  const dx = toward.x + toward.width / 2 - x;
  const dy = toward.y + toward.height / 2 - y;
  const nx = Math.abs(dx) / (shape.width / 2);
  const ny = Math.abs(dy) / (shape.height / 2);
  const divisor = shape.shape === "ellipse" ? Math.hypot(nx, ny) : shape.shape === "diamond" ? nx + ny : Math.max(nx, ny);
  const gap = 8 / Math.max(Math.hypot(dx, dy), 1);
  const scale = 1 / Math.max(divisor, 0.001) + gap;
  return { x: x + dx * scale, y: y + dy * scale };
}

// `behind` asks the editor to put the part under everything already drawn; it isn't saved.
const partData = (op) => ({ klui: true, name: op.key, ...(op.behind ? { behind: true } : {}) });

export function proposalToSkeletons(proposal) {
  const style = { strokeColor: KLUI_INK, roughness: 1, strokeWidth: 2 };
  const label = (value, ink = KLUI_INK) => (value ? { label: { text: value, fontSize: 20, fontFamily: 5, strokeColor: ink } } : {});
  const skeletons = [];
  for (const op of proposal.ops) {
    const ink = op.color || KLUI_INK;
    // A labelled shape gets a hatched fill so its label stays readable.
    const fill = op.fill ? { backgroundColor: op.fill, fillStyle: op.text ? "hachure" : "solid" } : { backgroundColor: "transparent" };
    if (op.op === "shape") {
      skeletons.push({ type: op.shape, id: `klui-${op.key}`, customData: partData(op), x: op.x, y: op.y, width: op.width, height: op.height, ...style, strokeColor: ink, ...fill, ...label(op.text, ink) });
    } else if (op.op === "text") {
      skeletons.push({ type: "text", id: `klui-${op.key}`, customData: { klui: true, name: op.key }, x: op.x, y: op.y, text: op.text, width: op.width, fontSize: TEXT_SIZES[op.size] || 20, fontFamily: 5, strokeColor: ink });
    } else if (op.op === "line") {
      const [x, y] = op.points[0];
      const points = [...op.points, ...(op.closed ? [op.points[0]] : [])].map(([px, py]) => [px - x, py - y]);
      skeletons.push({
        type: op.arrow ? "arrow" : "line", id: `klui-${op.key}`, customData: partData(op), x, y, points, ...style, strokeColor: ink, ...fill,
        ...(op.smooth ? { roundness: { type: 2 } } : {}), ...(op.arrow ? {} : { endArrowhead: null })
      });
      // Each point label sits just outside its point, away from the middle of the shape.
      const cx = op.points.reduce((sum, [px]) => sum + px, 0) / op.points.length;
      const cy = op.points.reduce((sum, [, py]) => sum + py, 0) / op.points.length;
      (op.labels || []).forEach((name, index) => {
        if (!name) return;
        const [px, py] = op.points[index];
        const length = Math.hypot(px - cx, py - cy);
        const [dx, dy] = length ? [(px - cx) / length, (py - cy) / length] : [0, -1];
        const width = Math.max(20, name.length * 11);
        skeletons.push({
          type: "text", id: `klui-${op.key}-label-${index}`, text: name, width, fontSize: 20, fontFamily: 5, strokeColor: ink,
          x: Math.max(0, px + dx * 26 - width / 2), y: Math.max(0, py + dy * 26 - 12)
        });
      });
    }
  }
  const box = new Map(proposal.ops.filter((op) => op.op === "shape").map((op) => [op.key, op]));
  for (const op of proposal.ops) {
    if (op.op !== "connect") continue;
    const from = box.get(op.from);
    const to = box.get(op.to);
    const start = connectionEdge(from, to);
    const end = connectionEdge(to, from);
    skeletons.push({
      type: "arrow",
      x: start.x,
      y: start.y,
      width: end.x - start.x,
      height: end.y - start.y,
      points: [[0, 0], [end.x - start.x, end.y - start.y]],
      ...style,
      start: { id: `klui-${op.from}` },
      end: { id: `klui-${op.to}` },
      ...label(op.label)
    });
  }
  return skeletons;
}
