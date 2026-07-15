import { io } from "socket.io-client";

export const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:4000`;

export function getToken() {
  return localStorage.getItem("token");
}

export function setToken(token) {
  localStorage.setItem("token", token);
}

export function clearToken() {
  localStorage.removeItem("token");
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const api = {
  requestCode: (email) =>
    request("/api/auth/request-code", { method: "POST", body: JSON.stringify({ email }) }),
  verifyCode: (email, code, username, publicKey) =>
    request("/api/auth/verify-code", { method: "POST", body: JSON.stringify({ email, code, username, publicKey }) }),
  getMe: () => request("/api/me"),
  getUsers: () => request("/api/users"),
  getChats: () => request("/api/chats"),
  createDirectChat: (otherUserId) =>
    request("/api/chats/direct", { method: "POST", body: JSON.stringify({ otherUserId }) }),
  createGroupChat: (name, memberIds) =>
    request("/api/chats/group", { method: "POST", body: JSON.stringify({ name, memberIds }) }),
  getMessages: (chatId) => request(`/api/chats/${chatId}/messages`),
  getChatKeys: (chatId) => request(`/api/chats/${chatId}/keys`),
  searchMessages: (chatId, q) => request(`/api/chats/${chatId}/search?q=${encodeURIComponent(q)}`),
  uploadFile: async (file) => {
    const token = getToken();
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_URL}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  },
  uploadAvatar: async (file) => {
    const token = getToken();
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_URL}/api/profile/avatar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  },
  createStatus: (content, mediaUrl, mediaType) =>
    request("/api/status", { method: "POST", body: JSON.stringify({ content, mediaUrl, mediaType }) }),
  getStatuses: () => request("/api/status"),
  viewStatus: (statusId) => request(`/api/status/${statusId}/view`, { method: "POST" }),
  setArchived: (chatId, archived) =>
    request(`/api/chats/${chatId}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  getVapidPublicKey: () => request("/api/push/vapid-public-key"),
  subscribePush: (subscription) =>
    request("/api/push/subscribe", { method: "POST", body: JSON.stringify(subscription) }),
};

let socket = null;

export function connectSocket() {
  const token = getToken();
  if (!token) return null;
  if (socket) return socket;
  socket = io(API_URL, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
