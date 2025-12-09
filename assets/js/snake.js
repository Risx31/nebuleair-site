// assets/js/snake.js
// NebuleAir Snake – vitesses verrouillées, bonus, emojis, classements + stats

const LEADERBOARD_API_URL =
  "https://nebuleairproxy.onrender.com/snake/leaderboard";

(function () {
  "use strict";

  const SPEEDS = {
    lent: 150,
    normal: 100,
    rapide: 60
  };

  const STORAGE_KEY = "nebuleair_snake_leaderboards_v1";
  const STATS_KEY = "NEBULESNAKE_STATS_V1";

  let currentMode = "normal";
  let gameInterval = null;

  let canvas = null;
  let ctx = null;
  const tileCount = 20;
  let tileSize = 20;

  let snake = [];
  let snakeDir = { x: 1, y: 0 };
  let nextDir = { x: 1, y: 0 };
  let running = false;
  let score = 0;
  let gameOverFlag = false;

  let apples = [];     // {x,y,type,expiresAt?}
  let bonusItems = []; // {x,y,type,expiresAt}

  const activeEffects = {
    turbo: false,
    doubleScore: false
  };
  const effectTimeouts = {
    turbo: null,
    doubleScore: null
  };

  const APPLE_EMOJIS = {
    normal: "🍎",
    golden: "🍏"
  };

  const BONUS_EMOJIS = {
    turbo: "⚡",
    double: "✨",
    jackpot: "💰",
    slim: "✂️"
  };

  let leaderboards = {
    lent: [],
    normal: [],
    rapide: []
  };

  // Stats de run (pour durée locale + envoi au serveur)
  let runStartTime = null;
  let lastRunDurationSec = 0;

  // ==========================
  //   STATS LOCALES (OPTIONNEL)
  // ==========================

  function loadLocalStats() {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (!raw) return { totalGames: 0, totalPlayTimeSec: 0 };
      const obj = JSON.parse(raw);
      return {
        totalGames: Number(obj.totalGames) || 0,
        totalPlayTimeSec: Number(obj.totalPlayTimeSec) || 0
      };
    } catch (e) {
      console.warn("[Snake] Impossible de charger les stats locales", e);
      return { totalGames: 0, totalPlayTimeSec: 0 };
    }
  }

  function saveLocalStats(stats) {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (e) {
      console.warn("[Snake] Impossible d’enregistrer les stats locales", e);
    }
  }

  function registerRunDuration(durationSec) {
    const stats = loadLocalStats();
    stats.totalGames += 1;
    stats.totalPlayTimeSec += Math.max(0, Math.floor(durationSec));
    saveLocalStats(stats);
  }

  // ==========================
  //   LEADERBOARDS – LOCAL
  // ==========================

  function loadLeaderboardsLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && typeof data === "object") {
        leaderboards = {
          lent: Array.isArray(data.lent) ? data.lent : [],
          normal: Array.isArray(data.normal) ? data.normal : [],
          rapide: Array.isArray(data.rapide) ? data.rapide : []
        };
      }
    } catch (e) {
      console.warn("[Snake] Impossible de charger les scores locaux :", e);
    }
  }

  function saveLeaderboardsLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(leaderboards));
    } catch (e) {
      console.warn("[Snake] Impossible d’enregistrer les scores locaux :", e);
    }
  }

  // ==========================
  //   LEADERBOARDS – SERVEUR
  // ==========================

  async function sendScoreToServer(mode, name, value, durationSec) {
    try {
      await fetch(LEADERBOARD_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          name,
          score: value,
          durationSec
        })
      });
      // on rafraîchit le classement global
      fetchGlobalLeaderboards();
    } catch (e) {
      console.warn("[Snake] Impossible d’envoyer le score au serveur :", e);
    }
  }

  async function fetchGlobalLeaderboards() {
    try {
      const res = await fetch(LEADERBOARD_API_URL, { method: "GET" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      let fromServer = { lent: [], normal: [], rapide: [] };

      if (data.leaderboards) {
        const lb = data.leaderboards;
        fromServer.lent = Array.isArray(lb.lent) ? lb.lent : [];
        fromServer.normal = Array.isArray(lb.normal) ? lb.normal : [];
        fromServer.rapide = Array.isArray(lb.rapide) ? lb.rapide : [];
      } else if (data.lent || data.normal || data.rapide) {
        fromServer.lent = Array.isArray(data.lent) ? data.lent : [];
        fromServer.normal = Array.isArray(data.normal) ? data.normal : [];
        fromServer.rapide = Array.isArray(data.rapide) ? data.rapide : [];
      } else if (Array.isArray(data.scores)) {
        data.scores.forEach((entry) => {
          const m = entry.mode || "normal";
          if (!fromServer[m]) fromServer[m] = [];
          fromServer[m].push({
            name: entry.name || "Anonyme",
            score: entry.score || 0,
            date: entry.date || null
          });
        });
      } else {
        console.warn("[Snake] Format leaderboard serveur inattendu :", data);
        return;
      }

      ["lent", "normal", "rapide"].forEach((mode) => {
        fromServer[mode].sort((a, b) => (b.score || 0) - (a.score || 0));
        fromServer[mode] = fromServer[mode].slice(0, 10);
      });

      leaderboards = fromServer;
      saveLeaderboardsLocal();
      renderScoreboards();
    } catch (e) {
      console.warn("[Snake] Impossible de récupérer le classement mondial :", e);
    }
  }

  // ==========================
  //   LEADERBOARDS – COMMUN
  // ==========================

  function addScore(mode, name, value) {
    if (!leaderboards[mode]) return;

    const entry = {
      name: name || "Anonyme",
      score: value,
      date: new Date().toISOString()
    };

    leaderboards[mode].push(entry);
    leaderboards[mode].sort((a, b) => b.score - a.score);
    leaderboards[mode] = leaderboards[mode].slice(0, 10);

    saveLeaderboardsLocal();
    renderScoreboards();

    // envoi au serveur avec la durée du run
    sendScoreToServer(mode, entry.name, entry.score, lastRunDurationSec);
  }

  function renderScoreboards() {
    ["lent", "normal", "rapide"].forEach((mode) => {
      const tbody = document.getElementById(`snake-highscores-${mode}`);
      if (!tbody) return;

      tbody.innerHTML = "";
      const scores = leaderboards[mode] || [];

      scores.forEach((entry, index) => {
        const tr = document.createElement("tr");
        const tdRank = document.createElement("td");
        const tdName = document.createElement("td");
        const tdScore = document.createElement("td");

        tdRank.textContent = index + 1;
        tdName.textContent = entry.name;
        tdScore.textContent = entry.score;

        tr.appendChild(tdRank);
        tr.appendChild(tdName);
        tr.appendChild(tdScore);
        tbody.appendChild(tr);
      });
    });
  }

  function askNameAndStoreScore() {
    const pseudo = window.prompt(
      `Partie terminée !\nTu as mangé ${score} pomme(s).\nEntre ton nom pour le classement :`,
      ""
    );
    if (pseudo === null) return;

    const trimmed = pseudo.trim();
    const name = trimmed === "" ? "Anonyme" : trimmed;
    addScore(currentMode, name, score);
  }

  // ==========================
  //   MAP / BONUS
  // ==========================

  function isCellOccupied(x, y) {
    if (snake.some((seg) => seg.x === x && seg.y === y)) return true;
    if (apples.some((a) => a.x === x && a.y === y)) return true;
    if (bonusItems.some((b) => b.x === x && b.y === y)) return true;
    return false;
  }

  function randomFreeCell() {
    let x, y;
    do {
      x = Math.floor(Math.random() * tileCount);
      y = Math.floor(Math.random() * tileCount);
    } while (isCellOccupied(x, y));
    return { x, y };
  }

  function spawnApple(type = "normal") {
    const pos = randomFreeCell();
    let expiresAt = null;
    if (type === "golden") {
      expiresAt = Date.now() + 6000; // 6s
    }
    apples.push({ x: pos.x, y: pos.y, type, expiresAt });
  }

  function spawnBonus(type) {
    const pos = randomFreeCell();
    bonusItems.push({
      x: pos.x,
      y: pos.y,
      type,
      expiresAt: Date.now() + 5000 // 5s
    });
  }

  function maybeSpawnRareStuff() {
    const r = Math.random() * 100;

    if (r < 1) {
      const alreadyGolden = apples.some((a) => a.type === "golden");
      if (!alreadyGolden) spawnApple("golden");
      return;
    }

    if (bonusItems.length > 0) return;

    if (r < 3) {
      spawnBonus("turbo");
    } else if (r < 6) {
      spawnBonus("double");
    } else if (r < 10) {
      spawnBonus("jackpot");
    } else if (r < 15) {
      spawnBonus("slim");
    }
  }

  function cleanExpiredBonuses() {
    const now = Date.now();
    bonusItems = bonusItems.filter((b) => b.expiresAt > now);
  }

  function cleanExpiredApples() {
    const now = Date.now();
    apples = apples.filter((a) => !a.expiresAt || a.expiresAt > now);
  }

  // ==========================
  //   EFFETS
  // ==========================

  function getAppleScoreGain() {
    let gain = 1;
    if (activeEffects.doubleScore) gain *= 2;
    if (activeEffects.turbo) gain += 1;
    return gain;
  }

  function applySlimEffect() {
    const minLength = 3;
    let toRemove = 4;
    while (snake.length > minLength && toRemove > 0) {
      snake.pop();
      toRemove--;
    }
  }

  function activateTurbo() {
    activeEffects.turbo = true;
    if (effectTimeouts.turbo) clearTimeout(effectTimeouts.turbo);
    effectTimeouts.turbo = setTimeout(() => {
      activeEffects.turbo = false;
      restartGameInterval();
    }, 5000);
    restartGameInterval();
  }

  function activateDoubleScore() {
    activeEffects.doubleScore = true;
    if (effectTimeouts.doubleScore) clearTimeout(effectTimeouts.doubleScore);
    effectTimeouts.doubleScore = setTimeout(() => {
      activeEffects.doubleScore = false;
    }, 10000);
  }

  function clearAllEffects() {
    activeEffects.turbo = false;
    activeEffects.doubleScore = false;
    if (effectTimeouts.turbo) clearTimeout(effectTimeouts.turbo);
    if (effectTimeouts.doubleScore) clearTimeout(effectTimeouts.doubleScore);
    effectTimeouts.turbo = null;
    effectTimeouts.doubleScore = null;
  }

  function applyBonusEffect(type) {
    switch (type) {
      case "turbo":
        activateTurbo();
        break;
      case "double":
        activateDoubleScore();
        break;
      case "jackpot":
        score += 5;
        updateScoreLabel();
        break;
      case "slim":
        applySlimEffect();
        break;
    }
  }

  // ==========================
  //   LOGIQUE DE JEU
  // ==========================

  function resetGame() {
    const startX = Math.floor(tileCount / 2);
    const startY = Math.floor(tileCount / 2);

    snake = [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY }
    ];

    snakeDir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };

    apples = [];
    bonusItems = [];
    clearAllEffects();
    spawnApple("normal");

    score = 0;
    updateScoreLabel();

    running = false;
    gameOverFlag = false;
    runStartTime = null;
    lastRunDurationSec = 0;

    if (ctx) draw();
  }

  function handleAppleCollisions(head) {
    let ateApple = false;

    for (let i = 0; i < apples.length; i++) {
      const a = apples[i];
      if (a.x === head.x && a.y === head.y) {
        ateApple = true;
        score += getAppleScoreGain();
        updateScoreLabel();
        apples.splice(i, 1);

        if (a.type === "golden") {
          for (let k = 0; k < 5; k++) spawnApple("normal");
        } else {
          spawnApple("normal");
        }

        maybeSpawnRareStuff();
        break;
      }
    }

    return ateApple;
  }

  function handleBonusCollisions(head) {
    for (let i = 0; i < bonusItems.length; i++) {
      const b = bonusItems[i];
      if (b.x === head.x && b.y === head.y) {
        applyBonusEffect(b.type);
        bonusItems.splice(i, 1);
        break;
      }
    }
  }

  function updateScoreLabel() {
    const el = document.getElementById("snake-score-current");
    if (el) el.textContent = score;
  }

  function getCurrentSpeed() {
    let base = SPEEDS[currentMode] || SPEEDS.normal;
    if (activeEffects.turbo) {
      base = Math.max(30, Math.floor(base * 0.6));
    }
    return base;
  }

  function restartGameInterval() {
    if (gameInterval) clearInterval(gameInterval);
    if (!running) return;
    gameInterval = setInterval(gameLoop, getCurrentSpeed());
  }

  function gameLoop() {
    if (!running) return;
    if (!snake || snake.length === 0) {
      console.warn("[Snake] Snake vide, reset.");
      resetGame();
      return;
    }

    snakeDir = { x: nextDir.x, y: nextDir.y };

    const head = snake[0];
    const newHead = { x: head.x + snakeDir.x, y: head.y + snakeDir.y };

    if (
      newHead.x < 0 ||
      newHead.x >= tileCount ||
      newHead.y < 0 ||
      newHead.y >= tileCount
    ) {
      gameOver();
      return;
    }

    if (snake.some((seg) => seg.x === newHead.x && seg.y === newHead.y)) {
      gameOver();
      return;
    }

    snake.unshift(newHead);

    const ateApple = handleAppleCollisions(newHead);
    handleBonusCollisions(newHead);

    if (!ateApple) snake.pop();

    cleanExpiredApples();
    cleanExpiredBonuses();
    draw();
  }

  function gameOver() {
    running = false;
    gameOverFlag = true;

    if (gameInterval) {
      clearInterval(gameInterval);
      gameInterval = null;
    }

    clearAllEffects();

    const now = Date.now();
    const durationMs = runStartTime ? now - runStartTime : 0;
    lastRunDurationSec = Math.max(1, Math.round(durationMs / 1000));
    registerRunDuration(lastRunDurationSec);
    runStartTime = null;

    drawGameOver();
    askNameAndStoreScore();
  }

  // ==========================
  //   DESSIN
  // ==========================

  function clearCanvas() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawGrid() {
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < tileCount; i++) {
      ctx.beginPath();
      ctx.moveTo(i * tileSize, 0);
      ctx.lineTo(i * tileSize, canvas.height);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i * tileSize);
      ctx.lineTo(canvas.width, i * tileSize);
      ctx.stroke();
    }
  }

  function drawSnake() {
    snake.forEach((seg, index) => {
      ctx.fillStyle = index === 0 ? "#00ff7f" : "#1e90ff";
      ctx.fillRect(
        seg.x * tileSize + 1,
        seg.y * tileSize + 1,
        tileSize - 2,
        tileSize - 2
      );
    });
  }

  function drawApples() {
    apples.forEach((a) => {
      const emoji = APPLE_EMOJIS[a.type] || APPLE_EMOJIS.normal;
      const fontSize = Math.floor(tileSize * 0.9);
      ctx.save();
      ctx.font = `${fontSize}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        emoji,
        a.x * tileSize + tileSize / 2,
        a.y * tileSize + tileSize / 2
      );
      ctx.restore();
    });
  }

  function drawBonuses() {
    bonusItems.forEach((b) => {
      const emoji = BONUS_EMOJIS[b.type] || "❓";
      const fontSize = Math.floor(tileSize * 0.9);
      ctx.save();
      ctx.font = `${fontSize}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        emoji,
        b.x * tileSize + tileSize / 2,
        b.y * tileSize + tileSize / 2
      );
      ctx.restore();
    });
  }

  function draw() {
    if (!ctx) return;
    clearCanvas();
    drawGrid();
    drawSnake();
    drawApples();
    drawBonuses();
  }

  function drawGameOver() {
    clearCanvas();
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#ff4757";
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2 - 10);

    ctx.fillStyle = "#fff";
    ctx.font = "16px sans-serif";
    ctx.fillText(`Score : ${score}`, canvas.width / 2, canvas.height / 2 + 20);
  }

  // ==========================
  //   VITESSE & INIT
  // ==========================

  function setSpeedMode(mode) {
    if (!SPEEDS[mode]) return;
    if (running) {
      console.log("[Snake] Changement de vitesse ignoré (partie en cours)");
      return;
    }
    currentMode = mode;

    const label = document.getElementById("snake-speed-label");
    if (label) {
      label.textContent =
        mode === "lent" ? "Lent" : mode === "rapide" ? "Rapide" : "Normal";
    }

    renderScoreboards();
  }

  function init() {
    canvas = document.getElementById("snakeCanvas");
    if (!canvas) {
      console.warn("[Snake] Canvas introuvable, id = snakeCanvas");
      return;
    }
    ctx = canvas.getContext("2d");

    if (!canvas.width) canvas.width = tileCount * 20;
    if (!canvas.height) canvas.height = tileCount * 20;
    tileSize = Math.floor(Math.min(canvas.width, canvas.height) / tileCount);

    loadLeaderboardsLocal();
    renderScoreboards();
    fetchGlobalLeaderboards();

    setSpeedMode(currentMode);
    resetGame();

    const achBtn = document.getElementById("snake-achievements-btn");
    if (achBtn && !achBtn._nebuleBound) {
      achBtn._nebuleBound = true;
      achBtn.addEventListener("click", () => {
        window.location.href = "succes.html";
      });
    }
  }

  // ==========================
  //   CONTRÔLES CLAVIER
  // ==========================

  document.addEventListener("keydown", (e) => {
    const key = e.key;

    const container = document.getElementById("snake-container");
    const snakeVisible =
      container && !container.classList.contains("snake-hidden");
    if (!snakeVisible) return;

    if (key === "1" || key === "2" || key === "3") {
      if (!running && !gameOverFlag) {
        if (key === "1") setSpeedMode("lent");
        if (key === "2") setSpeedMode("normal");
        if (key === "3") setSpeedMode("rapide");
      }
      return;
    }

    const isDirKey =
      key === "ArrowUp" ||
      key === "ArrowDown" ||
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "z" ||
      key === "q" ||
      key === "s" ||
      key === "d";

    if (!isDirKey) return;

    if (
      key === "ArrowUp" ||
      key === "ArrowDown" ||
      key === "ArrowLeft" ||
      key === "ArrowRight"
    ) {
      e.preventDefault();
    }

    // démarrage / restart
    if (!running) {
      if (gameOverFlag) {
        resetGame();
      }
      runStartTime = Date.now();
      running = true;
      restartGameInterval();
    }

    if (key === "ArrowUp" || key === "z") {
      if (snakeDir.y === 1) return;
      nextDir = { x: 0, y: -1 };
    } else if (key === "ArrowDown" || key === "s") {
      if (snakeDir.y === -1) return;
      nextDir = { x: 0, y: 1 };
    } else if (key === "ArrowLeft" || key === "q") {
      if (snakeDir.x === 1) return;
      nextDir = { x: -1, y: 0 };
    } else if (key === "ArrowRight" || key === "d") {
      if (snakeDir.x === -1) return;
      nextDir = { x: 1, y: 0 };
    }
  });

  // ==========================
  //   API GLOBALE
  // ==========================

  window.NebuleAirSnake = {
    init,
    setMode: setSpeedMode,
    resetScores: () => {
      leaderboards = { lent: [], normal: [], rapide: [] };
      saveLeaderboardsLocal();
      renderScoreboards();
    }
  };
})();
