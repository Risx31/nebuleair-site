/* ==========================================================================
   NebuleAir — dashboard.js (CSV + chart + map + export + PM2.5 corrigé)
   Dépendances (déjà dans index.html) :
   - Chart.js + chartjs-adapter-date-fns (defer)
   - Leaflet (defer)
   HTML IDs utilisés (voir index.html) :
   - Cards: pm1-value, pm25-value, pm10-value, temp-value, hum-value
   - Toggles: pm1-toggle, pm25-toggle, pm10-toggle, temp-toggle, hum-toggle
   - Range: .btn-range[data-range], start-date, end-date, apply-range
   - Correction: pm25-correction-toggle, pm25-correction-info
   - Chart: mainChart
   - Map: map
   - Export: export-freq, export-csv
   - Reset: reset-zoom
   ========================================================================== */

(() => {
  "use strict";

  // ---------------------- CONFIG ----------------------
  const qs = new URLSearchParams(window.location.search);

  // Source CSV (même logique que la page comparaison)
  const NEBULEAIR_CSV_URL = qs.get("nebuleair") || "assets/data/nebuleair_export.csv";

  // LocalStorage keys (partagés avec comparaison.js)
  const PM25_CAL_KEY = "nebuleair.pm25.calibration.v1";
  const PM25_CORR_ENABLED_KEY = "nebuleair.pm25.correction.enabled.v1";

  // ---------------------- DOM ----------------------
  const el = {
    // Cards
    pm1: document.getElementById("pm1-value"),
    pm25: document.getElementById("pm25-value"),
    pm10: document.getElementById("pm10-value"),
    temp: document.getElementById("temp-value"),
    hum: document.getElementById("hum-value"),

    // Toggles series
    tPM1: document.getElementById("pm1-toggle"),
    tPM25: document.getElementById("pm25-toggle"),
    tPM10: document.getElementById("pm10-toggle"),
    tTemp: document.getElementById("temp-toggle"),
    tHum: document.getElementById("hum-toggle"),

    // Range controls
    start: document.getElementById("start-date"),
    end: document.getElementById("end-date"),
    applyRange: document.getElementById("apply-range"),
    rangeBtns: Array.from(document.querySelectorAll(".btn-range")),

    // Correction toggle
    corrToggle: document.getElementById("pm25-correction-toggle"),
    corrInfo: document.getElementById("pm25-correction-info"),

    // Chart + map
    canvas: document.getElementById("mainChart"),
    map: document.getElementById("map"),

    // Export
    exportFreq: document.getElementById("export-freq"),
    exportBtn: document.getElementById("export-csv"),

    // Reset
    resetZoom: document.getElementById("reset-zoom"),
  };

  // ---------------------- STATE ----------------------
  let chartInstance = null;
  let leafletMap = null;
  let leafletMarker = null;

  /** Raw points from CSV (full period) */
  let allPoints = []; // {t:Date, pm1, pm25, pm10, temperature, humidite, lat?, lon?}

  /** Points within current range */
  let viewPoints = [];

  // ---------------------- UTIL ----------------------
  const HOUR_MS = 3600000;

  function toFloat(v) {
    if (v == null) return NaN;
    const s = String(v).trim();
    if (!s) return NaN;
    return Number.parseFloat(s.replace(",", "."));
  }

  function isFiniteNumber(n) {
    return typeof n === "number" && Number.isFinite(n);
  }

  function setText(node, value) {
    if (!node) return;
    node.textContent = value;
  }

  function clamp0(x) {
    return (!Number.isFinite(x) || x < 0) ? 0 : x;
  }

  function toDatetimeLocalValue(date) {
    // datetime-local = local time w/o TZ
    const tzOffsetMin = date.getTimezoneOffset();
    const local = new Date(date.getTime() - tzOffsetMin * 60000);
    return local.toISOString().slice(0, 16);
  }

  function parseDatetimeLocal(value) {
    if (!value) return null;
    const d = new Date(value); // interpreted as local
    return Number.isNaN(d.getTime()) ? null : d;
  }

  async function fetchText(url) {
    const u = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const res = await fetch(encodeURI(u), { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed (${res.status}) : ${url}`);
    return await res.text();
  }

  function downloadCSV(filename, content) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------------------- PM2.5 CORRECTION ----------------------
  function readPM25Calibration() {
    try {
      const raw = localStorage.getItem(PM25_CAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function isPM25CorrectionEnabled() {
    return localStorage.getItem(PM25_CORR_ENABLED_KEY) === "1";
  }

  function correctPM25(value, isoTime) {
    const v = Number(value);
    if (!Number.isFinite(v)) return value;

    if (!isPM25CorrectionEnabled()) return v;

    const cal = readPM25Calibration();
    if (!cal) return v;

    const a = Number(cal.a);
    const b = Number(cal.b);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return v;

    // Optionnel: si la calibration est définie sur une plage, on ne corrige que dedans
    if (cal.startISO && cal.endISO && isoTime) {
      const t = new Date(isoTime).getTime();
      const t0 = new Date(cal.startISO).getTime();
      const t1 = new Date(cal.endISO).getTime();
      if (Number.isFinite(t) && Number.isFinite(t0) && Number.isFinite(t1)) {
        if (t < t0 || t > t1) return v;
      }
    }

    return clamp0((v - a) / b);
  }

  function initPM25CorrectionUI() {
    if (!el.corrToggle) return;

    const cal = readPM25Calibration();

    // Si pas de calibration sauvegardée → toggle désactivé
    if (!cal) {
      el.corrToggle.checked = false;
      el.corrToggle.disabled = true;
      if (el.corrInfo) el.corrInfo.textContent = " (aucune calibration)";
      return;
    }

    el.corrToggle.disabled = false;
    el.corrToggle.checked = isPM25CorrectionEnabled();

    if (el.corrInfo) {
      const a = Number(cal.a);
      const b = Number(cal.b);
      const when = cal.savedAt ? new Date(cal.savedAt).toLocaleString() : "";
      el.corrInfo.textContent = ` (a=${a.toFixed(3)}, b=${b.toFixed(3)}${when ? " • " + when : ""})`;
    }

    el.corrToggle.addEventListener("change", () => {
      localStorage.setItem(PM25_CORR_ENABLED_KEY, el.corrToggle.checked ? "1" : "0");
      // Re-render chart + cards
      refreshView();
    });
  }

  // ---------------------- CSV PARSE ----------------------
  function parseNebuleAirCSV(text) {
    const lines = text.split(/\r?\n/g).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map(h => h.trim());
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    const pick = (cands) => {
      for (const c of cands) if (idx[c] !== undefined) return idx[c];
      return -1;
    };

    const iTime = pick(["time", "timestamp", "date", "t"]);
    const iPM1  = pick(["pm1", "PM1"]);
    const iPM25 = pick(["pm25", "PM25", "PM2.5", "pm2_5", "pm2.5"]);
    const iPM10 = pick(["pm10", "PM10"]);
    const iTemp = pick(["temperature", "temp", "T"]);
    const iHum  = pick(["humidite", "humidity", "RH", "hum"]);
    const iLat  = pick(["lat", "latitude"]);
    const iLon  = pick(["lon", "lng", "longitude"]);

    if (iTime < 0) throw new Error("CSV NebuleAir: colonne time/timestamp introuvable.");

    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",").map(p => p.trim());
      const t = new Date(parts[iTime]);
      if (Number.isNaN(t.getTime())) continue;

      const row = {
        t,
        pm1: iPM1 >= 0 ? toFloat(parts[iPM1]) : NaN,
        pm25: iPM25 >= 0 ? toFloat(parts[iPM25]) : NaN,
        pm10: iPM10 >= 0 ? toFloat(parts[iPM10]) : NaN,
        temperature: iTemp >= 0 ? toFloat(parts[iTemp]) : NaN,
        humidite: iHum >= 0 ? toFloat(parts[iHum]) : NaN,
      };

      if (iLat >= 0) row.lat = toFloat(parts[iLat]);
      if (iLon >= 0) row.lon = toFloat(parts[iLon]);

      out.push(row);
    }

    // tri par temps ascendant
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  // ---------------------- RANGE / FILTER ----------------------
  function setRangePreset(preset) {
    const now = new Date();
    let start;

    if (preset === "1h") start = new Date(now.getTime() - 1 * HOUR_MS);
    else if (preset === "24h") start = new Date(now.getTime() - 24 * HOUR_MS);
    else if (preset === "7j") start = new Date(now.getTime() - 7 * 24 * HOUR_MS);
    else return;

    if (el.start) el.start.value = toDatetimeLocalValue(start);
    if (el.end) el.end.value = toDatetimeLocalValue(now);

    refreshView();
  }

  function getCurrentRange() {
    // Si l’utilisateur n’a rien mis → on prend "dernier 24h" par défaut
    let s = el.start ? parseDatetimeLocal(el.start.value) : null;
    let e = el.end ? parseDatetimeLocal(el.end.value) : null;

    if (!s || !e || e <= s) {
      const now = allPoints.length ? allPoints[allPoints.length - 1].t : new Date();
      const start = new Date(now.getTime() - 24 * HOUR_MS);
      s = start;
      e = now;
      if (el.start) el.start.value = toDatetimeLocalValue(s);
      if (el.end) el.end.value = toDatetimeLocalValue(e);
    }

    return { start: s, end: e };
  }

  function filterPointsByRange(points, start, end) {
    const sMs = start.getTime();
    const eMs = end.getTime();
    return points.filter(p => {
      const t = p.t.getTime();
      return t >= sMs && t <= eMs;
    });
  }

  // ---------------------- CARDS ----------------------
  function updateCards(points) {
    // Prend le dernier point "valide" pour chaque variable dans la plage
    const lastValid = (key) => {
      for (let i = points.length - 1; i >= 0; i--) {
        const v = points[i][key];
        if (isFiniteNumber(v)) return { v, t: points[i].t };
      }
      return null;
    };

    const pm1 = lastValid("pm1");
    const pm25 = lastValid("pm25");
    const pm10 = lastValid("pm10");
    const temp = lastValid("temperature");
    const hum = lastValid("humidite");

    setText(el.pm1, pm1 ? pm1.v.toFixed(1) : "--");

    if (pm25) {
      const iso = pm25.t.toISOString();
      const v = correctPM25(pm25.v, iso);
      setText(el.pm25, Number.isFinite(v) ? v.toFixed(1) : "--");
    } else {
      setText(el.pm25, "--");
    }

    setText(el.pm10, pm10 ? pm10.v.toFixed(1) : "--");
    setText(el.temp, temp ? temp.v.toFixed(1) : "--");
    setText(el.hum, hum ? hum.v.toFixed(0) : "--");
  }

  // ---------------------- CHART ----------------------
  function buildSeries(points) {
    const times = points.map(p => p.t);

    const pm1 = points.map(p => (isFiniteNumber(p.pm1) ? p.pm1 : null));

    const pm25Raw = points.map(p => (isFiniteNumber(p.pm25) ? p.pm25 : null));
    const pm25 = pm25Raw.map((v, i) => {
      if (!isFiniteNumber(v)) return null;
      return correctPM25(v, times[i].toISOString());
    });

    const pm10 = points.map(p => (isFiniteNumber(p.pm10) ? p.pm10 : null));
    const temp = points.map(p => (isFiniteNumber(p.temperature) ? p.temperature : null));
    const hum = points.map(p => (isFiniteNumber(p.humidite) ? p.humidite : null));

    return { times, pm1, pm25, pm10, temp, hum };
  }

  function renderChart(points) {
    if (!el.canvas) return;

    const { times, pm1, pm25, pm10, temp, hum } = buildSeries(points);

    const datasets = [];

    if (!el.tPM1 || el.tPM1.checked) {
      datasets.push({
        label: "PM1",
        data: pm1,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        spanGaps: true,
      });
    }

    if (!el.tPM25 || el.tPM25.checked) {
      datasets.push({
        label: isPM25CorrectionEnabled() ? "PM2.5 (corrigé)" : "PM2.5",
        data: pm25,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        spanGaps: true,
        fill: false,
      });
    }

    if (!el.tPM10 || el.tPM10.checked) {
      datasets.push({
        label: "PM10",
        data: pm10,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        spanGaps: true,
      });
    }

    if (!el.tTemp || el.tTemp.checked) {
      datasets.push({
        label: "Temp (°C)",
        data: temp,
        yAxisID: "y2",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        spanGaps: true,
      });
    }

    if (!el.tHum || el.tHum.checked) {
      datasets.push({
        label: "Hum (%)",
        data: hum,
        yAxisID: "y2",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        spanGaps: true,
      });
    }

    if (chartInstance) {
      chartInstance.data.labels = times;
      chartInstance.data.datasets = datasets;
      chartInstance.update();
      return;
    }

    const ctx = el.canvas.getContext("2d");
    chartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: times,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top" },
          tooltip: {
            callbacks: {
              label(context) {
                const label = context.dataset.label ? context.dataset.label + ": " : "";
                const y = context.parsed.y;
                if (y === null || y === undefined) return label + "--";
                return label + Number(y).toFixed(2);
              },
            },
          },
        },
        scales: {
          x: {
            type: "time",
            time: { unit: "hour" },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            grid: { borderDash: [2, 4] },
            title: { display: true, text: "PM (µg/m³)" },
          },
          y2: {
            position: "right",
            grid: { display: false },
            title: { display: true, text: "Temp/Hum" },
          },
        },
      },
    });
  }

  // ---------------------- MAP ----------------------
  function initMap(points) {
    if (!el.map || typeof L === "undefined") return;

    // Dernière position valide, sinon Marseille
    let lat = 43.2965;
    let lon = 5.3698;

    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      if (isFiniteNumber(p.lat) && isFiniteNumber(p.lon)) {
        lat = p.lat;
        lon = p.lon;
        break;
      }
    }

    if (!leafletMap) {
      leafletMap = L.map(el.map).setView([lat, lon], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(leafletMap);

      leafletMarker = L.marker([lat, lon]).addTo(leafletMap);
      leafletMarker.bindPopup("NebuleAir (dernière position)").openPopup();
      return;
    }

    // Update position
    leafletMap.setView([lat, lon], leafletMap.getZoom());
    if (leafletMarker) leafletMarker.setLatLng([lat, lon]);
  }

  // ---------------------- EXPORT ----------------------
  function exportCurrentRangeCSV() {
    const freqMin = el.exportFreq ? Number(el.exportFreq.value) : 1;
    const stepMs = Math.max(1, freqMin) * 60000;

    const rows = [];
    rows.push(["time", "pm1", "pm25_raw", "pm25_corrected", "pm10", "temperature", "humidite"].join(","));

    let lastT = -Infinity;
    for (const p of viewPoints) {
      const tMs = p.t.getTime();
      if (tMs - lastT < stepMs) continue;
      lastT = tMs;

      const pm25Raw = isFiniteNumber(p.pm25) ? p.pm25 : "";
      const pm25Corr = isFiniteNumber(p.pm25) ? correctPM25(p.pm25, p.t.toISOString()) : "";

      rows.push([
        p.t.toISOString(),
        isFiniteNumber(p.pm1) ? p.pm1 : "",
        pm25Raw,
        (pm25Corr !== "" && Number.isFinite(pm25Corr)) ? pm25Corr : "",
        isFiniteNumber(p.pm10) ? p.pm10 : "",
        isFiniteNumber(p.temperature) ? p.temperature : "",
        isFiniteNumber(p.humidite) ? p.humidite : "",
      ].join(","));
    }

    const { start, end } = getCurrentRange();
    const name = `nebuleair_export_${start.toISOString().slice(0,10)}_to_${end.toISOString().slice(0,10)}.csv`;
    downloadCSV(name, rows.join("\n"));
  }

  // ---------------------- REFRESH PIPELINE ----------------------
  function refreshView() {
    const { start, end } = getCurrentRange();
    viewPoints = filterPointsByRange(allPoints, start, end);

    updateCards(viewPoints);
    renderChart(viewPoints);
    initMap(viewPoints);
  }

  // ---------------------- EVENTS ----------------------
  function bindEvents() {
    // toggles séries
    const toggleIds = [el.tPM1, el.tPM25, el.tPM10, el.tTemp, el.tHum];
    toggleIds.forEach(t => {
      if (!t) return;
      t.addEventListener("change", () => renderChart(viewPoints));
    });

    // presets range
    el.rangeBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const r = btn.getAttribute("data-range");
        setRangePreset(r);
      });
    });

    // apply range
    if (el.applyRange) {
      el.applyRange.addEventListener("click", (e) => {
        e.preventDefault();
        refreshView();
      });
    }

    // export
    if (el.exportBtn) {
      el.exportBtn.addEventListener("click", (e) => {
        e.preventDefault();
        exportCurrentRangeCSV();
      });
    }

    // reset (ici: reset sur 24h + re-render)
    if (el.resetZoom) {
      el.resetZoom.addEventListener("click", (e) => {
        e.preventDefault();
        setRangePreset("24h");
      });
    }
  }

  // ---------------------- INIT ----------------------
  async function init() {
    // UI correction toggle
    initPM25CorrectionUI();

    // load data
    const csv = await fetchText(NEBULEAIR_CSV_URL);
    allPoints = parseNebuleAirCSV(csv);

    if (!allPoints.length) {
      console.warn("Aucune donnée NebuleAir trouvée.");
      updateCards([]);
      return;
    }

    // default range: 24h ending at last point
    const last = allPoints[allPoints.length - 1].t;
    const start = new Date(last.getTime() - 24 * HOUR_MS);

    if (el.start) el.start.value = toDatetimeLocalValue(start);
    if (el.end) el.end.value = toDatetimeLocalValue(last);

    bindEvents();
    refreshView();
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch(err => console.error("❌ dashboard.js init error:", err));
  });

  // Expose for other scripts if needed
  window.refreshDashboard = refreshView;
})();
