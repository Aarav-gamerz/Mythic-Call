import { useEffect, useRef, useState } from "react";
import { api, API_URL } from "./api";
import Avatar from "./Avatar.jsx";

export default function StatusBar({ currentUser }) {
  const [statuses, setStatuses] = useState([]);
  const [viewing, setViewing] = useState(null); // { userId, items, index }
  const [creating, setCreating] = useState(false);
  const [textStatus, setTextStatus] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    api.getStatuses().then(setStatuses).catch((err) => console.error("Failed to load statuses:", err));
  }

  async function postTextStatus() {
    if (!textStatus.trim()) return;
    await api.createStatus(textStatus.trim(), null, null);
    setTextStatus("");
    setCreating(false);
    refresh();
  }

  async function postMediaStatus(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const { url, mediaType } = await api.uploadFile(file);
    await api.createStatus(null, url, mediaType);
    refresh();
    e.target.value = "";
  }

  function openViewer(userId) {
    const entry = statuses.find((s) => s.userId === userId);
    if (!entry) return;
    setViewing({ userId, items: entry.items, index: 0 });
    api.viewStatus(entry.items[0].id).catch(() => {});
  }

  function nextItem() {
    if (!viewing) return;
    if (viewing.index + 1 < viewing.items.length) {
      const nextIndex = viewing.index + 1;
      setViewing({ ...viewing, index: nextIndex });
      api.viewStatus(viewing.items[nextIndex].id).catch(() => {});
    } else {
      setViewing(null);
      refresh();
    }
  }

  const myStatus = statuses.find((s) => s.userId === currentUser.id);

  return (
    <div className="status-bar">
      <div className="status-row">
        <div className="status-item" onClick={() => (myStatus ? openViewer(currentUser.id) : setCreating(true))}>
          <Avatar name={currentUser.username} avatarUrl={currentUser.avatar} showRing={!!myStatus} />
          <div className="status-label">{myStatus ? "My status" : "+ Add status"}</div>
        </div>
        {statuses
          .filter((s) => s.userId !== currentUser.id)
          .map((s) => (
            <div className="status-item" key={s.userId} onClick={() => openViewer(s.userId)}>
              <Avatar name={s.username} showRing={!s.items.every((i) => i.viewedByMe)} />
              <div className="status-label">{s.username}</div>
            </div>
          ))}
      </div>

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add status</h2>
            <input
              placeholder="What's on your mind?"
              value={textStatus}
              onChange={(e) => setTextStatus(e.target.value)}
              style={{ marginBottom: 12, padding: 10, borderRadius: 8, border: "1px solid var(--wa-border)", background: "var(--wa-panel)", color: "var(--wa-text)" }}
            />
            <input type="file" ref={fileInputRef} accept="image/*" style={{ display: "none" }} onChange={postMediaStatus} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="close-btn" style={{ flex: 1, background: "var(--wa-green-accent)", color: "white" }} onClick={postTextStatus}>Post text</button>
              <button className="close-btn" style={{ flex: 1 }} onClick={() => fileInputRef.current?.click()}>Upload photo</button>
            </div>
            <button className="close-btn" style={{ marginTop: 8 }} onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      {viewing && (
        <div className="status-viewer" onClick={nextItem}>
          <div className="status-viewer-content">
            {viewing.items[viewing.index].media_url ? (
              <img
                src={
                  viewing.items[viewing.index].media_url.startsWith("http")
                    ? viewing.items[viewing.index].media_url
                    : `${API_URL}${viewing.items[viewing.index].media_url}`
                }
                alt="status"
              />
            ) : (
              <div className="status-text-slide">{viewing.items[viewing.index].content}</div>
            )}
          </div>
          <button className="status-close" onClick={(e) => { e.stopPropagation(); setViewing(null); }}>✕</button>
        </div>
      )}
    </div>
  );
}
