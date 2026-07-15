import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import multer from "multer";
import webpush from "web-push";
import bcrypt from "bcryptjs";
import supabase from "./db.js";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!RESEND_API_KEY) {
  console.warn("WARNING: RESEND_API_KEY not set — login emails will fail to send.");
}

// Sender address: Resend's shared "onboarding@resend.dev" works out of the box
// for testing without owning a domain. For production, verify your own domain
// in Resend and set EMAIL_FROM, e.g. "MythicCall <login@yourdomain.com>".
const EMAIL_FROM = process.env.EMAIL_FROM || "MythicCall <onboarding@resend.dev>";

async function sendLoginCodeEmail(toEmail, code) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [toEmail],
      subject: `${code} is your MythicCall login code`,
      html: `
        <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px">
          <h2 style="color:#7c3aed;margin-bottom:4px">MythicCall</h2>
          <p style="color:#333">Your login code is:</p>
          <div style="font-size:32px;font-weight:700;letter-spacing:6px;background:#f3f0ff;color:#7c3aed;padding:16px;border-radius:10px;text-align:center">${code}</div>
          <p style="color:#888;font-size:13px;margin-top:16px">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend error (${res.status}): ${body}`);
  }
}

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails("mailto:admin@mythiccall.app", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("WARNING: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications to offline users are disabled.");
}

async function sendPushToUser(userId, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("Push skipped: VAPID keys not configured");
    return;
  }
  const { data: subs, error: fetchErr } = await supabase.from("push_subscriptions").select("*").eq("user_id", userId);
  if (fetchErr) {
    console.error("Push: failed to fetch subscriptions", fetchErr);
    return;
  }
  if (!subs || subs.length === 0) {
    console.log(`Push: no subscriptions found for user ${userId} (they may not have enabled notifications)`);
    return;
  }
  for (const sub of subs) {
    const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      console.log(`Push sent successfully to user ${userId}`);
    } catch (err) {
      console.error(`Push failed for user ${userId}:`, err.statusCode, err.body || err.message);
      if (err.statusCode === 404 || err.statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const PORT = process.env.PORT || 4000;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

async function uploadToStorage(file) {
  const ext = file.originalname.includes(".") ? file.originalname.split(".").pop() : "";
  const filename = `${uuid()}${ext ? "." + ext : ""}`;
  const { error } = await supabase.storage.from("uploads").upload(filename, file.buffer, {
    contentType: file.mimetype,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("uploads").getPublicUrl(filename);
  return data.publicUrl;
}

// ---------- Auth helpers ----------
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });
  try {
    const token = header.split(" ")[1];
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ---------- Auth routes ----------
app.get("/api/me", authMiddleware, async (req, res) => {
  const { data: user, error } = await supabase
    .from("users")
    .select("id, username, email, avatar")
    .eq("id", req.userId)
    .maybeSingle();
  if (error || !user) return res.status(401).json({ error: "Session invalid" });
  res.json({ user });
});

app.post("/api/auth/request-code", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) return res.status(400).json({ error: "Email is required" });
  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: "Enter a valid email address" });

  const { data: existingUser } = await supabase
    .from("users")
    .select("id")
    .ilike("email", cleanEmail)
    .maybeSingle();

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const { error } = await supabase
    .from("email_codes")
    .upsert({ email: cleanEmail, code, expires_at: Date.now() + 10 * 60 * 1000, attempts: 0 });
  if (error) return res.status(500).json({ error: error.message });

  try {
    await sendLoginCodeEmail(cleanEmail, code);
  } catch (err) {
    console.error("Failed to send login email:", err.message);
    return res.status(500).json({ error: "Couldn't send the email. Try again in a moment." });
  }

  res.json({ sent: true, isNewUser: !existingUser });
});

app.post("/api/auth/verify-code", async (req, res) => {
  const { email, code, username, publicKey } = req.body;
  if (!email || !email.trim()) return res.status(400).json({ error: "Email is required" });
  if (!code || !code.trim()) return res.status(400).json({ error: "Enter the code from your email" });
  const cleanEmail = email.trim().toLowerCase();

  const { data: record, error: codeErr } = await supabase
    .from("email_codes")
    .select("*")
    .eq("email", cleanEmail)
    .maybeSingle();

  if (codeErr || !record) return res.status(401).json({ error: "Request a new code first" });
  if (Date.now() > record.expires_at) return res.status(401).json({ error: "Code expired. Request a new one." });
  if (record.attempts >= 5) return res.status(401).json({ error: "Too many attempts. Request a new code." });

  if (record.code !== code.trim()) {
    await supabase.from("email_codes").update({ attempts: record.attempts + 1 }).eq("email", cleanEmail);
    return res.status(401).json({ error: "Wrong code" });
  }

  // Code is correct — clear it so it can't be reused
  await supabase.from("email_codes").delete().eq("email", cleanEmail);

  const { data: existingUser } = await supabase
    .from("users")
    .select("id, username, email, public_key")
    .ilike("email", cleanEmail)
    .maybeSingle();

  let user = existingUser;

  if (user && !user.public_key && publicKey) {
    await supabase.from("users").update({ public_key: publicKey }).eq("id", user.id);
    user.public_key = publicKey;
  }

  if (!user) {
    if (!username || !username.trim()) return res.status(400).json({ error: "Name is required for a new account" });
    const cleanName = username.trim();
    const { data: nameTaken } = await supabase
      .from("users")
      .select("id")
      .ilike("username", cleanName)
      .maybeSingle();
    if (nameTaken) return res.status(409).json({ error: "That name is already taken. Pick another." });

    const id = uuid();
    const { error: insertErr } = await supabase
      .from("users")
      .insert({ id, username: cleanName, email: cleanEmail, public_key: publicKey || null, created_at: Date.now() });
    if (insertErr) return res.status(500).json({ error: insertErr.message });
    user = { id, username: cleanName, email: cleanEmail, public_key: publicKey || null };
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email }, publicKey: user.public_key });
});

// ---------- User / contacts ----------
app.get("/api/users", authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id, username, public_key, avatar")
    .neq("id", req.userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Get public keys for all members of a chat (needed to encrypt messages for them)
app.get("/api/chats/:chatId/keys", authMiddleware, async (req, res) => {
  const { chatId } = req.params;
  const { data: member } = await supabase
    .from("chat_members")
    .select("*")
    .eq("chat_id", chatId)
    .eq("user_id", req.userId)
    .maybeSingle();
  if (!member) return res.status(403).json({ error: "Not a member of this chat" });

  const { data: members } = await supabase.from("chat_members").select("user_id").eq("chat_id", chatId);
  const userIds = (members || []).map((m) => m.user_id);
  const { data: users } = await supabase.from("users").select("id, public_key").in("id", userIds);
  res.json(users || []);
});

// ---------- Push notifications ----------
app.get("/api/push/vapid-public-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY || null });
});

app.post("/api/push/subscribe", authMiddleware, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: "Invalid subscription" });
  await supabase.from("push_subscriptions").upsert(
    {
      id: uuid(),
      user_id: req.userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      created_at: Date.now(),
    },
    { onConflict: "endpoint" }
  );
  res.json({ ok: true });
});

app.post("/api/push/unsubscribe", authMiddleware, async (req, res) => {
  const { endpoint } = req.body;
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  res.json({ ok: true });
});

// ---------- Profile ----------
app.post("/api/profile/avatar", authMiddleware, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const url = await uploadToStorage(req.file);
    await supabase.from("users").update({ avatar: url }).eq("id", req.userId);
    res.json({ avatarUrl: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Status / Stories ----------
app.post("/api/status", authMiddleware, async (req, res) => {
  const { content, mediaUrl, mediaType } = req.body;
  if (!content && !mediaUrl) return res.status(400).json({ error: "Status needs text or media" });
  const id = uuid();
  const now = Date.now();
  const { error } = await supabase.from("statuses").insert({
    id,
    user_id: req.userId,
    content: content || null,
    media_url: mediaUrl || null,
    media_type: mediaType || null,
    created_at: now,
    expires_at: now + 24 * 60 * 60 * 1000,
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ id });
});

app.get("/api/status", authMiddleware, async (req, res) => {
  const now = Date.now();
  const { data: statuses, error: statusErr } = await supabase
    .from("statuses")
    .select("*")
    .gt("expires_at", now)
    .order("created_at", { ascending: false });

  if (statusErr) {
    console.error("Failed to fetch statuses:", statusErr);
    return res.status(500).json({ error: statusErr.message });
  }

  const userIds = [...new Set((statuses || []).map((s) => s.user_id))];
  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("id, username")
    .in("id", userIds.length ? userIds : ["-"]);

  if (usersErr) console.error("Failed to fetch status authors:", usersErr);

  const { data: views } = await supabase.from("status_views").select("status_id, viewer_id");

  const byUser = {};
  (statuses || []).forEach((s) => {
    if (!byUser[s.user_id]) {
      const author = (users || []).find((u) => u.id === s.user_id);
      byUser[s.user_id] = { userId: s.user_id, username: author?.username || "Unknown", items: [] };
    }
    byUser[s.user_id].items.push({
      ...s,
      viewedByMe: (views || []).some((v) => v.status_id === s.id && v.viewer_id === req.userId),
    });
  });
  res.json(Object.values(byUser));
});

app.post("/api/status/:statusId/view", authMiddleware, async (req, res) => {
  await supabase
    .from("status_views")
    .upsert({ status_id: req.params.statusId, viewer_id: req.userId }, { onConflict: "status_id,viewer_id" });
  res.json({ ok: true });
});

// ---------- Archive chats ----------
app.post("/api/chats/:chatId/archive", authMiddleware, async (req, res) => {
  const { archived } = req.body;
  await supabase
    .from("chat_members")
    .update({ archived: !!archived })
    .eq("chat_id", req.params.chatId)
    .eq("user_id", req.userId);
  res.json({ ok: true });
});

// Get or create a 1:1 chat with another user
app.post("/api/chats/direct", authMiddleware, async (req, res) => {
  const { otherUserId } = req.body;
  const myId = req.userId;

  const { data: myChats } = await supabase.from("chat_members").select("chat_id").eq("user_id", myId);
  const { data: theirChats } = await supabase.from("chat_members").select("chat_id").eq("user_id", otherUserId);
  const shared = (myChats || []).map((c) => c.chat_id).filter((id) => (theirChats || []).some((t) => t.chat_id === id));

  if (shared.length > 0) {
    const { data: existingChats } = await supabase.from("chats").select("id").in("id", shared).eq("is_group", false);
    if (existingChats && existingChats.length > 0) return res.json({ chatId: existingChats[0].id });
  }

  const chatId = uuid();
  await supabase.from("chats").insert({ id: chatId, is_group: false, created_at: Date.now() });
  await supabase.from("chat_members").insert([
    { chat_id: chatId, user_id: myId },
    { chat_id: chatId, user_id: otherUserId },
  ]);
  res.json({ chatId });
});

// List my chats with last message preview
app.get("/api/chats", authMiddleware, async (req, res) => {
  const { data: myMemberships } = await supabase
    .from("chat_members")
    .select("chat_id, archived")
    .eq("user_id", req.userId);

  const chatIds = (myMemberships || []).map((m) => m.chat_id);
  if (chatIds.length === 0) return res.json([]);

  const { data: chats } = await supabase.from("chats").select("*").in("id", chatIds);

  const result = await Promise.all(
    (chats || []).map(async (chat) => {
      const { data: memberRows } = await supabase.from("chat_members").select("user_id").eq("chat_id", chat.id).neq("user_id", req.userId);
      const memberIds = (memberRows || []).map((m) => m.user_id);
      const { data: members } = await supabase.from("users").select("id, username, avatar").in("id", memberIds.length ? memberIds : ["-"]);

      const { data: lastMsgs } = await supabase
        .from("messages")
        .select("content, created_at, media_type, deleted")
        .eq("chat_id", chat.id)
        .order("created_at", { ascending: false })
        .limit(1);

      const membership = myMemberships.find((m) => m.chat_id === chat.id);

      return {
        id: chat.id,
        isGroup: !!chat.is_group,
        archived: !!membership?.archived,
        name: chat.name || (members || []).map((m) => m.username).join(", "),
        members: members || [],
        lastMessage: lastMsgs?.[0] || null,
      };
    })
  );

  res.json(result);
});

// Create a group chat
app.post("/api/chats/group", authMiddleware, async (req, res) => {
  const { name, memberIds } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Group name is required" });
  if (!Array.isArray(memberIds) || memberIds.length === 0)
    return res.status(400).json({ error: "Pick at least one member" });

  const chatId = uuid();
  await supabase.from("chats").insert({ id: chatId, is_group: true, name: name.trim(), created_at: Date.now() });
  const allMembers = [...new Set([req.userId, ...memberIds])];
  await supabase.from("chat_members").insert(allMembers.map((uid) => ({ chat_id: chatId, user_id: uid })));

  res.json({ chatId });
});

// Upload media (image, file, voice note)
app.post("/api/upload", authMiddleware, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const url = await uploadToStorage(req.file);
    const mediaType = req.file.mimetype.startsWith("image/")
      ? "image"
      : req.file.mimetype.startsWith("audio/")
      ? "audio"
      : "file";
    res.json({ url, mediaType, filename: req.file.originalname });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search messages within a chat
app.get("/api/chats/:chatId/search", authMiddleware, async (req, res) => {
  const { chatId } = req.params;
  const { q } = req.query;
  const { data: member } = await supabase
    .from("chat_members")
    .select("*")
    .eq("chat_id", chatId)
    .eq("user_id", req.userId)
    .maybeSingle();
  if (!member) return res.status(403).json({ error: "Not a member of this chat" });
  if (!q) return res.json([]);

  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .eq("deleted", false)
    .ilike("content", `%${q}%`)
    .order("created_at", { ascending: true });
  res.json(data || []);
});

app.get("/api/chats/:chatId/messages", authMiddleware, async (req, res) => {
  const { chatId } = req.params;
  const { data: member } = await supabase
    .from("chat_members")
    .select("*")
    .eq("chat_id", chatId)
    .eq("user_id", req.userId)
    .maybeSingle();
  if (!member) return res.status(403).json({ error: "Not a member of this chat" });

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  const messageIds = (messages || []).map((m) => m.id);
  const { data: reactions } = await supabase
    .from("reactions")
    .select("*")
    .in("message_id", messageIds.length ? messageIds : ["-"]);

  const withReactions = (messages || []).map((m) => ({
    ...m,
    content: m.deleted ? "This message was deleted" : m.content,
    encrypted_keys: m.encrypted_keys ? JSON.parse(m.encrypted_keys) : null,
    reactions: (reactions || []).filter((r) => r.message_id === m.id),
  }));

  res.json(withReactions);
});

// ---------- Socket.io real-time layer ----------
const onlineUsers = new Map(); // userId -> socketId
const pendingCalls = new Map(); // userId -> { fromUserId, callerName, chatId, offer, callType, timestamp, callerSocketId }
const PENDING_CALL_TTL = 45000; // how long an offline call "rings" before giving up

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userId = payload.userId;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.userId;
  onlineUsers.set(userId, socket.id);
  io.emit("presence", { userId, online: true });

  // If someone tried to call this user while they were offline, deliver it now (if still within the ring window)
  const pending = pendingCalls.get(userId);
  if (pending && Date.now() - pending.timestamp < PENDING_CALL_TTL) {
    pendingCalls.delete(userId);
    io.to(socket.id).emit("incoming_call", {
      fromUserId: pending.fromUserId,
      callerName: pending.callerName,
      chatId: pending.chatId,
      offer: pending.offer,
      callType: pending.callType,
    });
  } else if (pending) {
    pendingCalls.delete(userId);
  }

  (async () => {
    const { data: myChats } = await supabase.from("chat_members").select("chat_id").eq("user_id", userId);
    (myChats || []).forEach((c) => socket.join(c.chat_id));
  })();

  socket.on("send_message", async ({ chatId, content, replyToId, mediaUrl, mediaType, iv, encryptedKeys }) => {
    const { data: member } = await supabase
      .from("chat_members")
      .select("*")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) return;

    const { data: otherMembers } = await supabase
      .from("chat_members")
      .select("user_id")
      .eq("chat_id", chatId)
      .neq("user_id", userId);
    const anyoneOnline = (otherMembers || []).some((m) => onlineUsers.has(m.user_id));

    const message = {
      id: uuid(),
      chat_id: chatId,
      sender_id: userId,
      content: content || "",
      created_at: Date.now(),
      status: anyoneOnline ? "delivered" : "sent",
      reply_to_id: replyToId || null,
      media_url: mediaUrl || null,
      media_type: mediaType || null,
      deleted: false,
      iv: iv || null,
      encrypted_keys: encryptedKeys ? JSON.stringify(encryptedKeys) : null,
    };
    await supabase.from("messages").insert(message);

    io.to(chatId).emit("new_message", { ...message, reactions: [], encrypted_keys: encryptedKeys || null });

    // notify offline members with a push notification (server can't read encrypted content, so keep it generic)
    const { data: sender } = await supabase.from("users").select("username").eq("id", userId).maybeSingle();
    const offlineMembers = (otherMembers || []).filter((m) => !onlineUsers.has(m.user_id));
    for (const m of offlineMembers) {
      sendPushToUser(m.user_id, {
        title: sender?.username || "MythicCall",
        body: mediaType ? "Sent you a " + mediaType : "Sent you a message",
        chatId,
      }).catch(() => {});
    }
  });

  socket.on("delete_message", async ({ messageId, chatId }) => {
    const { data: msg } = await supabase.from("messages").select("sender_id").eq("id", messageId).maybeSingle();
    if (!msg || msg.sender_id !== userId) return;
    await supabase.from("messages").update({ deleted: true, content: "" }).eq("id", messageId);
    io.to(chatId).emit("message_deleted", { messageId, chatId });
  });

  socket.on("mark_read", async ({ chatId }) => {
    const { data: unread } = await supabase
      .from("messages")
      .select("id")
      .eq("chat_id", chatId)
      .neq("sender_id", userId)
      .neq("status", "read");
    if (!unread || unread.length === 0) return;
    await supabase.from("messages").update({ status: "read" }).eq("chat_id", chatId).neq("sender_id", userId);
    io.to(chatId).emit("messages_read", { chatId, messageIds: unread.map((m) => m.id) });
  });

  socket.on("react", async ({ messageId, chatId, emoji }) => {
    await supabase
      .from("reactions")
      .upsert({ message_id: messageId, user_id: userId, emoji }, { onConflict: "message_id,user_id" });
    io.to(chatId).emit("reaction_updated", { messageId, userId, emoji });
  });

  socket.on("call_user", ({ toUserId, chatId, offer, callType, callerName }) => {
    const targetSocketId = onlineUsers.get(toUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit("incoming_call", {
        fromUserId: userId,
        callerName,
        chatId,
        offer,
        callType,
      });
      return;
    }

    // Target is offline — queue the call and wake them with a push notification.
    // If they open the app within PENDING_CALL_TTL, they'll still see this call ringing.
    pendingCalls.set(toUserId, {
      fromUserId: userId,
      callerName,
      chatId,
      offer,
      callType,
      timestamp: Date.now(),
      callerSocketId: socket.id,
    });

    sendPushToUser(toUserId, {
      title: `Incoming ${callType === "video" ? "video" : "voice"} call`,
      body: `${callerName} is calling you`,
      chatId,
      isCall: true,
    }).catch(() => {});

    io.to(socket.id).emit("call_pending", { toUserId });

    setTimeout(() => {
      const pending = pendingCalls.get(toUserId);
      if (pending && pending.timestamp === pendingCalls.get(toUserId)?.timestamp && !onlineUsers.has(toUserId)) {
        pendingCalls.delete(toUserId);
        io.to(socket.id).emit("call_failed", { reason: "No answer" });
      }
    }, PENDING_CALL_TTL);
  });

  socket.on("call_answer", ({ toUserId, answer }) => {
    const targetSocketId = onlineUsers.get(toUserId);
    if (targetSocketId) io.to(targetSocketId).emit("call_answered", { answer, fromUserId: userId });
  });

  socket.on("ice_candidate", ({ toUserId, candidate }) => {
    const targetSocketId = onlineUsers.get(toUserId);
    if (targetSocketId) io.to(targetSocketId).emit("ice_candidate", { candidate, fromUserId: userId });
  });

  socket.on("call_reject", ({ toUserId }) => {
    const targetSocketId = onlineUsers.get(toUserId);
    if (targetSocketId) io.to(targetSocketId).emit("call_rejected", { fromUserId: userId });
  });

  socket.on("call_end", ({ toUserId }) => {
    pendingCalls.delete(toUserId);
    const targetSocketId = onlineUsers.get(toUserId);
    if (targetSocketId) io.to(targetSocketId).emit("call_ended", { fromUserId: userId });
  });

  socket.on("join_chat", async ({ chatId }) => {
    const { data: member } = await supabase
      .from("chat_members")
      .select("*")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .maybeSingle();
    if (member) socket.join(chatId);
  });

  socket.on("typing", ({ chatId, isTyping }) => {
    socket.to(chatId).emit("typing", { chatId, userId, isTyping });
  });

  socket.on("disconnect", () => {
    onlineUsers.delete(userId);
    io.emit("presence", { userId, online: false });
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://0.0.0.0:${PORT}`));
