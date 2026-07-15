// Real end-to-end encryption: RSA-OAEP keypair per user (private key never leaves this device),
// AES-GCM per message. The server only ever sees ciphertext.

function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

export async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"]
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  return { publicKey: JSON.stringify(publicJwk), privateKey: JSON.stringify(privateJwk) };
}

export function savePrivateKey(userId, privateKeyJwk) {
  localStorage.setItem(`privkey:${userId}`, privateKeyJwk);
}
export function loadPrivateKeyRaw(userId) {
  return localStorage.getItem(`privkey:${userId}`);
}
export function saveOwnPublicKey(userId, publicKeyJwk) {
  localStorage.setItem(`pubkey:${userId}`, publicKeyJwk);
}
export function loadOwnPublicKey(userId) {
  return localStorage.getItem(`pubkey:${userId}`);
}

async function importPublicKey(jwkString) {
  const jwk = JSON.parse(jwkString);
  return crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"]);
}
async function importPrivateKey(jwkString) {
  const jwk = JSON.parse(jwkString);
  return crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["decrypt"]);
}

// Encrypt plaintext for a set of recipients: { userId: publicKeyJwkString }
export async function encryptForRecipients(plaintext, recipients) {
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encoded);
  const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);

  const encryptedKeys = {};
  for (const [userId, publicKeyJwk] of Object.entries(recipients)) {
    if (!publicKeyJwk) continue;
    try {
      const pubKey = await importPublicKey(publicKeyJwk);
      const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubKey, rawAesKey);
      encryptedKeys[userId] = bufToBase64(wrapped);
    } catch {
      // recipient has no valid key yet; they simply won't be able to decrypt
    }
  }

  return {
    content: bufToBase64(ciphertext),
    iv: bufToBase64(iv),
    encryptedKeys,
  };
}

// Decrypt a message using this user's private key
export async function decryptMessage(myUserId, message) {
  if (!message.encrypted_keys || !message.iv || !message.content) return null;
  const myEncryptedKey = message.encrypted_keys[myUserId];
  const privJwk = loadPrivateKeyRaw(myUserId);
  if (!myEncryptedKey || !privJwk) return null;

  try {
    const privKey = await importPrivateKey(privJwk);
    const rawAesKey = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privKey, base64ToBuf(myEncryptedKey));
    const aesKey = await crypto.subtle.importKey("raw", rawAesKey, { name: "AES-GCM" }, false, ["decrypt"]);
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(base64ToBuf(message.iv)) },
      aesKey,
      base64ToBuf(message.content)
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    return null;
  }
}
