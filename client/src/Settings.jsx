import { useEffect, useState } from "react";
import { requestNotificationPermission, notificationsEnabled, registerPushNotifications } from "./notifications";
import { api } from "./api";

const THEMES = [
  { name: "WhatsApp Green", accent: "#00a884", header: "#005c4b", bubble: "#005c4b" },
  { name: "Ocean Blue", accent: "#3b82f6", header: "#1e3a5f", bubble: "#1e40af" },
  { name: "Royal Purple", accent: "#a855f7", header: "#3b0764", bubble: "#6b21a8" },
  { name: "Sunset Orange", accent: "#f97316", header: "#7c2d12", bubble: "#c2410c" },
  { name: "Rose Pink", accent: "#ec4899", header: "#831843", bubble: "#be185d" },
  { name: "Midnight Teal", accent: "#14b8a6", header: "#134e4a", bubble: "#0f766e" },
];

export function applyTheme(theme) {
  const root = document.documentElement;
  root.style.setProperty("--wa-green-accent", theme.accent);
  root.style.setProperty("--wa-green-dark", theme.header); // this is the variable headers/sidebar actually use
  // Sent-message bubbles always stay green, regardless of theme — only accents/header change
  root.style.setProperty("--wa-bubble-sent", "#005c4b");
  localStorage.setItem("mythiccall-theme", JSON.stringify(theme));
}

const WALLPAPERS = [
  { name: "Default Dark", bg: "#0b141a" },
  { name: "Midnight Blue", bg: "#0a1628" },
  { name: "Deep Purple", bg: "#180a28" },
  { name: "Charcoal", bg: "#1a1a1a" },
  { name: "Forest", bg: "#0a1f14" },
  { name: "Warm Black", bg: "#160f0a" },
];

export function applyWallpaper(wallpaper) {
  document.documentElement.style.setProperty("--wa-bg", wallpaper.bg);
  localStorage.setItem("mythiccall-wallpaper", JSON.stringify(wallpaper));
}

export function loadSavedWallpaper() {
  try {
    const saved = localStorage.getItem("mythiccall-wallpaper");
    if (saved) applyWallpaper(JSON.parse(saved));
  } catch {
    /* ignore */
  }
}

export function loadSavedTheme() {
  try {
    const saved = localStorage.getItem("mythiccall-theme");
    if (saved) applyTheme(JSON.parse(saved));
  } catch {
    /* ignore */
  }
}

export default function Settings({ onClose }) {
  const [selected, setSelected] = useState(THEMES[0].name);
  const [selectedWallpaper, setSelectedWallpaper] = useState(WALLPAPERS[0].name);
  const [notifStatus, setNotifStatus] = useState(notificationsEnabled());

  useEffect(() => {
    try {
      const saved = localStorage.getItem("mythiccall-theme");
      if (saved) setSelected(JSON.parse(saved).name);
      const savedWp = localStorage.getItem("mythiccall-wallpaper");
      if (savedWp) setSelectedWallpaper(JSON.parse(savedWp).name);
    } catch {
      /* ignore */
    }
  }, []);

  function pickTheme(theme) {
    applyTheme(theme);
    setSelected(theme.name);
  }

  function pickWallpaper(wallpaper) {
    applyWallpaper(wallpaper);
    setSelectedWallpaper(wallpaper.name);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, color: "var(--wa-text-dim)", fontSize: 14 }}>Notifications</div>
          {notifStatus ? (
            <div style={{ fontSize: 13, color: "var(--wa-green-accent)" }}>✓ Notifications enabled</div>
          ) : (
            <button
              className="close-btn"
              style={{ background: "var(--wa-green-accent)", color: "white" }}
              onClick={async () => {
                const granted = await requestNotificationPermission();
                setNotifStatus(granted);
                if (granted) {
                  const pushOk = await registerPushNotifications(api);
                  alert(
                    pushOk
                      ? "Notifications enabled — you should receive alerts even with the app closed."
                      : "Browser notifications are on, but push setup failed (check that Render has VAPID keys configured)."
                  );
                } else {
                  alert("Notifications were blocked. Enable them in your browser's site settings to receive alerts.");
                }
              }}
            >
              Enable notifications
            </button>
          )}
        </div>

        <div style={{ marginBottom: 8, color: "var(--wa-text-dim)", fontSize: 14 }}>Theme color</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          {THEMES.map((theme) => (
            <div
              key={theme.name}
              onClick={() => pickTheme(theme)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 10,
                borderRadius: 8,
                cursor: "pointer",
                border: selected === theme.name ? `2px solid ${theme.accent}` : "1px solid var(--wa-border)",
                background: "var(--wa-panel)",
              }}
            >
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: theme.accent, flexShrink: 0 }} />
              <span style={{ fontSize: 13 }}>{theme.name}</span>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 8, color: "var(--wa-text-dim)", fontSize: 14 }}>Chat wallpaper</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          {WALLPAPERS.map((wp) => (
            <div
              key={wp.name}
              onClick={() => pickWallpaper(wp)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 10,
                borderRadius: 8,
                cursor: "pointer",
                border: selectedWallpaper === wp.name ? "2px solid var(--wa-green-accent)" : "1px solid var(--wa-border)",
                background: "var(--wa-panel)",
              }}
            >
              <div style={{ width: 20, height: 20, borderRadius: 4, background: wp.bg, flexShrink: 0, border: "1px solid var(--wa-border)" }} />
              <span style={{ fontSize: 13 }}>{wp.name}</span>
            </div>
          ))}
        </div>

        <button className="close-btn" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
