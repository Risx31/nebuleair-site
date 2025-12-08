// assets/js/dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  console.log("[NebuleAir] Dashboard JS chargé");

  // ============================
  //  CONFIG GÉNÉRALE
  // ============================
  const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
  const BUCKET = "Nodule Air";

  let currentRange = "1h";       // 1h, 6h, 12h, 24h, 7d, 30d, custom
  let customRange = null;        // { start: Date, end: Date }

  // Séries pour le graphique
  const series = {
    pm1: [],
    pm25: [],
    pm10: [],
    temperature: [],
    humidite: []
  };

  // ============================
  //  RÉFÉRENCES DOM
  // ============================
  const canvas = document.getElementById("mainChart");
  if (!canvas) {
    console.error("[NebuleAir] Canvas #mainChart introuvable");
    return;
  }

  const rangeButtons = document.querySelectorAll("[data-range]");
  const customStartInput = document.getElementById("custom-start");
  const customEndInput = document.getElementById("custom-end");
  const applyCustomBtn = document.getElementById("apply-custom-range");
  const refreshBtn = document.getElementById("refresh-btn");

  const pm1ValueEl = document.getElementById("pm1-value");
  const pm25ValueEl = document.getElementById("pm25-value");
  const pm10ValueEl = document.getElementById("pm10-value");
  const tempValueEl = document.getElementById("temperature-value");
  const humValueEl = document.getElementById("humidity-value");
  const lastUpdateEl = document.getElementById("last-update-value");

  const wifiValueEl = document.getElementById("wifi-value");
  const wifiIconEl = document.getElementById("wifi-icon");

  // ============================
  //  INIT CHART.JS
  // ============================
  const ctx = canvas.getContext("2d");

  const mainChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "PM1 (µg/m³)",
          data: [],
          borderWidth: 2,
          borderColor: "#007bff",
          backgroundColor: "rgba(0, 123, 255, 0.15)",
          tension: 0.2,
          pointRadius: 0,
          spanGaps: false
        },
        {
          label: "PM2.5 (µg/m³)",
          data: [],
          borderWidth: 2,
          borderColor: "#28a745",
          backgroundColor: "rgba(40, 167, 69, 0.15)",
          tension: 0.2,
          pointRadius: 0,
          spanGaps: false
        },
        {
          label: "PM10 (µg/m³)",
          data: [],
          borderWidth: 2,
          borderColor: "#ffc107",
          backgroundColor: "rgba(255, 193, 7, 0.15)",
          tension: 0.2,
          pointRadius: 0,
          spanGaps: false
        },
        {
          label: "Température (°C)",
          data: [],
          yAxisID: "y2",
          borderWidth: 2,
          borderColor: "#e83e8c",
          backgroundColor: "rgba(232, 62, 140, 0.15)",
          tension: 0.2,
          pointRadius: 0,
          spanGaps: false
        },
        {
          label: "Humidité (%)",
          data: [],
          yAxisID: "y2",
          borderWidth: 2,
          borderColor: "#17a2b8",
          backgroundColor: "rgba(23, 162, 184, 0.15)",
          tension: 0.2,
          pointRadius: 0,
          spanGaps: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
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
              hour: "dd/MM HH'h'",
              day: "dd/MM"
            }
          },
          ticks: {
            source: "auto"
          }
        },
        y: {
          beginAtZero: false,
          title: {
            display: true,
            text: "PM (µg/m³)"
          }
        },
        y2: {
          position: "right",
          beginAtZero: false,
          grid: {
            drawOnChartArea: false
          },
          title: {
            display: true,
            text: "Temp (°C) / Humidité (%)"
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

  // ============================
  //  INIT LEAFLET
  // ============================
  (function initMapNebuleAir() {
    const mapElement = document.getElementById("map");
    if (!mapElement || typeof L === "undefined") {
      console.warn("[NebuleAir] Carte Leaflet non initialisée (pas de #map ou Leaflet).");
      return;
    }

    // Coordonnées du capteur (à adapter si besoin)
    const SENSOR_LAT = 43.305440952514594;
    const SENSOR_LON = 5.3948736958397765;

    const map = L.map("map").setView([SENSOR_LAT, SENSOR_LON], 15);

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
  //  OUTILS D'AFFICHAGE
  // ============================
  function setText(el, value, suffix = "") {
    if (!el) return;
    if (value === null || value === undefined || Number.isNaN(value)) {
      el.textContent = "--";
    } else {
      el.textContent = `${value}${suffix}`;
    }
  }

  function formatDateTime(isoString) {
    if (!isoString) return "--";
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "--";
    return d.toLocaleString("fr-FR");
  }

  function updateWifiDisplay(rssi) {
    if (!wifiValueEl) return;

    if (typeof rssi !== "number" || Number.isNaN(rssi)) {
      wifiValueEl.textContent = "--";
      wifiValueEl.style.color = "";
      if (wifiIconEl) wifiIconEl.style.opacity = "0.5";
      return;
    }

    wifiValueEl.textContent = `${rssi} dBm`;

    let color = "#dc3545"; // rouge par défaut (mauvais)
    if (rssi > -60) {
      color = "#28a745"; // très bon
    } else if (rssi > -75) {
      color = "#ffc107"; // moyen
    }

    wifiValueEl.style.color = color;
    if (wifiIconEl) {
      wifiIconEl.style.color = color;
      wifiIconEl.style.opacity = "1";
    }
  }

  function setActiveRangeButton() {
    rangeButtons.forEach((btn) => {
      if (btn.dataset.range === currentRange) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  // ============================
  //  CALCUL DES FENÊTRES DE TEMPS
  // ============================
  function getRangeQueryParams() {
    const now = new Date();

    if (currentRange === "custom" && customRange?.start && customRange?.end) {
      return {
        start: customRange.start.toISOString(),
        stop: customRange.end.toISOString()
      };
    }

    const params = { range: currentRange, now: now.toISOString() };
    return params;
  }

  // ============================
  //  RÉCUPÉRATION DES DONNÉES
  // ============================
  async function fetchData() {
    try {
      const params = getRangeQueryParams();
      const urlParams = new URLSearchParams({ bucket: BUCKET });

      // Soit on passe "range=1h", soit start/stop ISO
      if (params.range) {
        urlParams.set("range", params.range);
      }
      if (params.start) {
        urlParams.set("start", params.start);
      }
      if (params.stop) {
        urlParams.set("stop", params.stop);
      }

      const url = `${INFLUX_URL}?${urlParams.toString()}`;
      console.log("[NebuleAir] Requête vers", url);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      console.log("[NebuleAir] Données reçues :", payload);

      // On accepte plusieurs formats de payload par sécurité :
      // 1) Tableau direct de mesures
      // 2) Objet { data: [...] }
      let rows = [];
      if (Array.isArray(payload)) {
        rows = payload;
      } else if (payload && Array.isArray(payload.data)) {
        rows = payload.data;
      } else {
        console.warn("[NebuleAir] Format de payload inattendu.");
        rows = [];
      }

      // On vide les séries
      series.pm1.length = 0;
      series.pm25.length = 0;
      series.pm10.length = 0;
      series.temperature.length = 0;
      series.humidite.length = 0;

      let lastRow = null;
      let lastRssi = null;

      rows.forEach((row) => {
        const t = new Date(row.time || row._time);
        if (Number.isNaN(t.getTime())) return;

        // On suppose des colonnes type "pm1", "pm25", etc.
        if (row.pm1 !== undefined && row.pm1 !== null) {
          series.pm1.push({ x: t, y: Number(row.pm1) });
        }
        if (row.pm25 !== undefined && row.pm25 !== null) {
          series.pm25.push({ x: t, y: Number(row.pm25) });
        }
        if (row.pm10 !== undefined && row.pm10 !== null) {
          series.pm10.push({ x: t, y: Number(row.pm10) });
        }
        if (row.temperature !== undefined && row.temperature !== null) {
          series.temperature.push({ x: t, y: Number(row.temperature) });
        }
        if (row.humidite !== undefined && row.humidite !== null) {
          series.humidite.push({ x: t, y: Number(row.humidite) });
        }

        if (typeof row.rssi === "number") {
          lastRssi = row.rssi;
        }

        lastRow = row;
      });

      // Mise à jour du graphique
      mainChart.data.datasets[0].data = series.pm1;
      mainChart.data.datasets[1].data = series.pm25;
      mainChart.data.datasets[2].data = series.pm10;
      mainChart.data.datasets[3].data = series.temperature;
      mainChart.data.datasets[4].data = series.humidite;
      mainChart.update();

      // Cartes "valeur actuelle"
      if (lastRow) {
        setText(pm1ValueEl, lastRow.pm1, " µg/m³");
        setText(pm25ValueEl, lastRow.pm25, " µg/m³");
        setText(pm10ValueEl, lastRow.pm10, " µg/m³");
        setText(tempValueEl, lastRow.temperature, " °C");
        setText(humValueEl, lastRow.humidite, " %");
        if (lastUpdateEl) {
          const timeStr = lastRow.time || lastRow._time;
          lastUpdateEl.textContent = formatDateTime(timeStr);
        }
      } else {
        // Si aucune donnée
        setText(pm1ValueEl, null);
        setText(pm25ValueEl, null);
        setText(pm10ValueEl, null);
        setText(tempValueEl, null);
        setText(humValueEl, null);
        if (lastUpdateEl) lastUpdateEl.textContent = "--";
      }

      // Wifi (RSSI)
      updateWifiDisplay(lastRssi);

    } catch (err) {
      console.error("[NebuleAir] Erreur lors du fetch Influx :", err);
    }
  }

  // ============================
  //  GESTION DES ÉVÉNEMENTS
  // ============================
  rangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const r = btn.dataset.range;
      if (!r) return;
      currentRange = r;
      setActiveRangeButton();

      if (currentRange !== "custom") {
        customRange = null;
      }

      fetchData();
    });
  });

  if (applyCustomBtn && customStartInput && customEndInput) {
    applyCustomBtn.addEventListener("click", () => {
      const startVal = customStartInput.value;
      const endVal = customEndInput.value;

      if (!startVal || !endVal) {
        alert("Merci de renseigner les deux dates pour le mode personnalisé.");
        return;
      }

      const startDate = new Date(startVal);
      const endDate = new Date(endVal);

      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
        alert("Plage de dates invalide.");
        return;
      }

      customRange = { start: startDate, end: endDate };
      currentRange = "custom";
      setActiveRangeButton();
      fetchData();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      fetchData();
    });
  }

  // ============================
  //  LANCEMENT INITIAL
  // ============================
  setActiveRangeButton();
  fetchData();

  // Rafraîchir automatiquement toutes les minutes
  setInterval(fetchData, 60_000);
});
