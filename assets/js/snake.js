// assets/js/snake.js
// NebuleAir Snake – bonus, succès, classements & stats globales

const LEADERBOARD_API_URL =
  "https://nebuleairproxy.onrender.com/snake/leaderboard";

(function () {
  "use strict";

  // ==========================
  //   CONFIG GÉNÉRALE
  // ==========================

  const SPEEDS = {
    lent: 150,
    normal: 100,
    rapide: 60
  };

  const STORAGE_KEY = "nebuleair_snake_leaderboards_v1";
  const STATS_KEY = "NEBULESNAKE_STATS_V1";

  // Icônes pour les succès (affichés dans le tableau)
  const ACHIEVEMENT_ICONS = {
    PERMA_TURBO: "⚡",
    GAMBLER: "🎰",
    YOYO_BODY: "🏋️",
    APPLE_RUSH: "🏃‍♂️",
    STORM_RIDER: "⛈️",
    FULL_HOUSE: "🧱",
    MARATHON_RUN: "🏃‍♀️"
  };

  // Emojis pour les pommes / bonus
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

  // ==========================
  //   ÉTAT DU JEU
  // ==========================

  let currentMode = "normal"; // lent | normal | rapide
  let gameInterval = null;

  let canvas = null;
  let ctx = null;
  const tileCount = 20;
  let tileSize = 20;

  let snake = [];
  let snakeDir = { x: 1, y: 0 };
  let nextDir = { x: 1, y: 0 };
  let running = false;
  let gameOverFlag = false;
  let score = 0;

  // pommes : {x,y,type,expiresAt?}
  let apples = [];
  // bonus : {x,y,type,expiresAt}
  let bonusItems = [];

  const activeEffects = {
    turbo: false,
    doubleScore: false
  };
  const effectTimeouts = {
    turbo: null,
    doubleScore: null
  };

  // Leaderboards (top 10) par mode
  let leaderboards = {
    lent: [],
    normal: [],
    rapide: []
  };

  // Stats de run / durée
  let runStartTime = null;
  let lastRunDurationSec = 0;
  let lastFrameTime = null;

  // Stats pour les succès
  let runStats = null;

  function resetRunStats() {
    runStats = {
      turboActiveMs: 0,
      applesEatenTotal: 0,
      applesEatenDuringTurbo: 0,
      goldenApplesEaten: 0,
      jackpotTaken: 0,
      doubleTaken: 0,
      slimTaken: 0,
      turboTaken: 0,
      maxLength: 3,
      yoyoDropReached: false
    };
  }

  // ==========================
  //   STATS LOCALES (option)
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
  //   LEADERBOARDS LOCAUX
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
  //   LEADERBOARDS SERVEUR
  // ==========================

  async function sendScoreToServer(
    mode,
    name,
    value,
    durationSec,
    achievements
  ) {
    try {
      await fetch(LEADERBOARD_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          name,
          score: value,
          durationSec,
          achievements
        })
      });
      // On rafraîchit derrière
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
            achievements: entry.achievements || [],
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
  //   LEADERBOARDS COMMUN
  // ==========================

  function addScore(mode, name, value, achievements = []) {
    if (!leaderboards[mode]) return;

    const entry = {
      name: name || "Anonyme",
      score: value,
      achievements: achievements.slice(0),
      date: new Date().toISOString()
    };

    leaderboards[mode].push(entry);
    leaderboards[mode].sort((a, b) => b.score - a.score);
    leaderboards[mode] = leaderboards[mode].slice(0, 10);

    saveLeaderboardsLocal();
    renderScoreboards();

    // Envoi au serveur (score + durée + succès)
    sendScoreToServer(
      mode,
      entry.name,
      entry.score,
      lastRunDurationSec,
      entry.achievements
    );
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

        let icons = "";
        if (entry.achievements && entry.achievements.length) {
          icons =
            " " +
            entry.achievements
              .map((id) => ACHIEVEMENT_ICONS[id] || "")
              .join("");
        }

        tdScore.textContent = entry.score + icons;

        tr.appendChild(tdRank);
        tr.appendChild(tdName);
        tr.appendChild(tdScore);
        tbody.appendChild(tr);
      });
    });
  }

  function askNameAndStoreScore(achievementsForRun) {
    const pseudo = window.prompt(
      `Partie terminée !\nTu as mangé ${score} pomme(s).\nEntre ton nom pour le classement :`,
      ""
    );

    // Annuler → aucun score
    if (pseudo === null) {
      return;
    }

    const trimmed = pseudo.trim();
    const name = trimmed === "" ? "Anonyme" : trimmed;

    const achievements = Array.isArray(achievementsForRun)
      ? achievementsForRun
      : [];

    addScore(currentMode, name, score, achievements);
  }

  // ==========================
  //   MAP & BONUS
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
    // Probabilités approx :
    // 1% pomme dorée, 2% turbo, 3% double, 4% jackpot, 5% slim.
    const r = Math.random() * 100;

    // Pomme dorée – 1 %
    if (r < 1) {
      const alreadyGolden = apples.some((a) => a.type === "golden");
      if (!alreadyGolden) {
        spawnApple("golden");
      }
      return;
    }

    // Un seul bonus à la fois
    if (bonusItems.length > 0) return;

    if (r < 3) {
      // 1–3 %
      spawnBonus("turbo");
    } else if (r < 6) {
      // 3–6 %
      spawnBonus("double");
    } else if (r < 10) {
      // 6–10 %
      spawnBonus("jackpot");
    } else if (r < 15) {
      // 10–15 %
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
  //   EFFETS & SUCCÈS
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
    }, 5000); // 5 s
    restartGameInterval();
  }

  function activateDoubleScore() {
    activeEffects.doubleScore = true;
    if (effectTimeouts.doubleScore) clearTimeout(effectTimeouts.doubleScore);
    effectTimeouts.doubleScore = setTimeout(() => {
      activeEffects.doubleScore = false;
    }, 10000); // 10 s
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
    if (runStats) {
      if (type === "turbo") runStats.turboTaken++;
      if (type === "double") runStats.doubleTaken++;
      if (type === "jackpot") runStats.jackpotTaken++;
      if (type === "slim") runStats.slimTaken++;
    }

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
      default:
        break;
    }
  }

  function computeRunAchievements() {
    if (!runStats) return [];

    const achievements = [];
    const totalSec = lastRunDurationSec || 0;
    const turboRatio =
      totalSec > 0 ? runStats.turboActiveMs / 1000 / totalSec : 0;

    // PERMA-TURBO : turbo ≥ 50% du temps, score ≥ 40
    if (score >= 40 && turboRatio >= 0.5) {
      achievements.push("PERMA_TURBO");
    }

    // GAMBLER : ≥1 jackpot, ≥2 double, aucun slim, score ≥ 50
    if (
      score >= 50 &&
      runStats.jackpotTaken >= 1 &&
      runStats.doubleTaken >= 2 &&
      runStats.slimTaken === 0
    ) {
      achievements.push("GAMBLER");
    }

    // YOYO BODY : longueur max ≥ 25 et perte de ≥ 8 cases
    if (runStats.maxLength >= 25 && runStats.yoyoDropReached) {
      achievements.push("YOYO_BODY");
    }

    // APPLE RUSH : ≥ 10 pommes mangées sous turbo
    if (runStats.applesEatenDuringTurbo >= 10) {
      achievements.push("APPLE_RUSH");
    }

    // STORM RIDER : ≥ 3 golden, score ≥ 70, len max ≥ 25
    if (
      score >= 70 &&
      runStats.maxLength >= 25 &&
      runStats.goldenApplesEaten >= 3
    ) {
      achievements.push("STORM_RIDER");
    }

    // FULL HOUSE : tous les bonus + ≥ 2 golden, score ≥ 80
    const usedAllBonuses =
      runStats.turboTaken > 0 &&
      runStats.doubleTaken > 0 &&
      runStats.jackpotTaken > 0 &&
      runStats.slimTaken > 0;

    if (usedAllBonuses && runStats.goldenApplesEaten >= 2 && score >= 80) {
      achievements.push("FULL_HOUSE");
    }

    // MARATHON RUN : ≥ 180 s et score ≥ 100
    if (totalSec >= 180 && score >= 100) {
      achievements.push("MARATHON_RUN");
    }

    return achievements;
  }

  // ==========================
  //   LOGIQUE DU JEU
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
    lastFrameTime = null;
    resetRunStats();

    if (ctx) draw();
  }

  function handleAppleCollisions(head) {
    let ateApple = false;

    for (let i = 0; i < apples.length; i++) {
      const a = apples[i];
      if (a.x === head.x && a.y === head.y) {
        ateApple = true;

        if (runStats) {
          runStats.applesEatenTotal++;
          if (activeEffects.turbo) {
            runStats.applesEatenDuringTurbo++;
          }
          if (a.type === "golden") {
            runStats.goldenApplesEaten++;
          }
        }

        const gain = getAppleScoreGain();
        score += gain;
        updateScoreLabel();

        apples.splice(i, 1);

        if (a.type === "golden") {
          // Pomme dorée → 5 nouvelles pommes normales
          for (let k = 0; k < 5; k++) {
            spawnApple("normal");
          }
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
      base = Math.max(30, Math.floor(base * 0.6)); // ~40 % plus rapide
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

    const now = Date.now();
    if (lastFrameTime !== null && activeEffects.turbo && runStats) {
      runStats.turboActiveMs += now - lastFrameTime;
    }
    lastFrameTime = now;

    if (!snake || snake.length === 0) {
      resetGame();
      return;
    }

    // Appliquer la direction demandée
    snakeDir = { x: nextDir.x, y: nextDir.y };

    const head = snake[0];
    const newHead = {
      x: head.x + snakeDir.x,
      y: head.y + snakeDir.y
    };

    // Collision murs
    if (
      newHead.x < 0 ||
      newHead.x >= tileCount ||
      newHead.y < 0 ||
      newHead.y >= tileCount
    ) {
      gameOver();
      return;
    }

    // Collision avec soi-même
    if (snake.some((seg) => seg.x === newHead.x && seg.y === newHead.y)) {
      gameOver();
      return;
    }

    snake.unshift(newHead);

    const ateApple = handleAppleCollisions(newHead);
    handleBonusCollisions(newHead);

    if (!ateApple) {
      snake.pop();
    }

    cleanExpiredApples();
    cleanExpiredBonuses();

    // Mise à jour des stats de longueur (YOYO BODY)
    if (runStats) {
      const len = snake.length;
      if (len > runStats.maxLength) {
        runStats.maxLength = len;
      }
      if (len < runStats.maxLength - 8) {
        runStats.yoyoDropReached = true;
      }
    }

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

    const achievements = computeRunAchievements();

    drawGameOver();
    askNameAndStoreScore(achievements);
  }

  // ==========================
  //   DESSIN
  // ==========================

  function clearCanvas() {
    ctx.fillStyle = "#000000";
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

    ctx.fillStyle = "#ffffff";
    ctx.font = "16px sans-serif";
    ctx.fillText(
      `Score : ${score}`,
      canvas.width / 2,
      canvas.height / 2 + 20
    );
  }

  // ==========================
  //   VITESSE & INIT
  // ==========================

  function setSpeedMode(mode) {
    if (!SPEEDS[mode]) return;
    if (running) {
      // on ne change pas la vitesse en pleine partie
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

    // 1/2/3 : changer la vitesse avant de démarrer
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

    // Empêche la page de scroller avec les flèches
    if (
      key === "ArrowUp" ||
      key === "ArrowDown" ||
      key === "ArrowLeft" ||
      key === "ArrowRight"
    ) {
      e.preventDefault();
    }

    // Démarrage / restart
    if (!running) {
      if (gameOverFlag) {
        resetGame();
      }
      runStartTime = Date.now();
      lastFrameTime = runStartTime;
      running = true;
      restartGameInterval();
    }

    // Changement de direction (sans demi-tour direct)
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
