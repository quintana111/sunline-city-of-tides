// HUD for Sunline: City of Tides — drives the index.html HUD ids every
// update() from state alone; canvas minimap; dialogue + toast. No gameplay
// state is mutated except clearing shown message/toast and overlay flags.
export function createHud(state, world) {
  const doc = typeof document !== 'undefined' ? document : null;
  let hudRoot = doc?.getElementById?.('hud') ?? null;
  if (!hudRoot && doc?.createElement) {
    hudRoot = doc.createElement('div');
    hudRoot.id = 'hud';
    doc.body?.appendChild?.(hudRoot);
  }

  function getElement(id) {
    return doc?.getElementById?.(id) ?? null;
  }

  function createPiece(id, parent = hudRoot, tag = 'div') {
    if (!doc?.createElement) return null;
    let element = getElement(id);
    if (!element) {
      element = doc.createElement(tag);
      element.id = id;
      parent?.appendChild?.(element);
    }
    return element;
  }

  const missionBanner = getElement('mission-banner');
  const missionTimer = createPiece('mission-timer', missionBanner || hudRoot);
  if (missionTimer?.style) {
    missionTimer.style.color = '#f2c66d';
    missionTimer.style.fontWeight = 'bold';
  }

  const dialogue = createPiece('dialogue');
  const dialogueSpeaker = createPiece('dialogue-speaker', dialogue, 'div');
  const dialogueText = createPiece('dialogue-text', dialogue, 'div');
  const toast = createPiece('toast');
  if (dialogue?.style) {
    dialogue.style.position = 'fixed';
    dialogue.style.left = '50%';
    dialogue.style.bottom = '5%';
    dialogue.style.transform = 'translateX(-50%)';
  }
  if (toast?.style) {
    toast.style.position = 'fixed';
    toast.style.left = '50%';
    toast.style.top = '12%';
    toast.style.transform = 'translateX(-50%)';
  }

  const starsElement = getElement('stars');
  if (starsElement && doc?.createElement && !starsElement.dataset?.sunlineStarsBuilt) {
    starsElement.textContent = '';
    for (let i = 0; i < 5; i += 1) {
      const star = doc.createElement('span');
      star.textContent = '★';
      // Inline size: the wanted level must read at a glance in screenshots.
      if (star.style) {
        star.style.fontSize = '20px';
        star.style.letterSpacing = '2px';
      }
      starsElement.appendChild(star);
    }
    if (starsElement.dataset) starsElement.dataset.sunlineStarsBuilt = 'true';
  }

  let frameCount = 0;
  let dialogueElapsed = 0;
  let toastElapsed = 0;
  let lastDialogue = null;
  let lastToast = null;

  function setToast(text) {
    if (!state?.mission) return;
    state.mission.toast = text;
    toastElapsed = 0;
    lastToast = text;
    if (toast) {
      toast.textContent = text ?? '';
      toast.hidden = !text;
    }
  }

  function showMessage(speaker, text) {
    if (!state?.mission) return;
    state.mission.message = { speaker, text };
    dialogueElapsed = 0;
    lastDialogue = state.mission.message;
    if (dialogueSpeaker) dialogueSpeaker.textContent = speaker ?? '';
    if (dialogueText) dialogueText.textContent = text ?? '';
    if (dialogue) dialogue.hidden = !(speaker || text);
  }

  function formatClock(timeOfDay) {
    const value = Number.isFinite(timeOfDay) ? timeOfDay : 0;
    const wrapped = ((value % 24) + 24) % 24;
    const hours = Math.floor(wrapped);
    const minutes = Math.floor((wrapped - hours) * 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  function formatTimer(timeLeft) {
    const total = Math.max(0, Math.floor(Number.isFinite(timeLeft) ? timeLeft : 0));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function setHidden(id, hidden) {
    const element = getElement(id);
    if (element) element.hidden = hidden;
  }

  function drawMinimap() {
    const canvas = getElement('minimap');
    if (!canvas?.getContext) return;
    let context;
    try {
      context = canvas.getContext('2d');
    } catch {
      return;
    }
    if (!context) return;

    const width = canvas.width || 180;
    const height = canvas.height || 180;
    const size = Number.isFinite(world?.size) && world.size > 0 ? world.size : 1120;
    const mapX = (x) => ((x + size / 2) / size) * width;
    const mapY = (z) => ((z + size / 2) / size) * height;

    context.clearRect(0, 0, width, height);
    context.fillStyle = '#142329';
    context.fillRect(0, 0, width, height);

    // City blocks use { minX, maxX, minZ, maxZ } in world.js.
    const blocks = Array.isArray(world?.blocks) ? world.blocks : [];
    context.fillStyle = 'rgba(205,178,133,.13)';
    for (const block of blocks) {
      if (!Number.isFinite(block?.minX) || !Number.isFinite(block?.maxX) ||
          !Number.isFinite(block?.minZ) || !Number.isFinite(block?.maxZ)) continue;
      context.fillRect(
        mapX(block.minX), mapY(block.minZ),
        ((block.maxX - block.minX) / size) * width,
        ((block.maxZ - block.minZ) / size) * height,
      );
    }

    const roads = Array.isArray(world?.roadLines) ? world.roadLines : [];
    function drawRoad(x1, z1, x2, z2) {
      const aX = mapX(x1);
      const aY = mapY(z1);
      const bX = mapX(x2);
      const bY = mapY(z2);
      context.beginPath();
      context.moveTo(aX, aY);
      context.lineTo(bX, bY);
      context.lineCap = 'round';
      context.lineWidth = 8;
      context.strokeStyle = 'rgba(20,35,41,0.9)';
      context.stroke();
      context.beginPath();
      context.moveTo(aX, aY);
      context.lineTo(bX, bY);
      context.lineWidth = 5;
      context.strokeStyle = 'rgba(245,236,210,0.95)';
      context.stroke();
    }
    for (const road of roads) {
      if (!Number.isFinite(road)) continue;
      drawRoad(road, -size / 2, road, size / 2);
      drawRoad(-size / 2, road, size / 2, road);
    }

    const game = typeof window !== 'undefined' ? window.__game : null;
    const policeUnits = state?.police?.units ?? game?.police?.units ?? [];
    if (Array.isArray(policeUnits)) {
      for (const unit of policeUnits) {
        const position = unit?.group?.position ?? unit?.pos ?? unit?.position;
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) continue;
        const x = mapX(position.x);
        const y = mapY(position.z);
        context.beginPath();
        context.arc(x, y, 7, 0, Math.PI * 2);
        context.fillStyle = '#3b82f6';
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = '#ffffff';
        context.stroke();
      }
    }

    const mission = state?.mission;
    const marker = mission?.marker ?? mission?.target;
    if (marker && Number.isFinite(marker.x) && Number.isFinite(marker.z)) {
      const x = mapX(marker.x);
      const y = mapY(marker.z);
      context.save();
      context.translate(x, y);
      context.rotate(Math.PI / 4);
      context.fillStyle = '#f2c66d';
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      context.fillRect(-7, -7, 14, 14);
      context.strokeRect(-7, -7, 14, 14);
      context.restore();
    }

    const cars = game?.traffic?.cars;
    if (Array.isArray(cars)) {
      for (const car of cars) {
        const position = car?.group?.position ?? car?.pos ?? car?.position;
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) continue;
        context.beginPath();
        context.arc(mapX(position.x), mapY(position.z), 2.5, 0, Math.PI * 2);
        context.fillStyle = '#f28b42';
        context.fill();
      }
    }

    const playerPosition =
      state?.currentVehicle?.pos ??
      state?.currentVehicle?.group?.position ??
      state?.player?.pos;
    if (playerPosition && Number.isFinite(playerPosition.x) && Number.isFinite(playerPosition.z)) {
      const heading = Number.isFinite(state?.currentVehicle?.heading)
        ? state.currentVehicle.heading
        : Number.isFinite(state?.player?.heading) ? state.player.heading : 0;
      context.save();
      context.translate(mapX(playerPosition.x), mapY(playerPosition.z));
      context.rotate(-heading);
      context.beginPath();
      context.moveTo(0, -8);
      context.lineTo(6, 7);
      context.lineTo(0, 4);
      context.lineTo(-6, 7);
      context.closePath();
      context.fillStyle = '#ffffff';
      context.fill();
      context.restore();
    }
  }

  function update(dt) {
    const step = Math.min(Math.max(Number.isFinite(dt) ? dt : 1 / 60, 0), 0.1);
    const player = state?.player ?? {};

    const healthFill = getElement('health-fill');
    if (healthFill?.style) {
      const health = Math.min(100, Math.max(0, Number.isFinite(player.health) ? player.health : 0));
      healthFill.style.width = `${health}%`;
    }

    const cash = getElement('cash');
    if (cash) cash.textContent = `$${Math.floor(Number.isFinite(player.cash) ? player.cash : 0)}`;

    if (starsElement) {
      const wanted = Math.min(5, Math.max(0, Math.floor(state?.wanted ?? 0)));
      const stars = starsElement.querySelectorAll?.('span') ?? [];
      stars.forEach((star, index) => {
        const filled = index < wanted;
        star.classList?.toggle?.('filled', filled);
        if (star.style) star.style.color = filled ? '#f2c66d' : 'rgba(255,255,255,0.3)';
      });
    }

    const clock = getElement('clock');
    if (clock) clock.textContent = formatClock(state?.timeOfDay);

    const speed = getElement('speed');
    if (speed) {
      if (state?.currentVehicle) {
        const vehicleSpeed = Number.isFinite(state.currentVehicle.speed)
          ? Math.abs(state.currentVehicle.speed) : 0;
        speed.textContent = `${Math.round(vehicleSpeed * 3.6)} km/h`;
      } else {
        speed.textContent = 'On foot';
      }
    }

    const mission = state?.mission ?? {};
    const missionActive = !!(mission.id || mission.title);
    const banner = getElement('mission-banner');
    if (banner) banner.hidden = !missionActive;
    const title = getElement('mission-title');
    if (title) title.textContent = mission.title ?? '';
    const objective = getElement('mission-objective');
    if (objective) objective.textContent = mission.objective ?? '';
    if (missionTimer) {
      missionTimer.hidden = !missionActive;
      missionTimer.textContent = missionActive ? formatTimer(mission.timeLeft) : '';
    }

    const promptElement = getElement('prompt');
    if (promptElement) {
      let prompt = '';
      if (state?.screen === 'play') {
        if (mission.prompt) {
          prompt = mission.prompt;
        } else if (state?.currentVehicle) {
          prompt = 'E — Exit vehicle';
        } else {
          let nearby = false;
          if (typeof window !== 'undefined') {
            try {
              nearby = !!window.__game?.vehicles?.getNearbyVehicle?.(4);
            } catch {
              nearby = false;
            }
          }
          if (nearby) prompt = 'E — Enter vehicle';
        }
      }
      promptElement.textContent = prompt;
      promptElement.hidden = !prompt;
    }

    const message = state?.mission?.message ?? null;
    if (message !== lastDialogue) {
      lastDialogue = message;
      dialogueElapsed = 0;
    }
    if (message) {
      dialogueElapsed += step;
      if (dialogueSpeaker) dialogueSpeaker.textContent = message.speaker ?? '';
      if (dialogueText) dialogueText.textContent = message.text ?? '';
      if (dialogue) dialogue.hidden = dialogueElapsed >= 6;
      if (dialogueElapsed >= 6 && state?.mission?.message === message) {
        state.mission.message = null;
        lastDialogue = null;
      }
    } else if (dialogue) {
      dialogue.hidden = true;
    }

    const currentToast = state?.mission?.toast ?? '';
    if (currentToast !== lastToast) {
      lastToast = currentToast;
      toastElapsed = 0;
    }
    if (currentToast) {
      toastElapsed += step;
      if (toast) {
        toast.textContent = currentToast;
        toast.hidden = toastElapsed >= 3;
      }
      if (toastElapsed >= 3 && state?.mission?.toast === currentToast) {
        state.mission.toast = '';
        lastToast = '';
      }
    } else if (toast) {
      toast.hidden = true;
    }

    setHidden('title-screen', state?.screen !== 'title');
    setHidden('pause-screen', state?.screen !== 'paused');
    setHidden('over-screen', state?.screen !== 'over');

    frameCount += 1;
    if (frameCount % 3 === 0) drawMinimap();
  }

  return { update, setToast, showMessage };
}
