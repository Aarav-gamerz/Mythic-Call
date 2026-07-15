import { useEffect, useRef, useState } from "react";
import { api, getSocket } from "./api";
import { colorForName } from "./avatarColor";
import Avatar from "./Avatar.jsx";
import { encryptForRecipients, decryptMessage, loadOwnPublicKey } from "./crypto";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:4000`;

function Ticks({ status, isSent }) {
  if (!isSent) return null;
  if (status === "read") return <span className="ticks read-tick">✓✓</span>;
  if (status === "delivered") return <span className="ticks delivered-tick">✓✓</span>;
  return <span className="ticks sent-tick">✓</span>;
}

function MediaContent({ m }) {
  if (!m.media_url) return null;
  const fullUrl = m.media_url.startsWith("http") ? m.media_url : `${API_URL}${m.media_url}`;
  if (m.media_type === "image") {
    return <img src={fullUrl} alt="shared" style={{ maxWidth: 240, borderRadius: 8, display: "block", marginBottom: m.content ? 6 : 0 }} />;
  }
  if (m.media_type === "audio") {
    return <audio controls src={fullUrl} style={{ display: "block", marginBottom: m.content ? 6 : 0 }} />;
  }
  return <a href={fullUrl} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>📎 Download file</a>;
}

export default function ChatWindow({ chat, currentUser, typingUsers }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [openEmojiFor, setOpenEmojiFor] = useState(null);
  const [openMenuFor, setOpenMenuFor] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const [chatKeys, setChatKeys] = useState({}); // userId -> public key jwk string

  useEffect(() => {
    if (!chat) return;
    (async () => {
      const keys = await api.getChatKeys(chat.id);
      const keyMap = {};
      keys.forEach((k) => (keyMap[k.id] = k.public_key));
      setChatKeys(keyMap);

      const history = await api.getMessages(chat.id);
      const decrypted = await Promise.all(
        history.map(async (m) => {
          if (m.deleted) return m;
          const plain = await decryptMessage(currentUser.id, m);
          return plain !== null ? { ...m, content: plain } : m;
        })
      );
      setMessages(decrypted);
    })();
    getSocket()?.emit("mark_read", { chatId: chat.id });
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
  }, [chat?.id]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    async function handleNewMessage(msg) {
      if (msg.chat_id === chat?.id) {
        let displayMsg = msg;
        if (!msg.deleted) {
          const plain = await decryptMessage(currentUser.id, msg);
          if (plain !== null) displayMsg = { ...msg, content: plain };
        }
        setMessages((prev) => [...prev, displayMsg]);
        socket.emit("mark_read", { chatId: chat.id });
      }
    }
    function handleRead({ chatId, messageIds }) {
      if (chatId !== chat?.id) return;
      setMessages((prev) => prev.map((m) => (messageIds.includes(m.id) ? { ...m, status: "read" } : m)));
    }
    function handleReaction({ messageId, userId, emoji }) {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const others = (m.reactions || []).filter((r) => r.user_id !== userId);
          return { ...m, reactions: [...others, { message_id: messageId, user_id: userId, emoji }] };
        })
      );
    }
    function handleDeleted({ messageId, chatId }) {
      if (chatId !== chat?.id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, deleted: 1, content: "This message was deleted", media_url: null } : m))
      );
    }

    socket.on("new_message", handleNewMessage);
    socket.on("messages_read", handleRead);
    socket.on("reaction_updated", handleReaction);
    socket.on("message_deleted", handleDeleted);
    return () => {
      socket.off("new_message", handleNewMessage);
      socket.off("messages_read", handleRead);
      socket.off("reaction_updated", handleReaction);
      socket.off("message_deleted", handleDeleted);
    };
  }, [chat?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const socket = getSocket();
    const selfKey = loadOwnPublicKey(currentUser.id);
    const { content, iv, encryptedKeys } = await encryptForRecipients(text.trim(), {
      ...chatKeys,
      [currentUser.id]: selfKey,
    });
    socket.emit("send_message", {
      chatId: chat.id,
      content,
      iv,
      encryptedKeys,
      replyToId: replyTo?.id || null,
    });
    setText("");
    setReplyTo(null);
    socket.emit("typing", { chatId: chat.id, isTyping: false });
  }

  function handleTyping(value) {
    setText(value);
    const socket = getSocket();
    if (!socket) return;
    socket.emit("typing", { chatId: chat.id, isTyping: true });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit("typing", { chatId: chat.id, isTyping: false });
    }, 1500);
  }

  function react(messageId, emoji) {
    getSocket().emit("react", { messageId, chatId: chat.id, emoji });
    setOpenEmojiFor(null);
  }

  function deleteMessage(messageId) {
    getSocket().emit("delete_message", { messageId, chatId: chat.id });
  }

  function findMessage(id) {
    return messages.find((m) => m.id === id);
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { url, mediaType } = await api.uploadFile(file);
      getSocket().emit("send_message", { chatId: chat.id, content: "", mediaUrl: url, mediaType });
    } catch (err) {
      console.error(err);
    }
    e.target.value = "";
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const file = new File([blob], "voice-note.webm", { type: "audio/webm" });
        try {
          const { url, mediaType } = await api.uploadFile(file);
          getSocket().emit("send_message", { chatId: chat.id, content: "", mediaUrl: url, mediaType });
        } catch (err) {
          console.error(err);
        }
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      alert("Microphone access denied or unavailable.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }

  async function runSearch() {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const results = await api.searchMessages(chat.id, searchQuery.trim());
    setSearchResults(results);
  }

  function startCall(callType) {
    if (chat.isGroup) {
      alert("Group calling isn't available yet — start a 1:1 chat to call.");
      return;
    }
    const otherMember = chat.members[0];
    if (!otherMember) return;
    window.__startCall?.(otherMember.id, otherMember.username, chat.id, callType);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  if (!chat) {
    return <div className="chat-window empty-state">Select a chat to start messaging</div>;
  }

  const isTyping = typingUsers.has(chat.id);
  const displayedMessages = searchResults !== null ? searchResults : messages;

  return (
    <div className="chat-window">
      <div className="chat-header">
        <Avatar name={chat.name} avatarUrl={!chat.isGroup && chat.members[0] ? chat.members[0].avatar : null} />
        <div style={{ flex: 1 }}>
          <div className="chat-name">{chat.name}{chat.isGroup ? " (group)" : ""}</div>
          {isTyping && <div className="typing-indicator">typing...</div>}
        </div>
        <button className="icon-btn" onClick={() => startCall("voice")} title="Voice call">📞</button>
        <button className="icon-btn" onClick={() => startCall("video")} title="Video call">🎥</button>
        <button className="icon-btn" onClick={toggleFullscreen} title="Toggle fullscreen">⛶</button>
        <button className="icon-btn" onClick={() => setSearchOpen((s) => !s)} title="Search messages">🔍</button>
      </div>

      {searchOpen && (
        <div style={{ display: "flex", gap: 8, padding: "8px 16px", background: "var(--wa-panel-light)" }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Search in this chat"
            style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid var(--wa-border)", background: "var(--wa-panel)", color: "var(--wa-text)" }}
          />
          <button onClick={runSearch} className="close-btn">Search</button>
          <button onClick={() => { setSearchResults(null); setSearchQuery(""); }} className="close-btn">Clear</button>
        </div>
      )}

      <div className="messages">
        {displayedMessages.map((m) => {
          const isSent = m.sender_id === currentUser.id;
          const repliedMsg = m.reply_to_id ? findMessage(m.reply_to_id) : null;
          const groupedReactions = {};
          (m.reactions || []).forEach((r) => {
            groupedReactions[r.emoji] = (groupedReactions[r.emoji] || 0) + 1;
          });

          return (
            <div key={m.id} className={`message ${isSent ? "sent" : "received"} ${openMenuFor === m.id ? "actions-open" : ""}`}>
              {openEmojiFor === m.id && !m.deleted && (
                <div className="emoji-picker">
                  {QUICK_EMOJIS.map((e) => (
                    <span key={e} onClick={() => react(m.id, e)}>{e}</span>
                  ))}
                </div>
              )}
              <div className="bubble-wrap">
                {!m.deleted && (
                  <div className="msg-actions">
                    <button onClick={() => setOpenEmojiFor(openEmojiFor === m.id ? null : m.id)}>😊</button>
                    <button onClick={() => { setReplyTo(m); setOpenMenuFor(null); }}>↩ Reply</button>
                    {isSent && <button onClick={() => { deleteMessage(m.id); setOpenMenuFor(null); }}>🗑 Delete</button>}
                  </div>
                )}
                <div
                  className="bubble"
                  onClick={() => !m.deleted && setOpenMenuFor(openMenuFor === m.id ? null : m.id)}
                  style={m.deleted ? { fontStyle: "italic", color: "var(--wa-text-dim)" } : {}}
                >
                  {repliedMsg && !m.deleted && <div className="reply-preview">{repliedMsg.content || "Media"}</div>}
                  {!m.deleted && <MediaContent m={m} />}
                  {m.content}
                </div>
              </div>
              {Object.keys(groupedReactions).length > 0 && !m.deleted && (
                <div className="reactions-row">
                  {Object.entries(groupedReactions).map(([emoji, count]) => (
                    <span key={emoji} className="reaction-pill">{emoji} {count > 1 ? count : ""}</span>
                  ))}
                </div>
              )}
              <div className="meta-row">
                <span className="timestamp">
                  {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <Ticks status={m.status} isSent={isSent} />
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {replyTo && (
        <div className="reply-bar">
          <span>Replying to: {(replyTo.content || "Media").slice(0, 60)}</span>
          <button onClick={() => setReplyTo(null)}>✕</button>
        </div>
      )}

      <form className="message-input" onSubmit={sendMessage}>
        <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileSelected} />
        <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach file">📎</button>
        <input
          value={text}
          onChange={(e) => handleTyping(e.target.value)}
          placeholder="Type a message"
        />
        {text.trim() ? (
          <button type="submit">Send</button>
        ) : (
          <button
            type="button"
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onMouseLeave={() => isRecording && stopRecording()}
            style={isRecording ? { background: "#ff6b6b" } : {}}
            title="Hold to record voice note"
          >
            {isRecording ? "● Recording" : "🎤"}
          </button>
        )}
      </form>
    </div>
  );
}
