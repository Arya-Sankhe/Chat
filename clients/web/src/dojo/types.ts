// The plain data the engine (islands/studyHub.js) hands the React Dojo on every render.

export type Jot = { t: number; text: string };

export type AudioEntry = {
  key: string;
  title: string;
  phase: string;
  label: string;
  detail: string;
  error: string;
  progress: number | null;
  failed: boolean;
  uploadId: string;
  docId: string;
};

export type LectureRow = {
  id: string;
  title: string;
  fileName: string;
  createdAt: string;
  duration: number;
  ready: boolean;
  writing: boolean;
  noteError: string;
  noteId: string;
  gist: string;
};

export type OpenLecture =
  | { kind: "live"; jots: Jot[]; recordingId: string }
  | { kind: "writing"; id: string; title: string; entry: AudioEntry | null; jots: Jot[]; writing?: boolean; noteError?: string; duration?: number; createdAt?: string }
  | (LectureRow & { kind: "note" | "writing"; tab: "notes" | "transcript" | "ask"; entry: AudioEntry | null; jots: Jot[]; html: string; player: boolean });

export type CollectionItem = {
  kind: "deck" | "quiz" | "podcast" | "tutor" | "whiteboard" | "note";
  type: string;
  id: string;
  title: string;
  meta: string;
  createdAt?: string;
  pinned: boolean;
  preparing?: boolean;
  outline?: string[];
  progress?: { state: "resume" | "done"; seen?: number; total: number; got: number; missed: number; revisit?: number } | null;
};

export type RecentRow = {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  gist: string;
  createdAt: string;
  duration: number;
  status: "ready" | "writing" | "transcribing" | "failed";
  made: number;
};

export type DojoView = {
  signedIn: boolean;
  courses: { id: string; name: string }[];
  courseId: string;
  tab: "notes" | "practice" | "materials" | "chat";
  recordTo: string;
  live: { courseId: string; here: boolean; state: string; elapsed: number; quiet: boolean };
  recent: { rows: RecentRow[]; counts: Record<string, { lectures: number; materials: number }> } | null;
  loaded?: boolean;
  course?: { id: string; name: string };
  lectures?: LectureRow[];
  busy?: AudioEntry[];
  lecture?: OpenLecture | null;
  collection?: CollectionItem[];
  generations?: { id: string; type: string; label: string; source: string; status: string; stage: string; error: string; elapsed: string; meta: string }[];
  materials?: { id: string; name: string; kind: string; status: string; createdAt: string; pages: number }[];
  pendingUploads?: { name: string; status: string }[];
  previewId?: string;
  studio?: { kind: string; id: string; title: string } | null;
  chats?: { id: string; title: string }[];
  chatId?: string;
  hasMessages?: boolean;
  uploading?: boolean;
};

export type DojoActions = {
  openCourse(id: string, opts?: { tab?: string }): Promise<void>;
  openCourses(): Promise<void>;
  setTab(tab: string): Promise<void>;
  selectLecture(id: string, tab?: string): void;
  closeLecture(): void;
  startLiveRecording(courseId?: string): Promise<void>;
  recordInto(courseId: string): void;
  recordUnsorted(): Promise<void>;
  setRecordTo(courseId: string): void;
  openLive(courseId: string): void;
  openLecture(courseId: string, docId: string): void;
  addMaterial(panel?: string): void;
  uploadRecording(): void;
  createCourse(): void;
  renameCourse(id: string): void;
  deleteCourse(id: string): void;
  closeStudio(): void;
  closePreview(): void;
  newChat(): void;
  openChat(id: string): void;
};

export type DojoHub = {
  view(): DojoView;
  loadRecentLectures(opts?: { force?: boolean }): Promise<void>;
  actions: DojoActions;
  render(): void;
};
