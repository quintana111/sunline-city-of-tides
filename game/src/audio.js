// Procedural audio for Sunline: City of Tides — Web Audio oscillators and
// noise only, no audio files. Lazy init after a user gesture; every call is
// best-effort and never throws.
export function createAudio() {
  let context = null;
  let master = null;
  let muted = false;
  let gestureSeen = false;
  let siren = null;
  let sirenPhase = 0;
  let engine = null;

  const markGesture = (event) => {
    if (!event || event.isTrusted !== false) gestureSeen = true;
  };

  try {
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', markGesture, { capture: true, passive: true });
      window.addEventListener('keydown', markGesture, { capture: true, passive: true });
      window.addEventListener('touchstart', markGesture, { capture: true, passive: true });
    }
  } catch {
    // Gesture detection is best-effort in non-browser environments.
  }

  function ensureContext() {
    if (context) return context;
    if (!gestureSeen) return null;
    try {
      const AudioContextClass =
        (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
        (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext));
      if (!AudioContextClass) return null;
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(context.destination);
      return context;
    } catch {
      context = null;
      master = null;
      return null;
    }
  }

  function makeNoise(duration, volume, rate) {
    try {
      if (!context || !master) return;
      const sampleRate = context.sampleRate || 44100;
      const length = Math.max(1, Math.floor(sampleRate * duration));
      const buffer = context.createBuffer(1, length, sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const seed = Math.sin((i + 1) * 12.9898) * 43758.5453;
        const noise = (seed - Math.floor(seed)) * 2 - 1;
        samples[i] = noise * (1 - t) * Math.min(1, t * 30);
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      gain.gain.setValueAtTime(volume, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration / rate);
      source.connect(gain);
      gain.connect(master);
      source.start();
      source.stop(context.currentTime + duration / rate + 0.01);
    } catch {
      // Audio playback is best-effort.
    }
  }

  function makeTone(frequency, waveform, duration, volume, rate, endFrequency) {
    try {
      if (!context || !master) return;
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = waveform;
      oscillator.frequency.setValueAtTime(Math.max(1, frequency * rate), now);
      if (Number.isFinite(endFrequency)) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency * rate), now + duration / rate);
      }
      gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration / rate);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now);
      oscillator.stop(now + duration / rate + 0.01);
    } catch {
      // Audio playback is best-effort.
    }
  }

  function startSiren() {
    if (!context || !master || siren) return;
    try {
      const now = context.currentTime;
      const lowOsc = context.createOscillator();
      const highOsc = context.createOscillator();
      const lowGain = context.createGain();
      const highGain = context.createGain();
      lowOsc.type = 'sine';
      highOsc.type = 'sine';
      lowOsc.frequency.value = 700;
      highOsc.frequency.value = 950;
      lowGain.gain.value = 0.05;
      highGain.gain.value = 0;
      lowOsc.connect(lowGain);
      highOsc.connect(highGain);
      lowGain.connect(master);
      highGain.connect(master);
      lowOsc.start(now);
      highOsc.start(now);
      siren = { lowOsc, highOsc, lowGain, highGain };
      sirenPhase = 0;
    } catch {
      stopSiren();
    }
  }

  function stopSiren() {
    if (!siren) return;
    try {
      const now = context ? context.currentTime : 0;
      siren.lowOsc.stop(now);
      siren.highOsc.stop(now);
      siren.lowGain.disconnect();
      siren.highGain.disconnect();
    } catch {
      // Nodes may already have stopped.
    }
    siren = null;
  }

  function startEngine() {
    if (!context || !master || engine) return;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = 60;
      gain.gain.value = 0.03;
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start();
      engine = { oscillator, gain };
    } catch {
      stopEngine();
    }
  }

  function stopEngine() {
    if (!engine) return;
    try {
      engine.oscillator.stop();
      engine.gain.disconnect();
    } catch {
      // Nodes may already have stopped.
    }
    engine = null;
  }

  function play(name, options = {}) {
    try {
      if (!gestureSeen) return;
      const ctx = ensureContext();
      if (!ctx || !master) return;
      if (ctx.state === 'suspended') {
        try {
          const resumed = ctx.resume?.();
          if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
        } catch {
          return;
        }
      }
      const volume = Number.isFinite(options.volume) ? Math.max(0, Math.min(1, options.volume)) : 1;
      const rate = Number.isFinite(options.rate) ? Math.max(0.1, Math.min(4, options.rate)) : 1;
      if (volume === 0) return;
      switch (name) {
        case 'click':
          makeTone(880, 'square', 0.06, 0.12 * volume, rate);
          break;
        case 'punch':
          makeTone(120, 'triangle', 0.12, 0.45 * volume, rate);
          makeNoise(0.12, 0.35 * volume, rate);
          break;
        case 'shot':
          makeNoise(0.15, 0.55 * volume, rate);
          makeTone(180, 'square', 0.15, 0.32 * volume, rate, 55);
          break;
        case 'pickup':
          makeTone(660, 'sine', 0.18, 0.2 * volume, rate, 990);
          break;
        case 'complete':
          makeTone(523, 'sine', 0.5, 0.18 * volume, rate);
          makeTone(659, 'sine', 0.42, 0.15 * volume, rate);
          makeTone(784, 'sine', 0.34, 0.12 * volume, rate);
          break;
        default:
          break;
      }
    } catch {
      // Audio playback is best-effort.
    }
  }

  function setMuted(value) {
    muted = Boolean(value);
    try {
      if (master) master.gain.setValueAtTime(muted ? 0 : 1, context.currentTime);
    } catch {
      // Audio may not have been initialized yet.
    }
  }

  function update(dt, state) {
    try {
      if (!state) {
        try {
          state = typeof window !== 'undefined' ? window.__game?.state : null;
        } catch {
          state = null;
        }
      }
      if (!context || context.state === 'suspended') return;
      const wanted = Number.isFinite(state?.wanted) && state.wanted > 0;
      if (wanted) {
        startSiren();
        if (siren) {
          sirenPhase += Number.isFinite(dt) && dt > 0 ? dt : 0;
          const highTone = (sirenPhase % 1) >= 0.5;
          const now = context.currentTime;
          siren.lowGain.gain.setValueAtTime(highTone ? 0 : 0.05, now);
          siren.highGain.gain.setValueAtTime(highTone ? 0.05 : 0, now);
        }
      } else {
        stopSiren();
      }
      if (state?.currentVehicle) {
        startEngine();
        if (engine) {
          const speed = Number.isFinite(state.currentVehicle.speed) ? state.currentVehicle.speed : 0;
          engine.oscillator.frequency.setValueAtTime(Math.max(1, 60 + speed * 4), context.currentTime);
        }
      } else {
        stopEngine();
      }
    } catch {
      // Audio updates are best-effort.
    }
  }

  // Called by main.js when the player starts the game (a user gesture):
  // unlock audio now that a gesture has happened.
  function start() {
    gestureSeen = true;
    try {
      const ctx = ensureContext();
      ctx?.resume?.()?.catch?.(() => {});
    } catch {
      // Audio is best-effort.
    }
  }

  return {
    play,
    setMuted,
    update,
    start,
    isMuted() {
      return muted;
    },
  };
}
