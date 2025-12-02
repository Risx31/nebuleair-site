// assets/js/dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
  const BUCKET = "Nodule Air";

  let currentRange = "1h";
  let customRange = null;

  let labelsRaw = [];
  let series = {
    pm1: [],
    pm25: [],
    pm10: [],
    temperature: [],
    humidite: []
  };

  // ============================
  //  INIT CHART.JS
  // ============================

  const ctx = document.getElementById("mainChart").getContext("2d");

  const mainChart = new Chart(ctx, {
    type: "line",
    data: {
      // Pas de labels ici : l’axe temps se sert des x={Date}
      datasets: [
        {
          label: "PM1",
          data: [],
          borderColor: "#007bff",
          backgroundColor: "rgba(0, 123, 255, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true
        },
        {
          label: "PM2.5",
          data: [],
          borderColor: "#ff9800",
          backgroundColor: "rgba(255, 152, 0, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true
        },
        {
          label: "PM10",
          data: [],
          borderColor: "#e91e63",
          backgroundColor: "rgba(233, 30, 99, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true
        },
        {
          label: "Température",
          data: [],
          borderColor: "#00c853",
          backgroundColor: "rgba(0, 200, 83, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true
        },
        {
          label: "Humidité",
          data: [],
          borderColor: "#26c6da",
          backgroundColor: "rgba(38, 198, 218, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      spanGaps: false,
      plugins: {
        legend: {
          position: "top",
          labels: { usePointStyle: true }
        },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            title: (items) => {
              if (!items.length) return "";
              const x = items[0].parsed.x;
              return new Date(x).toLocaleString("fr-FR", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit"
              });
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Valeur"
          }
        },
        x: {
          type: "time",
          time: {
            tooltipFormat: "dd MMM yyyy HH:mm",
            displayFormats: {
              minute: "HH:mm",
              hour: "dd MMM HH'h'",
              day: "dd MMM"
            }
          }
        }
      }
    }
  });

  // ============================
  //  HELPERS INFLUX
  // ============================

  function parseInfluxCsv(raw) {
    const lines = raw
      .split("\n")
      .map(l => l.trim())
      .filter(l => l !== "" && !l.startsWith("#"));

    if (lines.length < 2) {
      console.warn("CSV vide ou incomplet");
      return { labels: [], values: [] };
    }

    const header = lines[0].split(",");
    const timeIndex = header.indexOf("_time");
    const valueIndex = header.indexOf("_value");

    if (timeIndex === -1 || valueIndex === -1) {
      console.warn("Impossible de trouver _time ou _value dans l'en-tête:", header);
      return { labels: [], values: [] };
    }

    const labels = [];
    const values = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length <= Math.max(timeIndex, valueIndex)) continue;

      const t = cols[timeIndex];
      const v = parseFloat(cols[valueIndex]);

      if (!isNaN(v)) {
        labels.push(t); // string ISO
        values.push(v);
      }
    }

    return { labels, values };
  }

  function buildRangeClause() {
    if (customRange) {
      return `|> range(start: ${customRange.start}, stop: ${customRange.stop})`;
    }

    switch (currentRange) {
      case "1h":  return "|> range(start: -1h)";
      case "6h":  return "|> range(start: -6h)";
      case "24h": return "|> range(start: -24h)";
      case "7j":  return "|> range(start: -7d)";
      case "30j": return "|> range(start: -30d)";
      default:    return "|> range(start: -1h)";
    }
  }

  function getWindowEvery() {
    if (customRange) {
      const start = new Date(customRange.start);
      const stop = new Date(customRange.stop);
      const hours = (stop - start) / 3600000;
      if (hours <= 6) return "1m";
      if (hours <= 24) return "5m";
      if (hours <= 24 * 7) return "30m";
      if (hours <= 24 * 30) return "1h";
      return "6h";
    }

    switch (currentRange) {
      case "1h":  return "1m";
      case "6h":  return "2m";
      case "24h": return "5m";
      case "7j":  return "30m";
      case "30j": return "1h";
      default:    return "1m";
    }
  }

  async function fetchField(field) {
    const rangeClause = buildRangeClause();
    const every = getWindowEvery();

    const fluxQuery = `
from(bucket: "${BUCKET}")
  ${rangeClause}
  |> filter(fn: (r) => r._measurement == "nebuleair")
  |> filter(fn: (r) => r._field == "${field}")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  |> yield()
`;

    const response = await fetch(INFLUX_URL, {
      method: "POST",
      body: fluxQuery
    });

    const raw = await response.text();
    return parseInfluxCsv(raw);
  }

  // ============================
  //  MISE À JOUR UI
  // ============================

  function updateCards() {
    const setCard = (id, arr, digits = 1) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!arr || arr.length === 0 || isNaN(arr[arr.length - 1])) {
        el.textContent = "--";
      } else {
        el.textContent = arr[arr.length - 1].toFixed(digits);
      }
    };

    setCard("pm1-value", series.pm1, 1);
    setCard("pm25-value", series.pm25, 1);
    setCard("pm10-value", series.pm10, 1);
    setCard("temp-value", series.temperature, 1);
    setCard("hum-value", series.humidite, 0);
  }
// Construit un dataset avec des "trous" quand il y a un gros gap de temps
function buildDatasetWithGaps(values) {
  if (!labelsRaw.length) return [];

  // Calcul du pas temporel "normal" (médiane des deltas)
  const deltas = [];
  for (let i = 1; i < labelsRaw.length; i++) {
    deltas.push(labelsRaw[i] - labelsRaw[i - 1]);
  }

  let step = 0;
  if (deltas.length) {
    deltas.sort((a, b) => a - b);
    step = deltas[Math.floor(deltas.length / 2)];
  }

  const threshold = step ? step * 3 : Number.MAX_SAFE_INTEGER; // au-delà => trou
  const data = [];

  for (let i = 0; i < labelsRaw.length; i++) {
    const t = labelsRaw[i];
    const v = values[i];

    if (i > 0) {
      const dt = t - labelsRaw[i - 1];
      if (dt > threshold) {
        // on insère un point "cassure" avant la nouvelle séquence
        data.push({ x: t, y: null });
      }
    }

    data.push({
      x: t,
      y: isNaN(v) ? null : v
    });
  }

  return data;
}

 function updateChart() {
  mainChart.data.datasets[0].data = buildDatasetWithGaps(series.pm1);
  mainChart.data.datasets[1].data = buildDatasetWithGaps(series.pm25);
  mainChart.data.datasets[2].data = buildDatasetWithGaps(series.pm10);
  mainChart.data.datasets[3].data = buildDatasetWithGaps(series.temperature);
  mainChart.data.datasets[4].data = buildDatasetWithGaps(series.humidite);

  mainChart.update();
}



  // ============================
  //  CHARGEMENT GLOBAL
  // ============================

  async function loadAllData() {
    try {
      const [pm1, pm25, pm10, temp, hum] = await Promise.all([
        fetchField("pm1"),
        fetchField("pm25"),
        fetchField("pm10"),
        fetchField("temperature"),
        fetchField("humidite")
      ]);

      // On convertit TOUT de suite en Date()
      labelsRaw = pm1.labels.map(t => new Date(t));

      series.pm1 = pm1.values;
      series.pm25 = pm25.values;
      series.pm10 = pm10.values;
      series.temperature = temp.values;
      series.humidite = hum.values;

      updateCards();
      updateChart();
    } catch (err) {
      console.error("Erreur lors du chargement des données :", err);
    }
  }

  // ============================
  //  EVENTS UI
  // ============================

  document.querySelectorAll(".range-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      currentRange = btn.dataset.range;
      customRange = null;
      loadAllData();
    });
      // ============================
  //  CARTE LEAFLET – LOCALISATION CAPTEUR
  // ============================

  const SENSOR_LAT = 43.305440952514594;
  const SENSOR_LON = 5.3948736958397765;

  const mapElement = document.getElementById("map");
  if (mapElement && typeof L !== "undefined") {
    // Création de la carte centrée sur le capteur
    const map = L.map("map").setView([SENSOR_LAT, SENSOR_LON], 18);

    // Tuiles OpenStreetMap
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Marker du capteur
    const marker = L.marker([SENSOR_LAT, SENSOR_LON]).addTo(map);
    marker.bindPopup(
      "<b>NebuleAir – Capteur extérieur</b><br>Campus St-Jérôme"
    );
  }
});

  });

  const applyBtn = document.getElementById("apply-range");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      const startInput = document.getElementById("start-date").value;
      const endInput = document.getElementById("end-date").value;

      if (!startInput || !endInput) {
        alert("Choisis une date de début et une date de fin.");
        return;
      }

      const start = new Date(startInput + "T00:00:00Z");
      const end = new Date(endInput + "T23:59:59Z");

      if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
        alert("Vérifie tes dates (fin après début).");
        return;
      }

      customRange = {
        start: start.toISOString(),
        stop: end.toISOString()
      };

      document.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
      loadAllData();
    });
  }

  function bindToggle(checkboxId, datasetIndex) {
    const cb = document.getElementById(checkboxId);
    if (!cb) return;
    cb.addEventListener("change", () => {
      const meta = mainChart.getDatasetMeta(datasetIndex);
      meta.hidden = !cb.checked;
      mainChart.update();
    });
  }

  bindToggle("pm1-toggle", 0);
  bindToggle("pm25-toggle", 1);
  bindToggle("pm10-toggle", 2);
  bindToggle("temp-toggle", 3);
  bindToggle("hum-toggle", 4);

  const resetZoomBtn = document.getElementById("reset-zoom");
  if (resetZoomBtn) {
    resetZoomBtn.addEventListener("click", () => {
      customRange = null;
      currentRange = "1h";
      document.querySelectorAll(".range-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.range === "1h");
      });
      loadAllData();
    });
  }

  const exportBtn = document.getElementById("export-csv");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      if (!labelsRaw.length) {
        alert("Pas de données à exporter.");
        return;
      }

      let csv = "time,pm1,pm25,pm10,temperature,humidite\n";
      const len = labelsRaw.length;

      for (let i = 0; i < len; i++) {
        const t = labelsRaw[i] ? labelsRaw[i].toISOString() : "";
        const v1 = series.pm1[i] ?? "";
        const v2 = series.pm25[i] ?? "";
        const v3 = series.pm10[i] ?? "";
        const v4 = series.temperature[i] ?? "";
        const v5 = series.humidite[i] ?? "";
        csv += `${t},${v1},${v2},${v3},${v4},${v5}\n`;
      }

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "nebuleair_export.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  // ============================
  //  CHARGEMENT INITIAL
  // ============================

  document.querySelectorAll(".range-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.range === "1h");
  });

  loadAllData();
  setInterval(loadAllData, 60000);
});
