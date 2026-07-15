// Generates a WhatsApp-style repeating ringtone purely with the Web Audio API — no audio file needed.
let audioCtx = null;
let ringInterval = null;

function playTone(ctx, freq, startTime, duration, volume = 0.15) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = "sine";
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.03);
  gain.gain.linearRampToValueAtTime(volume, startTime + duration - 0.05);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

// A warmer two-note chord played twice in quick succession, then a pause — classic "ring-ring... ring-ring" cadence
function playChordBeep(ctx, startTime) {
  playTone(ctx, 523.25, startTime, 0.18, 0.12); // C5
  playTone(ctx, 659.25, startTime, 0.18, 0.1); // E5
}

export function startRingtone() {
  stopRingtone();
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  function ringOnce() {
    const now = audioCtx.currentTime;
    playChordBeep(audioCtx, now);
    playChordBeep(audioCtx, now + 0.28);
  }

  ringOnce();
  ringInterval = setInterval(ringOnce, 2000);
}

export function stopRingtone() {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
}
