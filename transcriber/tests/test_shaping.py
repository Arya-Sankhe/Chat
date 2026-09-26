import unittest

from transcriber.shaping import build_chunks, build_lines, format_clock, word_count


def seg(start, end, text):
    return {"start": start, "end": end, "text": text}


class ShapingTest(unittest.TestCase):
    def test_merges_short_segments_until_a_sentence_ends(self):
        lines = build_lines([seg(0, 4, "so today we"), seg(4.5, 9, "talk about cells."), seg(9.2, 14, "Next topic.")])
        self.assertEqual(lines[0][2], "So today we talk about cells. Next topic.")
        self.assertEqual(lines[0][:2], [0, 14])

    def test_breaks_after_min_length_at_sentence_end(self):
        lines = build_lines([seg(0, 13, "A long sentence."), seg(13.5, 20, "another one.")])
        self.assertEqual([line[2] for line in lines], ["A long sentence.", "Another one."])

    def test_breaks_on_long_gap_and_max_length(self):
        lines = build_lines([seg(0, 5, "one"), seg(10, 12, "two")])
        self.assertEqual(len(lines), 2)
        long = [seg(i * 5, i * 5 + 5, "word") for i in range(10)]
        self.assertTrue(all(line[1] - line[0] <= 40 for line in build_lines(long)))

    def test_skips_empty_text_and_keeps_lowercase_mid_sentence(self):
        lines = build_lines([seg(0, 20, "it was, "), seg(20, 40, "  "), seg(40.5, 45, "and then")])
        self.assertEqual([line[2] for line in lines], ["It was,", "and then"])

    def test_chunks_respect_size_and_carry_time_labels(self):
        lines = [[i * 10.0, i * 10.0 + 9, "x" * 90] for i in range(100)]
        chunks = build_chunks(lines, max_chars=1000)
        self.assertTrue(all(len(c["text"]) <= 1000 for c in chunks))
        self.assertEqual(sum(c["text"].count("\n") + 1 for c in chunks), 100)
        self.assertEqual(chunks[0]["label"], "0:00–1:39")
        self.assertTrue(chunks[0]["text"].startswith("[0:00] x"))

    def test_clock_and_word_count(self):
        self.assertEqual(format_clock(3725), "1:02:05")
        self.assertEqual(format_clock(65.9), "1:05")
        self.assertEqual(word_count([[0, 1, "a b c"], [1, 2, "d"]]), 4)


if __name__ == "__main__":
    unittest.main()
