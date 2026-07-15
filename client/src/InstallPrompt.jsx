import { useEffect, useState } from "react";

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

// Small "Install Now" button that triggers the native install prompt on
// Android/desktop Chrome, and shows manual instructions on iOS (Safari
// doesn't support the beforeinstallprompt event at all).
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [installed, setInstalled] = useState(isStandalone());
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("mc-install-dismissed") === "1");

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const onInstalled = () => setInstalled(true);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || dismissed) return null;
  if (!deferredPrompt && !isIos()) return null;

  const dismiss = () => {
    localStorage.setItem("mc-install-dismissed", "1");
    setDismissed(true);
  };

  const handleClick = async () => {
    if (isIos()) {
      setShowIosHelp(true);
      return;
    }
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferredPrompt(null);
  };

  return (
    <>
      <div className="install-banner">
        <div className="install-banner-icon">
          <img src="/icon-192.png" alt="" width="32" height="32" />
        </div>
        <div className="install-banner-text">
          <div className="install-banner-title">Install MythicCall</div>
          <div className="install-banner-sub">Add it to your home screen for quick access</div>
        </div>
        <button className="install-banner-btn" onClick={handleClick}>Install Now</button>
        <button className="install-banner-close" onClick={dismiss} aria-label="Dismiss">×</button>
      </div>

      {showIosHelp && (
        <div className="ios-install-overlay" onClick={() => setShowIosHelp(false)}>
          <div className="ios-install-sheet" onClick={(e) => e.stopPropagation()}>
            <img src="/icon-192.png" alt="" width="48" height="48" />
            <h3>Install MythicCall</h3>
            <p>
              Tap the <strong>Share</strong> icon <span className="ios-share-icon">⬆️</span> in Safari,
              then choose <strong>“Add to Home Screen.”</strong>
            </p>
            <button className="close-btn" onClick={() => setShowIosHelp(false)}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}
