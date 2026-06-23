import { isNative } from "./platform/index.js";

const DISMISS_KEY = "klui.ios-install-dismissed.v1";

function isInstalled() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIosSafari() {
  const ua = navigator.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return ios && webkit && !otherBrowser;
}

async function registerServiceWorker() {
  if (isNative() || location.protocol !== "https:" || location.hostname !== "klui.tech") return;
  if (!("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
}

function showIosInstallHint() {
  if (isNative() || isInstalled() || !isIosSafari()) return;
  if (localStorage.getItem(DISMISS_KEY) === "1") return;
  const hint = document.querySelector("#iosInstallHint");
  const close = document.querySelector("#iosInstallClose");
  if (!hint || !close) return;
  hint.classList.remove("hidden");
  close.addEventListener("click", () => {
    localStorage.setItem(DISMISS_KEY, "1");
    hint.classList.add("hidden");
  }, { once: true });
}

registerServiceWorker().catch(() => {});
window.addEventListener("load", showIosInstallHint, { once: true });
