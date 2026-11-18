// Procedural WebAudio sounds for Sunline: City of Tides. Oscillators and
// filtered noise only — no audio files, no network. The AudioContext is
// created lazily on first play() (a user gesture is required by browsers);
// every method silently no-ops when audio is unavailable.
export function createAudio() {
  let context = null;
  let muted = false;
  let engineOscillator = null;
  let engineFilter = null;
  let engineGain = null;
  let noiseBuffer = null;

  function getContext() {
    if (context) return context;
    try {
      const AudioContextClass =
        globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) return null;
      context = new AudioContextClass();
      return context;
    } catch {
      return null;
    }
  }

  function disconnectOnEnd(source, nodes) {
    source.onended = () => {
      try {
        source.disconnect();
        for (const node of nodes) node.disconnect();
      } catch {
        // Nodes may already have been disconnected by the browser.
      }
    };
  }

  function makeEnvelope(ctx, gainNode, volume, duration, attack = 0.008) {
    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(volume, now + attack);
    gainNode.gain.setValueAtTime(volume, now + Math.max(attack, duration * 0.55));
    gainNode.gain.linearRampToValueAtTime(0, now + duration);
  }

  function tone(frequency, duration, volume, type = 'sine', endFrequency = frequency) {
    const ctx = getContext();
    if (!ctx || muted) return;

    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
      if (endFrequency !== frequency) {
        oscillator.frequency.linearRampToValueAtTime(
          endFrequency,
          ctx.currentTime + duration,
        );
      }
      makeEnvelope(ctx, gain, volume, duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + duration + 0.02);
      disconnectOnEnd(oscillator, [gain]);
    } catch {
      // Audio is optional; fail silently when the browser rejects playback.
    }
  }

  function getNoiseBuffer(ctx) {
    if (noiseBuffer) return noiseBuffer;
    try {
      const sampleRate = ctx.sampleRate || 44100;
      const length = Math.max(1, Math.floor(sampleRate * 0.12));
      const buffer = ctx.createBuffer(1, length, sampleRate);
      const samples = buffer.getChannelData(0);
      // Deterministic pseudo-noise (fixed seed), so bursts sound identical.
      let seed = 0x51f15e;
      for (let i = 0; i < length; i++) {
        seed = (seed * 16807) % 2147483647;
        samples[i] = (seed / 1073741823.5) - 1;
      }
      noiseBuffer = buffer;
      return noiseBuffer;
    } catch {
      return null;
    }
  }

  function noiseBurst(duration, volume, cutoff) {
    const ctx = getContext();
    if (!ctx || muted) return;

    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const buffer = getNoiseBuffer(ctx);
      if (!buffer) return;

      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      source.buffer = buffer;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, ctx.currentTime);
      makeEnvelope(ctx, gain, volume, duration, 0.004);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      source.start();
      source.stop(ctx.currentTime + duration);
      disconnectOnEnd(source, [filter, gain]);
    } catch {
      // Audio is optional; fail silently.
    }
  }

  function play(name, options = {}) {
    if (muted || name === 'engine') return;
    const volume = Math.max(
      0,
      Math.min(1, Number.isFinite(options?.volume) ? options.volume : 0.5),
    );
    if (volume === 0) return;

    try {
      switch (name) {
        case 'click':
          tone(880, 0.05, volume * 0.35);
          break;

        case 'punch':
          noiseBurst(0.08, volume * 0.5, 1400);
          break;

        case 'shot':
          noiseBurst(0.11, volume * 0.65, 2800);
          tone(180, 0.12, volume * 0.6, 'sine', 90);
          break;

        case 'siren': {
          const ctx = getContext();
          if (!ctx) return;
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          const start = ctx.currentTime;
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(660, start);
          for (let i = 0; i < 6; i++) {
            oscillator.frequency.setValueAtTime(i % 2 === 0 ? 880 : 660, start + i * 0.15);
          }
          makeEnvelope(ctx, gain, volume * 0.28, 0.9, 0.04);
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start();
          oscillator.stop(start + 0.92);
          disconnectOnEnd(oscillator, [gain]);
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
          break;
        }

        case 'pickup':
          tone(660, 0.12, volume * 0.38);
          tone(990, 0.16, volume * 0.38);
          break;

        case 'complete':
          tone(523.25, 0.18, volume * 0.38);
          tone(659.25, 0.2, volume * 0.38);
          tone(783.99, 0.28, volume * 0.42);
          break;

        default:
          break;
      }
    } catch {
      // Never let audio failures interrupt game logic.
    }
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (!engineGain || !context) return;
    try {
      const now = context.currentTime;
      engineGain.gain.cancelScheduledValues(now);
      engineGain.gain.setTargetAtTime(muted ? 0 : 0.04, now, 0.04);
    } catch {
      // No-op if the context has been closed.
    }
  }

  function update(dt, state) {
    if (!context || muted) {
      if (context && engineGain) {
        try {
          engineGain.gain.setTargetAtTime(0, context.currentTime, 0.06);
        } catch {
          // No-op.
        }
      }
      return;
    }

    try {
      const gameState = state || globalThis.window?.__game?.state;
      if (!gameState) return;

      if (!engineOscillator) {
        engineOscillator = context.createOscillator();
        engineFilter = context.createBiquadFilter();
        engineGain = context.createGain();
        engineOscillator.type = 'sawtooth';
        engineFilter.type = 'lowpass';
        engineFilter.frequency.setValueAtTime(520, context.currentTime);
        engineGain.gain.setValueAtTime(0, context.currentTime);
        engineOscillator.connect(engineFilter);
        engineFilter.connect(engineGain);
        engineGain.connect(context.destination);
        engineOscillator.start();
      }

      const vehicle = gameState.currentVehicle;
      const speed = vehicle && Number.isFinite(vehicle.speed)
        ? Math.abs(vehicle.speed)
        : 0;
      const active = Boolean(vehicle && speed > 1);
      const now = context.currentTime;

      if (active) {
        engineOscillator.frequency.setTargetAtTime(
          60 + speed * 4,
          now,
          0.05,
        );
        engineGain.gain.setTargetAtTime(0.04, now, 0.06);
      } else {
        engineGain.gain.setTargetAtTime(0, now, 0.08);
      }
    } catch {
      // Audio is optional; fail silently.
    }
  }

  return {
    play,
    setMuted,
    update,
    isMuted: () => muted,
  };
}
