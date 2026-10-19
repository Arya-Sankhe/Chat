export function SettingsDrawer() {
  return (
    <aside className="settings-drawer" id="settingsDrawer" aria-label="Settings" aria-hidden="true">
      <div className="settings-panel">
        <nav className="settings-nav" id="settingsTabs" aria-label="Settings sections">
          <div className="settings-nav-brand">Settings</div>
          {" "}
          <button className="settings-tab active" type="button" aria-pressed="true" data-settings-tab="general">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.1A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.36.7.66.96.3.25.68.4 1.07.4H21v4h-.1A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
            {" General "}
          </button>
          {" "}
          <button className="settings-tab" type="button" aria-pressed="false" data-settings-tab="voice">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
            </svg>
            {" Voice "}
          </button>
          {" "}
          <button className="settings-tab" type="button" aria-pressed="false" data-settings-tab="memory">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3a5 5 0 0 0-4.55 7.08A4 4 0 0 0 9 18h1v3h4v-3h1a4 4 0 0 0 1.55-7.68A5 5 0 0 0 12 3Z" />
              <path d="M9 10h6M10 14h4" />
            </svg>
            {" Memory "}
          </button>
          {" "}
          <button className="settings-tab" type="button" aria-pressed="false" data-settings-tab="storage">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5.5 5h13l3 7v6a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-6l3-7Z" />
              <path d="M3 12h18M7 16h.01M11 16h.01" />
            </svg>
            {" Storage "}
          </button>
          {" "}
          <button className="settings-tab" type="button" aria-pressed="false" data-settings-tab="account">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            {" Account "}
          </button>
        </nav>
        <div className="settings-main">
          <div className="drawer-header">
            <strong id="settingsTitle">General</strong>
            {" "}
            <button className="drawer-close" id="closeSettingsButton" type="button" aria-label="Close settings">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <section className="settings-section" data-settings-panel="general">
            <h2>Appearance</h2>
            <div className="appearance-pill" id="appearancePill" role="radiogroup" aria-label="Appearance">
              <button type="button" data-appearance="light" role="radio" aria-checked="false">Light</button>
              {" "}
              <button type="button" data-appearance="system" role="radio" aria-checked="true">System</button>
              {" "}
              <button type="button" data-appearance="dark" role="radio" aria-checked="false">Dark</button>
            </div>
          </section>
          <section className="settings-section" data-settings-panel="general">
            <h2>Wallpaper</h2>
            <div className="wallpaper-picker" id="wallpaperPicker" role="radiogroup" aria-label="Home wallpaper">
              <button type="button" className="wallpaper-option" data-wallpaper="none" role="radio" aria-checked="false">
                <span className="wallpaper-thumb" aria-hidden="true" />
                {" "}
                <span>None</span>
              </button>
              {" "}
              <button type="button" className="wallpaper-option" data-wallpaper="clouds" role="radio" aria-checked="true">
                <span className="wallpaper-thumb" aria-hidden="true" />
                {" "}
                <span>Clouds</span>
              </button>
              {" "}
              <button type="button" className="wallpaper-option" data-wallpaper="alpine" role="radio" aria-checked="false">
                <span className="wallpaper-thumb" aria-hidden="true" />
                {" "}
                <span>Alpine</span>
              </button>
              {" "}
              <button type="button" className="wallpaper-option" data-wallpaper="valley" role="radio" aria-checked="false">
                <span className="wallpaper-thumb" aria-hidden="true" />
                {" "}
                <span>Valley</span>
              </button>
              {" "}
              <button type="button" className="wallpaper-option" data-wallpaper="launch" role="radio" aria-checked="false">
                <span className="wallpaper-thumb" aria-hidden="true" />
                {" "}
                <span>Launch</span>
              </button>
            </div>
          </section>
          <section className="settings-section" data-settings-panel="general">
            <h2>Accent color</h2>
            <div className="color-preset-row" id="colorPresetRow" role="group" aria-label="Accent color">
              <button type="button" className="color-swatch" data-accent="default" title="Default" aria-label="Default" aria-pressed="true">
                <span className="color-swatch-dot" data-swatch="default" />
              </button>
              {" "}
              <button type="button" className="color-swatch" data-accent="indigo" title="Indigo" aria-label="Indigo" aria-pressed="false">
                <span className="color-swatch-dot" data-swatch="indigo" />
              </button>
              {" "}
              <button type="button" className="color-swatch" data-accent="emerald" title="Emerald" aria-label="Emerald" aria-pressed="false">
                <span className="color-swatch-dot" data-swatch="emerald" />
              </button>
              {" "}
              <button type="button" className="color-swatch" data-accent="rose" title="Rose" aria-label="Rose" aria-pressed="false">
                <span className="color-swatch-dot" data-swatch="rose" />
              </button>
              {" "}
              <button type="button" className="color-swatch" data-accent="ocean" title="Ocean" aria-label="Ocean" aria-pressed="false">
                <span className="color-swatch-dot" data-swatch="ocean" />
              </button>
              {" "}
              <button type="button" className="color-swatch" data-accent="violet" title="Violet" aria-label="Violet" aria-pressed="false">
                <span className="color-swatch-dot" data-swatch="violet" />
              </button>
              {" "}
              <button type="button" className="color-swatch" data-accent="teal" title="Teal" aria-label="Teal" aria-pressed="false">
                <span className="color-swatch-dot" data-swatch="teal" />
              </button>
              {" "}
              <button type="button" className="color-swatch" data-accent="amber" title="Amber" aria-label="Amber" aria-pressed="false">
                <span className="color-swatch-dot" data-swatch="amber" />
              </button>
            </div>
          </section>
          <section className="settings-section settings-voice" data-settings-panel="voice" hidden>
            <h2>Voice mode</h2>
            <p className="settings-voice-lead">How Klui sounds when you talk to it. Use the arrows to hear each voice.</p>
            <div id="voiceSettingsPicker" />
          </section>
          <section className="settings-section" id="settingsStorageSection" data-settings-panel="storage" hidden>
            <h2>Your storage</h2>
            <div className="settings-storage">
              <div className="settings-storage-head">
                <span className="settings-storage-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="12" x2="2" y2="12" />
                    <path d="M5.45 5.11 2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
                    <line x1="6" y1="16" x2="6.01" y2="16" />
                    <line x1="10" y1="16" x2="10.01" y2="16" />
                  </svg>
                </span>
                {" "}
                <span className="settings-storage-copy">
                  <strong id="settingsStorageValue">0 KB used</strong>
                  {" "}
                  <small id="settingsStorageLeft">Loading storage...</small>
                </span>
              </div>
              <div className="settings-storage-track" id="settingsStorageTrack" role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
                <span id="settingsStorageFill" />
              </div>
            </div>
            <div className="settings-storage-manage">
              <h2>Manage files</h2>
              <p>Open chats or remove uploads to free up space.</p>
              <div className="storage-list" id="settingsStorageList" />
            </div>
          </section>
          <section className="settings-section" data-settings-panel="account" hidden>
            <div className="account-fields" id="settingsAccountFields">
              <div className="account-field">
                <span>Name</span>
                {" "}
                <span id="settingsAccountName">—</span>
              </div>
              <div className="account-field">
                <span>Email</span>
                {" "}
                <span id="settingsAccountEmail">—</span>
              </div>
              <div className="account-field">
                <span>Download my data</span>
                {" "}
                <button className="account-export-btn" id="exportAccountButton" type="button">Download</button>
              </div>
              <div className="account-field hidden" id="settingsAccountCancelRow">
                <span>Subscription</span>
                {" "}
                <button className="account-export-btn" id="cancelSubscriptionButton" type="button">Cancel</button>
              </div>
              <div className="account-field">
                <span>Delete account</span>
                {" "}
                <button className="account-delete-btn" id="deleteAccountButton" type="button">Delete</button>
              </div>
            </div>
            <p className="memory-empty hidden" id="settingsAccountGuest">Sign in to see your account.</p>
          </section>
          <section className="settings-section" data-settings-panel="memory" hidden>
            <div className="memory-toggle-card">
              <label className="settings-switch-row" htmlFor="memoryEnabledInput">
                <span>
                  <strong>Enable memory</strong>
                  {" "}
                  <small>Let Klui remember useful details for future chats.</small>
                </span>
                {" "}
                <input id="memoryEnabledInput" type="checkbox" role="switch" />
              </label>
            </div>
            <p className="memory-privacy">Memory starts with messages you send after you turn it on. Klui never learns from AI replies, uploaded files, images, tool results, generated documents, or temporary chats.</p>
            <div className="memory-editor hidden" id="memoryEditor">
              <label htmlFor="memoryContentInput">Memory summary</label>
              {" "}
              <textarea id="memoryContentInput" rows={12} maxLength={6000} spellCheck="true" placeholder="Klui keeps a short profile here: who you are, what you are working on, and how you like answers." />
              {" "}
              <div className="memory-actions">
                <button className="admin-load danger" id="clearMemoryButton" type="button">Clear memory</button>
                {" "}
                <button className="admin-load" id="saveMemoryButton" type="button">Save changes</button>
              </div>
            </div>
            <div className="memory-empty" id="memoryEmpty">Turn memory on to start building a private, editable summary from your future messages.</div>
            <p className="settings-notice" id="memoryNotice" role="status" aria-live="polite" />
          </section>
          <section className="settings-section hidden" id="settingsReasoningSection" data-settings-panel="general">
            <h2>Reasoning display</h2>
            {" "}
            <label className="settings-switch-row" htmlFor="showModelReasoningInput">
              <span>
                <strong>Show model reasoning</strong>
                {" "}
                <small>Turn off to use the simpler animated thinking bar.</small>
              </span>
              {" "}
              <input id="showModelReasoningInput" type="checkbox" role="switch" />
            </label>
          </section>
          <section className="settings-section hidden" id="settingsSystemPromptSection" data-settings-panel="general">
            <h2>System prompt</h2>
            {" "}
            <div className="field-group">
              <textarea id="systemPromptInput" rows={4} spellCheck="true" />
            </div>
            {" "}
            <button className="admin-load settings-save-btn" id="saveSystemPromptButton" type="button">Save global prompt</button>
          </section>
          <nav className="settings-legal" aria-label="Terms and policies">
            <a href="https://home.klui.ai/terms/" target="_blank" rel="noopener">Terms of use</a>
            {" "}
            <a href="https://home.klui.ai/privacy/" target="_blank" rel="noopener">Privacy policy</a>
            {" "}
            <a href="https://home.klui.ai/refund/" target="_blank" rel="noopener">Refund policy</a>
            {" "}
            <a href="https://home.klui.ai/account-delete/" target="_blank" rel="noopener">Delete your account</a>
            {" "}
            <a href="https://home.klui.ai/legal/" target="_blank" rel="noopener">{"Terms & policies"}</a>
          </nav>
        </div>
      </div>
    </aside>
  );
}
