// assets/js/dashboard.js

document.addEventListener("DOMContentLoaded", function () {
  console.log("[NebuleAir] Dashboard JS chargé");

  const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
  const BUCKET = "Nodule Air";

  let currentRange = "1h";
  let customRange = null;

  // Dates de référence (en objets Date)
  let labelsRaw = [];

  // Séries de valeurs
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

  const canvas = document.getElementById("mainChart");
  if (!canvas) {
    console.error("[NebuleAir] Canvas #mainChart introuvable");
    return;
  }

const wifiElement = document.getElementById('wifi-value');

if (data.rssi) {
    wifiElement.textContent = data.rssi;
    
    if (data.rssi > -60) {
        wifiElement.style.color = "#10b981"; // Vert (Excellent)
    } else if (data.rssi > -75) {
        wifiElement.style.color = "#f59e0b"; // Orange (Moyen)
    } else {
        wifiElement.style.color = "#ef4444"; // Rouge (Mauvais)
    }
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
          spanGaps: false
        },
        {
          label: "PM2.5",
          data: [],
          borderColor: "#ff9800",
          backgroundColor: "rgba(255, 152, 0, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true,
          spanGaps: false
        },
        {
          label: "PM10",
          data: [],
          borderColor: "#e91e63",
          backgroundColor: "rgba(233, 30, 99, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true,
          spanGaps: false
        },
        {
          label: "Température",
          data: [],
          borderColor: "#00c853",
          backgroundColor: "rgba(0, 200, 83, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true,
          spanGaps: false
        },
        {
          label: "Humidité",
          data: [],
          borderColor: "#26c6da",
          backgroundColor: "rgba(38, 198, 218, 0.15)",
          borderWidth: 2,
          tension: 0.25,
          fill: true,
          spanGaps: false
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
      plugins: {
        legend: {
          position: "top",
          labels: { usePointStyle: true }
        },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            title: function (items) {
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
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l !== "" && !l.startsWith("#"); });

    if (lines.length < 2) {
      console.warn("[NebuleAir] CSV vide ou incomplet");
      return { labels: [], values: [] };
    }

    const header = lines[0].split(",");
    const timeIndex = header.indexOf("_time");
    const valueIndex = header.indexOf("_value");

    if (timeIndex === -1 || valueIndex === -1) {
      console.warn("[NebuleAir] _time ou _value manquant dans l'en-tête", header);
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
        labels.push(t);
        values.push(v);
      }
    }

    return { labels: labels, values: values };
  }

  function buildRangeClause() {
    if (customRange) {
      return "|> range(start: " + customRange.start + ", stop: " + customRange.stop + ")";
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

    const fluxQuery =
`from(bucket: "${BUCKET}")
  ${rangeClause}
  |> filter(fn: (r) => r._measurement == "nebuleair")
  |> filter(fn: (r) => r._field == "${field}")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  |> yield()`;

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
    function setCard(id, arr, digits) {
      if (digits === undefined) digits = 1;
      const el = document.getElementById(id);
      if (!el) return;
      if (!arr || arr.length === 0 || isNaN(arr[arr.length - 1])) {
        el.textContent = "--";
      } else {
        el.textContent = arr[arr.length - 1].toFixed(digits);
      }
    }

    setCard("pm1-value", series.pm1, 1);
    setCard("pm25-value", series.pm25, 1);
    setCard("pm10-value", series.pm10, 1);
    setCard("temp-value", series.temperature, 1);
    setCard("hum-value", series.humidite, 0);
  }

  // Construire un dataset avec des trous quand il y a un gros gap
  function buildDatasetWithGaps(values) {
    if (!labelsRaw.length) return [];

    // 1) On estime le pas "normal" entre deux mesures (médiane des écarts)
    const deltas = [];
    for (let i = 1; i < labelsRaw.length; i++) {
      deltas.push(labelsRaw[i] - labelsRaw[i - 1]); // en ms
    }

    let step = 0;
    if (deltas.length) {
      deltas.sort(function (a, b) { return a - b; });
      step = deltas[Math.floor(deltas.length / 2)];
    }

    // Si deux points sont séparés de plus de 3× le pas normal,
    // on considère que c'est une déconnexion.
    const threshold = step ? step * 3 : Number.MAX_SAFE_INTEGER;
    const data = [];

    for (let i = 0; i < labelsRaw.length; i++) {
      const t = labelsRaw[i];
      const v = values[i];

      if (i > 0) {
        const prevT = labelsRaw[i - 1];
        const dt = t - prevT;

        if (dt > threshold) {
          // ➜ on place un point "trou" AU MILIEU du gap
          const mid = new Date(prevT.getTime() + dt / 2);
          data.push({ x: mid, y: null });
        }
      }

      data.push({
        x: t,
        y: (typeof v === "number" && !isNaN(v)) ? v : null
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
      const results = await Promise.all([
        fetchField("pm1"),
        fetchField("pm25"),
        fetchField("pm10"),
        fetchField("temperature"),
        fetchField("humidite")
      ]);

      const pm1 = results[0];
      const pm25 = results[1];
      const pm10 = results[2];
      const temp = results[3];
      const hum = results[4];

      labelsRaw = pm1.labels.map(function (t) { return new Date(t); });

      series.pm1 = pm1.values;
      series.pm25 = pm25.values;
      series.pm10 = pm10.values;
      series.temperature = temp.values;
      series.humidite = hum.values;

      updateCards();
      updateChart();
    } catch (err) {
      console.error("[NebuleAir] Erreur lors du chargement des données :", err);
    }
  }

  // ============================
  //  EVENTS – PLAGES DE TEMPS
  // ============================

  const rangeButtons = document.querySelectorAll(".range-btn");
  rangeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      rangeButtons.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      currentRange = btn.dataset.range;
      customRange = null;
      loadAllData();
    });
  });

  const applyBtn = document.getElementById("apply-range");
  if (applyBtn) {
    applyBtn.addEventListener("click", function () {
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

      rangeButtons.forEach(function (b) { b.classList.remove("active"); });
      loadAllData();
    });
  }

  // ============================
  //  EVENTS – VISIBILITÉ COURBES
  // ============================

  function bindToggle(checkboxId, datasetIndex) {
    const cb = document.getElementById(checkboxId);
    if (!cb) return;
    cb.addEventListener("change", function () {
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

  // ============================
  //  RESET PLAGE
  // ============================

  const resetZoomBtn = document.getElementById("reset-zoom");
  if (resetZoomBtn) {
    resetZoomBtn.addEventListener("click", function () {
      customRange = null;
      currentRange = "1h";
      rangeButtons.forEach(function (b) {
        b.classList.toggle("active", b.dataset.range === "1h");
      });
      loadAllData();
    });
  }

  // ============================
  //  EXPORT CSV
  // ============================

  const exportBtn = document.getElementById("export-csv");
  if (exportBtn) {
    exportBtn.addEventListener("click", function () {
      if (!labelsRaw.length) {
        alert("Pas de données à exporter.");
        return;
      }

      let csv = "time,pm1,pm25,pm10,temperature,humidite\n";
      const len = labelsRaw.length;

      for (let i = 0; i < len; i++) {
        const t = labelsRaw[i] ? labelsRaw[i].toISOString() : "";
        const v1 = (series.pm1[i] !== undefined) ? series.pm1[i] : "";
        const v2 = (series.pm25[i] !== undefined) ? series.pm25[i] : "";
        const v3 = (series.pm10[i] !== undefined) ? series.pm10[i] : "";
        const v4 = (series.temperature[i] !== undefined) ? series.temperature[i] : "";
        const v5 = (series.humidite[i] !== undefined) ? series.humidite[i] : "";
        csv += t + "," + v1 + "," + v2 + "," + v3 + "," + v4 + "," + v5 + "\n";
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
  //  CARTE LEAFLET
  // ============================

  (function initMapNebuleAir() {
    const SENSOR_LAT = 43.305440952514594;
    const SENSOR_LON = 5.3948736958397765;

    const mapElement = document.getElementById("map");
    if (!mapElement) {
      console.warn("[NebuleAir] #map introuvable");
      return;
    }

    if (typeof L === "undefined") {
      console.error("[NebuleAir] Leaflet (L) non défini");
      mapElement.innerHTML =
        "<p style='padding:8px;font-size:14px;'>Erreur : Leaflet n'est pas chargé.</p>";
      return;
    }

    const map = L.map("map").setView([SENSOR_LAT, SENSOR_LON], 18);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
    }).addTo(map);

    const marker = L.marker([SENSOR_LAT, SENSOR_LON]).addTo(map);
    marker.bindPopup("<b>NebuleAir – Capteur extérieur</b><br>43.3054, 5.3949");
  })();

  // ============================
  //  CHARGEMENT INITIAL
  // ============================

  rangeButtons.forEach(function (b) {
    b.classList.toggle("active", b.dataset.range === "1h");
  });

  loadAllData();
  setInterval(loadAllData, 60000);
});
