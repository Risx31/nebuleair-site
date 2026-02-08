/* ==========================================================================
   NebuleAir — comparaison.js (mode CSV, design inchangé)
   - Lit NebuleAir CSV + AtmoSud CSV
   - Agrège à l’heure, aligne, calcule a/b (régression), corrige
   - KPIs : R² (raw vs ref), RMSE (corr vs ref), Division (A/B/C)
   - Export CSV
   ========================================================================== */

(() => {
  "use strict";

  console.log("🚀 Démarrage Graphique (Design Original) — MODE CSV ✅");

  // ---------------------- CONFIG ----------------------
  const qs = new URLSearchParams(window.location.search);

  // Chemins par défaut (mets les fichiers ici)
  const NEBULEAIR_CSV_URL = qs.get("nebuleair") || "assets/data/nebuleair_export.csv";
  const ATMOSUD_CSV_URL = qs.get("atmosud") || "assets/data/MRSLCP_H_17122025au08012026.CSV";

  // pm1 | pm25 | pm10
  const METRIC = (qs.get("metric") || "pm25").toLowerCase();

  // AtmoSud = heure locale. Décembre à Marseille = CET = UTC+1
  const ATMOSUD_TZ_OFFSET_HOURS = Number(qs.get("atmosud_tz") || "1");

  // Garder uniquement les valeurs validées "A" côté AtmoSud
  const REQUIRE_FLAG_A = qs.get("flagA") !== "0";

  // ---------------------- DOM ----------------------
  const el = {
    coeffB: document.getElementById("coeff-pente"),
    coeffA: document.getElementById("coeff-offset"),
    btnApply: document.getElementById("apply-calibration"),
    btnExport: document.getElementById("export-data"),
    statR2: document.getElementById("stat-r2"),
    statRMSE: document.getElementById("stat-rmse"),
    statDivision: document.getElementById("stat-division"),
    cardDivision: document.getElementById("card-division"), // optionnel
    canvas: document.getElementById("comparisonChart"),
  };

  // ---------------------- STATE ----------------------
  const HOUR_MS = 3600000;
  let chartInstance = null;

  const data = {
    times: [],
    raw: [],
    ref: [],
    corr: [],
    temp: [],
    hum: [],
    a: NaN,
    b: NaN,
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

  // ---------------------- PARSE CSV ----------------------
  function parseNebuleAirCSV(text) {
    const lines = text.split(/\r?\n/g).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map(h => h.trim());
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",").map(p => p.trim());
      const t = new Date(parts[idx.time]);
      if (Number.isNaN(t.getTime())) continue;

      out.push({
        t,
        pm1: toFloat(parts[idx.pm1]),
        pm25: toFloat(parts[idx.pm25]),
        pm10: toFloat(parts[idx.pm10]),
        temperature: toFloat(parts[idx.temperature]),
        humidite: toFloat(parts[idx.humidite]),
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
    if (hh === 24) {
      utcMs = Date.UTC(yyyy, mm - 1, dd, 0, min) + 24 * HOUR_MS;
    } else {
      utcMs = Date.UTC(yyyy, mm - 1, dd, hh, min);
    }
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

  function aggregateHourly(points, metric, extraKeys = []) {
    const acc = new Map(); // hourMs -> {sum,count,...}
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
      if (r2 > 0.75 && b >= 0.7 && b <= 1.3) {
        division = "Division A"; color = "#10b981";
      } else if (r2 > 0.5 && ((b >= 0.5 && b < 0.7) || (b > 1.3 && b <= 1.5))) {
        division = "Division B"; color = "#f59e0b";
      }
    }
    return { division, color };
  }

  // ---------------------- CHART ----------------------
  function renderChart() {
    if (!el.canvas) return;
    const ctx = el.canvas.getContext("2d");

    const datasets = [
      {
        label: "Données Brutes",
        data: data.raw,
        borderColor: "#9ca3af",
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        spanGaps: true,
        order: 3,
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
        spanGaps: true,
        order: 2,
      },
      {
        label: "Données Corrigées",
        data: data.corr,
        borderColor: "#2563eb",
        backgroundColor: "rgba(37, 99, 235, 0.1)",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        fill: true,
        spanGaps: true,
        order: 1,
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

  // ---------------------- CALC + UI ----------------------
  function updateCorrection() {
    const a = el.coeffA ? (parseFloat(el.coeffA.value) || 0) : 0;
    const b = el.coeffB ? (parseFloat(el.coeffB.value) || 1) : 1;
    if (!isFiniteNumber(b) || b === 0) return;

    data.corr = data.raw.map(v => (isFiniteNumber(v) ? Math.max(0, (v - a) / b) : null));

    // KPIs sur les paires (ref & raw / ref & corr)
    const xRef = [];
    const yRaw = [];
    const refCorr = [];
    const yCorr = [];

    for (let i = 0; i < data.times.length; i++) {
      const raw = data.raw[i];
      const ref = data.ref[i];
      const corr = data.corr[i];

      if (isFiniteNumber(raw) && isFiniteNumber(ref)) { xRef.push(ref); yRaw.push(raw); }
      if (isFiniteNumber(corr) && isFiniteNumber(ref)) { refCorr.push(ref); yCorr.push(corr); }
    }

    const r2 = rSquared(xRef, yRaw);
    const eRMSE = rmse(refCorr, yCorr);

    setText(el.statR2, isFiniteNumber(r2) ? r2.toFixed(2) : "--");
    setText(el.statRMSE, isFiniteNumber(eRMSE) ? eRMSE.toFixed(1) : "--");

    const div = computeDivision(r2, b);
    if (el.statDivision) {
      el.statDivision.textContent = div.division;
      el.statDivision.style.color = div.color;
    }
    if (el.cardDivision) el.cardDivision.style.borderLeft = `4px solid ${div.color}`;

    renderChart();
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

    downloadCSV(`nebuleair_comparaison_${METRIC}_${new Date().toISOString().slice(0,10)}.csv`, rows.join("\n"));
  }

  // ---------------------- MAIN LOAD ----------------------
  async function fetchData() {
    console.log("1️⃣ Lecture CSV NebuleAir + AtmoSud...");

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

    const keys = buildUnionTimeline(nebMap, atmMap);
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

    // auto régression (sur paires)
    const xRef = [];
    const yRaw = [];
    for (let i = 0; i < data.times.length; i++) {
      if (isFiniteNumber(data.ref[i]) && isFiniteNumber(data.raw[i])) {
        xRef.push(data.ref[i]);
        yRaw.push(data.raw[i]);
      }
    }

    const { a, b } = linearRegression(xRef, yRaw);
    data.a = a; data.b = b;

    // si inputs encore en "0 / 1", on propose l'auto-calib
    const curA = el.coeffA ? parseFloat(el.coeffA.value) : 0;
    const curB = el.coeffB ? parseFloat(el.coeffB.value) : 1;
    const looksDefault = (!isFiniteNumber(curA) || curA === 0) && (!isFiniteNumber(curB) || curB === 1);

    if (looksDefault && isFiniteNumber(a) && isFiniteNumber(b) && b !== 0) {
      el.coeffA.value = a.toFixed(3);
      el.coeffB.value = b.toFixed(3);
    }

    console.log(`✅ Paires ref/raw utilisables: ${xRef.length}`);
    updateCorrection();
  }

  // ---------------------- INIT ----------------------
  document.addEventListener("DOMContentLoaded", () => {
    if (el.btnApply) el.btnApply.addEventListener("click", updateCorrection);
    if (el.btnExport) el.btnExport.addEventListener("click", exportCSV);

    fetchData().catch((e) => {
      console.error("❌ Erreur comparaison.js:", e);
      setText(el.statR2, "--");
      setText(el.statRMSE, "--");
      setText(el.statDivision, "Erreur données");
    });
  });
})();
