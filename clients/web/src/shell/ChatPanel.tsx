import { toggleSidebar, useApp } from "../state/app";
import { addConversation } from "../state/chat";
import { cx } from "./cx";
import { Composer } from "./Composer";
import { NativeModeWrap } from "./ComposerSheets";
import { Messages } from "./Messages";

export function ChatPanel() {
  const mobile = useApp((s) => s.mobile);
  const temporaryChat = useApp((s) => s.temporaryChat);
  // renderTemporaryChatMode(): the toggle shows on an empty chat or while a temporary chat is on.
  const showTempToggle = !useApp((s) => s.hasMessages) || temporaryChat;
  return (
    <main className="chat-panel">
      <header className="native-mobile-bar" role="banner">
        <button className="native-mobile-icon-btn native-mobile-menu" id="nativeMobileMenu" type="button" aria-label="Open navigation" onClick={toggleSidebar}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h11" />
          </svg>
        </button>
        {" "}
        {!mobile && <NativeModeWrap />}
        {" "}
        <div className={cx("temporary-chat-label", { hidden: !temporaryChat })} id="temporaryChatLabel">Temporary chat</div>
        {" "}
        <button className={cx("native-mobile-icon-btn temporary-chat-toggle", { hidden: !showTempToggle, active: temporaryChat })} id="temporaryChatToggle" type="button" aria-pressed={temporaryChat} aria-label="Temporary chat" title={temporaryChat ? "Temporary chat is on" : "Temporary chat"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 13h16" />
            <path d="M7 13l1.2-5.2A2.3 2.3 0 0110.45 6h3.1a2.3 2.3 0 012.25 1.8L17 13" />
            <circle cx="8.5" cy="16.5" r="2.5" />
            <circle cx="15.5" cy="16.5" r="2.5" />
            <path d="M11 16.5h2" />
          </svg>
        </button>
        {" "}
        <button className="native-mobile-icon-btn compact-new-chat" id="compactNewChatButton" type="button" aria-label="New chat" title="New chat" onClick={() => { useApp.setState({ sidebarOpen: false }); addConversation(); }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      </header>
      {" "}
      <button className="project-chat-crumb hidden" id="projectChatCrumb" type="button" aria-label="Back to project">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        </svg>
        {" "}
        <span id="projectChatCrumbName" />
      </button>
      {" "}
      <section className="project-view hidden" id="projectView" aria-live="polite" />
      {" "}
      <section className="study-view hidden" id="studyView" aria-live="polite" />
      {" "}
      <Messages />
      {" "}
      <aside className="chat-prompt-nav hidden" id="chatPromptNav" aria-label="Conversation prompts">
        <button className="chat-prompt-rail" id="chatPromptRail" type="button" aria-label="Browse conversation prompts" aria-expanded="false">
          <span id="chatPromptMarkers" aria-hidden="true" />
        </button>
        {" "}
        <div className="chat-prompt-panel" id="chatPromptPanel">
          <div className="chat-prompt-list" id="chatPromptList" />
        </div>
      </aside>
      {" "}
      <div className="compare-context-banner hidden" id="compareContextBanner" role="dialog" aria-labelledby="compareContextTitle" aria-describedby="compareContextBody">
        <div className="compare-context-card">
          <div className="compare-context-copy">
            <strong id="compareContextTitle">Compare uses visual context automatically</strong>
            {" "}
            <p id="compareContextBody">Visual details are transcribed for the text-only lane before both models answer independently.</p>
          </div>
          <div className="compare-context-actions">
            <button className="compare-context-primary" id="compareContextYes" type="button">Describe images for text models</button>
            {" "}
            <button className="compare-context-secondary" id="compareContextNo" type="button">New chat, no history</button>
            {" "}
            <button className="compare-context-cancel" id="compareContextCancel" type="button">Cancel compare</button>
          </div>
        </div>
      </div>
      {" "}
      <input id="imageFileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,text/tab-separated-values,.pdf,.docx,.xlsx,.pptx,.csv,.tsv" multiple className="sr-only" />
      {" "}
      <input id="cameraFileInput" type="file" accept="image/*" capture="environment" className="sr-only" />
      {" "}
      <input id="projectFileInput" type="file" accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,text/tab-separated-values,.pdf,.docx,.xlsx,.pptx,.csv,.tsv" multiple className="sr-only" />
      {" "}
      <input id="studyFileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,text/tab-separated-values,.pdf,.docx,.xlsx,.pptx,.csv,.tsv,image/*,audio/*,video/*,.mp3,.m4a,.wav,.webm,.ogg,.oga,.opus,.flac,.aac,.aif,.aiff,.caf,.mp4,.mov,.m4v,.mkv" multiple className="sr-only" />
      {" "}
      <div id="composerHomeAnchor" hidden />
      {" "}
      <Composer />
    </main>
  );
}
