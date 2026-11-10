import test from "node:test";
import assert from "node:assert/strict";
import { buildLectureInput, cleanJots, LECTURE_NOTE_MARK } from "../server/study/lectureNotes.js";
import { noteBody, noteModeAllowed, noteModesFromNotes, shortLectureTitle } from "../server/study/generate.js";
import { jotsFromText, lectureNoteHtml, loadJots, moveJots, saveJots } from "../public/js/studyLectures.js";

const lecture = {
  id: "doc-1",
  kind: "audio",
  metadata: { segments: [[0, 4, "Welcome back."], [252.4, 260, "DNA damage keeps CDK1 off."], [3700, 3710, " "]] }
};

test("lecture input is the timed transcript plus what the student typed", () => {
  const input = buildLectureInput({ documentFile: lecture, jots: [{ t: 250, text: "G2/M ⟦check⟧?" }, { t: 9, text: "   " }] });
  assert.match(input, /\[0:00\] Welcome back\.\n\[4:12\] DNA damage keeps CDK1 off\./);
  assert.doesNotMatch(input, /1:01:40/);
  assert.match(input, /typed during class:\n\[4:10\] G2\/M check\?$/);
  assert.match(buildLectureInput({ documentFile: lecture }), /did not type anything/);
  assert.throws(() => buildLectureInput({ documentFile: { ...lecture, metadata: {} } }), { status: 409 });
  assert.throws(() => buildLectureInput({ documentFile: { ...lecture, kind: "pdf" } }), { status: 400 });
  assert.equal(cleanJots(Array.from({ length: 300 }, (_, t) => ({ t, text: "x".repeat(900) }))).length, 200);
});

test("lecture notes are their own note mode, made once per recording", () => {
  const note = { document_file_id: "doc-1", kind: "summary", content: `${LECTURE_NOTE_MARK}\n# Cell cycle\n- point [4:12]` };
  const modes = noteModesFromNotes([note], "doc-1");
  assert.equal(modes.lecture, true);
  assert.equal(modes.summary, false);
  assert.equal(noteModeAllowed(modes, "lecture"), false);
  assert.equal(noteModeAllowed(modes, "summary"), true);
  assert.equal(noteBody(note), "# Cell cycle\n- point [4:12]");
});

test("notes link times to playback and mark the student's own words", () => {
  const html = lectureNoteHtml("<h1>Cell cycle</h1><ul><li>⟦G2/M?⟧ damage stops mitosis [04:12]</li><li>long [1:02:03]</li></ul>", String);
  assert.doesNotMatch(html, /<h1>/);
  assert.match(html, /<mark class="dojo-mine">G2\/M\?<\/mark>/);
  assert.match(html, /data-cite-time="252"[^>]*>04:12<\/button>/);
  assert.match(html, /data-cite-time="3723"/);
});

test("each typed line keeps the moment it was first written", () => {
  const first = jotsFromText("mitosis", [], 30);
  const second = jotsFromText("mitosis!\nask about G2", first, 95);
  assert.deepEqual(second, [{ t: 30, text: "mitosis!" }, { t: 95, text: "ask about G2" }]);
  const inserted = jotsFromText("new first\nmitosis!\nask about G2", second, 300);
  assert.deepEqual(inserted.map((line) => line.t), [300, 30, 95]);
  assert.deepEqual(jotsFromText("ask about G2", second, 400).map((line) => line.t), [95]);
});

test("typed lines survive when the device can't back them up", () => {
  const lines = [{ t: 4, text: "why p53?" }];
  saveJots("rec-1", lines);
  moveJots("rec-1", "doc-9");
  assert.deepEqual(loadJots("doc-9"), lines);
  assert.deepEqual(loadJots("rec-1"), []);
});

test("a lecture's title is the notes' short heading, kept list-sized", () => {
  assert.equal(shortLectureTitle("**Cell Cycle** Checkpoints"), "Cell Cycle Checkpoints");
  const long = shortLectureTitle("An unusually long heading that keeps going about mitosis and checkpoints and regulation and more");
  assert.ok(long.length <= 81 && long.endsWith("…"));
});
