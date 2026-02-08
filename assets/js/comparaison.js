/* ==========================================================================
   NebuleAir — comparaison.js (CSV + stats réelles, design inchangé)
   - Lit NebuleAir CSV (time, pm1, pm25, pm10, temperature, humidite)
   - Lit AtmoSud CSV (date;co2;flag;pm10;flag;pm25;flag;pm1;flag)
   - Agrège à l’heure + aligne (timeline)
   - Régression y = a + b·x (x=référence, y=capteur brut)
   - Correction : Ccorr = (Cbrut - a) / b
   - KPIs : R² (raw vs ref), RMSE (corr vs ref), Division (A/B/C)
   - Export CSV
   ========================================================================== */

(() => {
  "use strict";

  // ---------------------- CONFIG ----------------------
  const qs = new URLSearchParams(window.location.search);

  // chemins par défaut (mets tes vrais chemins si tu les as ailleurs)
  const NEBULEAIR_CSV_URL = qs.get("nebuleair") || "assets/data/nebuleair_export.csv";
  const ATMOSUD_CSV_URL = qs.get("atmosud") || "assets/data/MRSLCP_H_17122025au08012026.CSV";

  // pm1 | pm25 | pm10
  const METRIC = (qs.get("metric") || "pm25").toLowerCase();

  // AtmoSud est en heure locale. Décembre = CET = UTC+1.
  // On convertit en UTC en soustrayant l’offset.
  const ATMOSUD_TZ_OFFSET_HOURS = Number(qs.get("atmosud_tz") || "1");

  // Garder uniquement les mesures validées "A" (option désactivable via ?flagA=0)
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
    cardDivision: document.getElementById("card-division"), // peut ne pas exister
    canvas: document.getElementById("comparisonChart"),
  };

  // ---------------------- STATE ----------------------
  let chartInstance = null;

  const globalData = {
    // Timeline (Date[])
    times: [],
    // séries alignées (Number|null)[]
    raw: [],
    reference: [],
    corrected: [],
    // méta
    pairsCount: 0,
    expectedCount: 0,
    captureRate: 0,
    regression: { a: NaN, b: NaN },
  };

  // ---------------------- HELPERS ----------------------
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

  function floorToHourMs(d) {
    const t = d.getTime();
    return Math.floor(t / HOUR_MS) * HOUR_MS;
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

  function setText(idOrNode, text) {
    const node = typeof idOrNode === "string" ? document.getElementById(idOrNode) : idOrNode;
    if (!node) return;
    node.textContent = text;
  }

  // ---------------------- PARSERS ----------------------
  function parseNebuleAirCSV(text) {
    const lines = text.split(/\r?\n/g).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map(h => h.trim());
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    // tolérance : si les colonnes ne s’appellent pas exactement pareil
    const getIndex = (candidates) => {
      for (const c of candidates) {
        if (idx[c] !== undefined) return idx[c];
      }
      return -1;
    };

    const iTime = getIndex(["time", "timestamp", "date", "t"]);
    const iPM1 = getIndex(["pm1", "PM1"]);
    const iPM25 = getIndex(["pm25", "PM25", "PM2.5", "pm2_5", "pm2.5"]);
    const iPM10 = getIndex(["pm10", "PM10"]);
    const iTemp = getIndex(["temperature", "temp", "T"]);
    const iHum = getIndex(["humidite", "humidity", "RH", "hum"]);

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

  // AtmoSud date FR : "dd/mm/yyyy hh:mm" (heure locale)
  function parseAtmoSudDateFR(dateTimeStr, tzOffsetHours) {
    const s = String(dateTimeStr).trim();
    const [dPart, tPart] = s.split(/\s+/);
    if (!dPart || !tPart) return null;

    const [dd, mm, yyyy] = dPart.split("/").map(Number);
    let [hh, min] = tPart.split(":").map(Number);

    if (![dd, mm, yyyy, hh, min].every(Number.isFinite)) return null;

    // cas 24:00 → 00:00 du lendemain
    let utcMs;
    if (hh === 24) {
      utcMs = Date.UTC(yyyy, mm - 1, dd, 0, min) + 24 * HOUR_MS;
    } else {
      utcMs = Date.UTC(yyyy, mm - 1, dd, hh, min);
    }

    // local -> UTC
    utcMs -= tzOffsetHours * HOUR_MS;
    return new Date(utcMs);
  }

  function parseAtmoSudCSV(text, tzOffsetHours) {
    const lines = text.split(/\r?\n/g).map(l => l.trim()).filter(Boolean);
    const out = [];
    const rowRegex = /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s*;/;

    for (const line of lines) {
      if (!rowRegex.test(line)) continue;

      const p = line.split(";").map(x => x.trim());
      // date;co2;flag;pm10;flag;pm25;flag;pm1;flag
      if (p.length < 9) continue;

      const t = parseAtmoSudDateFR(p[0], tzOffsetHours);
      if (!t || Number.isNaN(t.getTime())) continue;

      out.push({
        t,
        co2: toFloat(p[1]),
        co2_flag: (p[2] || "").toUpperCase(),
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

  // ---------------------- AGGREGATION & ALIGN ----------------------
  function aggregateHourly(points, metric, extraKeys = []) {
    // hourMs -> accumulator
    const acc = new Map();

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

      a.sum += v;
      a.count += 1;

      for (const ek of extraKeys) {
        const ev = pt[ek];
        if (isFiniteNumber(ev)) {
          a[ek].sum += ev;
          a[ek].count += 1;
        }
      }
    }

    const out = new Map();
    for (const [k, a] of acc.entries()) {
      const row = { t: new Date(k), [metric]: a.sum / a.count };
      for (const ek of extraKeys) {
        row[ek] = a[ek].count ? a[ek].sum / a[ek].count : NaN;
      }
      out.set(k, row);
    }
    return out;
  }

  function buildUnionTimeline(nebMap, atmMap) {
    // union min/max
    const allKeys = [...nebMap.keys(), ...atmMap.keys()];
    if (allKeys.length === 0) return [];

    allKeys.sort((a, b) => a - b);
    const minK = allKeys[0];
    const maxK = allKeys[allKeys.length - 1];

    const keys = [];
    for (let k = minK; k <= maxK; k += HOUR_MS) keys.push(k);
    return keys;
  }

  function computeCaptureStats(nebMap, atmMap, metric) {
    if (nebMap.size === 0 || atmMap.size === 0) return { pairs: 0, expected: 0, capture: 0 };

    const nebKeys = [...nebMap.keys()].sort((a, b) => a - b);
    const atmKeys = [...atmMap.keys()].sort((a, b) => a - b);

    const commonStart = Math.max(nebKeys[0], atmKeys[0]);
    const commonEnd = Math.min(nebKeys[nebKeys.length - 1], atmKeys[atmKeys.length - 1]);

    if (commonEnd < commonStart) return { pairs: 0, expected: 0, capture: 0 };

    const expected = Math.floor((commonEnd - commonStart) / HOUR_MS) + 1;

    let pairs = 0;
    for (let k = commonStart; k <= commonEnd; k += HOUR_MS) {
      const n = nebMap.get(k)?.[metric];
      const r = atmMap.get(k)?.[metric];
      if (isFiniteNumber(n) && isFiniteNumber(r)) pairs++;
    }

    const capture = expected ? pairs / expected : 0;
    return { pairs, expected, capture };
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
    if (den === 0) return NaN;
    return (sxy * sxy) / den;
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

  // Division A/B/C (comme ton ancien code, mais avec vraies valeurs)
  function computeDivision(r2, b) {
    if (!isFiniteNumber(r2) || !isFiniteNumber(b)) return { label: "Hors Critères", color: "#ef4444" };

    if (r2 > 0.75 && b >= 0.7 && b <= 1.3) return { label: "Division A", color: "#10b981" };
    if (r2 > 0.5 && ((b >= 0.5 && b < 0.7) || (b > 1.3 && b <= 1.5))) return { label: "Division B", color: "#f59e0b" };
    return { label: "Hors Critères", color: "#ef4444" };
  }

  function metricLabel(metric) {
    if (metric === "pm1") return "PM1";
    if (metric === "pm10") return "PM10";
    return "PM2.5";
  }

  // ---------------------- CALIBRATION ----------------------
  function updateCorrection() {
    const a = el.coeffA ? (parseFloat(el.coeffA.value) || 0) : 0;
    const b = el.coeffB ? (parseFloat(el.coeffB.value) || 1) : 1;

    globalData.corrected = globalData.raw.map((val) => {
      if (!isFiniteNumber(val) || !isFiniteNumber(b) || b === 0) return null;
      const corr = (val - a) / b;
      return corr > 0 ? corr : 0;
    });

    calculateStats(b);
    renderChart();
  }

  function calculateStats(b) {
    // Stats uniquement sur les paires (raw & ref existants) / (corr & ref existants)
    const xRaw = [];
    const yRef = [];
    const yCorr = [];

    for (let i = 0; i < globalData.times.length; i++) {
      const raw = globalData.raw[i];
      const ref = globalData.reference[i];
      const corr = globalData.corrected[i];

      if (isFiniteNumber(raw) && isFiniteNumber(ref)) {
        // pour R² : raw vs ref
        xRaw.push(ref);
        yRef.push(raw);
      }
      if (isFiniteNumber(corr) && isFiniteNumber(ref)) {
        yCorr.push(corr);
      }
    }

    // R² raw vs ref (x=ref, y=raw)
    const r2 = rSquared(xRaw, yRef);

    // RMSE corrigé vs ref (sur mêmes index que yCorr / ref)
    const refForCorr = [];
    for (let i = 0; i < globalData.times.length; i++) {
      const ref = globalData.reference[i];
      const corr = globalData.corrected[i];
      if (isFiniteNumber(ref) && isFiniteNumber(corr)) refForCorr.push(ref);
    }
    const eRMSE = rmse(refForCorr, yCorr);

    setText(el.statR2, isFiniteNumber(r2) ? r2.toFixed(2) : "--");
    setText(el.statRMSE, isFiniteNumber(eRMSE) ? eRMSE.toFixed(1) : "--");

    const div = computeDivision(r2, b);
    if (el.statDivision) {
      el.statDivision.textContent = div.label;
      el.statDivision.style.color = div.color;
    }
    if (el.cardDivision) {
      el.cardDivision.style.borderLeft = `4px solid ${div.color}`;
    }
  }

  // ---------------------- CHART ----------------------
  function renderChart() {
    const canvas = el.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const datasets = [
      {
        label: "Données Brutes",
        data: globalData.raw,
        borderColor: "#9ca3af", // gris (inchangé)
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        spanGaps: true,
        order: 3,
      },
      {
        label: "Référence (AtmoSud)",
        data: globalData.reference,
        borderColor: "#10b981", // vert (inchangé)
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
        data: globalData.corrected,
        borderColor: "#2563eb", // bleu (inchangé)
        backgroundColor: "rgba(37, 99, 235, 0.1)",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        fill: true,
        spanGaps: true,
        order: 1,
      },
    ];

    const yTitle = `${metricLabel(METRIC)} (µg/m³)`;

    if (chartInstance) {
      chartInstance.data.labels = globalData.times;
      chartInstance.data.datasets = datasets;
      chartInstance.options.scales.y.title.text = yTitle;
      chartInstance.update();
      return;
    }

    chartInstance = new Chart(ctx, {
      type: "line",
      data: { labels: globalData.times, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top" },
          tooltip: {
            callbacks: {
              label(context) {
                let label = context.dataset.label || "";
                if (label) label += ": ";
                if (context.parsed.y !== null) label += Number(context.parsed.y).toFixed(1) + " µg/m³";
                return label;
              },
            },
          },
        },
        scales: {
          x: {
            type: "time",
            time: { unit: "day", displayFormats: { day: "dd/MM" } },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            grid: { borderDash: [2, 4] },
            title: { display: true, text: yTitle },
          },
        },
      },
    });
  }

  // ---------------------- EXPORT ----------------------
  function exportCSV() {
    const a = el.coeffA ? (parseFloat(el.coeffA.value) || 0) : 0;
    const b = el.coeffB ? (parseFloat(el.coeffB.value) || 1) : 1;

    const header = ["TimeUTC", "Raw", "Reference", "Corrected", "Temperature", "Humidite"].join(",");
    const rows = [header];

    for (let i = 0; i < globalData.times.length; i++) {
      const t = globalData.times[i];
      const raw = globalData.raw[i];
      const ref = globalData.reference[i];
      const corr = globalData.corrected[i];

      // temp/RH si dispo (on les met en cache dans des arrays temporaires, ici on les récupère via _meta)
      const temp = globalData._temp ? globalData._temp[i] : "";
      const hum = globalData._hum ? globalData._hum[i] : "";

      rows.push([
        t instanceof Date ? t.toISOString() : String(t),
        isFiniteNumber(raw) ? raw : "",
        isFiniteNumber(ref) ? ref : "",
        isFiniteNumber(corr) ? corr : "",
        isFiniteNumber(temp) ? temp : "",
        isFiniteNumber(hum) ? hum : "",
      ].join(","));
    }

    const fileName = `nebuleair_calibration_${METRIC}_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV(fileName, rows.join("\n"));
  }

  // ---------------------- MAIN LOAD ----------------------
  async function fetchData() {
    if (!["pm1", "pm25", "pm10"].includes(METRIC)) {
      throw new Error(`Metric invalide: ${METRIC} (attendu pm1|pm25|pm10)`);
    }

    // 1) Charger NebuleAir CSV
    const nebText = await fetchText(NEBULEAIR_CSV_URL);
    const nebPoints = parseNebuleAirCSV(nebText);

    // 2) Charger AtmoSud CSV
    const atmText = await fetchText(ATMOSUD_CSV_URL);
    let atmPoints = parseAtmoSudCSV(atmText, ATMOSUD_TZ_OFFSET_HOURS);

    // 3) Filtrer flag A si demandé
    if (REQUIRE_FLAG_A) {
      const flagKey = METRIC === "pm1" ? "pm1_flag" : (METRIC === "pm10" ? "pm10_flag" : "pm25_flag");
      atmPoints = atmPoints.filter(p => (p[flagKey] || "").toUpperCase() === "A");
    }

    // 4) Agréger à l’heure
    const nebMap = aggregateHourly(nebPoints, METRIC, ["temperature", "humidite"]);
    const atmMap = aggregateHourly(atmPoints, METRIC);

    // 5) Timeline union (pour garder une courbe propre + trous visibles)
    const keys = buildUnionTimeline(nebMap, atmMap);
    globalData.times = keys.map(k => new Date(k));

    // 6) Remplir séries alignées + temp/RH
    globalData.raw = [];
    globalData.reference = [];
    globalData.corrected = [];
    globalData._temp = [];
    globalData._hum = [];

    for (const k of keys) {
      const n = nebMap.get(k);
      const r = atmMap.get(k);

      const raw = n ? n[METRIC] : null;
      const ref = r ? r[METRIC] : null;

      globalData.raw.push(isFiniteNumber(raw) ? raw : null);
      globalData.reference.push(isFiniteNumber(ref) ? ref : null);
      globalData._temp.push(n && isFiniteNumber(n.temperature) ? n.temperature : null);
      globalData._hum.push(n && isFiniteNumber(n.humidite) ? n.humidite : null);

      globalData.corrected.push(null); // rempli après lecture a/b
    }

    // 7) Stats de capture & paires
    const cap = computeCaptureStats(nebMap, atmMap, METRIC);
    globalData.pairsCount = cap.pairs;
    globalData.expectedCount = cap.expected;
    globalData.captureRate = cap.capture;

    // 8) Auto-régression (sur paires)
    const xRef = [];
    const yRaw = [];
    for (let i = 0; i < globalData.times.length; i++) {
      const raw = globalData.raw[i];
      const ref = globalData.reference[i];
      if (isFiniteNumber(raw) && isFiniteNumber(ref)) {
        xRef.push(ref);
        yRaw.push(raw);
      }
    }

    const { a, b } = linearRegression(xRef, yRaw);
    globalData.regression = { a, b };

    // Auto-remplissage des inputs uniquement si l’utilisateur n’a pas déjà touché
    // (on considère "intouché" si a=0 et b=1)
    if (el.coeffA && el.coeffB) {
      const curA = parseFloat(el.coeffA.value);
      const curB = parseFloat(el.coeffB.value);

      const looksDefault =
        (!isFiniteNumber(curA) || curA === 0) &&
        (!isFiniteNumber(curB) || curB === 1);

      if (looksDefault && isFiniteNumber(a) && isFiniteNumber(b) && b !== 0) {
        el.coeffA.value = a.toFixed(3);
        el.coeffB.value = b.toFixed(3);
      }
    }

    // 9) Appliquer correction + afficher
    updateCorrection();
  }

  // ---------------------- INIT ----------------------
  document.addEventListener("DOMContentLoaded", () => {
    // Bind events (sans crash si éléments absents)
    if (el.btnApply) el.btnApply.addEventListener("click", updateCorrection);
    if (el.btnExport) el.btnExport.addEventListener("click", exportCSV);

    // Go
    fetchData().catch((e) => {
      console.error("❌ Erreur comparaison.js:", e);
      // On évite de laisser la page “vide”
      setText(el.statR2, "--");
      setText(el.statRMSE, "--");
      setText(el.statDivision, "Erreur données");
    });
  });
})();
