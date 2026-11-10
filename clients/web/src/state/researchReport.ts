/* The open Deep Research report: what shell/ResearchReportView.tsx draws.
   The research controller (islands/research.js) opens and closes it. */
import { create } from "zustand";
import { session } from "../app/runtime";
import { downloadAttachment, exportResearchReport, fetchDocumentJobStatus } from "../islands/api.js";

export type ResearchSource = { url?: string; title?: string };
export type ResearchReportPayload = {
  report?: string;
  sources?: ResearchSource[];
  run?: { id?: string; title?: string; summary?: string; conversationId?: string; sourceCount?: number; finishedAt?: string; createdAt?: string };
};

type ReportState = {
  /** The run being shown, set as soon as it is opened. */
  runId: string;
  payload: ResearchReportPayload | null;
  /** Shown in place of the report while it loads, or when it failed to. */
  message: string;
  textOnly: boolean;
  menuOpen: boolean;
  downloading: boolean;
};

export const useResearchReport = create<ReportState>(() => ({ runId: "", payload: null, message: "", textOnly: false, menuOpen: false, downloading: false }));
const set = useResearchReport.setState;
const get = useResearchReport.getState;

/** openResearchReport(): a fresh, loading report in the visual view. */
export function beginReport(runId: string) {
  set({ runId, payload: null, message: "Loading report...", textOnly: false, menuOpen: false });
}

/** Lands only if the same report is still the one open. */
export function settleReport(runId: string, payload: ResearchReportPayload | null, error = "") {
  if (get().runId !== runId) return;
  set(payload ? { payload, message: "" } : { payload: null, message: error });
}

export function clearReport() {
  set({ runId: "", payload: null, message: "", menuOpen: false });
}

export const reportPayload = () => get().payload;

export function setTextOnly(textOnly: boolean) {
  set({ textOnly });
}

export function setReportMenu(menuOpen: boolean) {
  set({ menuOpen });
}

async function waitForExport(jobId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const payload = await fetchDocumentJobStatus(session.current(), jobId);
    if (payload?.job?.status === "succeeded" && payload.artifact?.attachment_id) return payload.artifact;
    if (["failed", "expired"].includes(payload?.job?.status)) {
      throw new Error(payload.job.error?.message || "Download failed.");
    }
  }
  throw new Error("Download is still processing. Try again shortly.");
}

/** The report as a PDF or Word file; the server may hand back a job to wait on. */
export async function downloadReport(format: string) {
  const runId = get().payload?.run?.id;
  if (!runId) return;
  const current = session.current();
  if (!current?.access_token) throw new Error("Please sign in to download.");
  set({ downloading: true });
  try {
    const result = await exportResearchReport(current, runId, format);
    const artifact = result.artifact || (result.jobId ? await waitForExport(result.jobId) : null);
    if (!artifact?.attachment_id) throw new Error("Download did not return a file.");
    await downloadAttachment(current, artifact.attachment_id, artifact.file_name || `research.${format}`);
  } finally {
    set({ downloading: false });
  }
}
