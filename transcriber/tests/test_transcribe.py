import unittest

try:
    import numpy as np
except ImportError:
    np = None

from transcriber.transcribe import split_points


@unittest.skipIf(np is None, "numpy runs in the transcriber image")
class SplitPointsTest(unittest.TestCase):
    def test_short_speech_is_left_whole(self):
        self.assertEqual(split_points(np.ones(100), 100, 10), [])

    def test_cuts_at_the_quiet_moment_and_never_exceeds_the_limit(self):
        samples = np.ones(1000, dtype=np.float32)
        samples[85:95] = 0
        cuts = split_points(samples, 100, 10)
        self.assertTrue(85 <= cuts[0] <= 95, cuts)
        edges = [0, *cuts, len(samples)]
        self.assertTrue(all(0 < end - begin <= 100 for begin, end in zip(edges, edges[1:])))


if __name__ == "__main__":
    unittest.main()
