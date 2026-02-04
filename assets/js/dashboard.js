// assets/js/dashboard.js

document.addEventListener("DOMContentLoaded", function () {
  console.log("[NebuleAir] Dashboard JS chargé");

  const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
  const BUCKET = "Nodule Air";

  let currentRange = "1h";
  let customRange = null;
  let labelsRaw = [];
  let series = { pm1: [], pm25: [], pm10: [], temperature: [], humidite: [], rssi: [] };

  // ==========================================
  //  1. GESTION DU THÈME (MODE NUIT / BANANE)
  // ==========================================
  const body = document.body;
  const themeToggle = document.getElementById("themeToggle");
  const banana = document.getElementById("userProfileBanana");

  function toggleTheme() {
    if (body.classList.contains("light")) {
      body.classList.replace("light", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      body.classList.replace("dark", "light");
      localStorage.setItem("theme", "light");
    }
  }

  if (themeToggle) themeToggle.addEventListener("click", toggleTheme);
  if (banana) banana.addEventListener("click", toggleTheme);

  // Charger le thème sauvegardé
  const savedTheme = localStorage.getItem("theme") || "light";
  body.className = savedTheme; // Applique 'light' ou 'dark' au démarrage

  // ============================
  //  2. INITIALISATION GRAPHIQUE
  // ============================
  const canvas = document.getElementById("mainChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const mainChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        { label: "PM1", data: [], borderColor: "#007bff", backgroundColor: "rgba(0, 123, 255, 0.1)", yAxisID: 'y', tension: 0.3, fill: true },
        { label: "PM2.5", data: [], borderColor: "#ff9800", backgroundColor: "rgba(255, 152, 0, 0.1)", yAxisID: 'y', tension: 0.3, fill: true },
        { label: "PM10", data: [], borderColor: "#e91e63", backgroundColor: "rgba(233, 30, 99, 0.1)", yAxisID: 'y', tension: 0.3, fill: true },
        { label: "Température", data: [], borderColor: "#00c853", backgroundColor: "rgba(0, 200, 83, 0.1)", yAxisID: 'y1', tension: 0.3, fill: true },
        { label: "Humidité", data: [], borderColor: "#26c6da", backgroundColor: "rgba(38, 198, 218, 0.1)", yAxisID: 'y1', tension: 0.3, fill: true }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", labels: { usePointStyle: true, font: { family: 'Inter' } } },
        tooltip: {
          callbacks: {
            label: function(context) {
              let l = context.dataset.label + ': ' + context.parsed.y.toFixed(1);
              if (l.includes("PM")) l += " µg/m³";
              else if (l.includes("Temp")) l += " °C";
              else if (l.includes("Hum")) l += " %";
              return l;
            }
          }
        }
      },
      scales: {
        x: { type: "time", time: { tooltipFormat: "dd MMM HH:mm", displayFormats: { minute: "HH:mm", hour: "HH'h'", day: "dd MMM" } } },
        y: { position: 'left', title: { display: true, text: "µg/m³" }, beginAtZero: true },
        y1: { position: 'right', title: { display: true, text: "°C / %" }, grid: { drawOnChartArea: false } }
      }
    }
  });

  // ============================
  //  3. LOGIQUE INFLUXDB & DATA
  // ============================
  function parseInfluxCsv(raw) {
    const lines = raw.split("\n").map(l => l.trim()).filter(l => l !== "" && !l.startsWith("#"));
    if (lines.length < 2) return { labels: [], values: [] };
    const header = lines[0].split(",");
    const tIdx = header.indexOf("_time"), vIdx = header.indexOf("_value");
    const labels = [], values = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const v = parseFloat(cols[vIdx]);
      if (!isNaN(v)) { labels.push(cols[tIdx]); values.push(v); }
    }
    return { labels, values };
  }

  function getWindowEvery() {
    if (customRange) return "5m";
    const mapping = { "1h":"1m", "24h":"5m", "7j":"30m" };
    return mapping[currentRange] || "1m";
  }

  async function fetchField(field) {
    const range = customRange ? `|> range(start: ${customRange.start}, stop: ${customRange.stop})` : `|> range(start: -${currentRange})`;
    const query = `from(bucket: "${BUCKET}") ${range} |> filter(fn: (r) => r._measurement == "nebuleair" and r._field == "${field}") |> aggregateWindow(every: ${getWindowEvery()}, fn: mean, createEmpty: false) |> yield()`;
    try {
      const res = await fetch(INFLUX_URL, { method: "POST", body: query });
      return parseInfluxCsv(await res.text());
    } catch (e) { return { labels: [], values: [] }; }
  }

  async function loadAllData() {
    const fields = ["pm1", "pm25", "pm10", "temperature", "humidite", "rssi"];
    const results = await Promise.all(fields.map(f => fetchField(f)));
    
    labelsRaw = results[0].labels.map(t => new Date(t));
    series.pm1 = results[0].values;
    series.pm25 = results[1].values;
    series.pm10 = results[2].values;
    series.temperature = results[3].values;
    series.humidite = results[4].values;
    series.rssi = results[5].values;

    updateUI();
  }

  function updateUI() {
    // Mise à jour des cartes
    const ids = ["pm1-value", "pm25-value", "pm10-value", "temp-value", "hum-value"];
    const dataKeys = ["pm1", "pm25", "pm10", "temperature", "humidite"];
    ids.forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) {
        const val = series[dataKeys[i]][series[dataKeys[i]].length - 1];
        el.textContent = val !== undefined ? val.toFixed(1) : "--";
      }
    });

    // Mise à jour graphique
    dataKeys.forEach((key, i) => {
      mainChart.data.datasets[i].data = labelsRaw.map((t, idx) => ({ x: t, y: series[key][idx] }));
    });
    mainChart.update();
  }

  // ============================
  //  4. ÉVÉNEMENTS & EXPORT
  // ============================
  document.querySelectorAll(".btn-range").forEach(btn => {
    btn.addEventListener("click", () => {
      currentRange = btn.dataset.range;
      customRange = null;
      loadAllData();
    });
  });

  const exportBtn = document.getElementById("export-csv");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      const freq = parseInt(document.getElementById("export-freq").value) || 1;
      let csv = "time,pm1,pm25,pm10,temp,hum\n";
      for (let i = 0; i < labelsRaw.length; i += freq) {
        csv += `${labelsRaw[i].toISOString()},${series.pm1[i]||''},${series.pm25[i]||''},${series.pm10[i]||''},${series.temperature[i]||''},${series.humidite[i]||''}\n`;
      }
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "nebuleair_data.csv";
      a.click();
    });
  }

  loadAllData();
  setInterval(loadAllData, 60000);
});
