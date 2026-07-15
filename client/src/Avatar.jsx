import { colorForName } from "./avatarColor";
import { API_URL } from "./api";

export default function Avatar({ name, avatarUrl, size = 42, onClick, showRing }) {
  const fullUrl = avatarUrl ? (avatarUrl.startsWith("http") ? avatarUrl : `${API_URL}${avatarUrl}`) : null;
  const style = {
    width: size,
    height: size,
    fontSize: size * 0.4,
    background: fullUrl ? "transparent" : colorForName(name || "?"),
    cursor: onClick ? "pointer" : "default",
    border: showRing ? "3px solid var(--wa-green-accent)" : "none",
    padding: showRing ? 2 : 0,
  };
  return (
    <div className="avatar" style={style} onClick={onClick}>
      {fullUrl ? (
        <img
          src={fullUrl}
          alt={name}
          style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
        />
      ) : (
        (name || "?").charAt(0).toUpperCase()
      )}
    </div>
  );
}
