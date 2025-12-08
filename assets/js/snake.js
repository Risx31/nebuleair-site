// ============================
//  EASTER EGG : SNAKE (trigger "snake")
// ============================

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("snake-container");
  const canvas = document.getElementById("snake-canvas");
  const closeBtn = document.getElementById("snake-close");
  const scoreSpan = document.getElementById("snake-score-value");

  if (!container || !canvas || !closeBtn || !scoreSpan) {
    console.warn("[NebuleAir] Snake : éléments HTML manquants, easter egg désactivé.");
    return;
  }

  const ctx = canvas.getContext("2d");
  const tileSize = 20;
  const cols = canvas.width / tileSize;
  const rows = canvas.height / tileSize;

  let snake = [];
  let direction = { x: 1, y: 0 };
  let nextDirection = { x: 1, y: 0 };
  let food = null;
  let running = false;
  let loopId = null;
  let score = 0;

  // ---------- Affichage overlay ----------
  function showSnake() {
    container.classList.remove("snake-hidden");
    resetGame();
    startLoop();
  }

  function hideSnake() {
    container.classList.add("snake-hidden");
    stopLoop();
  }

  closeBtn.addEventListener("click", hideSnake);
  container.addEventListener("click", (e) => {
    if (e.target === container) hideSnake();
  });

  // ---------- Secret "snake" ----------
  const secret = "snake";
  let buffer = "";

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();

    // Si l'overlay est ouvert : on gère les flèches
    if (!container.classList.contains("snake-hidden")) {
      if (key === "arrowup" && direction.y !== 1) {
        nextDirection = { x: 0, y: -1 };
      } else if (key === "arrowdown" && direction.y !== -1) {
        nextDirection = { x: 0, y: 1 };
      } else if (key === "arrowleft" && direction.x !== 1) {
        nextDirection = { x: -1, y: 0 };
      } else if (key === "arrowright" && direction.x !== -1) {
        nextDirection = { x: 1, y: 0 };
      }
      return;
    }

    // Si fermé : on écoute juste le mot secret
    if (!/[a-z]/.test(key)) return;

    buffer += key;
    if (buffer.length > secret.length) {
      buffer = buffer.slice(-secret.length);
    }

    if (buffer === secret) {
      buffer = "";
      showSnake();
    }
  });

  // ---------- Logique du jeu ----------
  function resetGame() {
    snake = [
      { x: Math.floor(cols / 2), y: Math.floor(rows / 2) }
    ];
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
    score = 0;
    scoreSpan.textContent = score.toString();
    placeFood();
    draw();
  }

  function startLoop() {
    if (running) return;
    running = true;
    loopId = setInterval(tick, 120);
  }

  function stopLoop() {
    running = false;
    if (loopId) {
      clearInterval(loopId);
      loopId = null;
    }
  }

  function placeFood() {
    let valid = false;
    while (!valid) {
      const fx = Math.floor(Math.random() * cols);
      const fy = Math.floor(Math.random() * rows);
      valid = !snake.some(seg => seg.x === fx && seg.y === fy);
      if (valid) {
        food = { x: fx, y: fy };
      }
    }
  }

  function tick() {
    direction = nextDirection;

    const head = snake[0];
    const newHead = {
      x: head.x + direction.x,
      y: head.y + direction.y
    };

    // Collision mur
    if (newHead.x < 0 || newHead.x >= cols || newHead.y < 0 || newHead.y >= rows) {
      gameOver();
      return;
    }

    // Collision sur soi-même
    if (snake.some(seg => seg.x === newHead.x && seg.y === newHead.y)) {
      gameOver();
      return;
    }

    snake.unshift(newHead);

    // Mange la pomme
    if (food && newHead.x === food.x && newHead.y === food.y) {
      score += 10;
      scoreSpan.textContent = score.toString();
      placeFood();
    } else {
      snake.pop();
    }

    draw();
  }

  function gameOver() {
    stopLoop();
    draw(true);
    setTimeout(() => {
      resetGame();
      startLoop();
    }, 700);
  }

  function draw(isGameOver = false) {
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (food) {
      ctx.fillStyle = "#f97316";
      ctx.fillRect(
        food.x * tileSize + 2,
        food.y * tileSize + 2,
        tileSize - 4,
        tileSize - 4
      );
    }

    snake.forEach((seg, index) => {
      if (index === 0) {
        ctx.fillStyle = isGameOver ? "#ef4444" : "#22c55e";
      } else {
        ctx.fillStyle = isGameOver ? "#b91c1c" : "#4ade80";
      }
      ctx.fillRect(
        seg.x * tileSize + 2,
        seg.y * tileSize + 2,
        tileSize - 4,
        tileSize - 4
      );
    });
  }
});
