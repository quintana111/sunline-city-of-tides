// audio.js — Web Audio oscillators / noise only, no audio files.
// Fresh implementation from design-r3.md section 9.
// Nothing is created until a user gesture: createAudio() only builds the
// context on resume()/play(), and update() stays silent until then.
let ctx = null;
let master = null;
let muted = false;
let sirenNodes = null;
let engineNodes = null;
let sirenOn = false;
let engineOn = false;

function ensureCtx() {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
  return ctx;
}

function tone(freq, dur, type, gain, slideTo, delay) {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + (delay || 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain || 0.2, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

let noiseSeed = 0x12345678;
function noiseSample() {
  noiseSeed ^= noiseSeed << 13; noiseSeed ^= noiseSeed >>> 17; noiseSeed ^= noiseSeed << 5;
  return ((noiseSeed >>> 0) / 4294967296) * 2 - 1;
}
function noiseBurst(dur, filterFreq, gain, type) {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = noiseSample() * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = type || 'lowpass';
  filter.frequency.value = filterFreq || 1200;
  const g = c.createGain();
  g.gain.setValueAtTime(gain || 0.25, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t0);
}

const RECIPES = {
  click: () => tone(660, 0.07, 'square', 0.12),
  start: () => { tone(392, 0.14, 'triangle', 0.2); tone(523, 0.14, 'triangle', 0.2, null, 0.12); tone(659, 0.22, 'triangle', 0.22, null, 0.24); },
  enter: () => tone(180, 0.16, 'sine', 0.25, 90),
  exit: () => tone(140, 0.14, 'sine', 0.22, 220),
  jump: () => tone(280, 0.18, 'sine', 0.18, 620),
  punch: () => noiseBurst(0.12, 500, 0.35),
  shoot: () => { noiseBurst(0.09, 3200, 0.3, 'highpass'); tone(220, 0.1, 'square', 0.14, 60); },
  hit: () => tone(110, 0.2, 'sine', 0.3, 55),
  pickup: () => { tone(880, 0.1, 'sine', 0.18); tone(1318, 0.16, 'sine', 0.18, null, 0.09); },
  cash: () => { tone(988, 0.09, 'sine', 0.16); tone(1319, 0.14, 'sine', 0.16, null, 0.08); },
  complete: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.2, null, i * 0.11)); },
  fail: () => { [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'triangle', 0.18, null, i * 0.16)); },
  arrest: () => { tone(700, 0.16, 'square', 0.12); tone(520, 0.2, 'square', 0.12, null, 0.16); },
  horn: () => tone(370, 0.32, 'sawtooth', 0.12, 360),
  pause: () => tone(440, 0.1, 'sine', 0.14),
};

function play(name, options) {
  if (muted) return false;
  const c = ensureCtx();
  if (!c) return false;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const recipe = RECIPES[name];
  if (recipe) recipe(options);
  else tone(520, 0.08, 'sine', 0.1); // unknown name: soft blip, never an error
  return true;
}

function setMuted(value) {
  muted = !!value;
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
  return muted;
}

function resume() {
  const c = ensureCtx();
  if (c && c.state === 'suspended') return c.resume().catch(() => {});
  return Promise.resolve();
}

// Looping layers, driven from update(): a two-tone siren while wanted and
// a low engine hum while driving. Both fade to silence when inactive.
function setSiren(on) {
  const c = ensureCtx();
  if (!c) return;
  if (on && !sirenNodes) {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 720;
    const g = c.createGain();
    g.gain.value = 0;
    osc.connect(g);
    g.connect(master);
    osc.start();
    sirenNodes = { osc, g, t: 0 };
  }
  sirenOn = on;
}

function setEngine(on, speed) {
  const c = ensureCtx();
  if (!c) return;
  if (on && !engineNodes) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 70;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const g = c.createGain();
    g.gain.value = 0;
    osc.connect(filter);
    filter.connect(g);
    g.connect(master);
    osc.start();
    engineNodes = { osc, g, filter };
  }
  engineOn = on;
  if (engineNodes) {
    const s = speed || 0;
    engineNodes.osc.frequency.setTargetAtTime(60 + s * 4, c.currentTime, 0.1);
    engineNodes.g.gain.setTargetAtTime(on ? 0.05 + Math.min(0.06, s * 0.002) : 0, c.currentTime, 0.15);
  }
}

function update(dt, state) {
  if (!ctx) return; // never created: stay silent until a gesture
  if (!state) {
    try { state = globalThis.__game ? globalThis.__game.state : null; } catch (e) { state = null; }
  }
  if (!state) return;
  const wanted = state.wanted || 0;
  const driving = !!(state.currentVehicle || (state.player && !state.player.onFoot));
  setSiren(wanted > 0 && state.screen === 'play');
  if (sirenNodes) {
    sirenNodes.t += dt || 0.016;
    const hi = Math.floor(sirenNodes.t / 0.45) % 2 === 0;
    sirenNodes.osc.frequency.setTargetAtTime(hi ? 720 : 540, ctx.currentTime, 0.05);
    sirenNodes.g.gain.setTargetAtTime(sirenOn && !muted ? 0.045 : 0, ctx.currentTime, 0.1);
  }
  const speed = state.currentVehicle ? Math.abs(state.currentVehicle.speed || 0) : 0;
  setEngine(driving && state.screen === 'play', speed);
}

export function createAudio() {
  return { play, setMuted, update, resume, get muted() { return muted; } };
}

export { play, setMuted, update, resume };
