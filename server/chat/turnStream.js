/* A persisted turn keeps running after its client disconnects (the phone app
   goes to the background or is closed). Its SSE output is recorded here so a
   client that reconnects can replay what it missed and then follow live. */

const liveTurns = new Map();

function writable(target) {
  return Boolean(target) && !target.destroyed && !target.writableEnded;
}

export function liveTurnStream(runId) {
  return liveTurns.get(runId) || null;
}

/* Stands in for `res` while the turn runs. It never reports itself destroyed
   before the turn ends, so output is still recorded once the client is gone. */
export function openTurnStream(runId, res) {
  const chunks = [];
  const followers = new Map();
  let ended = false;

  const finish = () => {
    ended = true;
    for (const [follower, done] of followers) {
      if (writable(follower)) follower.end();
      done();
    }
    followers.clear();
    if (liveTurns.get(runId) === entry) liveTurns.delete(runId);
  };

  const stream = {
    get headersSent() { return res.headersSent; },
    get destroyed() { return ended; },
    get writableEnded() { return ended; },
    get statusCode() { return res.statusCode; },
    writeHead(...args) {
      if (writable(res) && !res.headersSent) res.writeHead(...args);
      return stream;
    },
    setHeader(...args) {
      if (writable(res) && !res.headersSent) res.setHeader(...args);
    },
    flushHeaders() {
      if (writable(res)) res.flushHeaders?.();
    },
    write(chunk) {
      if (ended) return false;
      const text = String(chunk);
      chunks.push(text);
      for (const follower of followers.keys()) {
        if (writable(follower)) follower.write(text);
      }
      if (writable(res)) res.write(text);
      return true;
    },
    end(chunk) {
      if (ended) return stream;
      if (chunk) stream.write(chunk);
      finish();
      if (writable(res) && res.headersSent) res.end();
      return stream;
    },
    on(event, listener) {
      res.on(event, listener);
      return stream;
    }
  };

  const entry = {
    stream,
    /* Replays the turn so far into `target`, then streams the rest. Resolves
       when the turn ends or `target` disconnects. */
    follow(target) {
      for (const chunk of chunks) target.write(chunk);
      if (ended) {
        target.end();
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const done = () => {
          followers.delete(target);
          resolve();
        };
        followers.set(target, done);
        target.on("close", done);
      });
    },
    /* Called once the turn handler returns, so followers never hang on a turn
       that stopped without writing an end. */
    release() {
      if (!ended) finish();
    }
  };

  liveTurns.set(runId, entry);
  return entry;
}
