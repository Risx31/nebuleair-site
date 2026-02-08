/* ==========================================================================
   NebuleAir — dashboard.js (API live + chart + map + export + PM2.5 corrigé)
   - Source principale: API AirCarto (dataNebuleAir)
   - UI: index.html (IDs conformes)
   - Correction PM2.5: (pm25 - a) / b depuis comparaison.js via localStorage
   ========================================================================== */

(() => {
  "use strict";

  console.log("🚀 Dashboard — MODE API ✅");

  // ---------------------- CONFIG ----------------------
  const qs = new URLSearchParams(window.location.search);

  // Capteur (modifiable via ?capteurID=...)
  const CAPTEUR_ID = qs.get("capteurID") || "nebuleair-pro101";

  // API AirCarto (modifiable via ?api=...)
  const SENSOR_API_BASE =
    qs.get("api") ||
    "https://api.aircarto.fr/capteurs/dataNebuleAir";

  // Fallback CSV (si tu veux pouvoir tester en local)
  const FALLBACK_CSV_URL = qs.get("nebuleair_csv") || null; // ex: assets/data/nebuleair_export.csv

  // ---------------------- LocalStorage keys (partagés avec comparaison.js) ----
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

    // Toggles
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

  let points = []; // points de la plage courante : {t:Date, pm1, pm25, pm10, temperature, humidite, lat?, lon?}

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
    const tzOffsetMin = date.getTimezoneOffset();
    const local = new Date(date.getTime() - tzOffsetMin * 60000);
    return local.toISOString().slice(0, 16);
  }

  function parseDatetimeLocal(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  async function fetchJSON(url) {
    const u = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const res = await fetch(encodeURI(u), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  }

  async function fetchText(url) {
    const u = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const res = await fetch(encodeURI(u), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
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

    // Optionnel: correction seulement dans la plage calibrée
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
      renderAll(); // re-render chart + cards
    });
  }

  // ---------------------- PARSING API ----------------------
  function parseNebuleAirAPI(jsonData) {
    // jsonData: array d’objets
    const out = [];

    const pmKeys = {
      pm1:  ["pm1", "PM1", "PM1.0", "pm_1"],
      pm25: ["pm25", "PM25", "PM2.5", "pm2_5", "pm2.5"],
      pm10: ["pm10", "PM10", "pm_10"],
      temp: ["temperature", "temp", "T"],
      hum:  ["humidite", "humidity", "RH", "hum"],
      lat:  ["lat", "latitude"],
      lon:  ["lon", "lng", "longitude"],
    };

    const pick = (obj, keys) => {
      for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
      }
      return null;
    };

    for (const d of (Array.isArray(jsonData) ? jsonData : [])) {
      const time = d.timestamp || d.time || d.date || d.t;
      if (!time) continue;

      const t = new Date(time);
      if (Number.isNaN(t.getTime())) continue;

      out.push({
        t,
        pm1: toFloat(pick(d, pmKeys.pm1)),
        pm25: toFloat(pick(d, pmKeys.pm25)),
        pm10: toFloat(pick(d, pmKeys.pm10)),
        temperature: toFloat(pick(d, pmKeys.temp)),
        humidite: toFloat(pick(d, pmKeys.hum)),
        lat: toFloat(pick(d, pmKeys.lat)),
        lon: toFloat(pick(d, pmKeys.lon)),
      });
    }

    out.sort((a, b) => a.t - b.t);
    return out;
  }

  // ---------------------- FALLBACK CSV (optionnel) ----------------------
  function parseNebuleAirCSV(text) {
    const lines = text.split(/\r?\n/g).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map(h => h.trim());
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    const pickIndex = (cands) => {
      for (const c of cands) if (idx[c] !== undefined) return idx[c];
      return -1;
    };

    const iTime = pickIndex(["time", "timestamp", "date", "t"]);
    const iPM1  = pickIndex(["pm1", "PM1"]);
    const iPM25 = pickIndex(["pm25", "PM25", "PM2.5", "pm2_5", "pm2.5"]);
    const iPM10 = pickIndex(["pm10", "PM10"]);
    const iTemp = pickIndex(["temperature", "temp", "T"]);
    const iHum  = pickIndex(["humidite", "humidity", "RH", "hum"]);
    const iLat  = pickIndex(["lat", "latitude"]);
    const iLon  = pickIndex(["lon", "lng", "longitude"]);

    if (iTime < 0) return [];

    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(",").map(x => x.trim());
      if (!p[iTime]) continue;

      const t = new Date(p[iTime]);
      if (Number.isNaN(t.getTime())) continue;

      out.push({
        t,
        pm1: iPM1 >= 0 ? toFloat(p[iPM1]) : NaN,
        pm25: iPM25 >= 0 ? toFloat(p[iPM25]) : NaN,
        pm10: iPM10 >= 0 ? toFloat(p[iPM10]) : NaN,
        temperature: iTemp >= 0 ? toFloat(p[iTemp]) : NaN,
        humidite: iHum >= 0 ? toFloat(p[iHum]) : NaN,
        lat: iLat >= 0 ? toFloat(p[iLat]) : NaN,
        lon: iLon >= 0 ? toFloat(p[iLon]) : NaN,
      });
    }

    out.sort((a, b) => a.t - b.t);
    return out;
  }

  // ---------------------- RANGE ----------------------
  function ensureDefaultRange() {
    const now = new Date();
    if (el.end && !el.end.value) el.end.value = toDatetimeLocalValue(now);
    if (el.start && !el.start.value) el.start.value = toDatetimeLocalValue(new Date(now.getTime() - 24 * HOUR_MS));
  }

  function getCurrentRange() {
    ensureDefaultRange();

    const s = parseDatetimeLocal(el.start?.value);
    const e = parseDatetimeLocal(el.end?.value);

    if (!s || !e || e <= s) {
      const now = new Date();
      return { start: new Date(now.getTime() - 24 * HOUR_MS), end: now };
    }
    return { start: s, end: e };
  }

  function setRangePreset(preset) {
    const now = new Date();
    let start;
    if (preset === "1h") start = new Date(now.getTime() - 1 * HOUR_MS);
    else if (preset === "24h") start = new Date(now.getTime() - 24 * HOUR_MS);
    else if (preset === "7j") start = new Date(now.getTime() - 7 * 24 * HOUR_MS);
    else return;

    if (el.start) el.start.value = toDatetimeLocalValue(start);
    if (el.end) el.end.value = toDatetimeLocalValue(now);

    refreshData(); // recharge API avec la nouvelle plage
  }

  // ---------------------- API BUILD ----------------------
  function formatApiRange(start, end) {
    // API accepte des ISO (le fichier comparaison “original” utilisait -7d / now)
    // Pour être robuste, on envoie ISO
    return {
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  function getExportFreq() {
    // ton select est en minutes (1,5,15,...)
    const m = el.exportFreq ? Number(el.exportFreq.value) : 10;
    const minutes = Number.isFinite(m) && m > 0 ? m : 10;
    return `${minutes}m`;
  }

  function buildApiUrl(start, end, freq) {
    const u = new URL(SENSOR_API_BASE);
    u.searchParams.set("capteurID", CAPTEUR_ID);
    u.searchParams.set("start", start);
    u.searchParams.set("end", end);
    u.searchParams.set("freq", freq);
    u.searchParams.set("format", "JSON");
    return u.toString();
  }

  // ---------------------- RENDER: CARDS ----------------------
  function updateCards() {
    const lastValid = (key) => {
      for (let i = points.length - 1; i >= 0; i--) {
        const v = points[i][key];
        if (isFiniteNumber(v)) return points[i];
      }
      return null;
    };

    const p1 = lastValid("pm1");
    const p25 = lastValid("pm25");
    const p10 = lastValid("pm10");
    const pt = lastValid("temperature");
    const ph = lastValid("humidite");

    setText(el.pm1, p1 ? p1.pm1.toFixed(1) : "--");

    if (p25) {
      const iso = p25.t.toISOString();
      const v = correctPM25(p25.pm25, iso);
      setText(el.pm25, Number.isFinite(v) ? v.toFixed(1) : "--");
    } else {
      setText(el.pm25, "--");
    }

    setText(el.pm10, p10 ? p10.pm10.toFixed(1) : "--");
    setText(el.temp, pt ? pt.temperature.toFixed(1) : "--");
    setText(el.hum, ph ? ph.humidite.toFixed(0) : "--");
  }

  // ---------------------- RENDER: CHART ----------------------
  function renderChart() {
    if (!el.canvas || typeof Chart === "undefined") return;

    const times = points.map(p => p.t);
    const pm1 = points.map(p => (isFiniteNumber(p.pm1) ? p.pm1 : null));
    const pm25Raw = points.map(p => (isFiniteNumber(p.pm25) ? p.pm25 : null));
    const pm25 = pm25Raw.map((v, i) => (isFiniteNumber(v) ? correctPM25(v, times[i].toISOString()) : null));
    const pm10 = points.map(p => (isFiniteNumber(p.pm10) ? p.pm10 : null));
    const temp = points.map(p => (isFiniteNumber(p.temperature) ? p.temperature : null));
    const hum = points.map(p => (isFiniteNumber(p.humidite) ? p.humidite : null));

    const datasets = [];

    if (!el.tPM1 || el.tPM1.checked) datasets.push({ label: "PM1", data: pm1, borderWidth: 2, pointRadius: 0, tension: 0.1, spanGaps: true });
    if (!el.tPM25 || el.tPM25.checked) datasets.push({ label: isPM25CorrectionEnabled() ? "PM2.5 (corrigé)" : "PM2.5", data: pm25, borderWidth: 2, pointRadius: 0, tension: 0.1, spanGaps: true });
    if (!el.tPM10 || el.tPM10.checked) datasets.push({ label: "PM10", data: pm10, borderWidth: 2, pointRadius: 0, tension: 0.1, spanGaps: true });
    if (!el.tTemp || el.tTemp.checked) datasets.push({ label: "Temp (°C)", data: temp, yAxisID: "y2", borderWidth: 2, pointRadius: 0, tension: 0.1, spanGaps: true });
    if (!el.tHum || el.tHum.checked) datasets.push({ label: "Hum (%)", data: hum, yAxisID: "y2", borderWidth: 2, pointRadius: 0, tension: 0.1, spanGaps: true });

    if (chartInstance) {
      chartInstance.data.labels = times;
      chartInstance.data.datasets = datasets;
      chartInstance.update();
      return;
    }

    const ctx = el.canvas.getContext("2d");
    chartInstance = new Chart(ctx, {
      type: "line",
      data: { labels: times, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "top" } },
        scales: {
          x: { type: "time", time: { unit: "hour" }, grid: { display: false } },
          y: { beginAtZero: true, title: { display: true, text: "PM (µg/m³)" } },
          y2: { position: "right", grid: { display: false }, title: { display: true, text: "Temp/Hum" } },
        },
      },
    });
  }

  // ---------------------- RENDER: MAP ----------------------
  function renderMap() {
    if (!el.map || typeof L === "undefined") return;

    // Dernière position valide dans la plage
    let lat = NaN, lon = NaN;
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      if (isFiniteNumber(p.lat) && isFiniteNumber(p.lon)) {
        lat = p.lat; lon = p.lon;
        break;
      }
    }

    // Si API ne donne pas lat/lon → on prend un fallback configurable
    if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
      lat = Number(qs.get("lat") || 43.2965);
      lon = Number(qs.get("lon") || 5.3698);
    }

    if (!leafletMap) {
      leafletMap = L.map(el.map).setView([lat, lon], 15);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(leafletMap);

      leafletMarker = L.marker([lat, lon]).addTo(leafletMap);
      leafletMarker.bindPopup("NebuleAir (dernière position)");
      return;
    }

    leafletMap.setView([lat, lon], leafletMap.getZoom());
    if (leafletMarker) leafletMarker.setLatLng([lat, lon]);
  }

  function renderAll() {
    updateCards();
    renderChart();
    renderMap();
  }

  // ---------------------- EXPORT CSV ----------------------
  function exportCSV() {
    const rows = [];
    rows.push(["time", "pm1", "pm25_raw", "pm25_corrected", "pm10", "temperature", "humidite", "lat", "lon"].join(","));

    for (const p of points) {
      const iso = p.t.toISOString();
      const pm25Raw = isFiniteNumber(p.pm25) ? p.pm25 : "";
      const pm25Corr = isFiniteNumber(p.pm25) ? correctPM25(p.pm25, iso) : "";

      rows.push([
        iso,
        isFiniteNumber(p.pm1) ? p.pm1 : "",
        pm25Raw,
        (pm25Corr !== "" && Number.isFinite(pm25Corr)) ? pm25Corr : "",
        isFiniteNumber(p.pm10) ? p.pm10 : "",
        isFiniteNumber(p.temperature) ? p.temperature : "",
        isFiniteNumber(p.humidite) ? p.humidite : "",
        isFiniteNumber(p.lat) ? p.lat : "",
        isFiniteNumber(p.lon) ? p.lon : "",
      ].join(","));
    }

    const { start, end } = getCurrentRange();
    downloadCSV(
      `nebuleair_dashboard_${start.toISOString().slice(0,10)}_to_${end.toISOString().slice(0,10)}.csv`,
      rows.join("\n")
    );
  }

  // ---------------------- DATA LOAD ----------------------
  async function refreshData() {
    try {
      const { start, end } = getCurrentRange();
      const freq = getExportFreq(); // on peut aussi mettre un freq fixe pour l'affichage si tu veux
      const { start: apiStart, end: apiEnd } = formatApiRange(start, end);

      const url = buildApiUrl(apiStart, apiEnd, freq);
      console.log("📡 API:", url);

      const json = await fetchJSON(url);
      points = parseNebuleAirAPI(json);

      console.log(`✅ Points: ${points.length}`);

      renderAll();
    } catch (err) {
      console.error("❌ Erreur API dashboard:", err);

      // Fallback CSV si configuré
      if (FALLBACK_CSV_URL) {
        try {
          const txt = await fetchText(FALLBACK_CSV_URL);
          const all = parseNebuleAirCSV(txt);

          const { start, end } = getCurrentRange();
          const sMs = start.getTime(), eMs = end.getTime();
          points = all.filter(p => p.t.getTime() >= sMs && p.t.getTime() <= eMs);

          console.warn(`⚠️ Fallback CSV utilisé: ${points.length} points`);
          renderAll();
          return;
        } catch (e2) {
          console.error("❌ Fallback CSV impossible:", e2);
        }
      }

      // En dernier recours: UI vide mais stable
      points = [];
      renderAll();
    }
  }

  // ---------------------- EVENTS ----------------------
  function bindEvents() {
    // Toggles séries
    [el.tPM1, el.tPM25, el.tPM10, el.tTemp, el.tHum].forEach(t => {
      if (!t) return;
      t.addEventListener("change", renderChart);
    });

    // Presets range
    el.rangeBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        setRangePreset(btn.getAttribute("data-range"));
      });
    });

    // Apply range (dates)
    if (el.applyRange) {
      el.applyRange.addEventListener("click", (e) => {
        e.preventDefault();
        refreshData();
      });
    }

    // Export
    if (el.exportBtn) {
      el.exportBtn.addEventListener("click", (e) => {
        e.preventDefault();
        exportCSV();
      });
    }

    // Reset = 24h
    if (el.resetZoom) {
      el.resetZoom.addEventListener("click", (e) => {
        e.preventDefault();
        setRangePreset("24h");
      });
    }

    // Si l’utilisateur change la fréquence d’export, on ne recharge pas forcément,
    // mais tu peux si tu veux: refreshData();
  }

  // ---------------------- INIT ----------------------
  document.addEventListener("DOMContentLoaded", () => {
    initPM25CorrectionUI();
    bindEvents();
    ensureDefaultRange();
    refreshData();
  });

  // Pour debug / autres scripts
  window.refreshDashboard = refreshData;
})();
