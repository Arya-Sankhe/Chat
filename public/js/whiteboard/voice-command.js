import { seenColor } from './colors.js';
import { LIMITS, SceneError, validateProposal } from './schema.js';

// A voice command draws new parts and changes what is in the student's view. Coordinates are
// view coordinates: (0, 0) is the top-left of `frame`, the scene rectangle the command was given.
// Edits target only elements of that frozen view and only through these fields.
export const VOICE_EDITS = 30;
export const VOICE_TRANSFORMS = 8;
const EDIT_FIELDS = ['id', 'delete', 'x', 'y', 'width', 'height', 'text', 'size', 'color', 'fill', 'strokeColor', 'backgroundColor'];
const TEXT_SIZES = new Set(['small', 'medium', 'large', 'huge']);
const HEX = /^(#[0-9a-f]{6}|transparent)$/i;
const SHAPES = new Set(['rectangle', 'ellipse', 'diamond']);

const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function frameOf(value) {
  if (value === undefined) return null;
  const ok = value && typeof value === 'object' && ['x', 'y'].every(key => number(value[key], -LIMITS.coordinate, LIMITS.coordinate))
    && ['width', 'height'].every(key => number(value[key], 0, LIMITS.size));
  if (!ok) throw new SceneError('That board command is not valid.');
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

export function validateVoiceProposal(value, elements) {
  const fail = () => { throw new SceneError('That board command is not valid.'); };
  if (!value || Object.keys(value).some(key => !['summary', 'ops', 'edits', 'transforms', 'navigation', 'frame'].includes(key))) fail();
  if (!Array.isArray(value.ops) || !Array.isArray(value.edits) || value.edits.length > VOICE_EDITS) fail();
  const frame = frameOf(value.frame);
  const proposal = value.ops.length
    ? validateProposal({ summary: value.summary, ops: value.ops }, { overlap: true, area: frame })
    : { summary: String(value.summary || '').trim().slice(0, 200), ops: [] };
  const byId = new Map(elements.map(element => [element.id, element]));
  const labelled = new Set(elements.filter(element => element.type === 'text' && element.containerId).map(element => element.containerId));
  const seen = new Set();
  const edits = value.edits.map(edit => {
    const element = byId.get(edit?.id);
    // A shape's label changes through its shape.
    if (!element || element.containerId || seen.has(edit.id) || Object.keys(edit).some(key => !EDIT_FIELDS.includes(key))) fail();
    seen.add(edit.id);
    if (edit.delete === true) return { id: edit.id, delete: true };
    if (edit.delete !== undefined && edit.delete !== false) fail();
    const out = { id: edit.id };
    for (const key of ['x', 'y']) {
      if (edit[key] === undefined) continue;
      if (!frame || !number(edit[key], -LIMITS.size, LIMITS.size)) fail();
      out[key] = edit[key];
    }
    for (const key of ['width', 'height']) {
      if (edit[key] === undefined) continue;
      if (element.type === 'text' || !number(edit[key], 4, LIMITS.size)) fail();
      out[key] = edit[key];
    }
    if (edit.text !== undefined) {
      const writable = element.type === 'text' || (SHAPES.has(element.type) && labelled.has(element.id));
      if (!writable || typeof edit.text !== 'string' || !edit.text.trim() || edit.text.length > LIMITS.proposalText) fail();
      out.text = edit.text.trim();
    }
    if (edit.size !== undefined) {
      if (element.type !== 'text' || !TEXT_SIZES.has(edit.size)) fail();
      out.size = edit.size;
    }
    for (const [key, alias] of [['strokeColor', 'color'], ['backgroundColor', 'fill']]) {
      const colour = edit[key] ?? edit[alias];
      if (colour === undefined) continue;
      if (typeof colour !== 'string' || !HEX.test(colour) || (key === 'strokeColor' && colour === 'transparent')) fail();
      out[key] = colour.toLowerCase();
    }
    if (Object.keys(out).length === 1) fail();
    return out;
  });
  // Several elements moved or scaled together, about their shared centre. Each element once.
  if (value.transforms !== undefined && (!Array.isArray(value.transforms) || value.transforms.length > VOICE_TRANSFORMS)) fail();
  const transforms = (value.transforms || []).map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['ids', 'dx', 'dy', 'scale'].includes(key))) fail();
    if (!Array.isArray(item.ids) || !item.ids.length || item.ids.length > 60) fail();
    for (const id of item.ids) {
      const element = byId.get(id);
      if (!element || element.containerId || seen.has(id)) fail();
      seen.add(id);
    }
    const out = { ids: [...item.ids] };
    if (item.dx !== undefined && item.dx !== 0) out.dx = number(item.dx, -LIMITS.size, LIMITS.size) ? item.dx : fail();
    if (item.dy !== undefined && item.dy !== 0) out.dy = number(item.dy, -LIMITS.size, LIMITS.size) ? item.dy : fail();
    if (item.scale !== undefined && item.scale !== 1) out.scale = number(item.scale, 0.1, 10) ? item.scale : fail();
    if (Object.keys(out).length === 1) fail();
    return out;
  });
  if (value.navigation !== undefined && !['left', 'right', 'up', 'down', 'fit'].includes(value.navigation)) fail();
  if (!proposal.ops.length && !edits.length && !transforms.length && !value.navigation) fail();
  return { ...proposal, edits, ...(transforms.length ? { transforms } : {}), ...(frame ? { frame } : {}), ...(value.navigation ? { navigation: value.navigation } : {}) };
}

/** True when nothing a command changes was edited after Klui saw it. */
export function voiceTargetsUnchanged(proposal, frozen, current) {
  const ids = [...(proposal.edits || []).map(edit => edit.id), ...(proposal.transforms || []).flatMap(item => item.ids)];
  return ids.every(id => {
    const before = frozen.find(element => element.id === id);
    const now = current.find(element => element.id === id && !element.isDeleted);
    return before && now && before.version === now.version && before.versionNonce === now.versionNonce;
  });
}

const NAVIGATION = ['left', 'right', 'up', 'down', 'fit'];

/**
 * Keeps whatever part of a spoken command is valid instead of failing the whole turn: each op and
 * edit is checked on its own and arrows go in after the shapes they join. Returns null when
 * nothing usable is left.
 */
export function salvageVoiceProposal(value, elements, frame = null) {
  const ops = Array.isArray(value?.ops) ? value.ops.filter(op => op && typeof op === 'object') : [];
  const kept = [];
  const fits = (op) => {
    try {
      validateProposal({ summary: '', ops: [...kept, op] }, { overlap: true, area: frame });
      return true;
    } catch {
      return false;
    }
  };
  for (const op of [...ops.filter(op => op.op !== 'connect'), ...ops.filter(op => op.op === 'connect')]) {
    if (kept.length >= LIMITS.proposalOps) break;
    if (fits(op)) kept.push(op);
  }
  const base = frame ? { frame } : {};
  const edits = (Array.isArray(value?.edits) ? value.edits : []).map(clean).filter((edit) => {
    try {
      validateVoiceProposal({ summary: '', ops: [], edits: [edit], ...base }, elements);
      return true;
    } catch {
      return false;
    }
  }).filter((edit, index, list) => list.findIndex(other => other.id === edit.id) === index).slice(0, VOICE_EDITS);
  const taken = new Set(edits.map(edit => edit.id));
  const transforms = [];
  for (const item of Array.isArray(value?.transforms) ? value.transforms : []) {
    if (transforms.length >= VOICE_TRANSFORMS || !item || typeof item !== 'object') break;
    // Keep the ids that exist; an id already edited stays with its edit.
    const ids = Array.isArray(item.ids) ? item.ids.filter(id => !taken.has(id) && elements.some(element => element.id === id && !element.containerId)) : [];
    const candidate = clean({ ...item, ids: [...new Set(ids)] });
    try {
      validateVoiceProposal({ summary: '', ops: [], edits: [], transforms: [candidate], ...base }, elements);
      candidate.ids.forEach(id => taken.add(id));
      transforms.push(candidate);
    } catch {
      // Drop it.
    }
  }
  const navigation = NAVIGATION.includes(value?.navigation) ? value.navigation : undefined;
  if (!kept.length && !edits.length && !transforms.length && !navigation) return null;
  return validateVoiceProposal({ summary: '', ops: kept, edits, ...(transforms.length ? { transforms } : {}), ...base, ...(navigation ? { navigation } : {}) }, elements);
}

// The model fills optional fields with empty strings or false; those mean "leave it alone".
function clean(edit) {
  if (!edit || typeof edit !== 'object') return edit;
  return Object.fromEntries(Object.entries(edit).filter(([key, value]) => value !== '' && value !== null && !(key === 'delete' && value === false)));
}

const round = (value) => Math.round(value);

/** An element's box as drawn, in scene coordinates (lines and strokes extend from their first point). */
export function elementBox(element) {
  if (!Array.isArray(element.points) || !element.points.length) return { x: element.x, y: element.y, width: element.width, height: element.height };
  const xs = element.points.map(point => point[0]);
  const ys = element.points.map(point => point[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: element.x + left, y: element.y + top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/**
 * What a voice command can see and change: one line per element with its id, in view coordinates
 * (frame's top-left is 0, 0). A shape's label is shown on the shape. Colours are as the student
 * sees them in `theme`.
 */
export function describeForCommand(elements, frame, { selectedIds = [], theme = "light", maxChars = 12000 } = {}) {
  const labels = new Map(elements.filter(element => element.type === 'text' && element.containerId).map(element => [element.containerId, element.text]));
  const selected = new Set(selectedIds);
  const lines = [];
  for (const element of elements) {
    if (element.type === 'text' && element.containerId) continue;
    const box = elementBox(element);
    const parts = [`id=${element.id}`, element.type];
    if (element.customData?.name) parts.push(`named "${element.customData.name}"`);
    parts.push(`box (${round(box.x - frame.x)}, ${round(box.y - frame.y)}) ${round(box.width)}×${round(box.height)}`);
    if (element.type !== 'freedraw' && element.type !== 'image') parts.push(`${element.type === 'text' ? 'colour' : 'outline'} ${seenColor(element.strokeColor, theme)}`);
    if (element.backgroundColor && element.backgroundColor !== 'transparent' && element.type !== 'text') parts.push(`fill ${seenColor(element.backgroundColor, theme)}`);
    if (element.type === 'text') parts.push(`text "${String(element.text).replace(/\s+/g, ' ').slice(0, 160)}"`);
    if (labels.has(element.id)) parts.push(`label "${String(labels.get(element.id)).replace(/\s+/g, ' ').slice(0, 120)}"`);
    if ((element.type === 'line' || element.type === 'arrow') && element.points.length <= 16) {
      parts.push(`points ${JSON.stringify(element.points.map(([px, py]) => [round(element.x + px - frame.x), round(element.y + py - frame.y)]))}`);
    }
    if (selected.has(element.id)) parts.push('SELECTED');
    lines.push(`- ${parts.join(', ')}`);
  }
  const out = lines.join('\n');
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n- …more not shown` : out;
}
