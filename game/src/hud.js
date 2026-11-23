// HUD + minimap (design §11). Written fresh 2026-11-24 (Builder B).
// Replaces main.js's fallback HUD: health bar, cash, wanted stars,
// mission banner, speed, clock, contextual prompts, live 2D minimap.
// Minimap roads are BRIGHT and THICK, police dots BIG (screenshot legibility).
import * as THREE from 'three';

export function createHud(state, world) {
  const healthFill = document.getElementById('health-fill');
  const cashEl = document.getElementById('cash');
  const starsEl = document.getElementById('stars');
  const speedEl = document.getElementById('speed');
  const clockEl = document.getElementById('clock');
  const banner = document.getElementById('mission-banner');
  const bannerTitle = document.getElementById('mission-title');
  const bannerObjective = document.getElementById('mission-objective');
  const promptEl = document.getElementById('prompt');
  const mapCanvas = document.getElementById('minimap');

  const starSpans = [];
  if (starsEl) {
    starsEl.replaceChildren();
    for (let i = 0; i < 5; i++) {
      const star = document.createElement('span');
      star.textContent = '★';
      starsEl.appendChild(star);
      starSpans.push(star);
    }
  }

  let frame = 0;

  function formatClock() {
    const totalMinutes = Math.floor((((state.timeOfDay % 24) + 24) % 24) * 60);
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
  }

  function drawMinimap() {
    if (!mapCanvas) return;
    const ctx = mapCanvas.getContext('2d');
    if (!ctx) return;
    const w = mapCanvas.width;
    const h = mapCanvas.height;
    ctx.clearRect(0, 0, w, h);
    // Dark land so the bright roads read as a street map, not a beige grid
    // (was #1b2b2e with faint blocks — at 142 px it read as a grid).
    ctx.fillStyle = '#0e1a1d';
    ctx.fillRect(0, 0, w, h);

    const size = world.size || 1120;
    const mapX = (x) => ((x + size / 2) / size) * w;
    const mapY = (z) => ((z + size / 2) / size) * h;

    // Beach / ocean strip at the south edge.
    ctx.fillStyle = '#c9a86a';
    ctx.fillRect(0, mapY(560), w, h - mapY(560));
    ctx.fillStyle = '#2e7f96';
    ctx.fillRect(0, mapY(620), w, h - mapY(620));

    // Blocks: a touch lighter than the land, so blocks vs roads separate.
    ctx.fillStyle = 'rgba(64,96,104,0.55)';
    for (const block of world.blocks ?? []) {
      ctx.fillRect(mapX(block.minX), mapY(block.minZ),
        ((block.maxX - block.minX) / size) * w, ((block.maxZ - block.minZ) / size) * h);
    }

    // Roads: dark casing + BRIGHT core. Kept THIN (5/3 px): the first
    // polish pass used 9/6 px, which covered ~half the 180 px canvas and
    // turned the map into a cream grid with dark blocks — the opposite of
    // a street map. Thin bright lines on dark land read as streets.
    ctx.lineCap = 'round';
    for (const pass of [
      { color: '#050d0f', width: 5 },
      { color: '#ffe9a8', width: 3 },
    ]) {
      ctx.strokeStyle = pass.color;
      ctx.lineWidth = pass.width;
      for (const line of world.roadLines ?? []) {
        ctx.beginPath();
        ctx.moveTo(mapX(line), 0);
        ctx.lineTo(mapX(line), h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, mapY(line));
        ctx.lineTo(w, mapY(line));
        ctx.stroke();
      }
    }

    // Traffic dots.
    const g = typeof window !== 'undefined' ? window.__game : null;
    ctx.fillStyle = '#e8795b';
    for (const car of g?.traffic?.cars ?? []) {
      const p = car.group?.position;
      if (p) ctx.fillRect(mapX(p.x) - 2, mapY(p.z) - 2, 4, 4);
    }

    // Mission marker: big gold diamond with dark outline.
    const missionPoint = missionTargetPoint();
    if (missionPoint) {
      const x = mapX(missionPoint.x);
      const y = mapY(missionPoint.z);
      ctx.fillStyle = '#ffd15a';
      ctx.strokeStyle = '#3a2c00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x + 8, y);
      ctx.lineTo(x, y + 8);
      ctx.lineTo(x - 8, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Police dots: BIG red/blue circles with white ring.
    const units = state.police?.units ?? [];
    for (const unit of units) {
      const p = unit.pos ?? unit.group?.position;
      if (!p) continue;
      const x = mapX(p.x);
      const y = mapY(p.z);
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#2c64ff';
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player arrow (rotates with heading) — bigger, with a dark halo so
    // it reads at small size against the bright roads.
    const pos = state.currentVehicle?.pos ?? state.player.pos;
    const heading = state.currentVehicle?.heading ?? state.player.heading;
    ctx.save();
    ctx.translate(mapX(pos.x), mapY(pos.z));
    ctx.rotate(-heading);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0a1416';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(8.5, 8);
    ctx.lineTo(0, 4.5);
    ctx.lineTo(-8.5, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function missionTargetPoint() {
    if (!state.mission?.id) return null;
    const points = world.missionPoints ?? {};
    if (state.mission.stage === 0) {
      const starts = {
        'first-light': 'parcelPickup', 'harbour-receipt': 'marinaCrate',
        'wrong-turn': 'mechanicPickup', 'last-ferry': 'cafeDropoff',
      };
      return points[starts[state.mission.id]] ?? null;
    }
    const dests = {
      'first-light': 'cafeDropoff', 'harbour-receipt': 'workshopDropoff',
      'wrong-turn': 'safehouse', 'last-ferry': 'ferryDock',
    };
    return points[dests[state.mission.id]] ?? null;
  }

  function promptText() {
    const g = typeof window !== 'undefined' ? window.__game : null;
    if (state.screen !== 'play') return '';
    if (state.player.onFoot) {
      if (g?.vehicles?.getNearbyVehicle?.(4)) return 'E — Enter vehicle';
      const points = world.missionPoints ?? {};
      const pos = state.player.pos;
      const starts = ['parcelPickup', 'marinaCrate', 'mechanicPickup', 'cafeDropoff'];
      if (!state.mission?.id || state.mission?.stage === -1) {
        for (const key of starts) {
          const p = points[key];
          if (p && Math.hypot(pos.x - p.x, pos.z - p.z) < 8) return 'E — Start job';
        }
      }
      return '';
    }
    return 'E — Exit vehicle';
  }

  function update() {
    frame += 1;
    if (healthFill) {
      healthFill.style.width = `${THREE.MathUtils.clamp(state.player.health, 0, 100)}%`;
    }
    if (cashEl) cashEl.textContent = `$${Math.max(0, Math.floor(state.player.cash))}`;
    starSpans.forEach((star, i) => star.classList.toggle('filled', i < state.wanted));
    const velocity = state.currentVehicle?.speed ?? Math.hypot(state.player.vel.x, state.player.vel.z);
    if (speedEl) {
      speedEl.textContent = state.currentVehicle
        ? `${Math.round(Math.abs(velocity) * 3.6)} km/h`
        : 'On foot';
    }
    if (clockEl) clockEl.textContent = formatClock();
    const hasMission = Boolean(state.mission?.id || state.mission?.title);
    if (banner) banner.hidden = !hasMission;
    if (bannerTitle) bannerTitle.textContent = state.mission?.title ?? '';
    if (bannerObjective) bannerObjective.textContent = state.mission?.objective ?? '';
    if (promptEl) {
      const text = promptText();
      promptEl.textContent = text;
      promptEl.hidden = !text;
    }
    if (frame % 3 === 0) drawMinimap();
  }

  return {
    update,
    drawMinimap,
    getWeaponState() { return null; },
  };
}
