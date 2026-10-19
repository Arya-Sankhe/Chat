/* The message composer (the composer-area section of public/index.html). Its
   chrome is rendered from settings as paintSpectrum, renderComposerModeChip,
   renderCompareControls and renderWritingStyle draw it in public/js/app.js.
   The prompt is a contenteditable owned outside React (see promptRef). */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { SPECTRUM_N, SPECTRUM_STEPS, WRITING_STYLE_LABELS, normalizeWritingStyle, spectrumLevel } from "@klui/shared";
import { createComposerKlui } from "../islands/composerKlui.js";
import { applySpectrumLevel, closeActionMenu, closeModelDropdown, setWritingStyle, toggleActionMenu, toggleModelDropdown, updateSetting, useApp } from "../state/app";
import { ActionMenu, DeckPickerPop, NativeModeWrap, WritingStyleMenu } from "./ComposerSheets";
import { cx } from "./cx";

/** voiceMode.js voiceModeSupported(): recording and playback both work here. */
function voiceModeSupported() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  const recordable = typeof MediaRecorder !== "undefined" && types.some((type) => MediaRecorder.isTypeSupported?.(type));
  return Boolean(typeof navigator.mediaDevices?.getUserMedia === "function" && recordable && (window.AudioContext || (window as any).webkitAudioContext));
}

const setComposerHasText = (composerHasText: boolean) => useApp.setState({ composerHasText });

const CHIP_LABELS = { research: "Deep research", compare: "Compare", council: "Council" } as const;
type ChipMode = keyof typeof CHIP_LABELS | "";

/** Holds attached context; it sits in the action row on desktop and above the prompt on phones. */
function ContextWrap() {
  return <div className="composer-context-wrap" id="composerContextWrap" />;
}

/** app.js roleLabel(): the server can rename the model roles. */
function roleLabel(roles: unknown, id: string, fallback: string) {
  return (Array.isArray(roles) ? roles : []).find((role) => role?.id === id)?.label || fallback;
}

export function Composer() {
  const mobile = useApp((s) => s.mobile);
  const settings = useApp((s) => s.settings);
  const roles = useApp((s) => (s.config as any)?.roles);
  const temporaryChat = useApp((s) => s.temporaryChat);
  const researchMode = useApp((s) => s.researchMode);
  // Running state and messages arrive with the message slice.
  const running = false;
  const hasMessages = false;
  const composerRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);

  const level = spectrumLevel(settings);
  const sliderPct = `${(level / (SPECTRUM_N - 1)) * 100}%`;
  const heatLabel = level === SPECTRUM_N - 1 ? roleLabel(roles, "pro", "Pro").toUpperCase() : level === 0 ? roleLabel(roles, "nitro", "Nitro") : roleLabel(roles, "think", "Think");
  const councilOn = Boolean(settings.compareEnabled && settings.compareMode === "council");
  const compareOn = Boolean(settings.compareEnabled) && !councilOn;
  const compareActive = !temporaryChat && compareOn;
  const councilActive = !temporaryChat && councilOn;
  // Desktop's mode switch already shows Compare and Council; phones keep the chip.
  const mode: ChipMode = researchMode ? "research" : councilOn ? "council" : compareOn ? "compare" : "";
  const chipMode: ChipMode = !mobile && mode !== "research" ? "" : mode;
  // The label keeps its last text while the chip is hidden, as before.
  const lastChipLabel = useRef<string>(CHIP_LABELS.research);
  if (mode) lastChipLabel.current = CHIP_LABELS[mode];
  const chipLabel = lastChipLabel.current;
  const writingStyle = normalizeWritingStyle(settings.writingStyle);
  const actionMenu = useApp((s) => s.actionMenu);

  // updateSendButton(): an empty composer offers voice mode where the send arrow would be.
  // Recording, follow-ups and pending uploads join with their slices.
  const synced = useApp((s) => s.sendButtonSynced);
  const composerHasText = useApp((s) => s.composerHasText);
  const speech = useApp((s) => Boolean((s.config as any)?.services?.speech));
  const offerVoice = synced && !composerHasText && speech && !researchMode && voiceModeSupported();
  const spectrumOpen = useApp((s) => s.spectrumOpen);

  // paintSpectrum(): a new label blurs out, swaps on the next frame and clears on the one after.
  const [shownLabel, setShownLabel] = useState(heatLabel);
  const [nameStyle, setNameStyle] = useState<{ filter?: string; opacity?: string }>({});
  useLayoutEffect(() => {
    if (shownLabel === heatLabel) return;
    setNameStyle({ filter: "blur(2px)", opacity: "0.55" });
    let second = 0;
    const first = requestAnimationFrame(() => {
      setShownLabel(heatLabel);
      second = requestAnimationFrame(() => setNameStyle({}));
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [heatLabel]);

  // setSpectrumOpen(): shown, then given .open a frame later; hidden 180 ms after closing.
  const spectrumPopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pop = spectrumPopRef.current!;
    if (spectrumOpen) {
      pop.hidden = false;
      const frame = requestAnimationFrame(() => pop.classList.add("open"));
      return () => cancelAnimationFrame(frame);
    }
    pop.classList.remove("open");
    const timer = setTimeout(() => {
      if (!useApp.getState().spectrumOpen) pop.hidden = true;
    }, 180);
    return () => clearTimeout(timer);
  }, [spectrumOpen]);

  const onModelButtonClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    closeActionMenu();
    // In the unified mode switch, the model segment means "back to one model".
    if (settings.compareEnabled) {
      updateSetting("compareEnabled", false);
      return;
    }
    if (mobile) {
      applySpectrumLevel(settings.modelMode === "pro" ? 1 : 2);
      closeModelDropdown();
      return;
    }
    toggleModelDropdown();
  };

  const onSpectrumPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const track = event.currentTarget;
    const fromPointer = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      applySpectrumLevel(Math.round(t * (SPECTRUM_N - 1)));
    };
    fromPointer(event.clientX);
    const move = (ev: PointerEvent) => fromPointer(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // applyComposerHeight(): desktop sizes the prompt to its content; phones use the stylesheet's line.
  useLayoutEffect(() => {
    const input = promptRef.current!;
    input.style.height = "auto";
    if (!mobile) {
      input.classList.remove("is-multiline");
      input.style.height = `${Math.min(200, input.scrollHeight)}px`;
      return;
    }
    const line = parseFloat(getComputedStyle(input).lineHeight) || 26;
    const multiline = input.scrollHeight > line * 1.5;
    input.classList.toggle("is-multiline", multiline);
    input.style.height = multiline ? `${Math.round(line * 1.4)}px` : "";
  }, [mobile]);

  // Pixel Klui on the composer (syncComposerKlui): only beside a running chat on desktop.
  const klui = useRef<ReturnType<typeof createComposerKlui> | null>(null);
  const chatEmpty = useApp((s) => s.chatEmpty);
  const activeConversationId = useApp((s) => s.activeConversationId);
  useLayoutEffect(() => {
    klui.current ||= createComposerKlui({
      host: composerRef.current!,
      findTarget: () => [...document.querySelectorAll("#messages .klui-bar.is-active .klui, #messages .research-card.is-active .rk-sprite")].at(-1) || null
    });
    klui.current.sync({ show: !mobile && !chatEmpty && hasMessages, running, key: activeConversationId || "" });
  }, [mobile, chatEmpty, hasMessages, running, activeConversationId]);

  return (
      <section className="composer-area" aria-label="Message composer">
        <div className="composer-wrap">
          <button className="chat-jump-bottom" id="chatJumpBottom" type="button" aria-label="Jump to latest message" title="Jump to latest message">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {" "}
          <div className="followup-queue hidden" id="followupQueue" aria-label="Queued follow-up messages" />
          {" "}
          <div className="attachment-model-notice" id="attachmentModelNotice" role="status" aria-hidden="true">
            <span id="attachmentModelNoticeText">Nitro is text-only. Switched to Think for attachments.</span>
            {" "}
            <button type="button" id="attachmentModelNoticeClose" aria-label="Dismiss">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          {" "}
          <section className="clarification-card hidden" id="clarificationCard" aria-live="polite" aria-label="Follow-up questions" />
          {" "}
          <div className="composer-slot">
            <div className="composer" ref={composerRef}>
              <div className="composer-beam" aria-hidden="true">
                <div data-beam-bloom="" />
              </div>
              <div className="composer-previews" id="imagePreviews" />
              <div className={cx("research-mode-chip", { hidden: !chipMode })} id="researchModeChip" data-mode={chipMode}>
                <svg className={cx("research-mode-mark", { hidden: mode !== "research" })} data-chip-icon="research" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 14.2 16.6 5.6a1.05 1.05 0 0 1 1.48 0l1.15 1.15a1.05 1.05 0 0 1 0 1.48L10.6 16.8z" />
                  <path d="M6.2 15.6 8.4 13.4" />
                  <path d="M6.5 16.2h11a1 1 0 0 1 1 1V19H5.5v-1.8a1 1 0 0 1 1-1z" />
                  <path d="M4.5 19.5h15a1 1 0 0 1 1 1V22H3.5v-1.5a1 1 0 0 1 1-1z" />
                </svg>
                {" "}
                <svg className={cx("research-mode-mark", { hidden: mode !== "compare" })} data-chip-icon="compare" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="7" height="16" rx="2" />
                  <rect x="14" y="4" width="7" height="16" rx="2" />
                </svg>
                {" "}
                <svg className={cx("research-mode-mark", { hidden: mode !== "council" })} data-chip-icon="council" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="7.4" r="2.35" />
                  <circle cx="5" cy="9" r="1.85" />
                  <circle cx="19" cy="9" r="1.85" />
                  <path d="M7.4 20v-1.5a4.6 4.6 0 0 1 9.2 0V20" />
                  <path d="M2.4 20v-1.1A3.3 3.3 0 0 1 5.9 15.6" />
                  <path d="M21.6 20v-1.1a3.3 3.3 0 0 0-3.5-3.3" />
                </svg>
                {" "}
                <span className="research-mode-chip-label">{chipLabel}</span>
                {" "}
                <button type="button" id="researchModeClose" aria-label={mode && mode !== "research" ? `Turn off ${CHIP_LABELS[mode]}` : "Turn off Deep Research"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {mobile && <ContextWrap />}
              <div className="composer-input">
                <div className="composer-deck-thumb hidden" id="composerDeckThumb" aria-hidden="true" />
                <div ref={promptRef} onInput={(event) => setComposerHasText(Boolean(event.currentTarget.textContent?.trim()))} id="promptInput" className="composer-prompt is-placeholder" contentEditable="true" role="textbox" aria-label="Ask Klui" aria-multiline="true" spellCheck="true" data-placeholder="Ask Klui" aria-haspopup="listbox" aria-controls="skillCommandMenu" aria-expanded="false" />
              </div>
              <div className="composer-bottom">
                <div className="composer-actions">
                  <div className={cx("composer-action-menu-wrap", { "is-open": Boolean(actionMenu) })} id="composerActionMenuWrap">
                    <button className="composer-tool composer-plus-btn" type="button" id="actionMenuButton" aria-haspopup="menu" aria-expanded={Boolean(actionMenu)} aria-label="More actions" title="More actions" onClick={(event) => { event.stopPropagation(); closeModelDropdown(); toggleActionMenu(); }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                      </svg>
                    </button>
                    {" "}
                    {!mobile && <ActionMenu />}
                    {" "}
                    {!mobile && <WritingStyleMenu />}
                  </div>
                  <div className="mode-switch" id="modeSwitch" data-active={councilActive ? "council" : compareActive ? "compare" : "think"} role="group" aria-label="Answer mode">
                    <div className={cx("composer-model-wrap", { "is-open": spectrumOpen })} id="composerModelWrap">
                      <div ref={spectrumPopRef} className="spectrum-pop" id="spectrumPop" role="dialog" aria-label="Model" hidden>
                        <div className="spectrum-head">Model</div>
                        <div className="spectrum-track" id="spectrumTrack" onPointerDown={onSpectrumPointerDown} role="slider" aria-valuemin={0} aria-valuemax={2} aria-valuenow={level} aria-label="Faster to smarter">
                          <div className="spectrum-fill" id="spectrumFill" style={{ width: sliderPct }} />
                          <div className="spectrum-steps" id="spectrumSteps">
                        {SPECTRUM_STEPS.map((_, i) => <i key={i} className={i <= level ? "lit" : undefined} />)}
                      </div>
                          <div className="spectrum-thumb" id="spectrumThumb" style={{ left: sliderPct }} />
                        </div>
                        <div className="spectrum-ends">
                          <span>Faster</span>
                          {" "}
                          <span>Smarter</span>
                        </div>
                      </div>
                      {" "}
                      <button className={cx("composer-model-btn heat-btn", { "nitro-active": level === 0, "think-active": level === 1, "pro-active": level === SPECTRUM_N - 1 })} id="modelButton" type="button" aria-haspopup="dialog" aria-expanded={spectrumOpen} aria-controls="spectrumPop" title={heatLabel} aria-label="Think" disabled={running} onClick={onModelButtonClick}>
                        <svg className="mode-switch-icon" width="22" height="14" viewBox="0 2.5 16 10" shapeRendering="crispEdges" aria-hidden="true">
                          <g fill="#8fd3fb">
                            <rect x="5" y="9.5" width="1" height="2.5" />
                            <rect x="10" y="9.5" width="1" height="2.5" />
                            <rect x="3" y="3.5" width="10" height="6" />
                            <rect x="1" y="5.5" width="2" height="2" />
                            <rect x="13" y="5.5" width="2" height="2" />
                          </g>
                          <g className="mode-switch-eyes" fill="#16202e">
                            <rect x="5" y="5" width="1" height="1.5" />
                            <rect x="10" y="5" width="1" height="1.5" />
                          </g>
                        </svg>
                        {" "}
                        <span className="heat-bar" aria-hidden="true">
                          <span className="heat-name" style={nameStyle}>{shownLabel}</span>
                          {" "}
                          <span className="heat-fill" id="heatFill" style={{ width: "100%" }}>
                            <span className="heat-name" style={nameStyle}>{shownLabel}</span>
                          </span>
                        </span>
                      </button>
                      {" "}
                      {" "}
                      <span className="composer-model-label hidden" id="modelLabel" hidden>Think</span>
                      {" "}
                      <span className="composer-model-price hidden" id="modelPriceBadge" hidden>4x</span>
                      {" "}
                      <div className="composer-model-dropdown hidden" id="modelDropdown" hidden role="listbox" aria-hidden="true">
                        <div className="model-catalog" id="modelCatalog" />
                      </div>
                    </div>
                    <div className="composer-compare-wrap" id="compareWrap">
                      <button className={cx("compare-btn", { active: compareActive })} id="compareButton" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Compare models" title={temporaryChat ? "Temporary chat uses one model" : compareActive ? "Compare mode on" : "Compare two answers"} aria-pressed={compareActive} disabled={running || temporaryChat}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="4" width="7" height="16" rx="2" />
                          <rect x="14" y="4" width="7" height="16" rx="2" />
                        </svg>
                        {" "}
                        <span id="compareLabel" className="mode-switch-label">Compare</span>
                      </button>
                      {" "}
                      <div className="compare-dropdown hidden" id="compareDropdown" role="listbox" aria-label="Compare models" aria-multiselectable="true">
                        <label htmlFor="compareInput" className="sr-only">Search compare models</label>
                        {" "}
                        <input id="compareInput" type="text" autoComplete="off" spellCheck="false" placeholder="Search models" />
                        {" "}
                        <div className="compare-hint">Fixed two-model compare</div>
                        {" "}
                        <div className="compare-mode-toggle" id="compareModeToggle" role="radiogroup" aria-label="Compare or council">
                          <button className="compare-mode-seg active" data-compare-mode="compare" type="button" role="radio" aria-checked="true">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="3" y="4" width="7" height="16" rx="2" />
                              <rect x="14" y="4" width="7" height="16" rx="2" />
                            </svg>
                            {" "}
                            <span>Compare</span>
                          </button>
                          {" "}
                          <button className="compare-mode-seg" data-compare-mode="council" type="button" role="radio" aria-checked="false">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <circle cx="12" cy="7.4" r="2.35" />
                              <circle cx="5" cy="9" r="1.85" />
                              <circle cx="19" cy="9" r="1.85" />
                              <path d="M7.4 20v-1.5a4.6 4.6 0 0 1 9.2 0V20" />
                              <path d="M2.4 20v-1.1A3.3 3.3 0 0 1 5.9 15.6" />
                              <path d="M21.6 20v-1.1a3.3 3.3 0 0 0-3.5-3.3" />
                            </svg>
                            {" "}
                            <span>Council</span>
                          </button>
                        </div>
                        {" "}
                        <div className="compare-mode-desc" id="compareModeDesc">Side-by-side answers from each model.</div>
                        {" "}
                        <div className="model-catalog" id="compareCatalog" />
                        {" "}
                        <button className="compare-clear" id="compareClearButton" type="button">Use single model</button>
                      </div>
                    </div>
                    <div className="composer-compare-wrap" id="councilWrap">
                      <button className={cx("compare-btn council-btn", { active: councilActive, "council-active": councilActive })} id="councilButton" type="button" aria-pressed={councilActive} aria-label="Council mode" title={temporaryChat ? "Temporary chat uses one model" : councilActive ? "Council mode on" : "Council mode"} disabled={running || temporaryChat}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="7.4" r="2.35" />
                          <circle cx="5" cy="9" r="1.85" />
                          <circle cx="19" cy="9" r="1.85" />
                          <path d="M7.4 20v-1.5a4.6 4.6 0 0 1 9.2 0V20" />
                          <path d="M2.4 20v-1.1A3.3 3.3 0 0 1 5.9 15.6" />
                          <path d="M21.6 20v-1.1a3.3 3.3 0 0 0-3.5-3.3" />
                        </svg>
                        {" "}
                        <span id="councilLabel" className="mode-switch-label">Council</span>
                      </button>
                    </div>
                  </div>
                  {!mobile && <ContextWrap />}
                  <div className={cx("writing-style-pill", { hidden: writingStyle === "normal" })} id="writingStylePill">
                    <span id="writingStylePillLabel">{WRITING_STYLE_LABELS[writingStyle]}</span>
                    {" "}
                    <button type="button" id="writingStylePillClose" onClick={() => setWritingStyle("normal")} aria-label="Use normal writing style" title="Use normal writing style">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {mobile && <NativeModeWrap />}
                </div>
                <div className="composer-send">
                  <button className="voice-btn" id="voiceButton" type="button" aria-label="Start voice input" aria-pressed="false" title="Voice input" disabled={synced && !speech}>
                    <svg className="voice-icon-mic" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <path d="M12 19v3" />
                    </svg>
                    {" "}
                    <svg className="voice-icon-cancel" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                    {" "}
                    <span className="voice-dot" aria-hidden="true" />
                  </button>
                  {" "}
                  <button className={cx("send-btn", { hidden: offerVoice, active: synced && composerHasText })} id="sendButton" type="button" aria-label="Send">
                    <svg className="send-icon-arrow" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      {mobile ? <path d="M12 19V5m-6 6 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />}
                    </svg>
                    {" "}
                    <svg className="send-icon-confirm" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </button>
                  {" "}
                  <button className={cx("voice-mode-btn", { hidden: !offerVoice })} id="voiceModeButton" type="button" aria-label="Start voice mode" title="Voice mode" disabled={!offerVoice}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
                      <path d="M4 10v4" />
                      <path d="M8 7v10" />
                      <path d="M12 4v16" />
                      <path d="M16 7v10" />
                      <path d="M20 10v4" />
                    </svg>
                  </button>
                  {" "}
                  <button className="stop-btn hidden" id="stopButton" type="button" aria-label="Stop">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            {!mobile && <DeckPickerPop />}
            <div className="skill-command-menu hidden" id="skillCommandMenu" role="listbox" aria-label="Skills" />
          </div>
        </div>
        <div className="home-modes" id="homeModes" hidden />
        <footer className="app-footer">
          <a className="accuracy-link" href="https://home.klui.ai/accuracy/" target="_blank" rel="noopener">Klui can make mistakes. Double-check important responses.</a>
        </footer>
      </section>
  );
}
