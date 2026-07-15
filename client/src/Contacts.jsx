import { useEffect, useState } from "react";
import { api } from "./api";
import Avatar from "./Avatar.jsx";

export default function Contacts({ onClose, onStartChat, onStartGroup, initialGroupMode }) {
  const [users, setUsers] = useState([]);
  const [groupMode, setGroupMode] = useState(!!initialGroupMode);
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState("");

  useEffect(() => {
    api.getUsers().then(setUsers).catch(console.error);
  }, []);

  function toggleSelect(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleCreateGroup() {
    if (!groupName.trim() || selected.length === 0) return;
    onStartGroup(groupName.trim(), selected);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{groupMode ? "New Group" : "Contacts"}</h2>

        {groupMode && (
          <input
            className="group-name-input"
            placeholder="Group name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            style={{ marginBottom: 12, padding: 10, borderRadius: 8, border: "1px solid var(--wa-border)", background: "var(--wa-panel)", color: "var(--wa-text)" }}
          />
        )}

        <div className="contacts-list">
          {users.length === 0 && <div className="empty">No other users yet. Register a second account to test chatting.</div>}
          {users.map((u) => (
            <div
              key={u.id}
              className="contact-item"
              onClick={() => (groupMode ? toggleSelect(u.id) : onStartChat(u.id))}
              style={groupMode && selected.includes(u.id) ? { background: "var(--wa-panel)" } : {}}
            >
              <Avatar name={u.username} avatarUrl={u.avatar} />
              <div>{u.username}</div>
              {groupMode && selected.includes(u.id) && <span style={{ marginLeft: "auto" }}>✓</span>}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {!groupMode ? (
            <button className="close-btn" style={{ flex: 1 }} onClick={() => setGroupMode(true)}>+ New group</button>
          ) : (
            <button className="close-btn" style={{ flex: 1, background: "var(--wa-green-accent)", color: "white" }} onClick={handleCreateGroup}>Create group</button>
          )}
          <button className="close-btn" style={{ flex: 1 }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
