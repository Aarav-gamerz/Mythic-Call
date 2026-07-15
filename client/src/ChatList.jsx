import Avatar from "./Avatar.jsx";

function previewText(lastMessage) {
  if (lastMessage.deleted) return "This message was deleted";
  if (lastMessage.media_type === "image") return "📷 Photo";
  if (lastMessage.media_type === "audio") return "🎤 Voice note";
  if (lastMessage.media_type === "file") return "📎 File";
  // text content is end-to-end encrypted; this list can't decrypt it without opening the chat
  return "🔒 New message";
}

export default function ChatList({ chats, activeChatId, onSelect, onlineUsers, onToggleArchive }) {
  return (
    <div className="chat-list">
      {chats.length === 0 && <div className="empty">No chats here yet.</div>}
      {chats.map((chat) => {
        const otherOnline = chat.members.some((m) => onlineUsers.has(m.id));
        const avatarUrl = !chat.isGroup && chat.members[0] ? chat.members[0].avatar : null;
        return (
          <div
            key={chat.id}
            className={`chat-list-item ${chat.id === activeChatId ? "active" : ""}`}
            onClick={() => onSelect(chat.id)}
          >
            <div style={{ position: "relative" }}>
              <Avatar name={chat.name} avatarUrl={avatarUrl} />
              {otherOnline && <span className="online-dot" />}
            </div>
            <div className="chat-info">
              <div className="chat-name">{chat.name}</div>
              <div className="chat-preview">
                {chat.lastMessage ? previewText(chat.lastMessage) : "No messages yet"}
              </div>
            </div>
            {onToggleArchive && (
              <button
                className="archive-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleArchive(chat.id, !chat.archived);
                }}
                title={chat.archived ? "Unarchive" : "Archive"}
              >
                {chat.archived ? "↩" : "🗄"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
