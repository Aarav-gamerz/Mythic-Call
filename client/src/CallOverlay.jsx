import { useEffect, useRef, useState } from "react";
import { getSocket, connectSocket } from "./api";
import { startRingtone, stopRingtone } from "./ringtone";
import { showCallNotification } from "./notifications";

// STUN alone fails whenever both people are behind restrictive NATs (common on mobile data).
// These free TURN servers (Open Relay Project) act as a relay fallback so calls still connect.
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
};

// call = { status: 'calling' | 'ringing' | 'connected', callType, otherUserId, otherName, chatId }
export default function CallOverlay({ currentUser }) {
  const [call, setCall] = useState(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const pendingCandidatesRef = useRef([]); // candidates that arrived before remote description was set
  const remoteDescSetRef = useRef(false);

  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return;

    function handleIncoming({ fromUserId, callerName, chatId, offer, callType }) {
      pendingOfferRef.current = offer;
      pendingCandidatesRef.current = [];
      remoteDescSetRef.current = false;
      startRingtone();
      showCallNotification({ callerName, callType, onClick: () => {} });
      setCall({ status: "ringing", callType, otherUserId: fromUserId, otherName: callerName, chatId });
    }

    async function handleAnswered({ answer }) {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        remoteDescSetRef.current = true;
        await flushPendingCandidates();
      }
      stopRingtone();
      setCall((prev) => (prev ? { ...prev, status: "connecting" } : prev));
    }

    async function flushPendingCandidates() {
      const queued = pendingCandidatesRef.current;
      pendingCandidatesRef.current = [];
      for (const candidate of queued) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          /* ignore invalid candidate */
        }
      }
    }

    async function handleIceCandidate({ candidate }) {
      if (!candidate) return;
      if (pcRef.current && remoteDescSetRef.current) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          /* ignore */
        }
      } else {
        // remote description not set yet — queue it and apply once it is
        pendingCandidatesRef.current.push(candidate);
      }
    }

    function handleRejected() {
      stopRingtone();
      cleanup();
      setCall(null);
    }

    function handleEnded() {
      stopRingtone();
      cleanup();
      setCall(null);
    }

    function handleFailed({ reason }) {
      stopRingtone();
      cleanup();
      setCall(null);
      alert(reason || "Call failed");
    }

    function handlePending() {
      setCall((prev) => (prev ? { ...prev, status: "calling", waking: true } : prev));
    }

    socket.on("incoming_call", handleIncoming);
    socket.on("call_answered", handleAnswered);
    socket.on("ice_candidate", handleIceCandidate);
    socket.on("call_rejected", handleRejected);
    socket.on("call_ended", handleEnded);
    socket.on("call_failed", handleFailed);
    socket.on("call_pending", handlePending);

    return () => {
      socket.off("incoming_call", handleIncoming);
      socket.off("call_answered", handleAnswered);
      socket.off("ice_candidate", handleIceCandidate);
      socket.off("call_rejected", handleRejected);
      socket.off("call_ended", handleEnded);
      socket.off("call_failed", handleFailed);
      socket.off("call_pending", handlePending);
    };
  }, []);

  useEffect(() => {
    if (call?.status !== "connected" || !remoteStreamRef.current) return;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
      remoteVideoRef.current.play().catch((err) => console.error("Remote video play blocked:", err));
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
      remoteAudioRef.current.play().catch((err) => console.error("Remote audio play blocked:", err));
    }
  }, [call?.status]);

  function cleanup() {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pendingOfferRef.current = null;
    pendingCandidatesRef.current = [];
    remoteDescSetRef.current = false;
    remoteStreamRef.current = null;
  }

  async function createPeerConnection(otherUserId) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        getSocket().emit("ice_candidate", { toUserId: otherUserId, candidate: e.candidate });
      }
    };
    pc.ontrack = (e) => {
      remoteStreamRef.current = e.streams[0];
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0];
        remoteVideoRef.current.play().catch((err) => console.error("Remote video play blocked:", err));
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0];
        remoteAudioRef.current.play().catch((err) => console.error("Remote audio play blocked:", err));
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setCall((prev) => (prev ? { ...prev, status: "connected" } : prev));
      }
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        // give it a moment in case it's a brief network blip, otherwise end the call
        setTimeout(() => {
          if (pcRef.current === pc && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) {
            hangUp();
          }
        }, 4000);
      }
    };
    pcRef.current = pc;
    return pc;
  }

  // Exposed globally so ChatWindow's call buttons can trigger it without prop drilling
  useEffect(() => {
    window.__startCall = async (otherUserId, otherName, chatId, callType) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: callType === "video",
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        pendingCandidatesRef.current = [];
        remoteDescSetRef.current = false;
        const pc = await createPeerConnection(otherUserId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        getSocket().emit("call_user", {
          toUserId: otherUserId,
          chatId,
          offer,
          callType,
          callerName: currentUser.username,
        });

        setCall({ status: "calling", callType, otherUserId, otherName, chatId });
      } catch (err) {
        alert("Could not access camera/microphone. Check browser permissions.");
      }
    };
    return () => {
      delete window.__startCall;
    };
  }, [currentUser]);

  async function acceptCall() {
    stopRingtone();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: call.callType === "video",
      });
    } catch (err) {
      alert("Could not access camera/microphone. Check browser permissions.");
      rejectCall();
      return;
    }

    try {
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = await createPeerConnection(call.otherUserId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current));
      remoteDescSetRef.current = true;

      const queued = pendingCandidatesRef.current;
      pendingCandidatesRef.current = [];
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          /* ignore */
        }
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      getSocket().emit("call_answer", { toUserId: call.otherUserId, answer });
      setCall((prev) => ({ ...prev, status: "connecting" }));
    } catch (err) {
      console.error("Call setup failed after media access succeeded:", err);
      alert("Call failed: " + (err.message || "unknown error") + " — check the browser console for details.");
      rejectCall();
    }
  }

  function rejectCall() {
    stopRingtone();
    getSocket().emit("call_reject", { toUserId: call.otherUserId });
    cleanup();
    setCall(null);
  }

  function hangUp() {
    if (call) getSocket().emit("call_end", { toUserId: call.otherUserId });
    stopRingtone();
    cleanup();
    setCall(null);
  }

  if (!call) return null;

  return (
    <div className="call-overlay">
      {call.status === "ringing" && (
        <div className="call-card">
          <div className="avatar call-avatar">{call.otherName?.charAt(0).toUpperCase()}</div>
          <div className="call-name">{call.otherName}</div>
          <div className="call-status">Incoming {call.callType === "video" ? "video" : "voice"} call...</div>
          <div className="call-actions">
            <button className="call-btn reject" onClick={rejectCall}>✕ Decline</button>
            <button className="call-btn accept" onClick={acceptCall}>✓ Accept</button>
          </div>
        </div>
      )}

      {call.status === "calling" && (
        <div className="call-card">
          <div className="avatar call-avatar">{call.otherName?.charAt(0).toUpperCase()}</div>
          <div className="call-name">{call.otherName}</div>
          <div className="call-status">{call.waking ? "Ringing their phone..." : "Calling..."}</div>
          <div className="call-actions">
            <button className="call-btn reject" onClick={hangUp}>✕ Cancel</button>
          </div>
        </div>
      )}

      {call.status === "connecting" && (
        <div className="call-card">
          <div className="avatar call-avatar">{call.otherName?.charAt(0).toUpperCase()}</div>
          <div className="call-name">{call.otherName}</div>
          <div className="call-status">Connecting...</div>
          <div className="call-actions">
            <button className="call-btn reject" onClick={hangUp}>✕ End call</button>
          </div>
        </div>
      )}

      {call.status === "connected" && (
        <div className="call-active">
          {call.callType !== "video" && <audio ref={remoteAudioRef} autoPlay />}
          {call.callType === "video" && (
            <>
              <video ref={remoteVideoRef} autoPlay playsInline className="remote-video" />
              <video ref={localVideoRef} autoPlay playsInline muted className="local-video" />
            </>
          )}
          {call.callType !== "video" && (
            <div className="call-card">
              <div className="avatar call-avatar">{call.otherName?.charAt(0).toUpperCase()}</div>
              <div className="call-name">{call.otherName}</div>
              <div className="call-status">Connected</div>
            </div>
          )}
          <button className="call-btn reject hangup-btn" onClick={hangUp}>✕ End call</button>
        </div>
      )}
    </div>
  );
}
