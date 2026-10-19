import { Messages } from "./Messages";

export function ChatPanel() {
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
        <div className="native-mobile-mode-wrap">
          <button className="native-mobile-mode-btn" id="nativeMobileModeButton" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Choose mode">
            <span className="native-mobile-mode-label" id="nativeMobileModeLabel">Think</span>
            {" "}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {" "}
          <div className="native-mobile-mode-dropdown hidden" id="nativeMobileModeDropdown" role="listbox" aria-label="Mode">
            <button className="native-mobile-mode-item" type="button" data-mode="nitro" role="option" aria-selected="false">
              <span className="mode-dot mode-dot-nitro" aria-hidden="true" />
              {" "}
              <span>Nitro</span>
            </button>
            {" "}
            <button className="native-mobile-mode-item" type="button" data-mode="thinking" role="option" aria-selected="true">
              <span className="mode-dot mode-dot-thinking" aria-hidden="true" />
              {" "}
              <span>Think</span>
            </button>
            {" "}
            <button className="native-mobile-mode-item" type="button" data-mode="pro" role="option" aria-selected="false">
              <span className="mode-dot mode-dot-pro" aria-hidden="true" />
              {" "}
              <span>Pro</span>
            </button>
            {" "}
            <button className="native-mobile-mode-item" type="button" data-mode="compare" role="option" aria-selected="false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="7" height="16" rx="2" />
                <rect x="14" y="4" width="7" height="16" rx="2" />
              </svg>
              {" "}
              <span>Compare</span>
            </button>
            {" "}
            <button className="native-mobile-mode-item" type="button" data-mode="council" role="option" aria-selected="false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 21h7l-1-5a3 3 0 00-3-3H4a3 3 0 00-3 3l-1 5h2" />
                <circle cx="5" cy="7" r="3" />
                <path d="M15 21h7l-1-5a3 3 0 00-3-3h-1a3 3 0 00-3 3l-1 5h2" />
                <circle cx="18" cy="7" r="3" />
                <circle cx="12" cy="3.5" r="2" />
                <path d="M11 12h2v3h-2z" />
              </svg>
              {" "}
              <span>Council</span>
            </button>
          </div>
        </div>
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
            <div className="composer">
              <div className="composer-beam" aria-hidden="true">
                <div data-beam-bloom="" />
              </div>
              <div className="composer-previews" id="imagePreviews" />
              <div className="research-mode-chip hidden" id="researchModeChip">
                <svg className="research-mode-mark" data-chip-icon="research" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 14.2 16.6 5.6a1.05 1.05 0 0 1 1.48 0l1.15 1.15a1.05 1.05 0 0 1 0 1.48L10.6 16.8z" />
                  <path d="M6.2 15.6 8.4 13.4" />
                  <path d="M6.5 16.2h11a1 1 0 0 1 1 1V19H5.5v-1.8a1 1 0 0 1 1-1z" />
                  <path d="M4.5 19.5h15a1 1 0 0 1 1 1V22H3.5v-1.5a1 1 0 0 1 1-1z" />
                </svg>
                {" "}
                <svg className="research-mode-mark hidden" data-chip-icon="compare" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="7" height="16" rx="2" />
                  <rect x="14" y="4" width="7" height="16" rx="2" />
                </svg>
                {" "}
                <svg className="research-mode-mark hidden" data-chip-icon="council" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="7.4" r="2.35" />
                  <circle cx="5" cy="9" r="1.85" />
                  <circle cx="19" cy="9" r="1.85" />
                  <path d="M7.4 20v-1.5a4.6 4.6 0 0 1 9.2 0V20" />
                  <path d="M2.4 20v-1.1A3.3 3.3 0 0 1 5.9 15.6" />
                  <path d="M21.6 20v-1.1a3.3 3.3 0 0 0-3.5-3.3" />
                </svg>
                {" "}
                <span className="research-mode-chip-label">Deep research</span>
                {" "}
                <button type="button" id="researchModeClose" aria-label="Turn off Deep Research">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="composer-input">
                <div className="composer-deck-thumb hidden" id="composerDeckThumb" aria-hidden="true" />
                <div id="promptInput" className="composer-prompt is-placeholder" contentEditable="true" role="textbox" aria-label="Ask Klui" aria-multiline="true" spellCheck="true" data-placeholder="Ask Klui" aria-haspopup="listbox" aria-controls="skillCommandMenu" aria-expanded="false" />
              </div>
              <div className="composer-bottom">
                <div className="composer-actions">
                  <div className="composer-action-menu-wrap" id="composerActionMenuWrap">
                    <button className="composer-tool composer-plus-btn" type="button" id="actionMenuButton" aria-haspopup="menu" aria-expanded="false" aria-label="More actions" title="More actions">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                      </svg>
                    </button>
                    {" "}
                    <div className="composer-action-menu hidden" id="composerActionMenu" role="menu" aria-label="More actions" data-page="root">
                      <button className="composer-action-menu-item" type="button" id="imageToggle" role="menuitem" data-menu-page="root">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.49" />
                        </svg>
                        {" "}
                        <span>{"Add photos & files"}</span>
                      </button>
                      {" "}
                      <button className="composer-action-menu-item mobile-camera-action hidden" type="button" id="cameraAction" role="menuitem" data-menu-page="root">
                        <svg width="19" height="19" viewBox="-1 -1 26 26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                        {" "}
                        <span>Camera</span>
                      </button>
                      {" "}
                      <button className="composer-action-menu-item hidden" type="button" id="deepResearchToggle" role="menuitem" aria-pressed="false" data-menu-page="root">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M8 14.2 16.6 5.6a1.05 1.05 0 0 1 1.48 0l1.15 1.15a1.05 1.05 0 0 1 0 1.48L10.6 16.8z" />
                          <path d="M6.2 15.6 8.4 13.4" />
                          <path d="M6.5 16.2h11a1 1 0 0 1 1 1V19H5.5v-1.8a1 1 0 0 1 1-1z" />
                          <path d="M4.5 19.5h15a1 1 0 0 1 1 1V22H3.5v-1.5a1 1 0 0 1 1-1z" />
                        </svg>
                        {" "}
                        <span>Deep research</span>
                      </button>
                      {" "}
                      <button className="composer-action-menu-item" type="button" id="actionMenuMore" role="menuitem" aria-haspopup="menu" aria-label="More options" data-menu-page="root">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="10" />
                          <circle cx="8" cy="12" r="1.15" fill="currentColor" stroke="none" />
                          <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
                          <circle cx="16" cy="12" r="1.15" fill="currentColor" stroke="none" />
                        </svg>
                        {" "}
                        <span>More</span>
                      </button>
                      {" "}
                      <button className="composer-action-menu-item" type="button" id="actionMenuBack" role="menuitem" aria-label="Back to actions" data-menu-page="more">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m15 18-6-6 6-6" />
                        </svg>
                        {" "}
                        <span>Back</span>
                      </button>
                      {" "}
                      <button className="composer-action-menu-item" type="button" id="writingStyleButton" role="menuitem" aria-haspopup="menu" data-menu-page="more">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
                        </svg>
                        {" "}
                        <span>Styles</span>
                        {" "}
                        <span className="composer-action-menu-value" id="writingStyleMenuValue">Normal</span>
                        {" "}
                        <svg className="composer-action-menu-chevron" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </button>
                      {" "}
                      <button className="composer-action-menu-item web-search-toggle hidden" type="button" id="webSearchToggle" role="menuitem" aria-pressed="true" aria-label="Web search auto" title="Web search: Auto — the model searches the web when needed. Click to turn off." data-menu-page="more">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="2" y1="12" x2="22" y2="12" />
                          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                        </svg>
                        {" "}
                        <span>Web search</span>
                      </button>
                    </div>
                    {" "}
                    <div className="composer-action-menu composer-style-menu hidden" id="writingStyleMenu" role="menu" aria-label="Writing styles">
                      <button className="composer-style-menu-back" type="button" id="writingStyleBack" aria-label="Back to more actions">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m15 18-6-6 6-6" />
                        </svg>
                        {" "}
                        <span>Styles</span>
                      </button>
                      {" "}
                      <button className="composer-style-option" type="button" data-writing-style="normal" role="menuitemradio" aria-checked="true">
                        <span>Normal</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                      </button>
                      {" "}
                      <button className="composer-style-option" type="button" data-writing-style="learning" role="menuitemradio" aria-checked="false">
                        <span>Learning</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                      </button>
                      {" "}
                      <button className="composer-style-option" type="button" data-writing-style="concise" role="menuitemradio" aria-checked="false">
                        <span>Concise</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                      </button>
                      {" "}
                      <button className="composer-style-option" type="button" data-writing-style="explanatory" role="menuitemradio" aria-checked="false">
                        <span>Explanatory</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                      </button>
                      {" "}
                      <button className="composer-style-option" type="button" data-writing-style="formal" role="menuitemradio" aria-checked="false">
                        <span>Formal</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="mode-switch" id="modeSwitch" data-active="think" role="group" aria-label="Answer mode">
                    <div className="composer-model-wrap" id="composerModelWrap">
                      <div className="spectrum-pop" id="spectrumPop" role="dialog" aria-label="Model" hidden>
                        <div className="spectrum-head">Model</div>
                        <div className="spectrum-track" id="spectrumTrack" role="slider" aria-valuemin={0} aria-valuemax={2} aria-valuenow={1} aria-label="Faster to smarter">
                          <div className="spectrum-fill" id="spectrumFill" />
                          <div className="spectrum-steps" id="spectrumSteps" />
                          <div className="spectrum-thumb" id="spectrumThumb" />
                        </div>
                        <div className="spectrum-ends">
                          <span>Faster</span>
                          {" "}
                          <span>Smarter</span>
                        </div>
                      </div>
                      {" "}
                      <button className="composer-model-btn heat-btn" id="modelButton" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="spectrumPop" title="Think" aria-label="Think">
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
                          <span className="heat-name">Think</span>
                          {" "}
                          <span className="heat-fill" id="heatFill">
                            <span className="heat-name">Think</span>
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
                      <button className="compare-btn" id="compareButton" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Compare models" title="Compare models">
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
                      <button className="compare-btn council-btn" id="councilButton" type="button" aria-pressed="false" aria-label="Council mode" title="Council mode">
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
                  <div className="composer-context-wrap" id="composerContextWrap" />
                  <div className="writing-style-pill hidden" id="writingStylePill">
                    <span id="writingStylePillLabel" />
                    {" "}
                    <button type="button" id="writingStylePillClose" aria-label="Use normal writing style" title="Use normal writing style">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="composer-send">
                  <button className="voice-btn" id="voiceButton" type="button" aria-label="Start voice input" aria-pressed="false" title="Voice input">
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
                  <button className="send-btn" id="sendButton" type="button" aria-label="Send">
                    <svg className="send-icon-arrow" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                    </svg>
                    {" "}
                    <svg className="send-icon-confirm" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </button>
                  {" "}
                  <button className="voice-mode-btn hidden" id="voiceModeButton" type="button" aria-label="Start voice mode" title="Voice mode" disabled>
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
            <div className="deck-picker-pop" id="deckPickerPop" role="dialog" aria-label="Slide themes" hidden />
            <div className="skill-command-menu hidden" id="skillCommandMenu" role="listbox" aria-label="Skills" />
          </div>
        </div>
        <div className="home-modes" id="homeModes" hidden />
        <footer className="app-footer">
          <a className="accuracy-link" href="https://home.klui.ai/accuracy/" target="_blank" rel="noopener">Klui can make mistakes. Double-check important responses.</a>
        </footer>
      </section>
    </main>
  );
}
