// Uses the browser's native Notification API. Works whenever the app is open
// (including in a background tab or minimized window) on both desktop and mobile browsers.

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function notificationsEnabled() {
  return "Notification" in window && Notification.permission === "granted";
}

export function showMessageNotification({ title, body, onClick }) {
  if (!notificationsEnabled()) return;
  // Don't notify if the tab is currently focused and visible — the person is already looking at the chat
  if (document.visibilityState === "visible" && document.hasFocus()) return;

  const notif = new Notification(title, {
    body,
    icon: "/mythiccall-icon.png",
    badge: "/mythiccall-icon.png",
    tag: "mythiccall-message",
  });
  notif.onclick = () => {
    window.focus();
    onClick?.();
    notif.close();
  };
}

export function showCallNotification({ callerName, callType, onClick }) {
  if (!notificationsEnabled()) return;
  const notif = new Notification(`Incoming ${callType === "video" ? "video" : "voice"} call`, {
    body: `${callerName} is calling you`,
    icon: "/mythiccall-icon.png",
    requireInteraction: true,
    tag: "mythiccall-call",
  });
  notif.onclick = () => {
    window.focus();
    onClick?.();
    notif.close();
  };
}

// ---------- True push notifications (work even when the app/browser is closed) ----------

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function registerPushNotifications(api) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("Push notifications not supported in this browser");
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready; // ensure it's actually active before subscribing
    const { publicKey } = await api.getVapidPublicKey();
    if (!publicKey) {
      console.error("Push registration failed: server has no VAPID public key configured");
      return false;
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const raw = subscription.toJSON();
    await api.subscribePush({ endpoint: raw.endpoint, keys: raw.keys });
    console.log("Push subscription registered successfully");
    return true;
  } catch (err) {
    console.error("Push subscription failed:", err);
    return false;
  }
}
