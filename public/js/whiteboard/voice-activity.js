// Local pause detection: no uploads or paid calls until a real utterance ends.
export function createVoiceActivity() {
  let started = 0;
  let lastSound = 0;
  return (level, now) => {
    if (level > 0.018) {
      if (!started) started = now;
      lastSound = now;
      return 'speech';
    }
    if (started && now - lastSound >= 2000) {
      return lastSound - started >= 250 ? 'finished' : 'noise';
    }
    return 'silence';
  };
}
