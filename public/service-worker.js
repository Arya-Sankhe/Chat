// Leftover unregisterer for old PWA clients. Do not cache or intercept.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: "window" });
    await Promise.all(
      windows.map((client) => ("navigate" in client ? client.navigate(client.url) : undefined))
    );
  })());
});
