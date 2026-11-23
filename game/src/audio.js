// Audio (design §11). Written fresh 2026-11-24 (Builder B).
// Web Audio oscillators + noise only, no files. Context is created lazily
// on the first user gesture (play/update after interaction), so screenshot
// staging without a gesture stays silent and error-free.
export function createAudio() {
  let ctx = null;
  let muted = false;
  let engineOsc = null;
  let engineGain = null;
  let engineFilter = null;

  function ensureContext() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function tone(freq, duration, type = 'sine', gain = 0.12, slideTo = null) {
    const c = ensureContext();
    if (!c || muted) return;
    resume();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), c.currentTime + duration);
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    osc.connect(g).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + duration + 0.02);
  }

  function noiseBurst(duration, gain = 0.2, filterFreq = 1200) {
    const c = ensureContext();
    if (!c || muted) return;
    resume();
    const len = Math.max(1, Math.floor(c.sampleRate * duration));
    const buffer = c.createBuffer(1, len, c.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic noise (seeded LCG) — no Math.random() anywhere in game/.
    let s = 0x9e3779b9;
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s ^ (s >>> 15), s | 1) + 0x6d2b79f5) >>> 0;
      data[i] = (((s >>> 8) & 0xffff) / 32768 - 1) * (1 - i / len);
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    src.connect(filter).connect(g).connect(c.destination);
    src.start();
  }

  function play(name, options = {}) {
    if (muted) return;
    const c = ensureContext();
    if (!c) return;
    switch (name) {
      case 'click':
        tone(660, 0.07, 'square', 0.06);
        break;
      case 'punch':
        noiseBurst(0.12, 0.25, 900);
        tone(120, 0.1, 'sine', 0.18, 60);
        break;
      case 'shot':
        noiseBurst(0.16, 0.3, 2400);
        break;
      case 'siren':
        tone(720, 0.35, 'sine', 0.05, 980);
        break;
      case 'cash':
        tone(880, 0.09, 'sine', 0.1);
        setTimeout(() => tone(1318, 0.14, 'sine', 0.1), 90);
        break;
      case 'mission':
        tone(523, 0.12, 'triangle', 0.1);
        setTimeout(() => tone(784, 0.18, 'triangle', 0.1), 120);
        break;
      case 'engine-start':
        tone(90, 0.3, 'sawtooth', 0.07, 160);
        break;
      default:
        tone(options.freq ?? 440, options.duration ?? 0.1, options.type ?? 'sine', options.gain ?? 0.08);
        break;
    }
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (engineGain && ctx) engineGain.gain.value = muted ? 0 : 0.05;
  }

  function isMuted() { return muted; }

  function update(dt, state) {
    if (muted) return;
    const driving = Boolean(state?.currentVehicle);
    if (!driving) {
      if (engineOsc) {
        try { engineOsc.stop(); } catch { /* already stopped */ }
        engineOsc = null;
        engineGain = null;
        engineFilter = null;
      }
      return;
    }
    const c = ensureContext();
    if (!c) return;
    resume();
    if (!engineOsc) {
      engineOsc = c.createOscillator();
      engineOsc.type = 'sawtooth';
      engineFilter = c.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineGain = c.createGain();
      engineGain.gain.value = 0.045;
      engineOsc.connect(engineFilter).connect(engineGain).connect(c.destination);
      engineOsc.start();
    }
    const speed = Math.abs(state.currentVehicle.speed || 0);
    engineOsc.frequency.setTargetAtTime(55 + speed * 4.5, c.currentTime, 0.08);
  }

  return {
    play,
    setMuted,
    isMuted,
    update,
  };
}
