// assets/js/snake.js
// NebuleAir Snake – avec classements & modes de vitesse
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
  let apple = { x: 10, y: 10 };
  let running = false;
  let score = 0;

  // Classements
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

    // si l'utilisateur annule ou laisse vide, on met "Anonyme"
    const name = (pseudo && pseudo.trim()) || "Anonyme";
    addScore(currentMode, name, score);
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

    placeApple();
    score = 0;
    updateScoreLabel();
    running = true;
  }

  function placeApple() {
    let valid = false;
    let x, y;
    while (!valid) {
      x = Math.floor(Math.random() * tileCount);
      y = Math.floor(Math.random() * tileCount);
      valid = !snake.some(seg => seg.x === x && seg.y === y);
    }
    apple.x = x;
    apple.y = y;
  }

  function updateScoreLabel() {
    const el = document.getElementById("snake-score-current");
    if (el) {
      el.textContent = score;
    }
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

    // Mange la pomme ?
    if (newHead.x === apple.x && newHead.y === apple.y) {
      score++;
      updateScoreLabel();
      placeApple();
    } else {
      // Sinon, on supprime la queue
      snake.pop();
    }

    draw();
  }

  function gameOver() {
    running = false;
    clearInterval(gameInterval);
    gameInterval = null;

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

  function drawApple() {
    ctx.fillStyle = "#ff4757";
    ctx.beginPath();
    ctx.arc(
      apple.x * tileSize + tileSize / 2,
      apple.y * tileSize + tileSize / 2,
      tileSize / 2 - 2,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  function draw() {
    clearCanvas();
    drawGrid();
    drawSnake();
    drawApple();
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
      // on relance la boucle avec la nouvelle vitesse
      if (gameInterval) clearInterval(gameInterval);
      gameInterval = setInterval(gameLoop, SPEEDS[currentMode]);
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

    // Démarre la boucle de jeu
    if (gameInterval) clearInterval(gameInterval);
    gameInterval = setInterval(gameLoop, SPEEDS[currentMode]);
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

  // Auto-init si le canvas est déjà dans la page
 // document.addEventListener("DOMContentLoaded", () => {
  //  if (document.getElementById("snakeCanvas")) {
  //   init("snakeCanvas");
 //   }
//  });
})();
