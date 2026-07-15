import { useEffect, useRef, useState } from "react";

export default function MythicAIPanel({ url, onClose }) {
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const iframeRef = useRef(null);

  useEffect(() => {
    // Sites that block embedding (X-Frame-Options / CSP frame-ancestors) don't fire a JS error —
    // the frame just stays blank. A load timeout is the practical way to detect that.
    const timer = setTimeout(() => {
      if (!loaded) setLoadFailed(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, [loaded]);

  return (
    <div className="mythic-ai-panel">
      <div className="chat-header">
        <div className="avatar" style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}>✨</div>
        <div style={{ flex: 1 }}>
          <div className="chat-name">Mythic AI</div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close">✕</button>
      </div>

      {!loadFailed ? (
        <iframe
          ref={iframeRef}
          src={url}
          title="Mythic AI"
          className="mythic-ai-frame"
          onLoad={() => setLoaded(true)}
        />
      ) : (
        <div className="mythic-ai-fallback">
          <p>Mythic AI didn't load inside the app — it's likely set to block embedding on other sites for security.</p>
          <button className="close-btn" onClick={() => window.open(url, "_blank")}>
            Open Mythic AI in a new tab
          </button>
        </div>
      )}
    </div>
  );
}
