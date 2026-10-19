import { useApp } from "../state/app";
import { Composer } from "./Composer";
import { NativeModeWrap } from "./ComposerSheets";
import { Messages } from "./Messages";

export function ChatPanel() {
  const mobile = useApp((s) => s.mobile);
  return (
    <main className="chat-panel">
      <header className="native-mobile-bar" role="banner">
        <button className="native-mobile-icon-btn native-mobile-menu" id="nativeMobileMenu" type="button" aria-label="Open navigation">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h11" />
          </svg>
        </button>
        {" "}
        {!mobile && <NativeModeWrap />}
        {" "}
        <div className="temporary-chat-label hidden" id="temporaryChatLabel">Temporary chat</div>
        {" "}
        <button className="native-mobile-icon-btn temporary-chat-toggle" id="temporaryChatToggle" type="button" aria-pressed="false" aria-label="Temporary chat" title="Temporary chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 13h16" />
            <path d="M7 13l1.2-5.2A2.3 2.3 0 0110.45 6h3.1a2.3 2.3 0 012.25 1.8L17 13" />
            <circle cx="8.5" cy="16.5" r="2.5" />
            <circle cx="15.5" cy="16.5" r="2.5" />
            <path d="M11 16.5h2" />
          </svg>
        </button>
        {" "}
        <button className="native-mobile-icon-btn compact-new-chat" id="compactNewChatButton" type="button" aria-label="New chat" title="New chat">
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
      <section className="message assistant guest-continue hidden" id="guestContinue" role="region" aria-labelledby="guestContinueTitle" aria-hidden="true">
        <div className="message-body">
          <div className="guest-continue-card">
            <h2 id="guestContinueTitle">Continue your conversation</h2>
            {" "}
            <p>{"Sign up to continue seamlessly with Klui's full power"}</p>
            {" "}
            <ul className="guest-continue-list">
              <li>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.49" />
                </svg>
                {" "}
                <span>Upload files and images</span>
              </li>
              <li>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 14.2 16.6 5.6a1.05 1.05 0 0 1 1.48 0l1.15 1.15a1.05 1.05 0 0 1 0 1.48L10.6 16.8z" />
                  <path d="M6.2 15.6 8.4 13.4" />
                  <path d="M6.5 16.2h11a1 1 0 0 1 1 1V19H5.5v-1.8a1 1 0 0 1 1-1z" />
                  <path d="M4.5 19.5h15a1 1 0 0 1 1 1V22H3.5v-1.5a1 1 0 0 1 1-1z" />
                </svg>
                {" "}
                <span>Use compare, council and deep research.</span>
              </li>
              <li>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <circle cx="8.5" cy="9.5" r="1.5" />
                  <path d="m21 15.5-4.2-4.2a1.5 1.5 0 0 0-2.1 0L6 20" />
                </svg>
                {" "}
                <span>Create illustrations and visualizations</span>
              </li>
              <li>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l8 3v6c0 5-3.4 8.4-8 9.5C7.4 20.4 4 17 4 12V6l8-3z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
                {" "}
                <span>{"Klui doesn't train on your chats"}</span>
              </li>
            </ul>
            {" "}
            <button type="button" id="guestContinueSignup">Sign up for free</button>
          </div>
        </div>
      </section>
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
