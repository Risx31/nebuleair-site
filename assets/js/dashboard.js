// assets/js/dashboard.js
// Dashboard NebuleAir – version sans Snake 🐍🚫

document.addEventListener("DOMContentLoaded", () => {
  console.log("[NebuleAir] Dashboard JS chargé (version sans Snake)");

  // =============================
  //  CONFIG
  // =============================
  const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
  const BUCKET = "Nodule Air";

  // Plage de temps courante ("1h", "6h", "24h", "7d" ou "custom")
  let currentRange = "1h";
  let customRange = null; // { start: Date, end: Date }

  // Données brutes
  let rows = [];

  // =============================
  //  RÉFÉRENCES DOM
  // =============================

  const canvas = document.getElementById("mainChart");
  if (!canvas) {
    console.error("[NebuleAir] Canvas #mainChart introuvable");
    return;
  }
  const ctx = canvas.getContext("2d");

  const rangeButtons = document.querySelectorAll("[data-range]");
  const startInput = document.getElementById("range-start");
  const endInput = document.getElementById("range-end");
  const applyRangeBtn = document.getElementById("apply-range");

  // Stats / cartes
  const pm1Span = document.getElementById("pm1-value");
  const pm25Span = document.getElementById("pm25-value");
  const pm10Span = document.getElementById("pm10-value");
  const tempSpan = document.getElementById("temp-value");
  const humSpan = document.getElementById("hum-value");
  const aqiSpan = document.getElementById("aqi-value");
  const aqiLabelSpan = document.getElementById("aqi-label");
  const wifiSpan = document.getElementById("wifi-value");
  const uptimeSpan = document.getElementById("uptime-value");
  const lastUpdateSpan = document.getElementById("last-update");

  const themeToggle = document.getElementById("theme-toggle");

  // =============================
  //  THÈME CLAIR / SOMBRE
  // =============================
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      document.documentElement.classList.toggle("dark");
      document.body.classList.toggle("dark");
    });
  }

  // =============================
  //  INIT CHART.JS
  // =============================

  const mainChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "PM1 (µg/m³)",
          data: [],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
          spanGaps: false
        },
        {
          label: "PM2.5 (µg/m³)",
          data: [],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
          spanGaps: false
        },
        {
          label: "PM10 (µg/m³)",
          data: [],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
          spanGaps: false
        },
        {
          label: "Température (°C)",
          data: [],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
          yAxisID: "y2",
          spanGaps: false
        },
        {
          label: "Humidité (%)",
          data: [],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
          yAxisID: "y2",
          spanGaps: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false, // on fournit {x, y}
      interaction: {
        mode: "nearest",
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
            maxRotation: 0
          }
        },
        y: {
          position: "left",
          title: {
            display: true,
            text: "PM (µg/m³)"
          }
        },
        y2: {
          position: "right",
          grid: {
            drawOnChartArea: false
          },
          title: {
            display: true,
            text: "Temp / Hum"
          }
        }
      },
      plugins: {
        legend: {
          position: "bottom"
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              if (!items.length) return "";
              const d = items[0].parsed.x;
              return new Date(d).toLocaleString("fr-FR");
            }
          }
        }
      }
    }
  });

  // =============================
  //  LEAFLET – CARTE CAPTEUR
  // =============================

  (function initMapNebuleAir() {
    const mapElement = document.getElementById("map");
    if (!mapElement) {
      console.warn("[NebuleAir] #map introuvable, la carte ne sera pas affichée");
      return;
    }

    // Coordonnées par défaut (IUT St Jérôme par ex.)
    const SENSOR_LAT = 43.305440952514594;
    const SENSOR_LON = 5.3948736958397765;

    const map = L.map(mapElement).setView([SENSOR_LAT, SENSOR_LON], 16);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    const marker = L.marker([SENSOR_LAT, SENSOR_LON]).addTo(map);
    marker.bindPopup("Capteur NebuleAir<br>Qualité de l'air en temps (quasi) réel");
  })();

  // =============================
  //  UTILITAIRES
  // =============================

  function formatDateTime(isoString) {
    if (!isoString) return "--";
    const d = new Date(isoString);
    return d.toLocaleString("fr-FR");
  }

  function computeAQI(pm25) {
    // Version simplifiée, juste pour donner une idée
    if (pm25 == null || isNaN(pm25)) return { value: "--", label: "N/A", className: "" };

    if (pm25 <= 10) return { value: pm25.toFixed(1), label: "Excellent", className: "aqi-good" };
    if (pm25 <= 20) return { value: pm25.toFixed(1), label: "Bon", className: "aqi-fair" };
    if (pm25 <= 25) return { value: pm25.toFixed(1), label: "Moyen", className: "aqi-moderate" };
    if (pm25 <= 50) return { value: pm25.toFixed(1), label: "Médiocre", className: "aqi-poor" };
    return { value: pm25.toFixed(1), label: "Très mauvais", className: "aqi-very-poor" };
  }

  function secondsToHuman(sec) {
    if (!sec || sec < 0) return "--";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d} j ${h} h`;
    if (h > 0) return `${h} h ${m} min`;
    return `${m} min`;
  }

  // =============================
  //  RÉCUP DATA INFUX
  // =============================

  async function fetchData() {
    try {
      const payload = {
        bucket: BUCKET,
        range: currentRange
      };

      if (currentRange === "custom" && customRange && customRange.start && customRange.end) {
        payload.start = customRange.start.toISOString();
        payload.end = customRange.end.toISOString();
      }

      const resp = await fetch(INFLUX_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        console.error("[NebuleAir] Erreur HTTP Influx", resp.status, resp.statusText);
        return [];
      }

      const json = await resp.json();
      // On suppose que le proxy renvoie { data: [...] }
      const data = Array.isArray(json.data) ? json.data : json;
      console.log("[NebuleAir] Données reçues:", data.length, "points");
      return data;
    } catch (err) {
      console.error("[NebuleAir] Erreur fetch Influx:", err);
      return [];
    }
  }

  // =============================
  //  MISE EN FORME & AFFICHAGE
  // =============================

  function updateChart() {
    const pm1Data = [];
    const pm25Data = [];
    const pm10Data = [];
    const tempData = [];
    const humData = [];

    rows.forEach((p) => {
      const t = new Date(p.time || p._time || p.timestamp);
      if (isNaN(t.getTime())) return;

      const pm1 = p.pm1 ?? p.pm_1 ?? null;
      const pm25 = p.pm25 ?? p.pm_2_5 ?? null;
      const pm10 = p.pm10 ?? p.pm_10 ?? null;
      const temp = p.temperature ?? p.temp ?? null;
      const hum = p.humidite ?? p.humidity ?? null;

      pm1Data.push({ x: t, y: pm1 != null ? pm1 : null });
      pm25Data.push({ x: t, y: pm25 != null ? pm25 : null });
      pm10Data.push({ x: t, y: pm10 != null ? pm10 : null });
      tempData.push({ x: t, y: temp != null ? temp : null });
      humData.push({ x: t, y: hum != null ? hum : null });
    });

    mainChart.data.datasets[0].data = pm1Data;
    mainChart.data.datasets[1].data = pm25Data;
    mainChart.data.datasets[2].data = pm10Data;
    mainChart.data.datasets[3].data = tempData;
    mainChart.data.datasets[4].data = humData;

    mainChart.update();
  }

  function updateStats() {
    if (!rows.length) {
      [pm1Span, pm25Span, pm10Span, tempSpan, humSpan, aqiSpan, aqiLabelSpan, wifiSpan, uptimeSpan, lastUpdateSpan]
        .filter(Boolean)
        .forEach((el) => (el.textContent = "--"));
      return;
    }

    const last = rows[rows.length - 1];

    const pm1 = last.pm1 ?? last.pm_1;
    const pm25 = last.pm25 ?? last.pm_2_5;
    const pm10 = last.pm10 ?? last.pm_10;
    const temp = last.temperature ?? last.temp;
    const hum = last.humidite ?? last.humidity;
    const rssi = last.rssi;
    const uptime_s = last.uptime_s ?? last.uptime;

    if (pm1Span && pm1 != null) pm1Span.textContent = pm1.toFixed(1);
    if (pm25Span && pm25 != null) pm25Span.textContent = pm25.toFixed(1);
    if (pm10Span && pm10 != null) pm10Span.textContent = pm10.toFixed(1);
    if (tempSpan && temp != null) tempSpan.textContent = temp.toFixed(1);
    if (humSpan && hum != null) humSpan.textContent = hum.toFixed(1);

    const aqi = computeAQI(pm25);
    if (aqiSpan) aqiSpan.textContent = aqi.value;
    if (aqiLabelSpan) {
      aqiLabelSpan.textContent = aqi.label;
      aqiLabelSpan.className = aqi.className || "";
    }

    if (wifiSpan && rssi != null) {
      wifiSpan.textContent = rssi + " dBm";

      // Code couleur simple
      if (rssi > -60) {
        wifiSpan.style.color = "#3cb371"; // bon
      } else if (rssi > -75) {
        wifiSpan.style.color = "#f0ad4e"; // moyen
      } else {
        wifiSpan.style.color = "#d9534f"; // mauvais
      }
    }

    if (uptimeSpan) {
      uptimeSpan.textContent = secondsToHuman(uptime_s);
    }

    if (lastUpdateSpan) {
      const t = last.time || last._time || last.timestamp;
      lastUpdateSpan.textContent = formatDateTime(t);
    }
  }

  async function refreshDashboard() {
    const data = await fetchData();
    rows = data || [];
    updateChart();
    updateStats();
  }

  // =============================
  //  GESTION DES PLAGES DE TEMPS
  // =============================

  function setActiveRangeButton() {
    rangeButtons.forEach((btn) => {
      const r = btn.dataset.range;
      if (!r) return;
      if (r === currentRange) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  rangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const range = btn.dataset.range;
      if (!range) return;

      currentRange = range;
      if (range !== "custom") {
        customRange = null;
      }
      setActiveRangeButton();
      refreshDashboard();
    });
  });

  if (applyRangeBtn && startInput && endInput) {
    applyRangeBtn.addEventListener("click", () => {
      if (!startInput.value || !endInput.value) {
        alert("Merci de renseigner les deux dates pour la plage personnalisée.");
        return;
      }
      const start = new Date(startInput.value);
      const end = new Date(endInput.value);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
        alert("Plage de dates invalide.");
        return;
      }
      customRange = { start, end };
      currentRange = "custom";
      setActiveRangeButton();
      refreshDashboard();
    });
  }

  // =============================
  //  BOOT
  // =============================
  setActiveRangeButton();
  refreshDashboard();

  // Refresh périodique (optionnel)
  setInterval(refreshDashboard, 60_000); // toutes les minutes
});
