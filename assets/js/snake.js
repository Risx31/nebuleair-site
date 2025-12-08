// assets/js/snake.js
// NebuleAir Snake – classements, vitesses & bonus
const LEADERBOARD_API_URL = "https://nebuleairproxy.onrender.com/snake/leaderboard";

(function () {
  "use strict";

  // ==========================
  //   CONFIG GÉNÉRALE
  // ==========================

  const SPEEDS = {
    lent: 150,     // ms entre 2 frames
    normal: 100,
    rapide: 60
  };

  const STORAGE_KEY = "nebuleair_snake_leaderboards_v1";

  let currentMode = "normal";   // "lent" | "normal" | "rapide"
  let gameInterval = null;

  // Canvas & dessin
  let canvas, ctx;
  let tileCount = 20;
  let tileSize = 20;

  // État du jeu
  let snake = [];
  let snakeDir = { x: 1, y: 0 };
  let nextDir = { x: 1, y: 0 };
  let running = false;
  let score = 0;

  // Pommes & bonus
  // type de pomme : "normal" | "golden"
  let apples = [];
  // type de bonus : "turbo" | "double" | "jackpot" | "slim"
  let bonusItems = [];

  const BONUS_TYPES = ["turbo", "double", "jackpot", "slim"];

  // Effets actifs
  const activeEffects = {
    turbo: false,
    doubleScore: false
  };

  const effectTimeouts = {
    turbo: null,
    doubleScore: null
  };

  // Classements (localStorage)
  let leaderboards = {
    lent: [],
    normal: [],
    rapide: []
  };

  // ==========================
  //   LEADERBOARDS
  // ==========================

  function loadLeaderboards() {
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
      console.warn("[Snake] Impossible de charger les scores :", e);
    }
  }

  function saveLeaderboards() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(leaderboards));
    } catch (e) {
      console.warn("[Snake] Impossible d’enregistrer les scores :", e);
    }
  }

  function addScore(mode, name, value) {
    if (!leaderboards[mode]) return;

    leaderboards[mode].push({
      name: name || "Anonyme",
      score: value,
      date: new Date().toISOString()
    });

    // tri décroissant
    leaderboards[mode].sort((a, b) => b.score - a.score);

    // on garde les 10 meilleurs
    leaderboards[mode] = leaderboards[mode].slice(0, 10);

    saveLeaderboards();
    renderScoreboards();
  }

  function renderScoreboards() {
    const modes = ["lent", "normal", "rapide"];

    modes.forEach(mode => {
      const tbody = document.getElementById(`snake-highscores-${mode}`);
      if (!tbody) return; // si pas de tableau dans le HTML, on ne fait rien

      tbody.innerHTML = "";

      const scores = leaderboards[mode] || [];
      scores.forEach((entry, index) => {
        const tr = document.createElement("tr");

        const tdRank = document.createElement("td");
        tdRank.textContent = index + 1;

        const tdName = document.createElement("td");
        tdName.textContent = entry.name;

        const tdScore = document.createElement("td");
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

    // Si l'utilisateur clique sur "Annuler" → on ne l'ajoute pas au classement
    if (pseudo === null) {
      return;
    }

    const trimmed = pseudo.trim();

    // Si le joueur laisse vide mais clique sur OK → on met "Anonyme"
    const name = trimmed === "" ? "Anonyme" : trimmed;

    addScore(currentMode, name, score);
  }

  // ==========================
  //   UTILITAIRES MAP/BONUS
  // ==========================

  function isCellOccupied(x, y) {
    if (snake.some(seg => seg.x === x && seg.y === y)) return true;
    if (apples.some(a => a.x === x && a.y === y)) return true;
    if (bonusItems.some(b => b.x === x && b.y === y)) return true;
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
    apples.push({
      x: pos.x,
      y: pos.y,
      type
    });
  }

  function spawnBonus(type) {
    const pos = randomFreeCell();
    const lifetimeMs = 8000; // visible 8 s sur la map
    bonusItems.push({
      x: pos.x,
      y: pos.y,
      type,
      expiresAt: Date.now() + lifetimeMs
    });
  }

  function maybeSpawnRareStuff() {
    // Appelé après chaque pomme mangée.
    // On tire une seule fois, et on décide s'il se passe quelque chose.
    // Probabilités approx :
    // 1% pomme dorée, 2% turbo, 3% double, 4% jackpot, 5% slim.
    // Soit 1 + 2 + 3 + 4 + 5 = 15% au total max.

    const r = Math.random() * 100;

    // Pomme dorée – 1%
    if (r < 1) {
      const alreadyGolden = apples.some(a => a.type === "golden");
      if (!alreadyGolden) {
        spawnApple("golden");
      }
      return;
    }

    // Pas plus d'un bonus sur la map à la fois pour garder ça lisible
    if (bonusItems.length > 0) return;

    // Turbo – 2% (1–3)
    if (r < 3) {
      spawnBonus("turbo");
      return;
    }

    // Double Score – 3% (3–6)
    if (r < 6) {
      spawnBonus("double");
      return;
    }

    // Jackpot – 4% (6–10)
    if (r < 10) {
      spawnBonus("jackpot");
      return;
    }

    // Minceur express – 5% (10–15)
    if (r < 15) {
      spawnBonus("slim");
    }
  }

  function cleanExpiredBonuses() {
    if (!bonusItems.length) return;
    const now = Date.now();
    bonusItems = bonusItems.filter(b => b.expiresAt > now);
  }

  // ==========================
  //   GESTION DES EFFETS
  // ==========================

  function getAppleScoreGain() {
    let gain = 1;

    if (activeEffects.doubleScore) {
      gain *= 2;
    }
    if (activeEffects.turbo) {
      // turbo = +1 point par pomme en plus
      gain += 1;
    }

    return gain;
  }

  function applySlimEffect() {
    const minLength = 3;
    let toRemove = 4; // on retire jusqu'à 4 segments
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

    if (effectTimeouts.turbo) {
      clearTimeout(effectTimeouts.turbo);
      effectTimeouts.turbo = null;
    }
    if (effectTimeouts.doubleScore) {
      clearTimeout(effectTimeouts.doubleScore);
      effectTimeouts.doubleScore = null;
    }
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
      default:
        break;
    }
  }

  // ==========================
  //   GESTION DU JEU
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

    spawnApple("normal"); // au moins une pomme au départ

    score = 0;
    updateScoreLabel();
    running = true;
  }

  function handleAppleCollisions(head) {
    let ateApple = false;

    for (let i = 0; i < apples.length; i++) {
      const a = apples[i];
      if (a.x === head.x && a.y === head.y) {
        ateApple = true;

        // score pour cette pomme
        const gain = getAppleScoreGain();
        score += gain;
        updateScoreLabel();

        // on enlève la pomme mangée
        apples.splice(i, 1);

        if (a.type === "golden") {
          // Pomme dorée → 5 nouvelles pommes normales
          for (let k = 0; k < 5; k++) {
            spawnApple("normal");
          }
        } else {
          // pomme normale : on en remet une
          spawnApple("normal");
        }

        // après toute pomme mangée, on tente les bonus rares
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
    if (el) {
      el.textContent = score;
    }
  }

  function getCurrentSpeed() {
    let base = SPEEDS[currentMode] || SPEEDS.normal;
    if (activeEffects.turbo) {
      base = Math.max(30, Math.floor(base * 0.6)); // ~40% plus rapide
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

    // Appliquer la direction tapée
    snakeDir = { ...nextDir };

    // Nouvelle position de la tête
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
      return gameOver();
    }

    // Collision avec soi-même
    if (snake.some(seg => seg.x === newHead.x && seg.y === newHead.y)) {
      return gameOver();
    }

    // Ajouter tête
    snake.unshift(newHead);

    // Pommes
    const ateApple = handleAppleCollisions(newHead);

    // Bonus
    handleBonusCollisions(newHead);

    // Si on n'a pas mangé de pomme, on enlève la queue
    if (!ateApple) {
      snake.pop();
    }

    // On nettoie les bonus expirés
    cleanExpiredBonuses();

    draw();
  }

  function gameOver() {
    running = false;
    clearInterval(gameInterval);
    gameInterval = null;

    clearAllEffects();

    drawGameOver();
    askNameAndStoreScore();
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
      // verticales
      ctx.beginPath();
      ctx.moveTo(i * tileSize, 0);
      ctx.lineTo(i * tileSize, canvas.height);
      ctx.stroke();

      // horizontales
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
    apples.forEach(a => {
      if (a.type === "golden") {
        ctx.fillStyle = "#facc15"; // jaune/or
      } else {
        ctx.fillStyle = "#ff4757"; // rouge
      }
      ctx.beginPath();
      ctx.arc(
        a.x * tileSize + tileSize / 2,
        a.y * tileSize + tileSize / 2,
        tileSize / 2 - 2,
        0,
        Math.PI * 2
      );
      ctx.fill();
    });
  }

  function drawBonuses() {
    bonusItems.forEach(b => {
      switch (b.type) {
        case "turbo":
          ctx.fillStyle = "#f97316"; // orange
          break;
        case "double":
          ctx.fillStyle = "#22c55e"; // vert
          break;
        case "jackpot":
          ctx.fillStyle = "#eab308"; // jaune
          break;
        case "slim":
          ctx.fillStyle = "#a855f7"; // violet
          break;
        default:
          ctx.fillStyle = "#ffffff";
      }
      ctx.fillRect(
        b.x * tileSize + 3,
        b.y * tileSize + 3,
        tileSize - 6,
        tileSize - 6
      );
    });
  }

  function draw() {
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
  //   VITESSE & MODES
  // ==========================

  function setSpeedMode(mode) {
    if (!SPEEDS[mode]) return;
    currentMode = mode;

    // Mettre à jour l'affichage de la vitesse si l'élément existe
    const label = document.getElementById("snake-speed-label");
    if (label) {
      const txt =
        mode === "lent"
          ? "Lent"
          : mode === "rapide"
          ? "Rapide"
          : "Normal";
      label.textContent = txt;
    }

    if (running) {
      restartGameInterval();
    }

    renderScoreboards();
  }

  // Raccourcis clavier : 1 = lent, 2 = normal, 3 = rapide
  document.addEventListener("keydown", (e) => {
    if (e.key === "1") setSpeedMode("lent");
    if (e.key === "2") setSpeedMode("normal");
    if (e.key === "3") setSpeedMode("rapide");
  });

  // ==========================
  //   INIT
  // ==========================

  function init(canvasId = "snakeCanvas") {
    canvas = document.getElementById(canvasId);
    if (!canvas) {
      console.warn("[Snake] Canvas introuvable, id =", canvasId);
      return;
    }
    ctx = canvas.getContext("2d");

    // si le canvas n'a pas de taille définie, on en met une
    if (!canvas.width) canvas.width = tileCount * tileSize;
    if (!canvas.height) canvas.height = tileCount * tileSize;

    tileSize = Math.floor(Math.min(canvas.width, canvas.height) / tileCount);

    loadLeaderboards();
    renderScoreboards();
    setSpeedMode(currentMode);
    resetGame();
    restartGameInterval();
  }

  // Contrôle de la direction avec ZQSD / flèches
  document.addEventListener("keydown", (e) => {
    // On évite de tourner à 180° brutalement
    if (e.key === "ArrowUp" || e.key === "z") {
      if (snakeDir.y === 1) return;
      nextDir = { x: 0, y: -1 };
    } else if (e.key === "ArrowDown" || e.key === "s") {
      if (snakeDir.y === -1) return;
      nextDir = { x: 0, y: 1 };
    } else if (e.key === "ArrowLeft" || e.key === "q") {
      if (snakeDir.x === 1) return;
      nextDir = { x: -1, y: 0 };
    } else if (e.key === "ArrowRight" || e.key === "d") {
      if (snakeDir.x === -1) return;
      nextDir = { x: 1, y: 0 };
    }
  });

  // Expose quelques fonctions globales (pratique pour dashboard.js)
  window.NebuleAirSnake = {
    init,
    setMode: setSpeedMode,
    resetScores: function () {
      leaderboards = { lent: [], normal: [], rapide: [] };
      saveLeaderboards();
      renderScoreboards();
    }
  };

  // Surtout pas d'auto-init ici :
  // c'est le dashboard qui appelle NebuleAirSnake.init("snakeCanvas")
  // quand on tape "snake".
})();
