import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
const hub = readFileSync(new URL('../clients/web/src/islands/studyHub.js', import.meta.url), 'utf8');
function load(name, context) {
  const source = hub.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`))?.[0];
  assert.ok(source);
  runInNewContext(source, context);
}
test('transcription progress does not redraw Ask when no cards are mounted', () => {
  let renders = 0;
  const context = {
    studyVisible: () => true, state: { activeCourseId: 'course', activeCourseTab: 'chat' },
    els: { studyView: { querySelectorAll: () => [], querySelector: () => null } },
    host: {}, activeLectureId: '', audioCardEntries: () => [{ key: 'doc:a', phase: 'running' }],
    render: () => renders++, CSS: { escape: value => value }
  };
  load('patchAudioCards', context);
  context.patchAudioCards();
  assert.equal(renders, 0);
  context.state.activeCourseTab = 'notes';
  context.patchAudioCards();
  assert.equal(renders, 1);
});
test('opening a studio from a lecture routes to Study before rendering', () => {
  const context = {
    host: {}, activeLectureId: 'lecture', state: { activeCourseTab: 'notes' },
    els: { studyView: { querySelector: () => null } }, localStorage: { getItem: () => null },
    deckLayoutKey: 'layout', podcastAudio: null, tutorCall: null,
    render() { assert.equal(context.activeLectureId, ''); assert.equal(context.state.activeCourseTab, 'practice'); },
    animatePreviewResize() {}, loadStudioTutor() {}
  };
  load('openStudioView', context);
  context.openStudioView('tutor', 'tutor-id');
  assert.equal(context.studioView.id, 'tutor-id');
});
test('source citations route to Materials and retain the page and picker callbacks', () => {
  let opened;
  const slot = {};
  const context = {
    host: {}, activeLectureId: 'lecture', state: { activeCourseTab: 'chat', studyMaterials: { documents: [{ id: 'pdf', attachment_id: 'attachment', kind: 'pdf' }] } },
    els: { studyView: { querySelector: () => slot } }, isAudioDoc: () => false, audioViewer: { id: '' },
    workspaceColumns: () => '', documentDisplayName: () => 'slides.pdf', animatePreviewResize() {},
    render() { assert.equal(context.state.activeCourseTab, 'materials'); assert.equal(context.activeLectureId, ''); },
    contextPicker: { pageOn: (id, page) => id === 'pdf' && page === 7 },
    openDocumentViewer: value => { opened = value; }
  };
  load('openSource', context);
  context.openSource('pdf', null, 7);
  assert.equal(opened.page, 7);
  assert.equal(opened.container, slot);
  assert.equal(opened.pagePick.isOn(7), true);
});
test('host refresh keeps surviving composer and message islands in place', () => {
  let parked = 0;
  const context = {
    els: { studyView: { querySelector: selector => selector.includes('slot') ? {} : null } },
    state: { activeCourseId: '' }, host: { update() {} },
    parkComposer: () => parked++, parkMessages: () => parked++, renderNoteOverlay() {}
  };
  load('renderHost', context);
  context.renderHost();
  assert.equal(parked, 0);
});
