import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/js/cameraSheet.js', import.meta.url), 'utf8').replace('export function', 'function');
function setup(getUserMedia) {
  const controls = Object.fromEntries(['video', '.camera-status', '.camera-shutter', '.camera-close', '.camera-switch'].map(key => [key, { classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, focus() {}, play: async () => {} }]));
  const sheet = { hidden: true, setAttribute() {}, querySelector: key => controls[key], addEventListener() {} };
  const context = { document: { createElement: () => sheet, getElementById: () => null, body: { append() {} }, addEventListener() {} }, navigator: { mediaDevices: { getUserMedia } } };
  const camera = runInNewContext(`${source}; createCameraSheet({ onPhoto() {}, onError() {} })`, context);
  return { camera, controls, sheet };
}
test('closing while camera permission is pending releases the late stream', async () => {
  let resolve, stopped = 0;
  const { camera, sheet } = setup(() => new Promise(done => { resolve = done; }));
  const opening = camera.open();
  assert.equal(sheet.hidden, false);
  assert.equal(camera.close(), true);
  resolve({ getTracks: () => [{ stop() { stopped++; } }] });
  await opening;
  assert.equal(stopped, 1);
  assert.equal(sheet.hidden, true);
  assert.equal(camera.close(), false);
});
test('denied camera permission leaves an actionable sheet and disabled shutter', async () => {
  const { camera, controls, sheet } = setup(async () => { throw { name: 'NotAllowedError' }; });
  await camera.open();
  assert.equal(sheet.hidden, false);
  assert.equal(controls['.camera-shutter'].disabled, true);
  assert.match(controls['.camera-status'].textContent, /Permissions/);
  camera.close();
});
test('closing an active camera stops all tracks and clears the video', async () => {
  let stopped = 0;
  const { camera, controls } = setup(async () => ({ getTracks: () => [{ stop() { stopped++; } }] }));
  await camera.open();
  assert.equal(controls['.camera-shutter'].disabled, false);
  camera.close();
  assert.equal(stopped, 1);
  assert.equal(controls.video.srcObject, null);
});
