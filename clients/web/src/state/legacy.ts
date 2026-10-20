/* The `state` and `els` objects the old app's code expects (public/js/app.js),
   for the islands that carry that code over.

   `state` is a shallow adapter. Keys the React store owns read and write
   through the store, so assigning `state.activeConversationId = id` re-renders
   whatever shows it. Everything else (messages, attachments, runs, the
   document viewer) is island-private and lives in a plain object, mutated in
   place as before. Store-owned values are replaced, never mutated: in
   development they come back frozen, so a copied `state.conversations.unshift()`
   throws instead of silently skipping a render. */
import { session } from "../app/runtime";
import { useApp, type AppState } from "./app";

const STORE_KEYS = new Set<keyof AppState>([
  "config",
  "buildId",
  "plans",
  "me",
  "settings",
  "conversations",
  "projects",
  "activeConversationId",
  "conversationLoading",
  "pinnedChatIds",
  "openConversationMenuId",
  "temporaryChat",
  "researchMode",
  "composerSkillIds",
  "composerSkills",
  "running"
]);

/* The rest of the old `state`, with its initial values. */
const local: Record<string, unknown> = {
  paymentRequests: [],
  projectsOpen: false,
  studyOpen: false,
  activeCourseId: "",
  activeCourseTab: "materials",
  studyMaterials: null,
  studyPractice: null,
  studyProjectDetail: null,
  studyUploading: false,
  activeProjectId: "",
  activeProject: null,
  projectUploading: false,
  projectSearch: "",
  projectSort: "updated",
  clarification: null,
  clarificationChecking: false,
  clarificationRequestId: 0,
  activeResearchId: "",
  researchReport: null,
  messages: [],
  messagePage: { hasMore: false, cursor: null },
  loadingOlderMessages: false,
  prependingOlder: false,
  images: [],
  pastedText: "",
  followUps: [],
  skillMenu: { open: false, query: "", start: 0, end: 0, active: 0, composing: false },
  autoScroll: true,
  abortController: null,
  activeTurnRunId: "",
  activeTurnConversationId: "",
  activeTurnWaiting: false,
  activeTurnCancelRequested: false,
  activeTurnCancelResult: null,
  resumingTurnId: "",
  pendingDeleteId: "",
  pendingDeleteAttachmentId: "",
  pendingDeleteProjectId: "",
  storage: null,
  memory: null,
  pendingRenameId: "",
  editingMessageId: "",
  compareDescribeImages: false,
  viewer: {
    open: false,
    attachmentId: "",
    downloadAttachmentId: "",
    jobId: "",
    fileName: "",
    kind: "",
    sourceKind: "",
    url: "",
    officeUrl: "",
    officeConfig: null,
    sheets: [],
    activeSheet: 0,
    markdown: "",
    revision: 0,
    loading: false,
    error: ""
  }
};

const freeze = import.meta.env.DEV
  ? (value: unknown) => (value && typeof value === "object" ? Object.freeze(value) : value)
  : (value: unknown) => value;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const state: any = new Proxy(local, {
  get(target, key: string) {
    if (key === "session") return session.current();
    if (STORE_KEYS.has(key as keyof AppState)) return freeze(useApp.getState()[key as keyof AppState]);
    return target[key];
  },
  set(target, key: string, value) {
    // Sign-in and sign-out go through the SessionManager, never a direct write.
    if (key === "session") throw new Error("state.session is read-only; use the SessionManager.");
    if (STORE_KEYS.has(key as keyof AppState)) useApp.setState({ [key]: value } as Partial<AppState>);
    else target[key] = value;
    return true;
  }
});

/* `els`: the old element map, looked up live so React can re-create an element. */
const SELECTORS: Record<string, string> = {
  composer: ".composer",
  composerBeam: ".composer-beam",
  composerArea: ".composer-area",
  temporaryChatBar: ".temporary-chat-bar"
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const els: any = new Proxy({}, {
  get(_target, key: string) {
    const selector = SELECTORS[key];
    return selector ? document.querySelector(selector) : document.getElementById(key);
  }
});
