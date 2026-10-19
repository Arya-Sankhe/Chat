// The children of #app, in the old index.html's order. Each region keeps the
// old markup (ids, classes, mounted-but-hidden elements) because the old
// stylesheets, :has() rules included, depend on that exact tree.
import { appearanceAttributes } from "@klui/shared";
import { useApp } from "../state/app";
import { useBodyState } from "../state/body";
import { AccountDrawer } from "./AccountDrawer";
import { AppUpdateDialog } from "./AppUpdateDialog";
import { AppUpdateToast } from "./AppUpdateToast";
import { AuthDialog } from "./AuthDialog";
import { BetaWelcome } from "./BetaWelcome";
import { ChatPanel } from "./ChatPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { CourseCreateDialog } from "./CourseCreateDialog";
import { CourseRenameDialog } from "./CourseRenameDialog";
import { DeckPresetDialog } from "./DeckPresetDialog";
import { DocumentViewer } from "./DocumentViewer";
import { Lightbox } from "./Lightbox";
import { MovedNotice } from "./MovedNotice";
import { PastedTextDialog } from "./PastedTextDialog";
import { PaywallView } from "./PaywallView";
import { ProjectCreateDialog } from "./ProjectCreateDialog";
import { RenameDialog } from "./RenameDialog";
import { ResearchReportView } from "./ResearchReportView";
import { SearchDialog } from "./SearchDialog";
import { SelectionActions } from "./SelectionActions";
import { SettingsDrawer } from "./SettingsDrawer";
import { SetupView } from "./SetupView";
import { SideChatPanel } from "./SideChatPanel";
import { Sidebar } from "./Sidebar";
import { StudyCreateDialog } from "./StudyCreateDialog";
import { StudyNoteOverlay } from "./StudyNoteOverlay";
import { cx } from "./cx";
import { MOBILE_AT_LOAD } from "./launch";

const MOVED_NOTICE_CSS = `
        #movedNotice .moved-open {
          display: inline-flex;
          margin-top: 8px;
          min-height: 36px;
          padding: 0 12px;
          border: 0;
          border-radius: 8px;
          background: var(--accent);
          color: var(--accent-contrast);
          font: inherit;
          font-weight: 650;
          cursor: pointer;
        }
        #movedNotice .moved-open:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
      `;

export function AppRoot() {
  useBodyState();
  const view = useApp((s) => s.view);
  const settings = useApp((s) => s.settings);
  const systemDark = useApp((s) => s.systemDark);
  const wallpaperSrc = appearanceAttributes(settings, systemDark).wallpaperSrc;
  return (
    <>
      <SetupView />
      <PaywallView />
      {/* showOnly(): the boot frame and the chat both show the chat view. */}
      <div className={cx("app-shell", { hidden: view !== "boot" && view !== "chat" })} id="chatView">
        <h1 className="sr-only">Klui AI</h1>
        {/* Phones decode it synchronously so the first frame already has it. */}
        <img className="home-wallpaper" id="homeWallpaper" alt="" aria-hidden="true" decoding={MOBILE_AT_LOAD ? "sync" : "async"} fetchPriority="high" src={wallpaperSrc || undefined} />
        <div className="chat-wallpaper-outline" aria-hidden="true" />
        <svg className="temporary-chat-art" viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">
          <path className="temporary-chat-line temporary-chat-line-fragments" pathLength="1000" vectorEffect="non-scaling-stroke" d="M-2 6 C8 1 13 9 12 18 C11 31 21 34 27 25 C34 15 40 22 37 35 C34 48 45 52 52 42 C59 32 67 39 64 53 C61 67 73 74 80 63 C87 51 94 66 102 94" />
          <path className="temporary-chat-line temporary-chat-line-connector" pathLength="1000" vectorEffect="non-scaling-stroke" d="M-2 6 C8 1 13 9 12 18 C11 31 21 34 27 25 C34 15 40 22 37 35 C34 48 45 52 52 42 C59 32 67 39 64 53 C61 67 73 74 80 63 C87 51 94 66 102 94" />
        </svg>
        <button className="native-nav-backdrop" id="nativeNavBackdrop" type="button" aria-label="Close navigation" />
        <Sidebar />
        <ChatPanel />
        <DocumentViewer />
        <SettingsDrawer />
        <AccountDrawer />
        <ConfirmDialog />
        <RenameDialog />
        <SearchDialog />
        <AuthDialog />
        <BetaWelcome />
        <div className="overlay" id="overlay" hidden />
      </div>
      <ProjectCreateDialog />
      <CourseCreateDialog />
      <StudyCreateDialog />
      <CourseRenameDialog />
      <DeckPresetDialog />
      <ResearchReportView />
      <div className="toast" id="toast" role="status" aria-live="polite" />
      <AppUpdateToast />
      <div className="study-session hidden" id="studySession" role="dialog" aria-modal="true" aria-label="Study session" aria-hidden="true" />
      <StudyNoteOverlay />
      <SelectionActions />
      <SideChatPanel />
      <MovedNotice />
      <style>{MOVED_NOTICE_CSS}</style>
      <AppUpdateDialog />
      <Lightbox />
      <PastedTextDialog />
    </>
  );
}
