// hud.js — HTML/CSS HUD + canvas minimap for Sunline: City of Tides.
// Fresh implementation from design-r3.md section 9.
// createHud(state, world) reuses the DOM index.html already provides
// (title / paused / over screens, #hud fields, #minimap canvas) and only
// creates what is missing. It never mutates gameplay state: it reads
// state and draws. main.js wires the buttons and drives the screens; this
// module syncs the same screens every frame so title / play / paused /
// over always match state.screen, and self-drives via rAF so the HUD also
// stays live in frozen ?shot= mode.
const MAP_SIZE = 220;
const CITY_HALF = 616;

function $(id) {
  if (typeof document === 'undefined') return null;
  return document.getElementById(id);
}

function makeEl(id, tag, parent, text) {
  let el = $(id);
  if (el) return el;
  if (typeof document === 'undefined') return null;
  el = document.createElement(tag || 'div');
  el.id = id;
  if (text !== undefined && text !== null) el.textContent = text;
  (parent || document.body).appendChild(el);
  return el;
}

function fmtClock(t) {
  const h = Math.floor(t) % 24;
  const m = Math.floor((t - Math.floor(t)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fmtTimer(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function starsText(wanted) {
  let out = '';
  for (let i = 0; i < 5; i++) out += i < wanted ? '★' : '☆';
  return out;
}

export function createHud(state, world) {
  const hasDom = typeof document !== 'undefined';
  const els = {};
  if (hasDom) {
    els.hud = $('hud');
    els.healthNum = $('hud-health-num');
    els.healthBar = $('hud-health-bar');
    els.cash = $('hud-cash');
    els.stars = $('hud-stars');
    els.clock = $('hud-clock');
    els.speed = $('hud-speed');
    els.missionBox = $('hud-mission');
    els.missionTitle = $('hud-mission-title');
    els.missionObjective = $('hud-mission-objective');
    els.prompt = $('hud-prompt');
    els.minimap = $('minimap');
    els.banner = $('mission-banner');
    els.dialogue = $('dialogue');
    els.topLeft = $('hud-topleft');
    els.topRight = $('hud-topright');
    els.titleScreen = $('title-screen');
    els.pausedScreen = $('paused-screen');
    els.overScreen = $('over-screen');
    els.continueBtn = $('continue-button');
    // Screens + buttons are NOT in index.html (A's file has screen-title /
    // screen-paused / screen-over instead); this module owns the visible B
    // layer, so build them when missing. main.js wires the buttons.
    if (!els.titleScreen || !els.pausedScreen || !els.overScreen) {
      const mkBtn = (id, label, primary) => {
        let b = $(id);
        if (b) return b;
        b = document.createElement('button');
        b.id = id;
        b.textContent = label;
        b.style.cssText = primary
          ? 'margin-top:14px;padding:12px 34px;font-size:18px;font-weight:800;border-radius:10px;border:none;background:#ffc93c;color:#222;cursor:pointer'
          : 'margin-top:10px;padding:10px 26px;font-size:16px;font-weight:700;border-radius:10px;border:1px solid rgba(255,255,255,0.5);background:rgba(255,255,255,0.16);color:#fff;cursor:pointer';
        return b;
      };
      const mkScreen = (id, title, sub, btns) => {
        let scr = $(id);
        if (scr) return scr;
        scr = document.createElement('div');
        scr.id = id;
        scr.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:40;color:#fff;text-align:center;background:linear-gradient(rgba(10,20,30,0.25),rgba(10,20,30,0.55))';
        const h = document.createElement(title === 'SUNLINE' ? 'h1' : 'h2');
        h.textContent = title;
        h.style.cssText = 'margin:0;font-size:56px;letter-spacing:6px;text-shadow:0 3px 18px rgba(0,0,0,0.7)';
        scr.appendChild(h);
        if (sub) {
          const s = document.createElement('div');
          s.textContent = sub;
          s.style.cssText = 'margin-top:8px;font-size:17px;text-shadow:0 2px 8px rgba(0,0,0,0.7)';
          scr.appendChild(s);
        }
        for (const b of btns) scr.appendChild(b);
        document.body.appendChild(scr);
        return scr;
      };
      const startBtn = mkBtn('start-button', 'Start', true);
      const contBtn = mkBtn('continue-button', 'Continue', false);
      contBtn.style.display = 'none';
      const resumeBtn = mkBtn('resume-button', 'Resume', true);
      const restartBtn = mkBtn('restart-button', 'Restart', false);
      const saveBtn = mkBtn('save-button', 'Save', false);
      const overRestartBtn = mkBtn('over-restart-button', 'Restart', true);
      els.titleScreen = mkScreen('title-screen', 'SUNLINE', 'City of Tides — a coastal story starring Nia Solis', [startBtn, contBtn]);
      const hint = document.createElement('div');
      hint.textContent = 'WASD move / drive · Mouse look · Shift run · Space jump / handbrake · E interact · F punch · Esc pause';
      hint.style.cssText = 'margin-top:16px;font-size:13px;opacity:0.9;text-shadow:0 1px 4px rgba(0,0,0,0.8)';
      els.titleScreen.appendChild(hint);
      els.pausedScreen = mkScreen('paused-screen', 'Paused', '', [resumeBtn, restartBtn, saveBtn]);
      els.overScreen = mkScreen('over-screen', 'Down — but not out', 'Nia is down. A cut of the cash is gone — recover and go again.', [overRestartBtn]);
      els.continueBtn = contBtn;
    }
    // Create the B-layer elements only when index.html lacks them.
    if (!els.banner) {
      els.banner = makeEl('mission-banner', 'div', els.hud || document.body);
      els.banner.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);text-align:center;z-index:30;pointer-events:none';
    }
    if (!els.dialogue) {
      els.dialogue = makeEl('dialogue', 'div', els.hud || document.body);
      els.dialogue.style.cssText = 'position:fixed;bottom:120px;left:50%;transform:translateX(-50%);max-width:640px;text-align:center;z-index:30;pointer-events:none';
    }
    if (!els.topLeft) els.topLeft = makeEl('hud-topleft', 'div', els.hud || document.body);
    if (!els.topRight) els.topRight = makeEl('hud-topright', 'div', els.hud || document.body);
  }

  let last = {};
  let frame = 0;
  let rafOn = false;

  function setText(el, key, value) {
    if (!el) return;
    if (last[key] !== value) {
      last[key] = value;
      el.textContent = value;
    }
  }

  function setDisplay(el, key, value) {
    if (!el) return;
    if (last[key] !== value) {
      last[key] = value;
      el.style.display = value;
    }
  }

  function districtAt(x, z) {
    try {
      if (world && typeof world.districtAt === 'function') return world.districtAt(x, z);
    } catch (e) { /* fall through */ }
    if (z >= 448) return x < 112 ? 'Sunwash Beach' : 'Pelican Marina';
    if (x >= -224 && x <= 224 && z >= -224 && z <= 224) return 'Glassline';
    if (x < -224 && z < -112) return 'Foundry Quay';
    if (Math.abs(x) > 224 && Math.abs(z) > 224) return 'Palm Court';
    return 'Civic Crescent';
  }

  // --- minimap: a DARK street map with BRIGHT road cores ---------------
  function drawMinimap() {
    const canvas = els.minimap;
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const S = MAP_SIZE;
    const scale = S / (CITY_HALF * 2);
    const toX = (x) => (x + CITY_HALF) * scale;
    const toY = (z) => (z + CITY_HALF) * scale;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#0d1822';
    ctx.fillRect(0, 0, S, S);
    // City blocks, slightly lighter than the background.
    ctx.fillStyle = '#16242f';
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        ctx.fillRect(toX(-560 + i * 112) + 2, toY(-560 + j * 112) + 2, 112 * scale - 4, 112 * scale - 4);
      }
    }
    // Ocean band along the south edge.
    ctx.fillStyle = '#0e3a4d';
    ctx.fillRect(0, toY(560), S, S - toY(560));
    // Roads: dark wide bed, then a BRIGHT thick core.
    const roads = (world && world.roads) || [];
    for (const pass of [0, 1]) {
      for (const r of roads) {
        const c = r.coord !== undefined ? r.coord : 0;
        ctx.beginPath();
        if (r.axis === 'ns') { ctx.moveTo(toX(c), 0); ctx.lineTo(toX(c), S); }
        else { ctx.moveTo(0, toY(c)); ctx.lineTo(S, toY(c)); }
        if (pass === 0) { ctx.strokeStyle = '#23394a'; ctx.lineWidth = 7; }
        else { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3.2; }
        ctx.stroke();
      }
    }
    // Downtown outline + coastline.
    ctx.strokeStyle = 'rgba(127,212,193,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(toX(-224), toY(-224), 448 * scale, 448 * scale);
    ctx.strokeStyle = 'rgba(94,200,220,0.9)';
    ctx.beginPath(); ctx.moveTo(0, toY(560)); ctx.lineTo(S, toY(560)); ctx.stroke();
    // Mission target: pulsing yellow diamond.
    const target = state._missionTarget;
    if (target) {
      const pulse = 6 + Math.sin(Date.now() / 280) * 1.5;
      const mx = toX(target.x);
      const my = toY(target.z);
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath();
      ctx.moveTo(mx, my - pulse); ctx.lineTo(mx + pulse, my);
      ctx.lineTo(mx, my + pulse); ctx.lineTo(mx - pulse, my);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#0d1822'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // Police: big red dots with a white ring, so a chase reads at a glance.
    const units = state._policeUnits || [];
    for (const u of units) {
      ctx.beginPath();
      ctx.arc(toX(u.x), toY(u.z), 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3b30';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Player arrow, rotated with heading (north is up).
    const p = state.player.pos;
    const px = toX(p.x);
    const py = toY(p.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(state.player.heading || 0);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#14b8a6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function syncScreens() {
    const screen = state.screen || 'title';
    setDisplay(els.titleScreen, 'titleScreen', screen === 'title' ? 'flex' : 'none');
    setDisplay(els.pausedScreen, 'pausedScreen', screen === 'paused' ? 'flex' : 'none');
    setDisplay(els.overScreen, 'overScreen', screen === 'over' ? 'flex' : 'none');
    setDisplay(els.hud, 'hud', screen === 'play' || screen === 'paused' ? 'block' : 'none');
    // The Continue button appears on the title screen only when a save
    // exists; main.js owns the click, this only toggles visibility.
    if (els.continueBtn) {
      let has = false;
      try { has = !!(typeof localStorage !== 'undefined' && localStorage.getItem('sunline-city-of-tides-save-v1')); } catch (e) { has = false; }
      setDisplay(els.continueBtn, 'continueBtn', screen === 'title' && has ? 'block' : 'none');
    }
  }

  function sync() {
    if (!hasDom) return;
    frame++;
    syncScreens();
    const p = state.player;
    const health = Math.round(p.health);
    setText(els.healthNum, 'healthNum', String(health));
    if (els.healthBar) {
      const w = `${health}%`;
      if (last.healthBarW !== w) { last.healthBarW = w; els.healthBar.style.width = w; }
      const col = health > 50 ? '#37c978' : health > 25 ? '#f5a623' : '#ef4444';
      if (last.healthBarC !== col) { last.healthBarC = col; els.healthBar.style.background = col; }
    }
    setText(els.cash, 'cash', `$${Math.floor(p.cash)}`);
    setText(els.stars, 'stars', starsText(state.wanted || 0));
    setText(els.clock, 'clock', fmtClock(state.timeOfDay || 17.25));
    const driving = !p.onFoot && state.currentVehicle;
    const speedTxt = driving
      ? `${Math.round(Math.abs(state.currentVehicle.speed || 0) * 3.6)} km/h`
      : 'On foot';
    setText(els.speed, 'speed', speedTxt);
    if (els.topLeft) {
      setText(els.topLeft, 'topLeft', `NIA SOLIS · HEALTH ${health}  $${Math.floor(p.cash)}`);
    }
    if (els.topRight) {
      setText(els.topRight, 'topRight', `${starsText(state.wanted || 0)}  ${fmtClock(state.timeOfDay || 17.25)}  ${districtAt(p.pos.x, p.pos.z)}`);
    }
    // Mission banner: title + objective + countdown, both placements.
    const m = state.mission || {};
    const hasMission = !!m.id;
    const bannerTxt = hasMission ? `${m.title} — ${m.objective}` : '';
    const timerTxt = hasMission && state._missionTimeLeft ? `  ·  ${fmtTimer(state._missionTimeLeft)}` : '';
    if (els.banner) {
      setText(els.banner, 'banner', bannerTxt + timerTxt);
      setDisplay(els.banner, 'bannerD', hasMission ? 'block' : 'none');
    }
    if (els.missionBox) {
      setText(els.missionTitle, 'mTitle', hasMission ? m.title : '');
      setText(els.missionObjective, 'mObj', hasMission ? `${m.objective}${timerTxt}` : '');
      setDisplay(els.missionBox, 'mBoxD', hasMission ? 'block' : 'none');
    }
    // Contextual prompt: mission first, then vehicle, then nothing.
    let prompt = '';
    if (state._missionPrompt) prompt = state._missionPrompt;
    else if (driving) prompt = 'E — exit vehicle';
    else {
      try {
        const g = globalThis.__game;
        if (g && g.vehicles && typeof g.vehicles.getNearbyVehicle === 'function' && g.vehicles.getNearbyVehicle()) {
          prompt = 'E — enter vehicle';
        }
      } catch (e) { /* no live game */ }
    }
    setText(els.prompt, 'prompt', prompt);
    setDisplay(els.prompt, 'promptD', prompt ? 'block' : 'none');
    // Dialogue line (missions / combat write state._dialogue).
    const dlg = state._dialogue;
    if (dlg && dlg.text && Date.now() < (dlg.until || 0)) {
      setText(els.dialogue, 'dialogue', dlg.text);
      setDisplay(els.dialogue, 'dialogueD', 'block');
    } else {
      setDisplay(els.dialogue, 'dialogueD', 'none');
    }
    // Minimap every 3rd sync: plenty for a 220px canvas.
    if (frame % 3 === 0) drawMinimap();
  }

  function update() { sync(); }

  function showDialogue(text, ms) {
    state._dialogue = { text, until: Date.now() + (ms || 4500) };
    sync();
  }

  // Self-drive: main.js also calls update() each frame, but the HUD must
  // keep painting in frozen ?shot= mode, where the main loop never steps.
  // Cached writes make a second sync per frame harmless.
  if (hasDom && typeof requestAnimationFrame === 'function' && !rafOn) {
    rafOn = true;
    const loop = () => { sync(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  sync();
  return { update, sync, syncScreens, showDialogue, drawMinimap, els };
}
