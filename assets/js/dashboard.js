// assets/js/dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  console.log("[NebuleAir] Dashboard JS chargé");

  // ============================
  //  CONFIG GÉNÉRALE
  // ============================
  const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
  const BUCKET = "Nodule Air";

  let currentRange = "1h";   // "1h", "6h", "24h", "7j", "30j"
  let customRange = null;    // { start: Date, end: Date } si dates choisies

  // Données brutes
  let labelsRaw = [];
  let series = {
    pm1: [],
    pm25: [],
    pm10: [],
    temperature: [],
    humidite: []
  };

  // ============================
  //  RÉFÉRENCES DOM
  // ============================

  const pm1Span = document.getElementById("pm1-value");
  const pm25Span = document.getElementById("pm25-value");
  const pm10Span = document.getElementById("pm10-value");
  const tempSpan = document.getElementById("temp-value");
  const humSpan = document.getElementById("hum-value");
  const wifiSpan = document.getElementById("wifi-value");

  const pm1Toggle = document.getElementById("pm1-toggle");
  const pm25Toggle = document.getElementById("pm25-toggle");
  const pm10Toggle = document.getElementById("pm10-toggle");
  const tempToggle = document.getElementById("temp-toggle");
  const humToggle = document.getElementById("hum-toggle");

  const rangeButtons = Array.from(document.querySelectorAll(".range-btn"));
  const startDateInput = document.getElementById("start-date");
  const endDateInput = document.getElementById("end-date");
  const applyRangeBtn = document.getElementById("apply-range");

  const resetZoomBtn = document.getElementById("reset-zoom");
  const exportCsvBtn = document.getElementById("export-csv");

  // ============================
  //  INIT CHART.JS
  // ============================

  const canvas = document.getElementById("mainChart");
  let mainChart = null;

  if (canvas && window.Chart) {
    const ctx = canvas.getContext("2d");

    const baseDatasets = [
      {
        id: "pm1",
        label: "PM1",
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.15)",
      },
      {
        id: "pm25",
        label: "PM2.5",
        borderColor: "#10b981",
        backgroundColor: "rgba(16, 185, 129, 0.15)",
      },
      {
        id: "pm10",
        label: "PM10",
        borderColor: "#f97316",
        backgroundColor: "rgba(249, 115, 22, 0.15)",
      },
      {
        id: "temperature",
        label: "Température",
        borderColor: "#ef4444",
        backgroundColor: "rgba(239, 68, 68, 0.15)",
      },
      {
        id: "humidite",
        label: "Humidité",
        borderColor: "#6366f1",
        backgroundColor: "rgba(99, 102, 241, 0.15)",
      },
    ];

    mainChart = new Chart(ctx, {
      type: "line",
      data: {
        datasets: baseDatasets.map((cfg) => ({
          ...cfg,
          data: [],
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false, // on fournit {x, y}
        spanGaps: false, // ne pas relier à travers les trous (NaN)
        interaction: {
          mode: "nearest",
          intersect: false,
        },
        scales: {
          x: {
            type: "time",
            time: {
              unit: "hour",
              tooltipFormat: "dd/MM/yyyy HH:mm",
            },
            ticks: {
              source: "auto",
            },
          },
          y: {
            beginAtZero: true,
          },
        },
        plugins: {
          legend: {
            display: true,
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y;
                if (v == null || Number.isNaN(v)) return `${ctx.dataset.label}: --`;
                return `${ctx.dataset.label}: ${v.toFixed(2)}`;
              },
            },
          },
        },
      },
    });
  } else {
    console.error("[NebuleAir] Canvas ou Chart.js manquant");
  }

  function applySeriesToChart() {
    if (!mainChart) return;

    const map = {
      pm1: "pm1",
      pm25: "pm25",
      pm10: "pm10",
      temperature: "temperature",
      humidite: "humidite",
    };

    mainChart.data.datasets.forEach((ds) => {
      const key = map[ds.id];
      ds.data = key ? series[key] : [];
    });

    // visibilité selon les cases à cocher
    mainChart.data.datasets.forEach((ds) => {
      if (ds.id === "pm1") ds.hidden = !pm1Toggle.checked;
      if (ds.id === "pm25") ds.hidden = !pm25Toggle.checked;
      if (ds.id === "pm10") ds.hidden = !pm10Toggle.checked;
      if (ds.id === "temperature") ds.hidden = !tempToggle.checked;
      if (ds.id === "humidite") ds.hidden = !humToggle.checked;
    });

    mainChart.update();
  }

  // ============================
  //  FETCH INFLUX
  // ============================

  function buildRangePayload() {
    if (customRange && customRange.start && customRange.end) {
      return {
        mode: "custom",
        start: customRange.start.toISOString(),
        end: customRange.end.toISOString(),
      };
    }
    // on garde un truc simple pour le proxy : -1h, -6h, etc.
    return { mode: "relative", range: currentRange };
  }

  async function fetchDataAndUpdate() {
    console.log("[NebuleAir] Fetch Influx…");

    labelsRaw = [];
    series = {
      pm1: [],
      pm25: [],
      pm10: [],
      temperature: [],
      humidite: [],
    };

    try {
      const payload = {
        bucket: BUCKET,
        range: buildRangePayload(),
      };

      const res = await fetch(INFLUX_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error("[NebuleAir] Erreur HTTP Influx:", res.status, res.statusText);
        applySeriesToChart();
        return;
      }

      const json = await res.json();
      // On essaye d'être tolérant sur la forme de la réponse
      const points = json.points || json.data || [];

      points.forEach((p) => {
        const tRaw = p.time || p._time || p.timestamp || p.date;
        const t = tRaw ? new Date(tRaw) : null;
        if (!t || Number.isNaN(t.getTime())) return;

        labelsRaw.push(t);

        function push(fieldName, key) {
          const v = Number(p[key]);
          const y = Number.isFinite(v) ? v : NaN;
          series[fieldName].push({ x: t, y });
        }

        push("pm1", "pm1");
        push("pm25", "pm25");
        push("pm10", "pm10");
        push("temperature", "temperature");
        push("humidite", "humidite");
      });

      // valeurs instantanées (dernier point)
      const last =
        json.last ||
        (points.length > 0 ? points[points.length - 1] : null);

      if (last) {
        if (pm1Span && last.pm1 != null) pm1Span.textContent = Number(last.pm1).toFixed(1);
        if (pm25Span && last.pm25 != null) pm25Span.textContent = Number(last.pm25).toFixed(1);
        if (pm10Span && last.pm10 != null) pm10Span.textContent = Number(last.pm10).toFixed(1);
        if (tempSpan && last.temperature != null) tempSpan.textContent = Number(last.temperature).toFixed(1);
        if (humSpan && last.humidite != null) humSpan.textContent = Number(last.humidite).toFixed(1);

        // RSSI potentiellement rssi ou wifi_rssi
        const rssi = last.rssi ?? last.wifi_rssi ?? last.wifi;
        if (wifiSpan && rssi != null) wifiSpan.textContent = rssi.toString();
      }

      applySeriesToChart();
    } catch (err) {
      console.error("[NebuleAir] Erreur fetch Influx:", err);
      applySeriesToChart(); // au moins on affiche un graph vide
    }
  }

  // ============================
  //  GESTION DES FILTRES
  // ============================

  if (pm1Toggle && pm25Toggle && pm10Toggle && tempToggle && humToggle) {
    [pm1Toggle, pm25Toggle, pm10Toggle, tempToggle, humToggle].forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        applySeriesToChart();
      });
    });
  }

  if (rangeButtons.length > 0) {
    rangeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        rangeButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentRange = btn.dataset.range || "1h";
        customRange = null;
        if (startDateInput) startDateInput.value = "";
        if (endDateInput) endDateInput.value = "";
        fetchDataAndUpdate();
      });
    });
  }

  if (applyRangeBtn) {
    applyRangeBtn.addEventListener("click", () => {
      if (!startDateInput || !endDateInput) return;

      const s = startDateInput.value;
      const e = endDateInput.value;
      if (!s || !e) return;

      const start = new Date(s + "T00:00:00");
      const end = new Date(e + "T23:59:59");

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        console.warn("[NebuleAir] Dates invalides pour la plage personnalisée");
        return;
      }

      customRange = { start, end };
      currentRange = ""; // plus de range relative
      rangeButtons.forEach((b) => b.classList.remove("active"));

      fetchDataAndUpdate();
    });
  }

  if (resetZoomBtn) {
    resetZoomBtn.addEventListener("click", () => {
      // sans plugin de zoom : on se contente de recharger les données
      fetchDataAndUpdate();
    });
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      if (labelsRaw.length === 0) return;

      let csv = "time;pm1;pm25;pm10;temperature;humidite\n";

      for (let i = 0; i < labelsRaw.length; i++) {
        const t = labelsRaw[i].toISOString();

        function val(arr) {
          const p = arr[i];
          if (!p || p.y == null || Number.isNaN(p.y)) return "";
          return String(p.y);
        }

        csv += [
          t,
          val(series.pm1),
          val(series.pm25),
          val(series.pm10),
          val(series.temperature),
          val(series.humidite),
        ].join(";") + "\n";
      }

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "nebuleair_data.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // ============================
  //  INIT LEAFLET
  // ============================

  (function initMapNebuleAir() {
    const mapElement = document.getElementById("map");
    if (!mapElement) {
      console.warn("[NebuleAir] Élément #map introuvable.");
      return;
    }
    if (typeof L === "undefined") {
      console.warn("[NebuleAir] Leaflet non chargé.");
      return;
    }

    const SENSOR_LAT = 43.305440952514594;
    const SENSOR_LON = 5.3948736958397765;

    const map = L.map(mapElement).setView([SENSOR_LAT, SENSOR_LON], 16);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    L.marker([SENSOR_LAT, SENSOR_LON])
      .addTo(map)
      .bindPopup("Capteur NebuleAir")
      .openPopup();
  })();

  // ============================
  //  EASTER EGG : SNAKE
  // ============================

  (function initSnake() {
    const container = document.getElementById("snake-container");
    const closeBtn = document.getElementById("snake-close");
    const canvasSnake = document.getElementById("snake-canvas");
    const scoreSpan = document.getElementById("snake-score-value");

    if (!container || !closeBtn || !canvasSnake || !scoreSpan) {
      console.warn("[NebuleSnake] éléments manquants, jeu non initialisé.");
      return;
    }

    const ctx = canvasSnake.getContext("2d");
    const cellSize = 20;
    const cells = canvasSnake.width / cellSize;

    let snake = [];
    let direction = { x: 1, y: 0 };
    let food = null;
    let score = 0;
    let loopId = null;

    function resetGame() {
      snake = [{ x: 10, y: 10 }];
      direction = { x: 1, y: 0 };
      score = 0;
      scoreSpan.textContent = "0";
      placeFood();
    }

    function placeFood() {
      food = {
        x: Math.floor(Math.random() * cells),
        y: Math.floor(Math.random() * cells),
      };
    }

    function draw() {
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, canvasSnake.width, canvasSnake.height);

      // food
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(food.x * cellSize, food.y * cellSize, cellSize, cellSize);

      // snake
      ctx.fillStyle = "#facc15";
      snake.forEach((seg) => {
        ctx.fillRect(seg.x * cellSize, seg.y * cellSize, cellSize, cellSize);
      });
    }

    function step() {
      const head = {
        x: snake[0].x + direction.x,
        y: snake[0].y + direction.y,
      };

      // murs
      if (
        head.x < 0 ||
        head.x >= cells ||
        head.y < 0 ||
        head.y >= cells
      ) {
        resetGame();
        return;
      }

      // auto-collision
      if (snake.some((seg) => seg.x === head.x && seg.y === head.y)) {
        resetGame();
        return;
      }

      snake.unshift(head);

      if (head.x === food.x && head.y === food.y) {
        score += 1;
        scoreSpan.textContent = String(score);
        placeFood();
      } else {
        snake.pop();
      }

      draw();
    }

    function startGame() {
      resetGame();
      if (loopId) clearInterval(loopId);
      loopId = setInterval(step, 120);
    }

    function stopGame() {
      if (loopId) clearInterval(loopId);
    }

    function openSnake() {
      container.classList.remove("snake-hidden");
      startGame();
    }

    function closeSnake() {
      container.classList.add("snake-hidden");
      stopGame();
    }

    closeBtn.addEventListener("click", closeSnake);

    // détection du mot "snake" tapé au clavier
    let buffer = "";
    const SECRET = "snake";

    window.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();

      // buffer pour détecter s-n-a-k-e
      if (key.length === 1 && key >= "a" && key <= "z") {
        buffer += key;
        if (buffer.length > SECRET.length) {
          buffer = buffer.slice(-SECRET.length);
        }
        if (buffer === SECRET) {
          openSnake();
        }
      }

      // contrôle du serpent uniquement si le jeu est visible
      if (!container.classList.contains("snake-hidden")) {
        if (e.key === "ArrowUp" && direction.y !== 1) direction = { x: 0, y: -1 };
        if (e.key === "ArrowDown" && direction.y !== -1) direction = { x: 0, y: 1 };
        if (e.key === "ArrowLeft" && direction.x !== 1) direction = { x: -1, y: 0 };
        if (e.key === "ArrowRight" && direction.x !== -1) direction = { x: 1, y: 0 };
      }
    });
  })();

  // ============================
  //  PREMIER CHARGEMENT
  // ============================
  fetchDataAndUpdate();
});
