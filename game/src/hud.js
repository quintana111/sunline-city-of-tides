// DOM HUD + 2D minimap for Sunline: City of Tides. Drives the existing
// index.html elements purely from shared state on every update() call, so the
// HUD is correct even in ?shot= mode (frozen sim, HUD still synced).
// Wanted stars are rebuilt once and toggled every frame — a previous build
// showed the clock but no stars at wanted 3; that path is unconditional here.
export function createHud(state, world) {
  const get = (id) => document.getElementById(id);
  const hud = get('hud');
  const healthFill = get('health-fill');
  const cash = get('cash');
  const stars = get('stars');
  const speed = get('speed');
  const clock = get('clock');
  const missionBanner = get('mission-banner');
  const missionTitle = get('mission-title');
  const missionObjective = get('mission-objective');
  const prompt = get('prompt');
  const minimap = get('minimap');

  let timer = missionBanner?.querySelector?.('.mission-timer') ?? null;
  if (missionBanner && !timer) {
    timer = document.createElement('div');
    timer.className = 'mission-timer';
    timer.style.color = '#f4c56c';
    timer.style.fontWeight = '750';
    timer.style.marginTop = '4px';
    timer.style.fontVariantNumeric = 'tabular-nums';
    missionBanner.appendChild(timer);
  }

  function makePanel(id, className, styles) {
    let element = get(id);
    if (!element) {
      element = document.createElement('div');
      element.id = id;
      element.className = className;
      Object.assign(element.style, styles);
      document.body.appendChild(element);
    }
    return element;
  }

  const dialogue = makePanel('dialogue', 'dialogue-panel', {
    position: 'fixed',
    left: '50%',
    bottom: '205px',
    transform: 'translateX(-50%)',
    maxWidth: 'min(620px, 80vw)',
    padding: '12px 18px',
    color: '#fff2ce',
    background: 'rgba(12, 25, 29, 0.92)',
    border: '1px solid rgba(245, 236, 210, 0.45)',
    borderRadius: '4px',
    font: '15px/1.45 sans-serif',
    zIndex: '20',
  });

  const toast = makePanel('toast', 'hud-toast', {
    position: 'fixed',
    top: '90px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '8px 14px',
    color: '#fff2ce',
    background: 'rgba(12, 25, 29, 0.9)',
    border: '1px solid rgba(245, 236, 210, 0.4)',
    borderRadius: '4px',
    font: '14px sans-serif',
    zIndex: '21',
  });

  let starsBuilt = false;
  function buildStars() {
    if (!stars || starsBuilt) return;
    stars.replaceChildren();
    for (let i = 0; i < 5; i += 1) {
      const star = document.createElement('span');
      star.textContent = '★';
      stars.appendChild(star);
    }
    starsBuilt = true;
  }

  function syncContinueButton() {
    const titleScreen = get('title-screen');
    if (!titleScreen) return;
    let button = get('continue-button');
    let hasSave = false;
    try {
      hasSave = !!localStorage.getItem('sunline-save-v1');
    } catch {
      hasSave = false;
    }

    if (!hasSave) {
      button?.remove();
      return;
    }
    if (button) return;

    const card =
      titleScreen.querySelector?.('.title-card, #title-card, .card') ?? titleScreen;
    button = document.createElement('button');
    button.id = 'continue-button';
    button.className = 'secondary';
    button.textContent = 'Continue';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const saveModule = await import('./save.js');
        await saveModule.loadGame(state, world);
        state.screen = 'play';
      } catch {
        button.remove();
      }
    });
    card.appendChild(button);
  }

  function updateClock() {
    if (!clock) return;
    let hours = Number(state.timeOfDay);
    if (!Number.isFinite(hours)) hours = 0;
    hours = ((hours % 24) + 24) % 24;
    const totalMinutes = Math.floor(hours * 60);
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    clock.textContent = `${hh}:${mm}`;
  }

  function updateMission() {
    const mission = state.mission ?? {};
    const active = !!(mission.id || mission.title);
    if (missionBanner) missionBanner.hidden = !active;
    if (missionTitle) missionTitle.textContent = mission.title ?? '';
    if (missionObjective) missionObjective.textContent = mission.objective ?? '';

    if (timer) {
      const hasTimer = active && Number.isFinite(mission.timeLeft);
      timer.hidden = !hasTimer;
      if (hasTimer) {
        const seconds = Math.max(0, Math.ceil(mission.timeLeft));
        const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
        const ss = String(seconds % 60).padStart(2, '0');
        timer.textContent = `⏱ ${mm}:${ss}`;
      }
    }

    const message = mission.message;
    dialogue.hidden = !message;
    dialogue.replaceChildren();
    if (message) {
      const speaker = document.createElement('b');
      speaker.textContent = `${message.speaker || 'Mara'}: `;
      const text = document.createElement('span');
      text.textContent = message.text ?? '';
      dialogue.append(speaker, text);
    }

    const toastText = mission.toast ?? '';
    toast.hidden = !toastText;
    toast.textContent = toastText;
  }

  function updatePrompt() {
    if (!prompt) return;
    let text = '';
    if (state.currentVehicle) {
      text = 'E — Exit vehicle';
    } else if (state.player?.onFoot) {
      let nearby = null;
      try {
        nearby = window.__game?.vehicles?.getNearbyVehicle?.(4) ?? null;
      } catch {
        nearby = null;
      }
      if (nearby) {
        text = 'E — Enter vehicle';
      } else if (!(state.mission?.id || state.mission?.title)) {
        const p = state.player?.pos;
        const points = Object.values(world?.missionPoints ?? {});
        const nearJob = p && points.some((point) =>
          point &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.z) &&
          Math.hypot(point.x - p.x, point.z - p.z) <= 6,
        );
        if (nearJob) text = 'E — Start job';
      }
    }
    prompt.textContent = text;
    prompt.hidden = !text;
  }

  function drawMinimap() {
    if (!minimap) return;
    const ctx = minimap.getContext?.('2d');
    if (!ctx) return;

    const width = minimap.width || 180;
    const height = minimap.height || 180;
    const size = Number.isFinite(world?.size) && world.size > 0 ? world.size : 1120;
    const half = size / 2;
    const mapX = (x) => ((x + half) / size) * width;
    const mapY = (z) => ((z + half) / size) * height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#142329';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(205,178,133,.13)';
    for (const block of world?.blocks ?? []) {
      if (!block) continue;
      const x1 = mapX(block.minX);
      const y1 = mapY(block.minZ);
      const x2 = mapX(block.maxX);
      const y2 = mapY(block.maxZ);
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    }

    // Roads: dark casing first, then a bright core — the old minimap read as a
    // "blank grid" because its roads were thin and dim. These must be visible.
    for (const road of world?.roadLines ?? []) {
      if (!Number.isFinite(road)) continue;
      const x = mapX(road);
      const y = mapY(road);
      ctx.beginPath();
      ctx.strokeStyle = '#23343a';
      ctx.lineWidth = 8;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = '#f5ecd2';
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const car of window.__game?.traffic?.cars ?? []) {
      const p = car?.group?.position;
      if (!p) continue;
      ctx.fillStyle = '#e8795b';
      ctx.fillRect(mapX(p.x) - 1.5, mapY(p.z) - 1.5, 3, 3);
    }

    const policeUnits = window.__game?.police?.units ?? state.policeUnits ?? [];
    // Flash keyed to game time (deterministic; frozen in shot mode).
    const phase = ((Math.floor((Number(state.timeOfDay) || 0) * 86400) % 2) + 2) % 2;
    for (const unit of policeUnits) {
      const p = unit?.pos ?? unit?.vehicle?.pos ?? unit?.group?.position;
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(mapX(p.x), mapY(p.z), 7, 0, Math.PI * 2);
      ctx.fillStyle = phase ? '#ff8a70' : '#e34a40';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }

    const mission = state.mission ?? {};
    const marker = mission.marker ??
      ((mission.id || mission.title) ? world?.missionPoints?.cafeDropoff : null);
    if (marker && Number.isFinite(marker.x) && Number.isFinite(marker.z)) {
      const x = mapX(marker.x);
      const y = mapY(marker.z);
      ctx.beginPath();
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 7, y);
      ctx.lineTo(x, y + 7);
      ctx.lineTo(x - 7, y);
      ctx.closePath();
      ctx.fillStyle = '#ffd15a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }

    const vehicle = state.currentVehicle;
    const pos = vehicle?.pos ?? state.player?.pos;
    if (pos) {
      const heading = vehicle?.heading ?? state.player?.heading ?? 0;
      ctx.save();
      ctx.translate(mapX(pos.x), mapY(pos.z));
      ctx.rotate(-heading);
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fillStyle = '#fff2ce';
      ctx.fill();
      ctx.restore();
    }
  }

  function update() {
    if (hud) hud.hidden = state.screen === 'title' || state.screen === 'over';

    const titleScreen = get('title-screen');
    const pauseScreen = get('pause-screen');
    const overScreen = get('over-screen');
    if (titleScreen) titleScreen.hidden = state.screen !== 'title';
    if (pauseScreen) pauseScreen.hidden = state.screen !== 'paused';
    if (overScreen) overScreen.hidden = state.screen !== 'over';

    const health = Number.isFinite(state.player?.health) ? state.player.health : 100;
    if (healthFill) healthFill.style.width = `${Math.max(0, Math.min(100, health))}%`;
    if (cash) cash.textContent = `$${state.player?.cash ?? 0}`;

    buildStars();
    if (stars) {
      const wanted = Math.max(0, Math.min(5, Math.floor(Number(state.wanted) || 0)));
      [...stars.children].forEach((star, index) => {
        star.classList.toggle('filled', index < wanted);
      });
    }

    if (speed) {
      if (state.currentVehicle) {
        speed.textContent = `${Math.round(Math.abs(state.currentVehicle.speed ?? 0) * 3.6)} km/h`;
      } else {
        speed.textContent = state.player?.onFoot ? 'On foot' : '0 km/h';
      }
    }

    updateClock();
    updateMission();
    updatePrompt();
    drawMinimap();
    syncContinueButton();
  }

  return {
    update,
    setMessage(text) {
      state.mission ??= {};
      state.mission.message = { speaker: 'Mara', text };
    },
    showToast(text) {
      state.mission ??= {};
      state.mission.toast = text;
    },
  };
}
