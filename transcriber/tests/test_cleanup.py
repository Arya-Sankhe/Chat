import sys
import types
import unittest

sys.modules.setdefault("requests", types.ModuleType("requests"))

from transcriber import cleanup  # noqa: E402


def line(text, start=0.0):
    return [start, start + 10.0, text]


def fix(number, old, new):
    return {"line": number, "from": old, "to": new}


class SafetyRulesTest(unittest.TestCase):
    def assert_rejected(self, text, old, new, reason):
        self.assertEqual(cleanup.rejection_reason(text, old, new), reason, (old, new))

    def test_real_mishearings_pass(self):
        for text, old, new in [
            ("During my tosis the cell divides.", "my tosis", "mitosis"),
            ("It runs the crebs cycle here.", "crebs", "Krebs"),
            ("It makes a t p for energy.", "a t p", "ATP"),
            ("Patients with hyper tension.", "hyper tension", "hypertension"),
            ("We sell the cell to it.", "sell", "cell"),
            ("Then dna replicates.", "dna", "DNA"),
            ("Lots of par six here.", "par six", "PAR-6"),
            ("Build a three D map.", "three D", "3D"),
            ("Then PAR6 moves.", "PAR6", "PAR-6"),
        ]:
            self.assertIsNone(cleanup.rejection_reason(text, old, new), (old, new))

    def test_numbers_units_and_negations_cannot_change(self):
        for text, old, new in [
            ("Give 15 mg daily.", "15 mg", "50 mg"),
            ("Give 15 mg daily.", "mg", "kg"),
            ("Take fifteen tablets.", "fifteen", "fifty"),
            ("Take sixteen tablets.", "sixteen", "60"),
            ("Protein par six.", "par six", "PAR-7"),
            ("Bring it to class.", "to", "two"),
            ("Five milligrams a day.", "milligrams", "micrograms"),
            ("This does not bind.", "does not bind", "does bind"),
            ("It can bind.", "can", "can't"),
            ("A charge of -15 here.", "-15", "15"),
            ("About 1.5 moles.", "1.5", "1 5"),
            ("About 1,5 moles.", "1,5", "15"),
            ("Takes 5-10 days.", "5-10", "5 10"),
            ("Roughly 15% of them.", "15%", "15"),
            ("Move 5 m along.", "5 m", "5 s"),
            ("It is non polar.", "non polar", "polar"),
        ]:
            self.assert_rejected(text, old, new, "changes_protected_word")

    def test_opposites_and_unrelated_words_are_refused(self):
        self.assert_rejected("The patient was hypoglycemic.", "hypoglycemic", "hyperglycemic", "flips_meaning")
        self.assert_rejected("Levels increase here.", "increase", "decrease", "flips_meaning")
        self.assert_rejected("The test was positive.", "positive", "negative", "flips_meaning")
        self.assert_rejected("It stays unbound.", "unbound", "bound", "flips_meaning")
        self.assertIsNone(cleanup.rejection_reason("It stays un bound.", "un bound", "unbound"))
        self.assert_rejected("The ribosome moves.", "ribosome", "enzyme", "not_similar")

    def test_fix_must_match_exactly_one_whole_phrase(self):
        self.assert_rejected("All cells divide.", "cell", "sell", "not_found_once")
        self.assert_rejected("cell by cell growth.", "cell", "sell", "not_found_once")
        self.assert_rejected("Nothing here.", "absent", "present", "not_found_once")
        self.assert_rejected("Some text.", "", "new", "empty")
        self.assert_rejected(
            "one two three four five six seven eight nine", "a b c d e f g h i", "x", "too_long")


class ApplyFixesTest(unittest.TestCase):
    def test_applies_safe_fixes_keeps_timestamps_and_records_the_original(self):
        lines = [line("During my tosis it splits.", 0.0), line("Take 15 mg.", 10.0)]
        cleaned, audit = cleanup.apply_fixes(lines, [
            fix(1, "my tosis", "mitosis"),
            fix(2, "15 mg", "50 mg"),
            fix(9, "a", "b"),
        ])
        self.assertEqual(cleaned, [[0.0, 10.0, "During mitosis it splits."], [10.0, 20.0, "Take 15 mg."]])
        self.assertEqual(lines[0][2], "During my tosis it splits.")
        self.assertEqual(audit["applied"], 1)
        self.assertEqual(audit["rejected"], {"changes_protected_word": 1, "unknown_line": 1})
        self.assertEqual(audit["original_lines"], [{"line": 1, "text": "During my tosis it splits."}])

    def test_two_fixes_on_a_line_keep_the_first_original(self):
        cleaned, audit = cleanup.apply_fixes([line("The crebs cycle and my tosis.")], [
            fix(1, "crebs", "Krebs"), fix(1, "my tosis", "mitosis")])
        self.assertEqual(cleaned[0][2], "The Krebs cycle and mitosis.")
        self.assertEqual(audit["original_lines"], [{"line": 1, "text": "The crebs cycle and my tosis."}])


    def test_a_long_term_is_fixed_everywhere_on_its_line(self):
        cleaned, audit = cleanup.apply_fixes([line("The crebs cycle feeds another crebs cycle.")], [
            fix(1, "crebs cycle", "Krebs cycle")])
        self.assertEqual(cleaned[0][2], "The Krebs cycle feeds another Krebs cycle.")
        self.assertEqual(audit["applied"], 1)


class ParseFixesTest(unittest.TestCase):
    def test_keeps_finished_lines_of_a_cut_off_or_messy_reply(self):
        reply = '\n'.join([
            "```json",
            '{"line":1,"from":"a","to":"b"}',
            '{"line":"2","from":"a","to":"b"}',
            '{"line":true,"from":"a","to":"b"}',
            '{"line":3,"from":"a","to":"b"},',
            '{"line":4,"from":"a","t',
        ])
        self.assertEqual(cleanup.parse_fixes(reply), [fix(1, "a", "b"), fix(3, "a", "b")])
        self.assertEqual(cleanup.parse_fixes(None), [])


class CourseContextTest(unittest.TestCase):
    def test_prefers_text_about_this_lecture_and_respects_the_budget(self):
        lines = [line("Today we cover mitochondria and oxidative phosphorylation.")]
        chunks = ["Chapter one covers medieval castles.", "Oxidative phosphorylation in mitochondria.", "", None]
        self.assertEqual(
            cleanup.select_course_context(chunks, lines),
            "Oxidative phosphorylation in mitochondria.\n\nChapter one covers medieval castles.")
        big = ["mitochondria " * 1000, "mitochondria " * 1000]
        self.assertLessEqual(len(cleanup.select_course_context(big, lines, max_chars=500)), 500)
        self.assertEqual(cleanup.select_course_context([], lines), "")


class FakeResponse:
    def __init__(self, chunks, tick):
        self.chunks, self.tick = chunks, tick

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def raise_for_status(self):
        pass

    def iter_content(self, chunk_size=None):
        for chunk in self.chunks:
            self.tick()
            yield chunk


class CompleteTest(unittest.TestCase):
    def run_stream(self, chunks, deadline_after=100):
        clock = {"now": 0.0}
        self.addCleanup(setattr, cleanup.time, "monotonic", cleanup.time.monotonic)
        cleanup.time.monotonic = lambda: clock["now"]
        had = hasattr(cleanup.requests, "post")
        original = getattr(cleanup.requests, "post", None)
        self.addCleanup(lambda: setattr(cleanup.requests, "post", original) if had else delattr(cleanup.requests, "post"))

        def tick():
            clock["now"] += 1

        cleanup.requests.post = lambda *_args, **_kwargs: FakeResponse(chunks, tick)
        return cleanup.complete(api_key="k", base_url="http://x", model="m", lines=[line("Hi.")], course_context="",
                                deadline=deadline_after)

    def test_joins_a_stream_split_across_chunks_and_reads_usage(self):
        text, usage = self.run_stream([
            b'data: {"choices":[{"delta":{"content":"ab',
            b'c"}}]}\n: keep-alive\n',
            b'data: {"choices":[],"usage":{"cost":1}}\ndata: [DONE]\n',
        ])
        self.assertEqual((text, usage), ("abc", {"cost": 1}))

    def test_a_reply_trickling_without_newlines_stops_at_the_deadline(self):
        text, _usage = self.run_stream(
            [b'data: {"choices":[{"delta":{"content":"kept"}}]}\n', *[b"x"] * 1000], deadline_after=5)
        self.assertEqual(text, "kept")

    def test_a_model_error_inside_the_stream_raises(self):
        with self.assertRaises(RuntimeError):
            self.run_stream([b'data: {"error":{"message":"boom"}}\n'])


class UserMessageTest(unittest.TestCase):
    def test_numbers_lines_from_one_and_omits_empty_context(self):
        self.assertEqual(cleanup.build_user_message([line("Hello.")], ""), "<transcript>\n1. Hello.\n</transcript>")
        self.assertIn("<course_files>\nSlides\n</course_files>", cleanup.build_user_message([line("Hello.")], "Slides"))


if __name__ == "__main__":
    unittest.main()
