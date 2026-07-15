import { useEffect, useRef, useState } from "react";
import Auth from "./Auth.jsx";
import ChatList from "./ChatList.jsx";
import ChatWindow from "./ChatWindow.jsx";
import Contacts from "./Contacts.jsx";
import { api, connectSocket, disconnectSocket, getToken, clearToken, getSocket } from "./api";
import CallOverlay from "./CallOverlay.jsx";
import Avatar from "./Avatar.jsx";
import StatusBar from "./StatusBar.jsx";
import Settings from "./Settings.jsx";
import MythicAIPanel from "./MythicAIPanel.jsx";
import InstallPrompt from "./InstallPrompt.jsx";
import { loadSavedTheme, loadSavedWallpaper } from "./Settings.jsx";
import { requestNotificationPermission, showMessageNotification, registerPushNotifications } from "./notifications";
import { decryptMessage } from "./crypto";

const MYTHIC_AI_URL = "https://aarav-ai.onrender.com/";

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [showContacts, setShowContacts] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [typingUsers, setTypingUsers] = useState(new Map()); // chatId -> boolean
  const [showArchived, setShowArchived] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMythicAI, setShowMythicAI] = useState(false);
  const avatarInputRef = useRef(null);

  // Restore session from existing token on load, instead of always showing the login screen
  useEffect(() => {
    loadSavedTheme();
    loadSavedWallpaper();
    const token = getToken();
    if (!token) {
      setCheckingSession(false);
      return;
    }
    api
      .getMe()
      .then(({ user }) => setUser(user))
      .catch(() => clearToken())
      .finally(() => setCheckingSession(false));
  }, []);

  const chatsRef = useRef([]);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    if (!user) return;
    const socket = connectSocket();

    socket.on("presence", ({ userId, online }) => {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        online ? next.add(userId) : next.delete(userId);
        return next;
      });
    });

    socket.on("typing", ({ chatId, isTyping }) => {
      setTypingUsers((prev) => {
        const next = new Map(prev);
        if (isTyping) next.set(chatId, true);
        else next.delete(chatId);
        return next;
      });
    });

    socket.on("new_message", async (msg) => {
      refreshChats();
      if (msg.sender_id === user.id) return; // don't notify yourself
      let body = "New message";
      if (msg.media_url) {
        body = msg.media_type === "image" ? "📷 Photo" : msg.media_type === "audio" ? "🎤 Voice note" : "📎 File";
      } else {
        const plain = await decryptMessage(user.id, msg);
        body = plain !== null ? plain : "New message";
      }
      const senderChat = chatsRef.current.find((c) => c.id === msg.chat_id);
      const senderName = senderChat?.members?.find((m) => m.id === msg.sender_id)?.username || senderChat?.name || "MythicCall";
      showMessageNotification({
        title: senderName,
        body,
        onClick: () => setActiveChatId(msg.chat_id),
      });
    });

    refreshChats();

    return () => disconnectSocket();
  }, [user?.id]); // only reconnect on actual login/logout, not on profile field updates (avatar, etc.)

  useEffect(() => {
    if (user) {
      requestNotificationPermission().then((granted) => {
        if (granted) registerPushNotifications(api);
      });
    }
  }, [user?.id]);

  function refreshChats() {
    api.getChats().then(setChats).catch(console.error);
  }

  function handleAuth(userData) {
    setUser(userData);
  }

  function handleLogout() {
    clearToken();
    disconnectSocket();
    setUser(null);
    setChats([]);
    setActiveChatId(null);
  }

  async function handleStartChat(otherUserId) {
    const { chatId } = await api.createDirectChat(otherUserId);
    setShowContacts(false);
    await refreshChats();
    setActiveChatId(chatId);
    getSocket()?.emit("join_chat", { chatId });
  }

  async function handleStartGroup(name, memberIds) {
    const { chatId } = await api.createGroupChat(name, memberIds);
    setShowContacts(false);
    await refreshChats();
    setActiveChatId(chatId);
    getSocket()?.emit("join_chat", { chatId });
  }

  async function handleAvatarSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const { avatarUrl } = await api.uploadAvatar(file);
    setUser((prev) => ({ ...prev, avatar: avatarUrl }));
    e.target.value = "";
  }

  async function toggleArchive(chatId, archived) {
    await api.setArchived(chatId, archived);
    refreshChats();
  }

  if (checkingSession) {
    return (
      <div className="auth-screen">
        <div style={{ color: "var(--wa-text-dim)" }}>Loading...</div>
      </div>
    );
  }

  if (!user) return <Auth onAuth={handleAuth} />;

  const activeChat = chats.find((c) => c.id === activeChatId);
  const visibleChats = chats.filter((c) => !!c.archived === showArchived);

  return (
    <div className="app">
      <InstallPrompt />
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="me">
            <input type="file" accept="image/*" ref={avatarInputRef} style={{ display: "none" }} onChange={handleAvatarSelected} />
            <Avatar name={user.username} avatarUrl={user.avatar} onClick={() => avatarInputRef.current?.click()} />
            <span>{user.username}</span>
          </div>
          <div className="sidebar-actions">
            <button onClick={() => setShowContacts(true)}>+</button>
            <button onClick={() => setShowSettings(true)} title="Settings">⚙</button>
            <button className="logout-btn" onClick={handleLogout}>Logout</button>
          </div>
        </div>

        <StatusBar currentUser={user} />

        <div
          className="chat-list-item"
          onClick={() => setShowMythicAI(true)}
          style={{ borderBottom: "1px solid var(--wa-border)" }}
        >
          <div className="avatar" style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}>✨</div>
          <div className="chat-info">
            <div className="chat-name">Mythic AI</div>
            <div className="chat-preview">Chat with AI, generate images, and more</div>
          </div>
        </div>

        <div style={{ display: "flex", borderBottom: "1px solid var(--wa-border)" }}>
          <button
            className="close-btn"
            style={{ flex: 1, borderRadius: 0, background: !showArchived ? "var(--wa-panel-light)" : "transparent" }}
            onClick={() => setShowArchived(false)}
          >
            Chats
          </button>
          <button
            className="close-btn"
            style={{ flex: 1, borderRadius: 0, background: showArchived ? "var(--wa-panel-light)" : "transparent" }}
            onClick={() => setShowArchived(true)}
          >
            Archived
          </button>
        </div>

        <ChatList
          chats={visibleChats}
          activeChatId={activeChatId}
          onSelect={setActiveChatId}
          onlineUsers={onlineUsers}
          onToggleArchive={toggleArchive}
        />
      </div>

      <ChatWindow chat={activeChat} currentUser={user} typingUsers={typingUsers} />
      <CallOverlay currentUser={user} />

      {showContacts && (
        <Contacts
          onClose={() => setShowContacts(false)}
          onStartChat={handleStartChat}
          onStartGroup={handleStartGroup}
          initialGroupMode={showContacts === "group"}
        />
      )}

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showMythicAI && <MythicAIPanel url={MYTHIC_AI_URL} onClose={() => setShowMythicAI(false)} />}
    </div>
  );
}
