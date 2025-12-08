// assets/js/dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  console.log("[NebuleAir] Dashboard JS chargé");

  // ============================
  //  CONFIG BACKEND / INFLUX
  // ============================
  const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
  const BUCKET = "Nodule Air";

  let currentRange = "1h";    // "1h", "6h", "24h", "7j", "30j", "custom"
  let customRange = null;     // { start: ISO, end: ISO }

  let labelsRaw = [];         // tableaux de Date
  let series = {
    pm1: [],
    pm25: [],
    pm10: [],
    temperature: [],
    humidite: [],
    wifi: []
  };

  // ============================
  //  RÉFÉRENCES DOM
  // ============================
  const canvas = document.getElementById("mainChart");
  if (!canvas) {
    console.error("[NebuleAir] Canvas #mainChart introuvable");
    return;
  }
  const ctx = canvas.getContext("2d");

  const pm1ValueEl  = document.getElementById("pm1-value");
  const pm25ValueEl = document.getElementById("pm25-value");
  const pm10ValueEl = document.getElementById("pm10-value");
  const tempValueEl = document.getElementById("temp-value");
  const humValueEl  = document.getElementById("hum-value");
  const wifiValueEl = document.getElementById("wifi-value");

  const pm1Toggle  = document.getElementById("pm1-toggle");
  const pm25Toggle = document.getElementById("pm25-toggle");
  const pm10Toggle = document.getElementById("pm10-toggle");
  const tempToggle = document.getElementById("temp-toggle");
  const humToggle  = document.getElementById("hum-toggle");

  const rangeButtons   = document.querySelectorAll(".range-btn");
  const startDateInput = document.getElementById("start-date");
  const endDateInput   = document.getElementById("end-date");
  const applyRangeBtn  = document.getElementById("apply-range");

  const resetZoomBtn = document.getElementById("reset-zoom");
  const exportCsvBtn = document.getElementById("export-csv");

  // ============================
  //  CHART.JS
  // ============================

  const mainChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "PM1",
          data: [],
          parsing: false,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,0.1)",
          tension: 0.2,
          borderWidth: 2
        },
        {
          label: "PM2.5",
          data: [],
          parsing: false,
          borderColor: "#16a34a",
          backgroundColor: "rgba(22,163,74,0.1)",
          tension: 0.2,
          borderWidth: 2
        },
        {
          label: "PM10",
          data: [],
          parsing: false,
          borderColor: "#f97316",
          backgroundColor: "rgba(249,115,22,0.1)",
          tension: 0.2,
          borderWidth: 2
        },
        {
          label: "Température",
          data: [],
          parsing: false,
          borderColor: "#ec4899",
          backgroundColor: "rgba(236,72,153,0.08)",
          tension: 0.2,
          borderWidth: 2,
          yAxisID: "yTempHum"
        },
        {
          label: "Humidité",
          data: [],
          parsing: false,
          borderColor: "#8b5cf6",
          backgroundColor: "rgba(139,92,246,0.08)",
          tension: 0.2,
          borderWidth: 2,
          yAxisID: "yTempHum"
        }
      ]
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      responsive: true,
      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false
      },
      scales: {
        x: {
          type: "time",
          time: {
            tooltipFormat: "dd/MM/yyyy HH:mm",
            displayFormats: {
              minute: "HH:mm",
              hour: "HH:mm",
              day: "dd/MM"
            }
          },
          ticks: {
            maxRotation: 0,
            autoSkip: true
          },
          grid: {
            color: "rgba(148,163,184,0.2)"
          }
        },
        y: {
          position: "left",
          title: {
            display: true,
            text: "Particules (µg/m³)"
          },
          grid: {
            color: "rgba(148,163,184,0.2)"
          }
        },
        yTempHum: {
          position: "right",
          title: {
            display: true,
            text: "Température / Humidité"
          },
          grid: {
            drawOnChartArea: false
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          labels: { usePointStyle: true }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              if (v == null) return ctx.dataset.label + " : --";
              return ctx.dataset.label + " : " + v.toFixed(2);
            }
          }
        }
      }
    }
  });

  function updateChartDatasets() {
    const labels = labelsRaw;

    const buildData = (arr) =>
      labels.map((t, i) => {
        const v = arr[i];
        return v == null ? { x: t, y: null } : { x: t, y: v };
      });

    mainChart.data.datasets[0].data = buildData(series.pm1);
    mainChart.data.datasets[1].data = buildData(series.pm25);
    mainChart.data.datasets[2].data = buildData(series.pm10);
    mainChart.data.datasets[3].data = buildData(series.temperature);
    mainChart.data.datasets[4].data = buildData(series.humidite);

    mainChart.update();
  }

  // ============================
  //  FETCH DONNÉES INFLUX
  // ============================

  // *** IMPORTANT : payload simple pour coller au flow Node-RED ***
  function makeRequestPayload() {
    if (currentRange === "custom" && customRange && customRange.start && customRange.end) {
      return {
        bucket: BUCKET,
        range: "custom",
        start: customRange.start,
        end: customRange.end
      };
    }

    // Plage relative : "1h", "6h", "24h", "7j", "30j"
    return {
      bucket: BUCKET,
      range: currentRange
    };
  }

  function safeNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function parseInfluxResponse(json) {
    console.log("[NebuleAir] Réponse Influx brute :", json);

    labelsRaw = [];
    series.pm1 = [];
    series.pm25 = [];
    series.pm10 = [];
    series.temperature = [];
    series.humidite = [];
    series.wifi = [];

    // Si c'est clairement une erreur, on sort
    if (json && json.code && json.message) {
      console.warn("[NebuleAir] Erreur renvoyée par le proxy :", json.code, json.message);
      return;
    }

    // Format 1 : { labels:[], pm1:[], ... }
    if (Array.isArray(json.labels)) {
      labelsRaw = json.labels.map((t) => new Date(t));
      ["pm1", "pm25", "pm10", "temperature", "humidite", "wifi"].forEach((k) => {
        if (Array.isArray(json[k])) series[k] = json[k].map(safeNumber);
      });
      return;
    }

    // Format 2 : { rows:[{time, pm1,...}, ...] }
    if (Array.isArray(json.rows)) {
      labelsRaw = json.rows.map((r) => new Date(r.time));
      json.rows.forEach((r) => {
        series.pm1.push(safeNumber(r.pm1));
        series.pm25.push(safeNumber(r.pm25));
        series.pm10.push(safeNumber(r.pm10));
        series.temperature.push(safeNumber(r.temperature));
        series.humidite.push(safeNumber(r.humidite));
        series.wifi.push(safeNumber(r.wifi));
      });
      return;
    }

    // Format 3 : tableau direct [{time, pm1,...}]
    if (Array.isArray(json)) {
      labelsRaw = json.map((r) => new Date(r.time));
      json.forEach((r) => {
        series.pm1.push(safeNumber(r.pm1));
        series.pm25.push(safeNumber(r.pm25));
        series.pm10.push(safeNumber(r.pm10));
        series.temperature.push(safeNumber(r.temperature));
        series.humidite.push(safeNumber(r.humidite));
        series.wifi.push(safeNumber(r.wifi));
      });
      return;
    }

    console.warn("[NebuleAir] Format de réponse Influx inconnu, aucune donnée parsée.");
  }

  async function loadData() {
    try {
      const payload = makeRequestPayload();
      console.log("[NebuleAir] Requête Influx :", payload);

      const resp = await fetch(INFLUX_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        console.error("[NebuleAir] Erreur HTTP Influx :", resp.status, resp.statusText);
        return;
      }

      const json = await resp.json();
      parseInfluxResponse(json);
      updateChartDatasets();
      updateLiveCards();
    } catch (err) {
      console.error("[NebuleAir] Erreur fetch Influx :", err);
    }
  }

  function lastNonNull(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] != null && Number.isFinite(arr[i])) return arr[i];
    }
    return null;
  }

  function updateLiveCards() {
    const lastPm1  = lastNonNull(series.pm1);
    const lastPm25 = lastNonNull(series.pm25);
    const lastPm10 = lastNonNull(series.pm10);
    const lastT    = lastNonNull(series.temperature);
    const lastH    = lastNonNull(series.humidite);
    const lastWifi = lastNonNull(series.wifi);

    if (pm1ValueEl)  pm1ValueEl.textContent  = lastPm1  != null ? lastPm1.toFixed(1)  : "--";
    if (pm25ValueEl) pm25ValueEl.textContent = lastPm25 != null ? lastPm25.toFixed(1) : "--";
    if (pm10ValueEl) pm10ValueEl.textContent = lastPm10 != null ? lastPm10.toFixed(1) : "--";
    if (tempValueEl) tempValueEl.textContent = lastT    != null ? lastT.toFixed(1)    : "--";
    if (humValueEl)  humValueEl.textContent  = lastH    != null ? lastH.toFixed(0)    : "--";
    if (wifiValueEl) wifiValueEl.textContent = lastWifi != null ? lastWifi.toFixed(0) : "--";
  }

  // ============================
  //  GESTION DES FILTRES
  // ============================

  function syncTogglesWithChart() {
    if (pm1Toggle)  mainChart.data.datasets[0].hidden = !pm1Toggle.checked;
    if (pm25Toggle) mainChart.data.datasets[1].hidden = !pm25Toggle.checked;
    if (pm10Toggle) mainChart.data.datasets[2].hidden = !pm10Toggle.checked;
    if (tempToggle) mainChart.data.datasets[3].hidden = !tempToggle.checked;
    if (humToggle)  mainChart.data.datasets[4].hidden = !humToggle.checked;
    mainChart.update();
  }

  [pm1Toggle, pm25Toggle, pm10Toggle, tempToggle, humToggle].forEach((el) => {
    if (!el) return;
    el.addEventListener("change", syncTogglesWithChart);
  });

  rangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      rangeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentRange = btn.dataset.range;
      customRange = null;
      if (startDateInput) startDateInput.value = "";
      if (endDateInput)   endDateInput.value   = "";
      loadData();
    });
  });

  if (applyRangeBtn) {
    applyRangeBtn.addEventListener("click", () => {
      if (!startDateInput.value || !endDateInput.value) {
        alert("Merci de sélectionner une date de début et une date de fin.");
        return;
      }
      const startISO = new Date(startDateInput.value + "T00:00:00").toISOString();
      const endISO   = new Date(endDateInput.value   + "T23:59:59").toISOString();

      customRange = { start: startISO, end: endISO };
      currentRange = "custom";
      rangeButtons.forEach((b) => b.classList.remove("active"));

      loadData();
    });
  }

  if (resetZoomBtn) {
    resetZoomBtn.addEventListener("click", () => {
      mainChart.options.scales.x.min = undefined;
      mainChart.options.scales.x.max = undefined;
      mainChart.update();
    });
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      if (!labelsRaw.length) {
        alert("Aucune donnée à exporter.");
        return;
      }

      let csv = "time,pm1,pm25,pm10,temperature,humidite,wifi\n";
      labelsRaw.forEach((d, i) => {
        csv += [
          d.toISOString(),
          series.pm1[i] ?? "",
          series.pm25[i] ?? "",
          series.pm10[i] ?? "",
          series.temperature[i] ?? "",
          series.humidite[i] ?? "",
          series.wifi[i] ?? ""
        ].join(",") + "\n";
      });

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = "nebuleair_data.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // ============================
  //  LEAFLET – CARTE
  // ============================

  (function initMapNebuleAir() {
    const SENSOR_LAT = 43.305440952514594;
    const SENSOR_LON = 5.3948736958397765;

    const mapElement = document.getElementById("map");
    if (!mapElement) {
      console.error("[NebuleAir] Élément #map introuvable.");
      return;
    }

    const map = L.map(mapElement).setView([SENSOR_LAT, SENSOR_LON], 16);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    L.marker([SENSOR_LAT, SENSOR_LON])
      .addTo(map)
      .bindPopup("Capteur NebuleAir")
      .openPopup();
  })();

  // ============================
  //  EASTER EGG : SNAKE
  // ============================

  const snakeContainer = document.getElementById("snake-container");
  const snakeCanvas    = document.getElementById("snake-canvas");
  const snakeCloseBtn  = document.getElementById("snake-close");
  const snakeScoreSpan = document.getElementById("snake-score-value");

  let snakeCtx;
  let snakeTimer = null;
  let snakeDirection = "right";
  let snakeBody = [];
  let snakeFood = null;
  let snakeScore = 0;
  let keyBuffer = "";

  function showSnake() {
    if (!snakeContainer || !snakeCanvas) return;
    snakeContainer.classList.remove("snake-hidden");
    snakeContainer.classList.add("snake-visible");
    snakeCtx = snakeCanvas.getContext("2d");
    startSnakeGame();
  }

  function hideSnake() {
    if (!snakeContainer) return;
    snakeContainer.classList.remove("snake-visible");
    snakeContainer.classList.add("snake-hidden");
    if (snakeTimer) {
      clearInterval(snakeTimer);
      snakeTimer = null;
    }
  }

  function startSnakeGame() {
    const cols = 20;
    const rows = 20;
    const cellSize = snakeCanvas.width / cols;

    snakeBody = [
      { x: 5, y: 10 },
      { x: 4, y: 10 },
      { x: 3, y: 10 }
    ];
    snakeDirection = "right";
    snakeScore = 0;
    if (snakeScoreSpan) snakeScoreSpan.textContent = "0";

    function placeFood() {
      let fx, fy;
      do {
        fx = Math.floor(Math.random() * cols);
        fy = Math.floor(Math.random() * rows);
      } while (snakeBody.some((p) => p.x === fx && p.y === fy));
      snakeFood = { x: fx, y: fy };
    }

    placeFood();

    function draw() {
      snakeCtx.fillStyle = "#f9fafb";
      snakeCtx.fillRect(0, 0, snakeCanvas.width, snakeCanvas.height);

      if (snakeFood) {
        snakeCtx.fillStyle = "#22c55e";
        snakeCtx.fillRect(
          snakeFood.x * cellSize,
          snakeFood.y * cellSize,
          cellSize,
          cellSize
        );
      }

      snakeCtx.fillStyle = "#2563eb";
      snakeBody.forEach((seg) => {
        snakeCtx.fillRect(
          seg.x * cellSize,
          seg.y * cellSize,
          cellSize - 4,
          cellSize - 4
        );
      });
    }

    function step() {
      const head = { ...snakeBody[0] };
      if (snakeDirection === "right") head.x++;
      if (snakeDirection === "left")  head.x--;
      if (snakeDirection === "up")    head.y--;
      if (snakeDirection === "down")  head.y++;

      if (head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows) {
        return gameOver();
      }
      if (snakeBody.some((seg) => seg.x === head.x && seg.y === head.y)) {
        return gameOver();
      }

      snakeBody.unshift(head);

      if (snakeFood && head.x === snakeFood.x && head.y === snakeFood.y) {
        snakeScore++;
        if (snakeScoreSpan) snakeScoreSpan.textContent = String(snakeScore);
        placeFood();
      } else {
        snakeBody.pop();
      }

      draw();
    }

    function gameOver() {
      clearInterval(snakeTimer);
      snakeTimer = null;
      snakeCtx.fillStyle = "rgba(0,0,0,0.4)";
      snakeCtx.fillRect(0, 0, snakeCanvas.width, snakeCanvas.height);
      snakeCtx.fillStyle = "#ffffff";
      snakeCtx.font = "20px system-ui";
      snakeCtx.textAlign = "center";
      snakeCtx.fillText("Game Over", snakeCanvas.width / 2, snakeCanvas.height / 2);
      snakeCtx.fillText(
        "Score : " + snakeScore,
        snakeCanvas.width / 2,
        snakeCanvas.height / 2 + 26
      );
    }

    draw();
    if (snakeTimer) clearInterval(snakeTimer);
    snakeTimer = setInterval(step, 130);
  }

  // Déclenchement en tapant "snake"
  document.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();

    if (/^[a-z0-9]$/.test(key)) {
      keyBuffer += key;
      if (keyBuffer.length > 5) keyBuffer = keyBuffer.slice(-5);
      if (keyBuffer === "snake") {
        console.log("[NebuleAir] Easter Egg Snake activé");
        keyBuffer = "";
        showSnake();
      }
    } else if (key === "escape") {
      keyBuffer = "";
    }

    if (!snakeTimer) return;

    if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      e.preventDefault();
      if (key === "arrowup" && snakeDirection !== "down")    snakeDirection = "up";
      if (key === "arrowdown" && snakeDirection !== "up")    snakeDirection = "down";
      if (key === "arrowleft" && snakeDirection !== "right") snakeDirection = "left";
      if (key === "arrowright" && snakeDirection !== "left") snakeDirection = "right";
    }
  });

  if (snakeCloseBtn) {
    snakeCloseBtn.addEventListener("click", hideSnake);
  }

  // ============================
  //  DÉMARRAGE
  // ============================
  syncTogglesWithChart();
  loadData();
});
