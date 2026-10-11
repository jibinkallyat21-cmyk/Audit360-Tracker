/* Desktop notifications for the Audit 360 Tracker. Receives pushes and shows them. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // The person is looking at the site right now; the page itself shows the new message.
      if (windows.some((w) => w.focused)) return undefined;
      return self.registration.showNotification(data.title || "Audit 360 Tracker", {
        body: data.body || "",
        tag: data.tag,
        icon: "/icon.svg",
        badge: "/icon.svg",
        data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/" },
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ("focus" in w) return w.focus().then(() => ("navigate" in w ? w.navigate(url) : undefined));
      }
      return self.clients.openWindow(url);
    }),
  );
});
