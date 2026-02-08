// assets/js/dashboard.js
document.addEventListener("DOMContentLoaded", () => {
  console.log("[NebuleAir] Dashboard JS chargé");

  // ============================
  // 0) CONFIG INFLUX
  // ============================
  const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
  const BUCKET = "Nodule Air";
  const MEASUREMENT = "nebuleair";

  // Champs qu’on veut charger (pivot -> une seule requête)
  const FIELDS = ["pm1", "pm25", "pm10", "temperature", "humidite", "rssi"];

  // ============================
  // 1) STATE
  // ============================
  let currentRange = "1h";       // "1h" | "24h" | "7j" | "30j"
  let customRange = null;        // { startISO: string, stopISO: string } ou null

  // Timestamps (Date)
  let labelsRaw = [];

  // Séries alignées sur labelsRaw
  const series = {
    pm1: [],
    pm25: [],
    pm10: [],
    temperature: [],
    humidite: [],
    rssi: []
  };

  // ============================
  // 2) THEME
  // ============================
  const body = document.body;
  const themeToggle = document.getElementById("themeToggle");
  const banana = document.getElementById("userProfileBanana");

  function applyTheme(theme) {
    body.classList.remove("light", "dark");
    body.classList.add(theme);
    localStorage.setItem("theme", theme);
  }

  function toggleTheme() {
    const next = body.classList.contains("light") ? "dark" : "light";
    applyTheme(next);
  }

  const savedTheme = localStorage.getItem("theme") || "light";
  applyTheme(savedTheme);

  themeToggle?.addEventListener("click", toggleTheme);
  banana?.addEventListener("click", toggleTheme);

  // ============================
  // 3) CHART.JS INIT
  // ============================
  const canvas = document.getElementById("mainChart");
  if (!canvas) {
    console.error("[NebuleAir] Canvas #mainChart introuvable");
    return;
  }

  const ctx = canvas.getContext("2d");

  const mainChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "PM1",
          data: [],
          borderColor: "#007bff",
          backgroundColor: "rgba(0, 123, 255, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true,
          yAxisID: "y"
        },
        {
          label: "PM2.5",
          data: [],
          borderColor: "#ff9800",
          backgroundColor: "rgba(255, 152, 0, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true,
          yAxisID: "y"
        },
        {
          label: "PM10",
          data: [],
          borderColor: "#e91e63",
          backgroundColor: "rgba(233, 30, 99, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true,
          yAxisID: "y"
        },
        {
          label: "Température",
          data: [],
          borderColor: "#00c853",
          backgroundColor: "rgba(0, 200, 83, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true,
          yAxisID: "y1"
        },
        {
          label: "Humidité",
          data: [],
          borderColor: "#26c6da",
          backgroundColor: "rgba(38, 198, 218, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true,
          yAxisID: "y1"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", labels: { usePointStyle: true } }
      },
      scales: {
        x: {
          type: "time",
          time: {
            tooltipFormat: "dd MMM yyyy HH:mm",
            displayFormats: { minute: "HH:mm", hour: "dd HH'h'", day: "dd MMM" }
          }
        },
        y: {
          type: "linear",
          display: true,
          position: "left",
          beginAtZero: true,
          title: { display: true, text: "µg/m³" }
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          grid: { drawOnChartArea: false },
          title: { display: true, text: "°C / %" }
        }
      }
    }
  });

  function setChartWindow(startISO, stopISO) {
    // Pour “visualiser une plage” : on force min/max sur l’axe X (visuel propre)
    if (!mainChart?.options?.scales?.x) return;

    mainChart.options.scales.x.min = startISO ? new Date(startISO) : undefined;
    mainChart.options.scales.x.max = stopISO ? new Date(stopISO) : undefined;
  }

  // ============================
  // 4) INFLUX HELPERS
  // ============================
  function fluxTime(iso) {
    // Flux: time(v: "2026-02-08T12:00:00.000Z")
    return `time(v: "${iso}")`;
  }

  function buildRangeClause() {
    if (customRange) {
      return `|> range(start: ${fluxTime(customRange.startISO)}, stop: ${fluxTime(customRange.stopISO)})`;
    }
    const map = { "1h": "-1h", "24h": "-24h", "7j": "-7d", "30j": "-30d" };
    return `|> range(start: ${map[currentRange] || "-1h"})`;
  }

  function getWindowEvery() {
    // Auto pour éviter 50k points qui mettent le PC en PLS
    if (!customRange) {
      const map = { "1h": "1m", "24h": "5m", "7j": "30m", "30j": "1h" };
      return map[currentRange] || "1m";
    }

    const startMs = new Date(customRange.startISO).getTime();
    const stopMs = new Date(customRange.stopISO).getTime();
    const minutes = Math.max(1, (stopMs - startMs) / 60000);

    if (minutes <= 180) return "1m";        // <= 3h
    if (minutes <= 1440) return "5m";       // <= 1j
    if (minutes <= 10080) return "30m";     // <= 7j
    if (minutes <= 43200) return "2h";      // <= 30j
    return "6h";
  }

  function parseInfluxPivotCsv(raw, fields) {
    // Influx CSV (annotated) : on ignore lignes #, puis header, puis données
    const lines = raw
      .split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#"));

    if (lines.length < 2) {
      return { times: [], rows: [] };
    }

    const header = lines[0].split(",");
    const timeIdx = header.indexOf("_time");
    if (timeIdx === -1) return { times: [], rows: [] };

    const idxByField = {};
    fields.forEach(f => (idxByField[f] = header.indexOf(f)));

    const times = [];
    const rows = []; // [{pm1:..., pm25:..., ...}, ...] aligné

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const t = cols[timeIdx];
      if (!t) continue;

      const obj = {};
      fields.forEach(f => {
        const idx = idxByField[f];
        if (idx === -1) {
          obj[f] = null;
          return;
        }
        const v = parseFloat(cols[idx]);
        obj[f] = Number.isFinite(v) ? v : null;
      });

      times.push(new Date(t));
      rows.push(obj);
    }

    return { times, rows };
  }

  async function fetchAllFieldsPivot() {
    const windowEvery = getWindowEvery();

    // Query unique: filtre measurement + fields, aggregateWindow, pivot
    const fluxQuery = `
from(bucket: "${BUCKET}")
  ${buildRangeClause()}
  |> filter(fn: (r) => r._measurement == "${MEASUREMENT}")
  |> filter(fn: (r) => contains(value: r._field, set: ${JSON.stringify(FIELDS)}))
  |> aggregateWindow(every: ${windowEvery}, fn: mean, createEmpty: false)
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: ${JSON.stringify(["_time", ...FIELDS])})
  |> sort(columns: ["_time"])
`;

    const res = await fetch(INFLUX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Accept": "text/csv"
      },
      body: fluxQuery
    });

    const txt = await res.text();
    if (!res.ok) {
      console.error("[NebuleAir] Influx erreur:", res.status, txt);
      throw new Error("Influx query failed");
    }

    return parseInfluxPivotCsv(txt, FIELDS);
  }

  // ============================
  // 5) UI UPDATE
  // ============================
  function lastFinite(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const v = arr[i];
      if (Number.isFinite(v)) return v;
    }
    return null;
  }

  function updateCards() {
    const mapping = {
      "pm1-value": series.pm1,
      "pm25-value": series.pm25,
      "pm10-value": series.pm10,
      "temp-value": series.temperature,
      "hum-value": series.humidite,
      "wifi-value": series.rssi // si tu as une carte wifi-value un jour
    };

    Object.keys(mapping).forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const v = lastFinite(mapping[id]);
      el.textContent = (v !== null) ? v.toFixed(1) : "--";
    });
  }

  function updateChart() {
    // datasets[0..4] = pm1, pm25, pm10, temperature, humidite
    const keys = ["pm1", "pm25", "pm10", "temperature", "humidite"];

    keys.forEach((key, i) => {
      mainChart.data.datasets[i].data = labelsRaw.map((t, idx) => ({
        x: t,
        y: series[key][idx]
      }));
    });

    mainChart.update();
  }

  // ============================
  // 6) LOAD DATA
  // ============================
  async function loadAllData() {
    try {
      const { times, rows } = await fetchAllFieldsPivot();

      labelsRaw = times;

      // reset arrays
      FIELDS.forEach(f => (series[f] = []));

      rows.forEach(r => {
        FIELDS.forEach(f => series[f].push(r[f]));
      });

      updateCards();
      updateChart();
    } catch (err) {
      console.error("[NebuleAir] Erreur chargement :", err);
    }
  }

  // ============================
  // 7) RANGE CONTROLS
  // ============================
  const rangeButtons = document.querySelectorAll(".btn-range");

  function clearRangeButtonsActive() {
    rangeButtons.forEach(b => b.classList.remove("active"));
  }

  function setActiveRangeButton(range) {
    clearRangeButtonsActive();
    rangeButtons.forEach(b => {
      if (b.dataset.range === range) b.classList.add("active");
    });
  }

  rangeButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      currentRange = btn.dataset.range || "1h";
      customRange = null;

      setActiveRangeButton(currentRange);
      setChartWindow(null, null);

      loadAllData();
    });
  });

  // Custom range (start -> end)
  function parseInputToDate(value, isEnd) {
    // Supporte date ("YYYY-MM-DD") et datetime-local ("YYYY-MM-DDTHH:mm")
    if (!value) return null;

    // date only
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const d = new Date(value + "T00:00:00");
      if (isEnd) {
        // Fin = lendemain 00:00 (stop exclusif en Flux, donc on englobe toute la journée)
        d.setDate(d.getDate() + 1);
      }
      return d;
    }

    // datetime-local
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  document.getElementById("apply-range")?.addEventListener("click", () => {
    const startVal = document.getElementById("start-date")?.value;
    const endVal = document.getElementById("end-date")?.value;

    const start = parseInputToDate(startVal, false);
    const stop = parseInputToDate(endVal, true);

    if (!start) return alert("Date/heure de début requise");
    if (!stop) return alert("Date/heure de fin requise");
    if (stop <= start) return alert("La fin doit être après le début");

    customRange = { startISO: start.toISOString(), stopISO: stop.toISOString() };
    clearRangeButtonsActive();

    setChartWindow(customRange.startISO, customRange.stopISO);
    loadAllData();
  });

  // Init inputs (si présents) : 1h glissante
  (function initDateInputs() {
    const startInput = document.getElementById("start-date");
    const endInput = document.getElementById("end-date");
    if (!startInput || !endInput) return;

    const pad = n => String(n).padStart(2, "0");
    const toLocalDT = (d) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Ne remplit que si vide (sinon tu perds ta saisie)
    if (!startInput.value) startInput.value = toLocalDT(oneHourAgo);
    if (!endInput.value) endInput.value = toLocalDT(now);
  })();

  // ============================
  // 8) TOGGLES COURBES
  // ============================
  // dataset indexes: 0 pm1, 1 pm25, 2 pm10, 3 temp, 4 hum
  const toggleMap = [
    { id: "pm1-toggle", idx: 0 },
    { id: "pm25-toggle", idx: 1 },
    { id: "pm10-toggle", idx: 2 },
    { id: "temp-toggle", idx: 3 },
    { id: "hum-toggle", idx: 4 }
  ];

  toggleMap.forEach(({ id, idx }) => {
    document.getElementById(id)?.addEventListener("change", (e) => {
      mainChart.setDatasetVisibility(idx, e.target.checked);
      mainChart.update();
    });
  });

  // ============================
  // 9) EXPORT CSV (downsample par minutes)
  // ============================
  document.getElementById("export-csv")?.addEventListener("click", () => {
    if (!labelsRaw.length) return alert("Pas de données à exporter");

    const freqMin = parseInt(document.getElementById("export-freq")?.value || "1", 10);
    const freqMs = Math.max(1, freqMin) * 60 * 1000;

    let csv = "time,pm1,pm25,pm10,temperature,humidite,rssi\n";

    let lastKeep = null;
    for (let i = 0; i < labelsRaw.length; i++) {
      const t = labelsRaw[i];
      if (!(t instanceof Date) || !Number.isFinite(t.getTime())) continue;

      if (!lastKeep || (t.getTime() - lastKeep.getTime()) >= freqMs) {
        lastKeep = t;

        csv += [
          t.toISOString(),
          series.pm1[i] ?? "",
          series.pm25[i] ?? "",
          series.pm10[i] ?? "",
          series.temperature[i] ?? "",
          series.humidite[i] ?? "",
          series.rssi[i] ?? ""
        ].join(",") + "\n";
      }
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "nebuleair_export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  });

  // Reset affichage (min/max X + repasse sur range boutons si custom)
  document.getElementById("reset-zoom")?.addEventListener("click", () => {
    setChartWindow(null, null);

    // Option: si tu étais en customRange, on revient au range courant
    if (customRange) {
      customRange = null;
      setActiveRangeButton(currentRange);
      loadAllData();
      return;
    }

    mainChart.update();
  });

  // ============================
  // 10) MAP LEAFLET
  // ============================
  (function initMap() {
    const lat = 43.30544, lon = 5.39487;
    const mapEl = document.getElementById("map");
    if (!mapEl || typeof L === "undefined") return;

    const map = L.map("map").setView([lat, lon], 18);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    L.marker([lat, lon]).addTo(map).bindPopup("<b>Capteur NebuleAir</b>");
  })();

  // ============================
  // 11) SNAKE EASTER EGG (safe)
  // ============================
  (function snakeEasterEgg() {
    const container = document.getElementById("snake-container");
    if (!container) return;

    // S’assure qu’il est bien caché au chargement
    container.classList.add("snake-hidden");
    if ("hidden" in container) container.hidden = true;

    const secret = "snake";
    let buffer = "";

    function openSnake() {
      container.classList.remove("snake-hidden");
      if ("hidden" in container) container.hidden = false;
      window.NebuleAirSnake?.init?.("snakeCanvas");
    }

    function closeSnake() {
      container.classList.add("snake-hidden");
      if ("hidden" in container) container.hidden = true;
    }

    document.addEventListener("keydown", (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      buffer = (buffer + e.key.toLowerCase()).slice(-secret.length);
      if (buffer === secret) openSnake();

      if (e.key === "Escape") closeSnake();
    });

    document.getElementById("snake-close")?.addEventListener("click", closeSnake);
  })();

  // ============================
  // 12) BOOT
  // ============================
  setActiveRangeButton(currentRange);
  loadAllData();

  // Auto-refresh seulement si on est sur un range “relatif” (pas de customRange)
  setInterval(() => {
    if (!customRange) loadAllData();
  }, 60000);
});
