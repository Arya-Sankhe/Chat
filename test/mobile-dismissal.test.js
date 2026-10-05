import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const closeSource = source.slice(source.indexOf('function closeTopNativeSurface()'), source.indexOf('async function handleNativeBack()'));
function surface(...classes) { return { classList: { contains: name => classes.includes(name) } }; }
function dismissal(overrides = {}) {
  const closed = [];
  const context = {
    document: { querySelector: () => null, getElementById: () => null, body: surface() },
    els: {
      nativeMobileModeButton: { getAttribute: () => 'false' },
      composerActionMenuWrap: surface(), composerModelWrap: surface(),
      appUpdateDialog: surface('hidden'), lightbox: surface('hidden'), paywallView: surface('hidden'),
      settingsDrawer: surface(), accountDrawer: surface(), authDialog: surface(),
      confirmDialog: surface(), renameDialog: surface()
    },
    cameraSheet: null,
    homeModesController: { closePicker: () => false }, studyHub: { handleEscape: () => false },
    state: { viewer: { open: false } }, isGuestContinueOpen: () => false, isSearchDialogOpen: () => false
  };
  for (const name of ['closeMobileModeSheet', 'closeActionMenu', 'closeModelDropdown', 'closeSettings', 'closeAccount', 'closeAppUpdate', 'closeLightbox', 'renderShell', 'closeDocumentViewer', 'closeAuthDialog', 'dismissGuestContinue', 'closeConfirmDialog', 'closeRenameDialog', 'closeSearchDialog']) {
    context[name] = () => closed.push(name);
  }
  Object.assign(context.els, overrides.els);
  Object.assign(context, Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'els')));
  return { handled: runInNewContext(`${closeSource}\ncloseTopNativeSurface()`, context), closed };
}

test('one back action closes a mobile model sheet before the underlying study screen', () => {
  const result = dismissal({ els: { nativeMobileModeButton: { getAttribute: () => 'true' } }, studyHub: { handleEscape() { throw Error('Underlying screen must not receive dismissal'); } } });
  assert.equal(result.handled, true);
  assert.deepEqual(result.closed, ['closeMobileModeSheet']);
});
test('one back action closes the attachment or writing-style sheet', () => {
  const result = dismissal({ els: { composerActionMenuWrap: surface('is-open') } });
  assert.equal(result.handled, true);
  assert.deepEqual(result.closed, ['closeActionMenu']);
});
test('one back action closes settings directly, including a settings subpage', () => {
  const result = dismissal({ els: { settingsDrawer: { ...surface('open'), dataset: { mobilePage: 'detail' } } } });
  assert.equal(result.handled, true);
  assert.deepEqual(result.closed, ['closeSettings']);
});
test('a slide preview closes before the gallery beneath it', () => {
  let previews = 0;
  const result = dismissal({ document: { querySelector: () => null, getElementById: () => ({ open: true, close: () => previews++ }) }, homeModesController: { closePicker() { throw Error('Keep gallery open'); } } });
  assert.equal(result.handled, true);
  assert.equal(previews, 1);
});
test('a gallery consumes one dismissal', () => {
  assert.equal(dismissal({ homeModesController: { closePicker: () => true } }).handled, true);
});
test('no open surface leaves normal native navigation available', () => {
  const result = dismissal();
  assert.equal(result.handled, false);
  assert.deepEqual(result.closed, []);
});

const backSource = source.slice(source.indexOf('async function handleNativeBack()'), source.indexOf('async function setupNativeLifecycle()'));
async function backAction({ surfaceOpen = false, keyboard = false, conversation = null } = {}) {
  const calls = [];
  await runInNewContext(`${backSource}; handleNativeBack()`, {
    closeTopNativeSurface: () => surfaceOpen,
    document: { body: surface(...(keyboard ? ['keyboard-open'] : [])) },
    state: { activeConversationId: conversation }, window: { location: { pathname: '/' } },
    exitApp: async () => calls.push('exit'), dismissComposerKeyboard: () => calls.push('keyboard'),
    openNewChat: () => calls.push('home'), showToast: () => { throw Error('No exit toast'); }
  });
  return calls;
}
test('one native back or right swipe exits from home without a second-back toast', async () => {
  assert.deepEqual(await backAction(), ['exit']);
  assert.deepEqual(await backAction({ surfaceOpen: true }), []);
  assert.deepEqual(await backAction({ keyboard: true }), ['keyboard']);
  assert.deepEqual(await backAction({ conversation: 'chat' }), ['home']);
});
test('a swipe and its duplicate Android back callback perform only one action', async () => {
  let callback, calls = 0;
  const start = source.indexOf('  await registerBackButton(async () => {');
  const handler = source.slice(start, source.indexOf('\n  });', start) + 6);
  const context = { registerBackButton: async fn => { callback = fn; }, lastNativeSwipeAt: Date.now(), handleNativeBack: async () => calls++ };
  await runInNewContext(`(async () => { ${handler} })()`, context);
  await callback();
  assert.equal(calls, 0);
  context.lastNativeSwipeAt = 0;
  await callback();
  assert.equal(calls, 1);
});

test('mobile profile opens full settings directly while desktop retains its menu', () => {
  const start = source.indexOf('function toggleProfileMenu()');
  const handler = source.slice(start, source.indexOf('\nfunction openStorageDrawer()', start));
  for (const mobile of [true, false]) {
    const calls = [];
    runInNewContext(`${handler}; toggleProfileMenu()`, {
      state: { session: {} }, isMobileLayout: () => mobile,
      closeProfileMenu: () => calls.push('close-menu'), openSettings: () => calls.push('settings'),
      renderProfileMenu: () => calls.push('render-menu'), isProfileMenuOpen: () => false,
      els: { profileMenu: { classList: { remove: () => calls.push('open-menu') } }, accountButton: { setAttribute() {} } }
    });
    assert.deepEqual(calls, mobile ? ['close-menu', 'settings'] : ['render-menu', 'open-menu']);
  }
});
