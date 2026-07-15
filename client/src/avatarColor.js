// Deterministic avatar color per username, WhatsApp-ish palette
const PALETTE = [
  "#00a884", "#f15c6d", "#f0b429", "#5b8def", "#a970ff",
  "#ff8a3d", "#26c6da", "#ec4899", "#84cc16", "#f472b6",
];

export function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
