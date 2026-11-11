import { useRef, useState } from "react";
import { session } from "../app/runtime";
import { updateAdminSettings } from "../islands/api.js";
import { COLOR_PRESETS } from "@klui/shared";
import { NATIVE_APP, chatHooks, closeSettings, setSettingsTab, showMobileSettingsOverview, showToast, updateSetting, useApp } from "../state/app";
import { signOutAndReset } from "../state/chat";
import { cx } from "./cx";
import { AccountUsage } from "./Sidebar";
import { AccountPanel, MemoryPanel, StorageList, formatStorageBytes } from "./SettingsPanels";
import { SettingsVoicePicker } from "./VoicePicker";

/** Admins only: the reasoning display, and the global system prompt every chat starts from. */
function AdminSettings({ hidden }: { hidden: boolean }) {
  const admin = useApp((s) => s.me?.profile?.role === "admin");
  const showReasoning = useApp((s) => s.settings.showModelReasoning !== false);
  const savedPrompt = useApp((s) => s.settings.systemPrompt);
  // The draft stays local until Save, so an account refresh mid-edit keeps it.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!admin) return null;
  const systemPrompt = draft ?? savedPrompt ?? "";
  const save = async () => {
    const prompt = String(systemPrompt).trim();
    if (!prompt) {
      showToast("System prompt cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const payload = await updateAdminSettings(session.current(), { systemPrompt: prompt });
      const saved = payload.settings?.systemPrompt || prompt;
      updateSetting("systemPrompt", saved);
      setDraft(null);
      const me = useApp.getState().me;
      if (me) useApp.setState({ me: { ...me, settings: { ...(me.settings || {}), systemPrompt: saved } } });
      showToast("Global system prompt saved.");
    } catch (error: any) {
      showToast(error?.message || "Could not save the prompt.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <section className="settings-section" id="settingsReasoningSection" data-settings-panel="general" hidden={hidden}>
        <h2>Reasoning display</h2>
        {" "}
        <label className="settings-switch-row" htmlFor="showModelReasoningInput">
          <span>
            <strong>Show model reasoning</strong>
            {" "}
            <small>Turn off to use the simpler animated thinking bar.</small>
          </span>
          {" "}
          <input id="showModelReasoningInput" type="checkbox" role="switch" checked={showReasoning} onChange={(event) => { updateSetting("showModelReasoning", event.target.checked); chatHooks.renderMessages(); }} />
        </label>
      </section>
      <section className="settings-section" id="settingsSystemPromptSection" data-settings-panel="general" hidden={hidden}>
        <h2>System prompt</h2>
        {" "}
        <div className="field-group">
          <textarea id="systemPromptInput" rows={4} spellCheck="true" value={systemPrompt} onChange={(event) => setDraft(event.target.value)} />
        </div>
        {" "}
        <button className="admin-load settings-save-btn" id="saveSystemPromptButton" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save global prompt"}</button>
      </section>
    </>
  );
}

/** The title row; phones lift it above the tab list (setupMobileLayout). */
function SettingsHeader() {
  const title = useApp((s) => (s.settingsPage === "overview" ? "Settings" : s.settingsTab[0]!.toUpperCase() + s.settingsTab.slice(1)));
  return (
      <div className="drawer-header">
        <button type="button" className="mobile-settings-back" aria-label="Back to settings" onClick={() => (useApp.getState().settingsPage === "overview" ? closeSettings() : showMobileSettingsOverview())}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 12H4m7-7-7 7 7 7" /></svg>
        </button>
        {" "}
        <strong id="settingsTitle">{title}</strong>
        {" "}
        <button className="drawer-close" id="closeSettingsButton" type="button" aria-label="Close settings" onClick={closeSettings}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
  );
}

type StorageMeter = { value: string; left: string; percent: number; valueText?: string; fill?: { width: string } };
const STORAGE_LOADING: StorageMeter = { value: "0 KB used", left: "Loading storage...", percent: 0 };

/** renderSettingsStorage(): drawn once the plan's limit is known, and kept as last drawn otherwise. */
function useStorageMeter() {
  const signedIn = useApp((s) => s.signedIn);
  const me = useApp((s) => s.me);
  const last = useRef(STORAGE_LOADING);
  const storage = me?.usage?.storage || {};
  const maxBytes = Number(storage.maxBytes || (me?.plan as any)?.maxStorageBytes || 0);
  if (signedIn && maxBytes > 0) {
    const usedBytes = Math.max(0, Number(storage.usedBytes || 0));
    const percent = Math.max(0, Math.min(100, Math.floor(Number(storage.percent || (usedBytes / maxBytes) * 100))));
    const value = `${formatStorageBytes(usedBytes)} of ${formatStorageBytes(maxBytes)} used`;
    last.current = { value, left: `${formatStorageBytes(Math.max(0, maxBytes - usedBytes))} left`, percent, valueText: value, fill: { width: `${percent}%` } };
  }
  return last.current;
}

function chooseAccent(accent: string) {
  const settings = useApp.getState().settings;
  useApp.setState({ settings: { ...settings, colorChosen: true } });
  updateSetting("colorPreset", COLOR_PRESETS.has(accent) ? accent : "default");
}

export function SettingsDrawer() {
  const mobile = useApp((s) => s.mobile);
  const open = useApp((s) => s.settingsOpen);
  const page = useApp((s) => s.settingsPage);
  const tab = useApp((s) => s.settingsTab);
  const profile = useApp((s) => s.settingsProfile);
  const usageShown = useApp((s) => Boolean(s.me?.plan));
  const upgradePlans = useApp((s) => Array.isArray(s.plans) && s.plans.length > 0);
  const settings = useApp((s) => s.settings);
  // Drafts belong to one account: a different sign-in remounts the editors.
  const accountKey = useApp((s) => String(s.me?.user?.id || ""));
  const appearance = settings.appearance;
  const accent = COLOR_PRESETS.has(settings.colorPreset) ? settings.colorPreset : "default";
  const storage = useStorageMeter();
  return (
    <aside className={cx("settings-drawer", { open })} id="settingsDrawer" aria-label="Settings" aria-hidden={!open} data-mobile-page={page || undefined}>
      <div className="settings-panel">
        {mobile && <SettingsHeader />}
        <nav className="settings-nav" id="settingsTabs" aria-label="Settings sections" onClick={(event) => {
          const button = (event.target as Element).closest<HTMLElement>("[data-settings-tab]");
          if (button) setSettingsTab(button.dataset.settingsTab!);
        }}>
          <div className="mobile-settings-profile">
            <div id="mobileSettingsAvatar" aria-hidden="true">{profile?.initials}</div>
            <div className="mobile-settings-identity"><strong id="mobileSettingsName">{profile?.name}</strong><span id="mobileSettingsPlan">{profile?.plan}</span></div>
          </div>
          <div className="mobile-settings-group">My Klui</div>
          {" "}
          <div className="settings-nav-brand">Settings</div>
          {" "}
          <button className={cx("settings-tab", { active: tab === "general" })} type="button" aria-pressed={tab === "general"} data-settings-tab="general">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.1A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.36.7.66.96.3.25.68.4 1.07.4H21v4h-.1A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
            {" General "}
            <span className="mobile-settings-description">{"Appearance and wallpaper"}</span>
          </button>
          {" "}
          <button className={cx("settings-tab", { active: tab === "voice" })} type="button" aria-pressed={tab === "voice"} data-settings-tab="voice">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
            </svg>
            {" Voice "}
            <span className="mobile-settings-description">{"Voice and playback"}</span>
          </button>
          {" "}
          <button className={cx("settings-tab", { active: tab === "memory" })} type="button" aria-pressed={tab === "memory"} data-settings-tab="memory">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3a5 5 0 0 0-4.55 7.08A4 4 0 0 0 9 18h1v3h4v-3h1a4 4 0 0 0 1.55-7.68A5 5 0 0 0 12 3Z" />
              <path d="M9 10h6M10 14h4" />
            </svg>
            {" Memory "}
            <span className="mobile-settings-description">{"What Klui remembers"}</span>
          </button>
          {" "}
          <button className={cx("settings-tab", { active: tab === "storage" })} type="button" aria-pressed={tab === "storage"} data-settings-tab="storage">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5.5 5h13l3 7v6a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-6l3-7Z" />
              <path d="M3 12h18M7 16h.01M11 16h.01" />
            </svg>
            {" Storage "}
            <span className="mobile-settings-description">{"Files and documents"}</span>
          </button>
          {" "}
          <button className={cx("settings-tab", { active: tab === "account" })} type="button" aria-pressed={tab === "account"} data-settings-tab="account">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            {" Account "}
            <span className="mobile-settings-description">{(profile && profile.email) || "Profile and subscription"}</span>
          </button>
          {" "}
          <button type="button" id="mobileSettingsPricing" className={cx("mobile-settings-pricing", { hidden: !profile || NATIVE_APP || !upgradePlans })} onClick={() => chatHooks.openUpgradePlans()}>Plans &amp; pricing</button>
          <div id="mobileSettingsUsage" className="mobile-settings-usage" hidden={profile ? !usageShown : undefined}>{profile && <AccountUsage />}</div>
          <button type="button" className="mobile-settings-logout" onClick={() => { closeSettings(); void signOutAndReset(); }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 5H4v14h5m5-14 7 7-7 7M8 12h13" /></svg><span>Log out</span>
          </button>
        </nav>
        <div className="settings-main">
          {!mobile && <SettingsHeader />}
          <section className="settings-section" data-settings-panel="general" hidden={tab !== "general"}>
            <h2>Appearance</h2>
            <div className="appearance-pill" id="appearancePill" role="radiogroup" aria-label="Appearance">
              <button type="button" data-appearance="light" role="radio" aria-checked={appearance === "light"} onClick={() => updateSetting("appearance", "light")}>Light</button>
              {" "}
              <button type="button" data-appearance="system" role="radio" aria-checked={appearance === "system"} onClick={() => updateSetting("appearance", "system")}>System</button>
              {" "}
              <button type="button" data-appearance="dark" role="radio" aria-checked={appearance === "dark"} onClick={() => updateSetting("appearance", "dark")}>Dark</button>
            </div>
          </section>
          <section className="settings-section" data-settings-panel="general" hidden={tab !== "general"}>
            <h2>Wallpaper</h2>
            <div className="wallpaper-picker" id="wallpaperPicker" role="radiogroup" aria-label="Home wallpaper">
              <button type="button" className="wallpaper-option" data-wallpaper="none" role="radio" aria-checked={settings.wallpaper === "none"} onClick={() => updateSetting("wallpaper", "none")}>
                <span className="wallpaper-thumb" aria-hidden="true" />
                {" "}
                <span>None</span>
              </button>
              {" "}
              <button type="button" className="wallpaper-option" data-wallpaper="clouds" role="radio" aria-checked={settings.wallpaper === "clouds"} onClick={() => updateSetting("wallpaper", "clouds")}>
                <span className="wallpaper-thumb" aria-hidden="true" />
                {" "}
                <span>Clouds</span>
              </button>
              {" "}
              <button type="button" className="wallpaper-option" data-wallpaper="alpine" role="radio" aria-checked={settings.wallpaper === "alpine"} onClick={() => updateSetting("wallpaper", "alpine")}>
                <span className="wallpaper-thumb" aria-hidden="true" />
                {" "}
                <span>Alpine</span>
              </button>
              {" "}
              <button type="button" className="wallpaper-option" data-wallpaper="valley" role="radio" aria-checked={settings.wallpaper === "valley"} onClick={() => updateSetting("wallpaper", "valley")}>
                <span className="wallpaper-thumb" aria-hidden="true" />
                {" "}
                <span>Valley</span>
              </button>
              {" "}
              <button type="button" className="wallpaper-option" data-wallpaper="launch" role="radio" aria-checked={settings.wallpaper === "launch"} onClick={() => updateSetting("wallpaper", "launch")}>
                <span className="wallpaper-thumb" aria-hidden="true" />
                {" "}
                <span>Launch</span>
              </button>
            </div>
          </section>
          <section className="settings-section" data-settings-panel="general" hidden={tab !== "general"}>
            <h2>Accent color</h2>
            <div className="color-preset-row" id="colorPresetRow" role="group" aria-label="Accent color">
              <button type="button" className={cx("color-swatch", { active: accent === "default" })} data-accent="default" title="Default" aria-label="Default" aria-pressed={accent === "default"} onClick={() => chooseAccent("default")}>
                <span className="color-swatch-dot" data-swatch="default" />
              </button>
              {" "}
              <button type="button" className={cx("color-swatch", { active: accent === "indigo" })} data-accent="indigo" title="Indigo" aria-label="Indigo" aria-pressed={accent === "indigo"} onClick={() => chooseAccent("indigo")}>
                <span className="color-swatch-dot" data-swatch="indigo" />
              </button>
              {" "}
              <button type="button" className={cx("color-swatch", { active: accent === "emerald" })} data-accent="emerald" title="Emerald" aria-label="Emerald" aria-pressed={accent === "emerald"} onClick={() => chooseAccent("emerald")}>
                <span className="color-swatch-dot" data-swatch="emerald" />
              </button>
              {" "}
              <button type="button" className={cx("color-swatch", { active: accent === "rose" })} data-accent="rose" title="Rose" aria-label="Rose" aria-pressed={accent === "rose"} onClick={() => chooseAccent("rose")}>
                <span className="color-swatch-dot" data-swatch="rose" />
              </button>
              {" "}
              <button type="button" className={cx("color-swatch", { active: accent === "ocean" })} data-accent="ocean" title="Ocean" aria-label="Ocean" aria-pressed={accent === "ocean"} onClick={() => chooseAccent("ocean")}>
                <span className="color-swatch-dot" data-swatch="ocean" />
              </button>
              {" "}
              <button type="button" className={cx("color-swatch", { active: accent === "violet" })} data-accent="violet" title="Violet" aria-label="Violet" aria-pressed={accent === "violet"} onClick={() => chooseAccent("violet")}>
                <span className="color-swatch-dot" data-swatch="violet" />
              </button>
              {" "}
              <button type="button" className={cx("color-swatch", { active: accent === "teal" })} data-accent="teal" title="Teal" aria-label="Teal" aria-pressed={accent === "teal"} onClick={() => chooseAccent("teal")}>
                <span className="color-swatch-dot" data-swatch="teal" />
              </button>
              {" "}
              <button type="button" className={cx("color-swatch", { active: accent === "amber" })} data-accent="amber" title="Amber" aria-label="Amber" aria-pressed={accent === "amber"} onClick={() => chooseAccent("amber")}>
                <span className="color-swatch-dot" data-swatch="amber" />
              </button>
            </div>
          </section>
          <section className="settings-section settings-voice" data-settings-panel="voice" hidden={tab !== "voice"}>
            <h2>Voice mode</h2>
            <p className="settings-voice-lead">How Klui sounds when you talk to it. Use the arrows to hear each voice.</p>
            <div id="voiceSettingsPicker">{tab === "voice" && <SettingsVoicePicker />}</div>
          </section>
          <section className="settings-section" id="settingsStorageSection" data-settings-panel="storage" hidden={tab !== "storage"}>
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
                  <strong id="settingsStorageValue">{storage.value}</strong>
                  {" "}
                  <small id="settingsStorageLeft">{storage.left}</small>
                </span>
              </div>
              <div className="settings-storage-track" id="settingsStorageTrack" role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={storage.percent} aria-valuetext={storage.valueText}>
                <span id="settingsStorageFill" style={storage.fill} />
              </div>
            </div>
            <div className="settings-storage-manage">
              <h2>Manage files</h2>
              <p>Open chats or remove uploads to free up space.</p>
              <StorageList />
            </div>
          </section>
          <AccountPanel hidden={tab !== "account"} />
          <MemoryPanel key={`memory:${accountKey}`} hidden={tab !== "memory"} />
          <AdminSettings key={`admin:${accountKey}`} hidden={tab !== "general"} />
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
