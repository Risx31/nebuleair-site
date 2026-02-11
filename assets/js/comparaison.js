/* ==========================================================================
   NebuleAir — comparaison.js (CSV + fenêtre de calibration + auto-calibration)
   - NebuleAir CSV + AtmoSud CSV
   - Agrégation horaire, alignement
   - Auto-calibration sur une plage (régression y = a + b·x)
   - Correction : x_est = (y - a) / b
   - KPI (R², RMSE, Division) calculés sur la plage
   - Option : appliquer la correction uniquement sur la plage
   ========================================================================== */

(() => {
  "use strict";

   // ====== Stockage calibration (partagée avec index.html) ======
const PM25_CAL_KEY = "nebuleair.pm25.calibration.v1";

function savePM25Calibration(payload) {
  try {
    localStorage.setItem(PM25_CAL_KEY, JSON.stringify({
      ...payload,
      savedAt: new Date().toISOString()
    }));
  } catch (e) {
    console.warn("Impossible de sauvegarder la calibration PM2.5:", e);
  }
}

function loadPM25Calibration() {
  try {
    const raw = localStorage.getItem(PM25_CAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

   
  console.log("🚀 Comparaison — MODE CSV (v2 plage calibration) ✅");

  const qs = new URLSearchParams(window.location.search);

// ===============================
// NOUVEAUX FICHIERS 2026
// ===============================

const NEBULEAIR_CSV_URL = qs.get("nebuleair") || "assets/data/Données_brutes2026.CSV";
const ATMOSUD_CSV_URL   = qs.get("atmosud")   || "assets/data/MRS-LCP.CSV";


  // pm1 | pm25 | pm10
  const METRIC = (qs.get("metric") || "pm25").toLowerCase();

  // AtmoSud = heure locale. Décembre Marseille = UTC+1
  const ATMOSUD_TZ_OFFSET_HOURS = Number(qs.get("atmosud_tz") || "1");

  // Garder uniquement les valeurs validées "A"
  const REQUIRE_FLAG_A = qs.get("flagA") !== "0";

  const HOUR_MS = 3600000;
  const SPAN_GAPS_MS = 2 * HOUR_MS; // évite les ramps bleues sur pannes longues

  // ---------------------- DOM ----------------------
  const el = {
    coeffB: document.getElementById("coeff-pente"),
    coeffA: document.getElementById("coeff-offset"),
    btnApply: document.getElementById("apply-calibration"),
    btnExport: document.getElementById("export-data"),

    calibStart: document.getElementById("calib-start"),
    calibEnd: document.getElementById("calib-end"),
    btnAuto: document.getElementById("auto-calibration"),
    chkOnlyWindow: document.getElementById("apply-only-window"),

    statR2: document.getElementById("stat-r2"),
    statRMSE: document.getElementById("stat-rmse"),
    statDivision: document.getElementById("stat-division"),
    cardDivision: document.getElementById("card-division"),

    canvas: document.getElementById("comparisonChart"),
  };

  // ---------------------- STATE ----------------------
  let chartInstance = null;

  const data = {
    times: [],   // Date[]
    raw: [],     // number|null
    ref: [],     // number|null
    corr: [],    // number|null
    temp: [],
    hum: [],
  };

  // ---------------------- HELPERS ----------------------
  function toFloat(v) {
    if (v == null) return NaN;
    const s = String(v).trim();
    if (!s) return NaN;
    return Number.parseFloat(s.replace(",", "."));
  }

  function isFiniteNumber(n) {
    return typeof n === "number" && Number.isFinite(n);
  }

  function floorToHourMs(d) {
    return Math.floor(d.getTime() / HOUR_MS) * HOUR_MS;
  }

  function setText(node, value) {
    if (!node) return;
    node.textContent = value;
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

  function toDatetimeLocalValue(date) {
    const tzOffsetMin = date.getTimezoneOffset();
    const local = new Date(date.getTime() - tzOffsetMin * 60000);
    return local.toISOString().slice(0, 16);
  }

  function parseDatetimeLocal(value) {
    if (!value) return null;
    const d = new Date(value); // interprété en local => OK
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ---------------------- PARSERS ----------------------
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

    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",").map(p => p.trim());
      if (iTime < 0 || !parts[iTime]) continue;

      const t = new Date(parts[iTime]);
      if (Number.isNaN(t.getTime())) continue;

      out.push({
        t,
        pm1: iPM1 >= 0 ? toFloat(parts[iPM1]) : NaN,
        pm25: iPM25 >= 0 ? toFloat(parts[iPM25]) : NaN,
        pm10: iPM10 >= 0 ? toFloat(parts[iPM10]) : NaN,
        temperature: iTemp >= 0 ? toFloat(parts[iTemp]) : NaN,
        humidite: iHum >= 0 ? toFloat(parts[iHum]) : NaN,
      });
    }
    return out;
  }

  function parseAtmoSudDateFR(dateTimeStr, tzOffsetHours) {
    const s = String(dateTimeStr).trim();
    const [dPart, tPart] = s.split(/\s+/);
    if (!dPart || !tPart) return null;

    const [dd, mm, yyyy] = dPart.split("/").map(Number);
    let [hh, min] = tPart.split(":").map(Number);
    if (![dd, mm, yyyy, hh, min].every(Number.isFinite)) return null;

    let utcMs;
    if (hh === 24) utcMs = Date.UTC(yyyy, mm - 1, dd, 0, min) + 24 * HOUR_MS;
    else utcMs = Date.UTC(yyyy, mm - 1, dd, hh, min);

    utcMs -= tzOffsetHours * HOUR_MS; // local -> UTC
    return new Date(utcMs);
  }

  function parseAtmoSudCSV(text, tzOffsetHours) {
    const lines = text.split(/\r?\n/g).map(l => l.trim()).filter(Boolean);
    const out = [];
    const rowRegex = /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s*;/;

    for (const line of lines) {
      if (!rowRegex.test(line)) continue;
      const p = line.split(";").map(x => x.trim());
      if (p.length < 9) continue;

      const t = parseAtmoSudDateFR(p[0], tzOffsetHours);
      if (!t || Number.isNaN(t.getTime())) continue;

      out.push({
        t,
        pm10: toFloat(p[3]),
        pm10_flag: (p[4] || "").toUpperCase(),
        pm25: toFloat(p[5]),
        pm25_flag: (p[6] || "").toUpperCase(),
        pm1: toFloat(p[7]),
        pm1_flag: (p[8] || "").toUpperCase(),
      });
    }
    return out;
  }

  // ---------------------- AGGREGATION ----------------------
  function aggregateHourly(points, metric, extraKeys = []) {
    const acc = new Map(); // hourMs -> accum
    for (const pt of points) {
      const v = pt[metric];
      if (!isFiniteNumber(v)) continue;

      const k = floorToHourMs(pt.t);
      let a = acc.get(k);
      if (!a) {
        a = { sum: 0, count: 0 };
        for (const ek of extraKeys) a[ek] = { sum: 0, count: 0 };
        acc.set(k, a);
      }

      a.sum += v; a.count++;
      for (const ek of extraKeys) {
        const ev = pt[ek];
        if (isFiniteNumber(ev)) {
          a[ek].sum += ev; a[ek].count++;
        }
      }
    }

    const out = new Map();
    for (const [k, a] of acc.entries()) {
      const row = { t: new Date(k), [metric]: a.sum / a.count };
      for (const ek of extraKeys) row[ek] = a[ek].count ? a[ek].sum / a[ek].count : NaN;
      out.set(k, row);
    }
    return out;
  }

  function buildUnionTimeline(nebMap, atmMap) {
    const allKeys = [...nebMap.keys(), ...atmMap.keys()];
    if (allKeys.length === 0) return [];
    allKeys.sort((a, b) => a - b);

    const minK = allKeys[0], maxK = allKeys[allKeys.length - 1];
    const keys = [];
    for (let k = minK; k <= maxK; k += HOUR_MS) keys.push(k);
    return keys;
  }

  // ---------------------- STATS ----------------------
  function linearRegression(xArr, yArr) {
    const n = Math.min(xArr.length, yArr.length);
    if (n < 2) return { a: NaN, b: NaN };

    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) { sumX += xArr[i]; sumY += yArr[i]; }
    const meanX = sumX / n, meanY = sumY / n;

    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      const dx = xArr[i] - meanX;
      const dy = yArr[i] - meanY;
      num += dx * dy;
      den += dx * dx;
    }

    const b = den === 0 ? NaN : num / den;
    const a = meanY - b * meanX;
    return { a, b };
  }

  function rSquared(xArr, yArr) {
    const n = Math.min(xArr.length, yArr.length);
    if (n < 2) return NaN;

    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) { sumX += xArr[i]; sumY += yArr[i]; }
    const meanX = sumX / n, meanY = sumY / n;

    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xArr[i] - meanX;
      const dy = yArr[i] - meanY;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
    const den = sxx * syy;
    return den === 0 ? NaN : (sxy * sxy) / den;
  }

  function rmse(refArr, estArr) {
    const n = Math.min(refArr.length, estArr.length);
    if (n < 1) return NaN;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const e = refArr[i] - estArr[i];
      s += e * e;
    }
    return Math.sqrt(s / n);
  }

  function computeDivision(r2, b) {
    let division = "Hors Critères";
    let color = "#ef4444";

    if (isFiniteNumber(r2) && isFiniteNumber(b)) {
      if (r2 >= 0.75 && b >= 0.7 && b <= 1.3) {
        division = "Division A"; color = "#10b981";
      } else if (r2 >= 0.5 && ((b >= 0.5 && b < 0.7) || (b > 1.3 && b <= 1.5))) {
        division = "Division B"; color = "#f59e0b";
      }
    }
    return { division, color };
  }

  // ---------------------- WINDOW ----------------------
  function getWindowMs() {
    if (!el.calibStart || !el.calibEnd) return null;
    const s = parseDatetimeLocal(el.calibStart.value);
    const e = parseDatetimeLocal(el.calibEnd.value);
    if (!s || !e) return null;

    const startMs = s.getTime();
    const endMs = e.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

    return { startMs, endMs };
  }

  function getPairs(windowMs) {
    const xRef = [];
    const yRaw = [];

    for (let i = 0; i < data.times.length; i++) {
      const tMs = data.times[i].getTime();
      if (windowMs && (tMs < windowMs.startMs || tMs > windowMs.endMs)) continue;

      const raw = data.raw[i];
      const ref = data.ref[i];
      if (isFiniteNumber(raw) && isFiniteNumber(ref)) {
        xRef.push(ref);
        yRaw.push(raw);
      }
    }
    return { xRef, yRaw };
  }

  // ---------------------- CHART ----------------------
  function renderChart() {
    if (!el.canvas) return;
    const ctx = el.canvas.getContext("2d");

    const datasets = [
      {
        label: "Données Corrigées",
        data: data.corr,
        borderColor: "#2563eb",
        backgroundColor: "rgba(37, 99, 235, 0.1)",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        fill: true,
        spanGaps: SPAN_GAPS_MS,
        order: 1,
      },
      {
        label: "Référence (AtmoSud)",
        data: data.ref,
        borderColor: "#10b981",
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0.1,
        spanGaps: SPAN_GAPS_MS,
        order: 2,
      },
      {
        label: "Données Brutes",
        data: data.raw,
        borderColor: "#9ca3af",
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        spanGaps: SPAN_GAPS_MS,
        order: 3,
      },
    ];

    if (chartInstance) {
      chartInstance.data.labels = data.times;
      chartInstance.data.datasets = datasets;
      chartInstance.update();
      return;
    }

    chartInstance = new Chart(ctx, {
      type: "line",
      data: { labels: data.times, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "top" } },
        scales: {
          x: { type: "time", time: { unit: "day" }, grid: { display: false } },
          y: { beginAtZero: true, grid: { borderDash: [2, 4] } },
        },
      },
    });
  }

  // ---------------------- KPI + CORR ----------------------
  function calcKPIsOnWindow(b, windowMs) {
    const { xRef, yRaw } = getPairs(windowMs);
    const r2 = rSquared(xRef, yRaw);

    const refArr = [];
    const corrArr = [];
    for (let i = 0; i < data.times.length; i++) {
      const tMs = data.times[i].getTime();
      if (windowMs && (tMs < windowMs.startMs || tMs > windowMs.endMs)) continue;

      const ref = data.ref[i];
      const corr = data.corr[i];
      if (isFiniteNumber(ref) && isFiniteNumber(corr)) {
        refArr.push(ref);
        corrArr.push(corr);
      }
    }

    const eRMSE = rmse(refArr, corrArr);

    setText(el.statR2, isFiniteNumber(r2) ? r2.toFixed(2) : "--");
    setText(el.statRMSE, isFiniteNumber(eRMSE) ? eRMSE.toFixed(1) : "--");

    const div = computeDivision(r2, b);
    if (el.statDivision) {
      el.statDivision.textContent = div.division;
      el.statDivision.style.color = div.color;
    }
    if (el.cardDivision) el.cardDivision.style.borderLeft = `4px solid ${div.color}`;
  }

  function updateCorrection() {
    const a = el.coeffA ? (parseFloat(el.coeffA.value) || 0) : 0;
    const b = el.coeffB ? (parseFloat(el.coeffB.value) || 1) : 1;
    if (!isFiniteNumber(b) || b === 0) return;

    const windowMs = getWindowMs();
    const onlyWindow = !!(el.chkOnlyWindow && el.chkOnlyWindow.checked);

    data.corr = data.raw.map((v, i) => {
      if (!isFiniteNumber(v)) return null;
      if (onlyWindow && windowMs) {
        const tMs = data.times[i].getTime();
        if (tMs < windowMs.startMs || tMs > windowMs.endMs) return null;
      }
      return Math.max(0, (v - a) / b);
    });

    calcKPIsOnWindow(b, windowMs);
    renderChart();
  }

function autoCalibrateOnWindow() {
  // 1) Récupération de la plage de calibration
  const windowMs = getWindowMs();
  if (!windowMs) {
    console.warn("❌ Plage de calibration invalide ou incomplète.");
    return;
  }

  // 2) Extraction des paires (référence / brut) dans la plage
  const { xRef, yRaw } = getPairs(windowMs);

  console.log(`🎯 Auto-calibration PM2.5 : ${xRef.length} paires utilisées`);

  if (xRef.length < 5) {
    console.warn("❌ Pas assez de points pour calibrer (minimum ≈ 5 requis).");
    return;
  }

  // 3) Régression linéaire : y_raw = a + b * x_ref
  const { a, b } = linearRegression(xRef, yRaw);

  if (!isFiniteNumber(a) || !isFiniteNumber(b) || b === 0) {
    console.warn("❌ Régression invalide : coefficients a/b incorrects.");
    return;
  }

  // 4) Injection des coefficients dans l'UI
  if (el.coeffA) el.coeffA.value = a.toFixed(3);
  if (el.coeffB) el.coeffB.value = b.toFixed(3);

  // 5) Sauvegarde calibration (UNIQUEMENT PM2.5)
  if (METRIC === "pm25") {
    const startValue = el.calibStart ? el.calibStart.value : null;
    const endValue   = el.calibEnd   ? el.calibEnd.value   : null;

    savePM25Calibration({
      a,
      b,
      startISO: startValue ? new Date(startValue).toISOString() : null,
      endISO:   endValue   ? new Date(endValue).toISOString()   : null,
      method: "auto"
    });

    console.log(
      `💾 Calibration PM2.5 sauvegardée → a=${a.toFixed(3)}, b=${b.toFixed(3)}`
    );
  }

  // 6) Application immédiate de la correction + recalcul KPI + refresh graphe
  updateCorrection();
}


  function exportCSV() {
    const header = ["TimeUTC", "Raw", "Reference", "Corrected", "Temperature", "Humidite"].join(",");
    const rows = [header];

    for (let i = 0; i < data.times.length; i++) {
      rows.push([
        data.times[i] instanceof Date ? data.times[i].toISOString() : String(data.times[i]),
        isFiniteNumber(data.raw[i]) ? data.raw[i] : "",
        isFiniteNumber(data.ref[i]) ? data.ref[i] : "",
        isFiniteNumber(data.corr[i]) ? data.corr[i] : "",
        isFiniteNumber(data.temp[i]) ? data.temp[i] : "",
        isFiniteNumber(data.hum[i]) ? data.hum[i] : "",
      ].join(","));
    }

    downloadCSV(`nebuleair_comparaison_${METRIC}_${new Date().toISOString().slice(0, 10)}.csv`, rows.join("\n"));
  }
  // ---------------------- LOAD ----------------------
  async function fetchData() {
    console.log("📦 Lecture CSV NebuleAir + AtmoSud...");

    const [nebText, atmText] = await Promise.all([
      fetchText(NEBULEAIR_CSV_URL),
      fetchText(ATMOSUD_CSV_URL),
    ]);

    const nebPoints = parseNebuleAirCSV(nebText);
    let atmPoints = parseAtmoSudCSV(atmText, ATMOSUD_TZ_OFFSET_HOURS);

    if (REQUIRE_FLAG_A) {
      const flagKey = METRIC === "pm1" ? "pm1_flag" : (METRIC === "pm10" ? "pm10_flag" : "pm25_flag");
      atmPoints = atmPoints.filter(p => (p[flagKey] || "").toUpperCase() === "A");
    }

    const nebMap = aggregateHourly(nebPoints, METRIC, ["temperature", "humidite"]);
    const atmMap = aggregateHourly(atmPoints, METRIC);

const keys = [...nebMap.keys()]
  .filter(k => atmMap.has(k))
  .sort((a, b) => a - b);

    data.times = keys.map(k => new Date(k));

    data.raw = [];
    data.ref = [];
    data.corr = [];
    data.temp = [];
    data.hum = [];

    for (const k of keys) {
      const n = nebMap.get(k);
      const r = atmMap.get(k);

      const raw = n ? n[METRIC] : null;
      const ref = r ? r[METRIC] : null;

      data.raw.push(isFiniteNumber(raw) ? raw : null);
      data.ref.push(isFiniteNumber(ref) ? ref : null);
      data.temp.push(n && isFiniteNumber(n.temperature) ? n.temperature : null);
      data.hum.push(n && isFiniteNumber(n.humidite) ? n.humidite : null);
      data.corr.push(null);
    }

    // Init plage par défaut : 1ère et dernière paire (raw + ref)
    if (el.calibStart && el.calibEnd) {
      let first = null, last = null;
      for (let i = 0; i < data.times.length; i++) {
        if (isFiniteNumber(data.raw[i]) && isFiniteNumber(data.ref[i])) { first = data.times[i]; break; }
      }
      for (let i = data.times.length - 1; i >= 0; i--) {
        if (isFiniteNumber(data.raw[i]) && isFiniteNumber(data.ref[i])) { last = data.times[i]; break; }
      }
      if (first && last) {
        el.calibStart.value = toDatetimeLocalValue(first);
        el.calibEnd.value = toDatetimeLocalValue(last);
      }
    }

    // Auto-calibration initiale si a/b sont encore "par défaut"
    const curA = el.coeffA ? parseFloat(el.coeffA.value) : 0;
    const curB = el.coeffB ? parseFloat(el.coeffB.value) : 1;
    const looksDefault = (!isFiniteNumber(curA) || curA === 0) && (!isFiniteNumber(curB) || curB === 1);

    const allPairs = getPairs(getWindowMs());
    console.log(`✅ Paires ref/raw utilisables: ${allPairs.xRef.length}`);

    if (looksDefault && allPairs.xRef.length >= 5) autoCalibrateOnWindow();
    else updateCorrection();
  }

  // ---------------------- INIT ----------------------
  document.addEventListener("DOMContentLoaded", () => {
if (el.btnApply) el.btnApply.addEventListener("click", () => {
  // sauvegarde les valeurs saisies
  if (METRIC === "pm25") {
    const a = el.coeffA ? (parseFloat(el.coeffA.value) || 0) : 0;
    const b = el.coeffB ? (parseFloat(el.coeffB.value) || 1) : 1;

    const s = el.calibStart ? el.calibStart.value : null;
    const e = el.calibEnd ? el.calibEnd.value : null;

    savePM25Calibration({
      a,
      b,
      startISO: s ? new Date(s).toISOString() : null,
      endISO: e ? new Date(e).toISOString() : null,
      method: "manual"
    });
  }

  updateCorrection();
});

    if (el.btnExport) el.btnExport.addEventListener("click", exportCSV);

    // Event delegation = même si le DOM bouge, le bouton marche
    document.addEventListener("click", (e) => {
      const target = e.target.closest("#auto-calibration");
      if (!target) return;
      e.preventDefault();
      autoCalibrateOnWindow();
    }, { capture: true });

    if (el.calibStart) el.calibStart.addEventListener("change", updateCorrection);
    if (el.calibEnd) el.calibEnd.addEventListener("change", updateCorrection);
    if (el.chkOnlyWindow) el.chkOnlyWindow.addEventListener("change", updateCorrection);

    fetchData().catch((e) => {
      console.error("❌ Erreur comparaison.js:", e);
      setText(el.statR2, "--");
      setText(el.statRMSE, "--");
      setText(el.statDivision, "Erreur données");
    });
  });
})();
