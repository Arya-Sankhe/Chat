// Named UI states compared between the old site and the new web client. Each
// scenario waits for an explicit sign that the state is ready (selectors the
// new client reproduces from the old markup), never for a fixed delay.

// Fixture ids differ per user only in their tag (see local-backend/fixtures.mjs).
const conversationId = (site, n) => `00000000-0000-4000-8000-${site === "old" ? "a" : "b"}${String(n).padStart(11, "0")}`;

const listReady = (page) => page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });

// Desktop starts with the sidebar collapsed to an icon rail; phones open it as
// a drawer from the top bar.
const openSidebar = async (page, viewport) => {
  await page.click(viewport === "phone" ? "#nativeMobileMenu" : "#sidebarButton");
  await page.locator(".conversation-row").first().waitFor();
};

export const scenarios = [
  {
    name: "signed-out",
    path: "/",
    signedOut: true,
    // Signed out is the guest home: the composer plus a log-in panel in the sidebar.
    ready: (page) => page.waitForSelector("body.guest-mode #guestLoginButton", { state: "attached" })
  },
  {
    name: "home",
    path: "/",
    ready: listReady
  },
  {
    name: "conversation",
    path: ({ site }) => `/c/${conversationId(site, 1)}`,
    ready: (page) => page.getByText("The Calvin cycle").first().waitFor()
  },
  {
    name: "chat-menu",
    path: "/",
    viewports: ["desktop"],
    ready: listReady,
    steps: async (page, { viewport }) => {
      await openSidebar(page, viewport);
      await page.locator(".conversation-row").first().hover();
      await page.locator(".conversation-menu-btn").first().click();
      await page.waitForSelector(".conversation-menu:not(.hidden)");
    }
  },
  {
    name: "profile-menu",
    path: "/",
    ready: listReady,
    steps: async (page, { viewport }) => {
      if (viewport === "phone") await openSidebar(page, viewport);
      await page.click("#profileAvatar");
      // On phones the avatar opens the settings overview instead of a menu.
      await page.waitForSelector(viewport === "phone" ? "#settingsDrawer.open" : "#profileMenu:not(.hidden)");
    }
  },
  {
    name: "search-dialog",
    path: "/",
    ready: listReady,
    steps: async (page, { viewport }) => {
      if (viewport === "phone") await openSidebar(page, viewport);
      await page.click("#searchChatsButton");
      await page.waitForSelector("#searchDialog:not(.hidden)");
    }
  }
];
