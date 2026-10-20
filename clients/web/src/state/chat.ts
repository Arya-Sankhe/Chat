/* The chat core's actions, for the shell. The core itself is the old app's
   conversation code (islands/chat.js); these are its entry points. */
import { launchGreetingHtml } from "../shell/launch";
import * as core from "../islands/chat.js";
import { els } from "./legacy";
import { useApp } from "./app";

export const openConversation = core.openConversation as (id: string) => Promise<void>;
export const openNewChat = core.openNewChat as (options?: { replaceUrl?: boolean }) => void;
export const addConversation = core.addConversation as () => Promise<void>;
export const removeConversation = core.removeConversation as (id: string) => Promise<void>;
export const signOutAndReset = core.signOutAndReset as () => Promise<void>;
export const loadChatApp = core.loadChatApp as () => Promise<void>;
export const applyComposerHeight = core.applyComposerHeight as () => void;
export const restorePendingDocuments = core.restorePendingDocuments as () => Promise<void>;
export const openRouteResearchReport = core.openRouteResearchReport as () => Promise<void>;
export const resumeGuestSend = core.resumeGuestSend as () => Promise<void>;
export const closeGuestContinue = core.closeGuestContinue as () => void;
export const handleSessionEnded = core.handleSessionEnded as () => void;
export const loadPaymentRequests = core.loadPaymentRequests as () => Promise<void>;
export const trackPaymentRequests = core.trackPaymentRequests as () => void;
export const refreshAfterMamoReturn = core.refreshAfterMamoReturn as () => Promise<void>;
export const prefetchRecentChats = core.prefetchRecentChats as (promise: Promise<unknown>) => void;

/** Before boot: what index.html's script painted on a phone opened at "/". */
export function mountChat() {
  if (useApp.getState().shellRender === 0) els.messages.innerHTML = launchGreetingHtml();
  core.mountChat();
}
