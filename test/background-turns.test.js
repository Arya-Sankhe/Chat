import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const rejoinSource = source.slice(source.indexOf('const MAX_TURN_REJOINS'), source.indexOf('/* Reloads the chat;'));

function rejoin() {
  return runInNewContext(`${rejoinSource}\n({ shouldRejoinTurn })`, {});
}
function networkError(message) {
  return new TypeError(message);
}

test('a saved turn that loses its connection is rejoined instead of failing', () => {
  const { shouldRejoinTurn } = rejoin();
  const run = { turnRunId: 'turn-1' };
  assert.equal(shouldRejoinTurn(run, networkError('Failed to fetch')), true);
  assert.equal(shouldRejoinTurn(run, networkError('network error')), true);
  assert.equal(shouldRejoinTurn(run, networkError('Load failed')), true);
});

test('a stream detached on resume is rejoined, but Stop and real errors are not', () => {
  const { shouldRejoinTurn } = rejoin();
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  assert.equal(shouldRejoinTurn({ turnRunId: 'turn-1', reattaching: true }, abort), true);
  assert.equal(shouldRejoinTurn({ turnRunId: 'turn-2' }, abort), false);
  assert.equal(shouldRejoinTurn({ turnRunId: 'turn-3', cancelRequested: true }, networkError('Failed to fetch')), false);
  assert.equal(shouldRejoinTurn({ turnRunId: 'turn-4' }, new TypeError("Cannot read properties of undefined (reading 'x')")), false);
  assert.equal(shouldRejoinTurn({ turnRunId: '' }, networkError('Failed to fetch')), false, 'unsaved turns cannot be rejoined');
});

test('rejoining one turn stops after a few attempts', () => {
  const { shouldRejoinTurn } = rejoin();
  const run = { turnRunId: 'turn-1' };
  const results = Array.from({ length: 7 }, () => shouldRejoinTurn(run, networkError('Failed to fetch')));
  assert.deepEqual(results, [true, true, true, true, true, false, false]);
});

test('coming back to the app checks for a quiet stream and reloads a lost connection', () => {
  assert.match(source, /async function refreshAccountAfterResume\(\) \{\n  if \(state\.session\?\.access_token\) rejoinTurnsAfterResume\(\);/);
  assert.match(source, /if \(rejoinTurn && stillActive\) \{\n      await rejoinConversationTurn\(conversationId, localAssistant\);/);
});
