import test from 'node:test';
import assert from 'node:assert/strict';
import { darkPixels, seenColor, storedColor, storedProposal } from '../public/js/whiteboard/colors.js';
import { createVoiceActivity } from '../public/js/whiteboard/voice-activity.js';
import { validateProposal } from '../public/js/whiteboard/schema.js';
import { describeForCommand, salvageVoiceProposal, validateVoiceProposal, voiceTargetsUnchanged } from '../public/js/whiteboard/voice-command.js';

test('pause detection ignores silence and brief noise, sends only after a sustained utterance', () => {
  const silent = createVoiceActivity();
  assert.equal(silent(0, 100), 'silence');
  assert.equal(silent(0, 90_000), 'silence');
  const noise = createVoiceActivity();
  noise(.04, 100);
  assert.equal(noise(0, 2200), 'noise');
  const speech = createVoiceActivity();
  assert.equal(speech(.04, 100), 'speech');
  speech(.04, 500);
  assert.equal(speech(0, 1400), 'silence');
  assert.equal(speech(0, 2500), 'finished');
});

test('voice edits change only visible elements through allowed fields and reject stale targets', () => {
  const elements = [{ id: 'note', type: 'text', version: 1, versionNonce: 2 }];
  const command = { summary: 'Updated.', ops: [], edits: [{ id: 'note', text: 'New text', strokeColor: '#1971c2' }] };
  assert.deepEqual(validateVoiceProposal(command, elements), command);
  for (const edit of [{ id: 'missing', text: 'x' }, { id: 'note', isDeleted: true }, { id: 'note', strokeColor: 'url(x)' }, { id: 'note', text: 'x'.repeat(401) }]) {
    assert.throws(() => validateVoiceProposal({ ...command, edits: [edit] }, elements));
  }
  assert.throws(() => validateVoiceProposal(command, [{ ...elements[0], containerId: 'shape' }]));
  assert.equal(voiceTargetsUnchanged(command, elements, elements), true);
  assert.equal(voiceTargetsUnchanged(command, elements, [{ ...elements[0], version: 2 }]), false);
  assert.equal(voiceTargetsUnchanged(command, elements, []), false);
});


test('voice navigation accepts only the supported canvas actions', () => {
  assert.equal(validateVoiceProposal({ summary: 'Moving right.', ops: [], edits: [], navigation: 'right' }, []).navigation, 'right');
  assert.throws(() => validateVoiceProposal({ summary: 'x', ops: [], edits: [], navigation: 'javascript:alert(1)' }, []));
});

test('voice commands can move, resize, recolour, relabel and delete what is in view', () => {
  const frame = { x: 500, y: 300, width: 1400, height: 900 };
  const elements = [
    { id: 'walls', type: 'line', x: 600, y: 400, width: 400, height: 350, points: [[0, 0], [400, 0], [400, 350], [0, 0]], strokeColor: '#cc3333', backgroundColor: '#cc3333', customData: { klui: true, name: 'walls' } },
    { id: 'window', type: 'rectangle', x: 640, y: 460, width: 80, height: 80, strokeColor: '#336699', backgroundColor: '#cce6ff' },
    { id: 'box', type: 'rectangle', x: 900, y: 900, width: 200, height: 100, strokeColor: '#1971c2', backgroundColor: 'transparent', boundElements: [{ id: 'box-label', type: 'text' }] },
    { id: 'box-label', type: 'text', text: 'Start', containerId: 'box', x: 950, y: 930, width: 50, height: 25, strokeColor: '#1971c2' },
    { id: 'title', type: 'text', text: 'House', x: 600, y: 320, width: 80, height: 25, strokeColor: '#1e1e1e' }
  ];
  const command = {
    summary: '', frame,
    ops: [{ op: 'shape', key: 'left-window', shape: 'ellipse', x: 1350, y: 160, width: 70, height: 70, text: '', fill: '#cce6ff' }],
    edits: [
      { id: 'window', delete: true },
      { id: 'walls', x: 120, y: 80, width: 600, height: 500 },
      { id: 'box', text: 'Begin', color: '#e03131', fill: '#ffec99' },
      { id: 'title', size: 'huge' }
    ]
  };
  const out = validateVoiceProposal(command, elements);
  assert.deepEqual(out.frame, frame);
  assert.equal(out.ops[0].x, 1350);
  assert.deepEqual(out.edits[2], { id: 'box', text: 'Begin', strokeColor: '#e03131', backgroundColor: '#ffec99' });
  for (const edit of [
    { id: 'box-label', text: 'x' },
    { id: 'title', width: 300 },
    { id: 'walls', text: 'x' },
    { id: 'title', size: 'giant' },
    { id: 'window', delete: 'yes' },
    { id: 'window', color: 'transparent' }
  ]) assert.throws(() => validateVoiceProposal({ ...command, edits: [edit] }, elements), JSON.stringify(edit));
  // A whole drawing moves or scales together; an element belongs to one change only.
  const grown = validateVoiceProposal({ summary: '', frame, ops: [], edits: [], transforms: [{ ids: ['walls', 'window', 'title'], scale: 1.5, dx: 0 }] }, elements);
  assert.deepEqual(grown.transforms, [{ ids: ['walls', 'window', 'title'], scale: 1.5 }]);
  for (const transforms of [[{ ids: ['box-label'], dx: 5 }], [{ ids: ['walls'], scale: 50 }], [{ ids: ['walls'] }], [{ ids: ['walls'], dx: 5 }, { ids: ['walls'], dy: 5 }]]) {
    assert.throws(() => validateVoiceProposal({ summary: '', frame, ops: [], edits: [], transforms }, elements), JSON.stringify(transforms));
  }
  assert.throws(() => validateVoiceProposal({ summary: '', frame, ops: [], edits: [{ id: 'walls', delete: true }], transforms: [{ ids: ['walls'], dx: 5 }] }, elements));
  assert.deepEqual(salvageVoiceProposal({ ops: [], edits: [{ id: 'door', delete: true }], transforms: [{ ids: ['walls', 'missing', 'door'], dx: 40, dy: 0, scale: 1 }] }, elements, frame)?.transforms, [{ ids: ['walls'], dx: 40 }]);
  // Without the view it was given, a position means nothing.
  assert.throws(() => validateVoiceProposal({ summary: '', ops: [], edits: [{ id: 'walls', x: 10 }] }, elements));
  // Empty optional fields from the model are ignored, and a bad edit doesn't sink the good ones.
  const salvaged = salvageVoiceProposal({ ops: [], edits: [{ id: 'window', delete: true, text: '' }, { id: 'missing', delete: true }] }, elements, frame);
  assert.deepEqual(salvaged.edits, [{ id: 'window', delete: true }]);
  const listed = describeForCommand(elements, frame, { selectedIds: ['title'] });
  assert.match(listed, /id=walls, line, named "walls", box \(100, 100\) 400×350/);
  assert.match(listed, /id=box, rectangle, box \(400, 600\) 200×100, outline #1971c2, label "Start"/);
  assert.match(listed, /id=title, text, .*text "House", SELECTED/);
  assert.doesNotMatch(listed, /id=box-label/);
});

test('dark boards: Klui sees and picks colours as they look on screen', () => {
  const near = (a, b) => [1, 3, 5].every((at) => Math.abs(parseInt(a.slice(at, at + 2), 16) - parseInt(b.slice(at, at + 2), 16)) <= 2);
  // Matches the browser's invert(93%) hue-rotate(180deg) (sampled from Chrome).
  assert.ok(near(seenColor('#8b4513', 'dark'), '#da9e73'));
  assert.ok(near(seenColor('#cce6ff', 'dark'), '#172d43'));
  assert.equal(seenColor('#8b4513', 'light'), '#8b4513');
  assert.equal(seenColor('transparent', 'dark'), 'transparent');
  // Reachable colours round-trip; out-of-reach ones stay the same hue.
  for (const colour of ['#8b4513', '#2f9e44', '#6d4c41']) assert.ok(near(seenColor(storedColor(colour, 'dark'), 'dark'), colour), colour);
  const red = seenColor(storedColor('#e03131', 'dark'), 'dark');
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(red.slice(at, at + 2), 16));
  assert.ok(r > 180 && g < 120 && b < 120, `red stays red, got ${red}`);
  assert.equal(storedColor('#e03131', 'light'), '#e03131');
  const proposal = storedProposal({ summary: '', ops: [{ op: 'shape', key: 'sun', color: '#8b4513', fill: 'transparent' }], edits: [{ id: 'a', strokeColor: '#8b4513', backgroundColor: '#2f9e44' }] }, 'dark');
  assert.ok(near(proposal.ops[0].color, storedColor('#8b4513', 'dark')));
  assert.equal(proposal.ops[0].fill, 'transparent');
  assert.equal(proposal.edits[0].backgroundColor, storedColor('#2f9e44', 'dark'));
  const pixels = darkPixels(new Uint8ClampedArray([0x8b, 0x45, 0x13, 255]));
  assert.ok(near(`#${[...pixels.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`, '#da9e73'));
  const line = describeForCommand([{ id: 'w', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, strokeColor: '#cce6ff', backgroundColor: '#8b4513' }], { x: 0, y: 0 }, { theme: 'dark' });
  assert.match(line, new RegExp(`outline ${seenColor('#cce6ff', 'dark')}, fill ${seenColor('#8b4513', 'dark')}`));
});

test('a full view lets a spoken drawing go past its edge, up to one view beyond', () => {
  const frame = { x: 500, y: 200, width: 1700, height: 980 };
  const below = { op: 'shape', key: 'next', shape: 'rectangle', x: 100, y: 1100, width: 220, height: 100, text: 'Next' };
  const kept = salvageVoiceProposal({ say: 'ok', ops: [below], edits: [] }, [], frame);
  assert.equal(kept.ops.length, 1);
  assert.equal(kept.ops[0].y, 1100);
  const left = { op: 'line', key: 'path', points: [[-200, 50], [-40, 80]] };
  assert.equal(salvageVoiceProposal({ ops: [left], edits: [] }, [], frame).ops.length, 1);
  // A view smaller than a diagram's space (1600×1200) still gets that space to spill into.
  const tooFar = { ...below, key: 'far', y: 1200 * 2 - 50 };
  assert.equal(salvageVoiceProposal({ ops: [tooFar], edits: [] }, [], frame), null);
  // Diagrams placed by the editor keep their local space.
  assert.throws(() => validateProposal({ ops: [{ ...below, y: -20 }] }), /out of range/);
});
