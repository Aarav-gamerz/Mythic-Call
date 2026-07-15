// This runs in the background, independently of any open tab, which is what lets
// notifications appear even when MythicCall isn't open in the browser at all.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "MythicCall", body: event.data ? event.data.text() : "New message" };
  }

  const title = data.title || "MythicCall";
  const options = {
    body: data.body || "New message",
    icon: "/mythiccall-icon.png",
    badge: "/mythiccall-icon.png",
    tag: data.isCall ? "mythiccall-call" : "mythiccall-push",
    requireInteraction: !!data.isCall,
    data: { chatId: data.chatId || null },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
