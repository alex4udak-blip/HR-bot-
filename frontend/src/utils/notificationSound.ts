/**
 * Notification sound: a short synthesized chime that plays ONLY for a new anketa
 * (form_submitted). No audio asset is bundled — it's two sine notes via Web Audio.
 *
 * Browser autoplay policy blocks sound until a user gesture, so call unlockAudio()
 * once on app mount; it resumes/creates the AudioContext on the first pointer/key
 * event. Until then playAnketaChime() is a safe no-op.
 */
import { getLocalStorage, setLocalStorage } from './localStorage';

const MUTE_KEY = 'anketa_sound_muted';

export function isAnketaSoundMuted(): boolean {
  return getLocalStorage<boolean>(MUTE_KEY, false);
}

export function setAnketaSoundMuted(muted: boolean): void {
  setLocalStorage<boolean>(MUTE_KEY, muted);
}

let ctx: AudioContext | null = null;

function getAudioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

/** Resume/create the AudioContext on the user's first gesture, then self-remove. */
export function unlockAudio(): void {
  const AC = getAudioCtor();
  if (!AC) return;
  const unlock = () => {
    try {
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      /* ignore */
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Soft two-note chime (A5 -> D6). No-op if muted or audio isn't available/unlocked. */
export function playAnketaChime(): void {
  if (isAnketaSoundMuted()) return;
  const AC = getAudioCtor();
  if (!AC) return;
  try {
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const notes = [
      { freq: 880, start: 0 }, // A5
      { freq: 1174.66, start: 0.12 }, // D6
    ];
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.freq;
      const t0 = now + note.start;
      const dur = 0.16;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.015); // soft attack (no click)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); // gentle release
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  } catch {
    /* ignore — never let a chime break the notification flow */
  }
}
