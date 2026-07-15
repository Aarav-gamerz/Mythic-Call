import { useState } from "react";
import { api, setToken } from "./api";
import { generateKeyPair, savePrivateKey, saveOwnPublicKey, loadPrivateKeyRaw } from "./crypto";

export default function Auth({ onAuth }) {
  const [step, setStep] = useState("email"); // "email" | "code"
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [isNewUser, setIsNewUser] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  async function sendCode() {
    setError("");
    setLoading(true);
    try {
      const { isNewUser: isNew } = await api.requestCode(email);
      setIsNewUser(isNew);
      setStep("code");
      startCooldown();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function startCooldown() {
    setResendCooldown(30);
    const interval = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          clearInterval(interval);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function handleEmailSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    await sendCode();
  }

  async function handleCodeSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { publicKey, privateKey } = await generateKeyPair();
      const { token, user } = await api.verifyCode(email, code, isNewUser ? username : undefined, publicKey);
      setToken(token);
      if (!loadPrivateKeyRaw(user.id)) {
        savePrivateKey(user.id, privateKey);
        saveOwnPublicKey(user.id, publicKey);
      }
      onAuth(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>MythicCall</h1>
        <p className="subtitle">
          {step === "email" ? "We'll email you a login code" : `Enter the code sent to ${email}`} &middot; end-to-end
          encrypted
        </p>

        {step === "email" && (
          <form onSubmit={handleEmailSubmit}>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
            />
            {error && <div className="error">{error}</div>}
            <button type="submit" disabled={loading}>
              {loading ? "Sending..." : "Send Code"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={handleCodeSubmit}>
            <input
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoFocus
              required
            />
            {isNewUser && (
              <input
                placeholder="Choose a name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            )}
            {error && <div className="error">{error}</div>}
            <button type="submit" disabled={loading}>
              {loading ? "Verifying..." : "Continue"}
            </button>
          </form>
        )}

        {step === "code" && (
          <p className="auth-toggle">
            <button
              type="button"
              className="auth-toggle-btn"
              disabled={resendCooldown > 0}
              onClick={sendCode}
            >
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}
            </button>
            {"  ·  "}
            <button
              type="button"
              className="auth-toggle-btn"
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
            >
              Use a different email
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
