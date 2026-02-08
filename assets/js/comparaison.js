/* ==========================================================================
   NebuleAir — comparaison.js (version QA/QC)
   - Charge NebuleAir CSV + AtmoSud CSV
   - Agrège / aligne à l’heure (intersection)
   - Régression y = a + b·x (x=référence AtmoSud, y=capteur NebuleAir brut)
   - Correction : Ccorr = (Cbrut - a) / b
   - KPIs : R² (raw vs ref), RMSE & MAPE (corr vs ref), data capture, Division A/B/C
   - Export CSV (time, raw, ref, corr, T, RH)
   ========================================================================== */

(() => {
  "use strict";

  // -----------------------------
  // 1) Config (fichiers & options)
  // -----------------------------
  const qs = new URLSearchParams(window.location.search);

  // Fichiers locaux par défaut (mets tes vrais chemins si besoin)
  const NEBULEAIR_CSV_URL = qs.get("nebuleair") || "nebuleair_export.csv";
  const ATMOSUD_CSV_URL = qs.get("atmosud") || "MRSLCP_H_17122025au08012026.CSV";

  // pm1 | pm25 | pm10
  const METRIC = (qs.get("metric") || "pm25").toLowerCase();

  // AtmoSud est en heure locale. Décembre à Marseille = CET = UTC+1.
  // On convertit vers UTC en soustrayant l’offset.
  const ATMOSUD_TZ_OFFSET_HOURS = Number(qs.get("atmosud_tz") || "1");

  // Garder seulement les points AtmoSud flaggés "A" (validés)
  const REQUIRE_FLAG_A = qs.get("flagA") !== "0";

  // -----------------------------
  // 2) DOM
  // -----------------------------
  const el = {
    coeffB: document.getElementById("coeff-pente"),
    coeffA: document.getElementById("coeff-offset"),
    btnApply: document.getElementById("apply-calibration"),
    btnExport: document.getElementById("export-data"),
    statR2: document.getElementById("stat-r2"),
    statRMSE: document.getElementById("stat-rmse"),
    statDivision: document.getElementById("stat-division"),
    cardDivision: document.getElementById("card-division"), // optionnel selon ton HTML
    canvas: document.getElementById("comparisonChart"),
  };

  // -----------------------------
  // 3) Helpers
  // -----------------------------
  function fmt(n, d = 3) {
    return Number.isFinite(n) ? n.toFixed(d) : "--";
  }

  function toFloat(v) {
    if (v == null) return NaN;
    const s = String(v).trim();
    if (!s) return NaN;
    return Number.parseFloat(s.replace(",", "."));
  }

  function floorToHourMs(date) {
    const t = date.getTime();
    return Math.floor(t / 3600000) * 3600000;
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

  async function fetchText(url) {
    const u = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const res = await fetch(encodeURI(u), { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed (${res.status}) : ${url}`);
    return await res.text();
  }

  function parseCsvLines(text) {
    return text
      .split(/\r?\n/g)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  // CSV simple (headers + virgules)
  function parseNebuleAirCSV(text) {
    const lines = parseCsvLines(text);
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((h) => h.trim());
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",").map((p) => p.trim());
      const timeStr = parts[idx.time];
      const t = new Date(timeStr);
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

  // AtmoSud: lignes type
  // 17/12/2025 01:00;484.21;A;20.0;A;16.5;A;14.8;A
  function parseAtmoSudDateFR(dateTimeStr, tzOffsetHours) {
    const s = String(dateTimeStr).trim();
    const [dPart, tPart] = s.split(/\s+/);
    if (!dPart || !tPart) return null;

    const [dd, mm, yyyy] = dPart.split("/").map((x) => Number(x));
    let [hh, min] = tPart.split(":").map((x) => Number(x));
    if (
      !Number.isFinite(dd) ||
      !Number.isFinite(mm) ||
      !Number.isFinite(yyyy) ||
      !Number.isFinite(hh) ||
      !Number.isFinite(min)
    ) {
      return null;
    }

    // Cas 24:00 → 00:00 du lendemain
    let utcMs;
    if (hh === 24) {
      utcMs = Date.UTC(yyyy, mm - 1, dd, 0, min) + 24 * 3600000;
    } else {
      utcMs = Date.UTC(yyyy, mm - 1, dd, hh, min);
    }

    // Local -> UTC
    utcMs -= tzOffsetHours * 3600000;
    return new Date(utcMs);
  }

  function parseAtmoSudCSV(text, tzOffsetHours) {
    const lines = parseCsvLines(text);
    const out = [];
    const rowRegex = /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s*;/;

    for (const line of lines) {
      if (!rowRegex.test(line)) continue;
      const p = line.split(";").map((x) => x.trim());
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

  // Agrégation horaire : si tu as du 10 min, on moyenne par heure
  function aggregateHourly(points, metric, extraKeys = []) {
    const acc = new Map(); // hourMs -> {sum,count, ...extras}
    for (const pt of points) {
      const v = pt[metric];
      if (!Number.isFinite(v)) continue;

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
        if (Number.isFinite(ev)) {
          a[ek].sum += ev;
          a[ek].count += 1;
        }
      }
    }

    const out = new Map();
    for (const [k, a] of acc.entries()) {
      const obj = {
        t: new Date(k),
        [metric]: a.sum / a.count,
      };
      for (const ek of extraKeys) {
        obj[ek] =
          a[ek].count > 0 ? a[ek].sum / a[ek].count : NaN;
      }
      out.set(k, obj);
    }
    return out;
  }

  // Alignement = intersection sur l’heure
  function align(nebMap, atmMap, metric) {
    const keys = [];
    for (const k of atmMap.keys()) {
      if (nebMap.has(k)) keys.push(k);
    }
    keys.sort((a, b) => a - b);

    const aligned = keys.map((k) => {
      const neb = nebMap.get(k);
      const atm = atmMap.get(k);
      return {
        t: new Date(k),
        raw: neb[metric],
        ref: atm[metric],
        temperature: neb.temperature,
        humidite: neb.humidite,
      };
    });

    if (keys.length === 0) {
      return { aligned, captureRate: 0, expectedCount: 0 };
    }

    const start = keys[0];
    const end = keys[keys.length - 1];
    const expectedCount = Math.floor((end - start) / 3600000) + 1;
    const captureRate = expectedCount > 0 ? keys.length / expectedCount : 0;

    return { aligned, captureRate, expectedCount };
  }

  // -----------------------------
  // 4) Stats (régression & KPIs)
  // -----------------------------
  function linearRegression(xArr, yArr) {
    const n = Math.min(xArr.length, yArr.length);
    if (n < 2) return { a: NaN, b: NaN };

    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) {
      sumX += xArr[i];
      sumY += yArr[i];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;

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

  // R² via corr² (robuste et standard)
  function rSquared(xArr, yArr) {
    const n = Math.min(xArr.length, yArr.length);
    if (n < 2) return NaN;

    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) {
      sumX += xArr[i];
      sumY += yArr[i];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;

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

  function mape(refArr, estArr) {
    const n = Math.min(refArr.length, estArr.length);
    if (n < 1) return NaN;
    let s = 0, k = 0;
    for (let i = 0; i < n; i++) {
      const r = refArr[i];
      const e = estArr[i];
      if (!Number.isFinite(r) || !Number.isFinite(e) || r === 0) continue;
      s += Math.abs(r - e) / Math.abs(r);
      k++;
    }
    return k === 0 ? NaN : s / k;
  }

  // Seuils A/B/C (PM) — cohérents avec ce qu’on a utilisé dans vos docs
  function gradeSlope(p) {
    if (!Number.isFinite(p)) return "C";
    if (p >= 0.7 && p <= 1.3) return "A";
    if ((p >= 0.5 && p < 0.7) || (p > 1.3 && p <= 1.5)) return "B";
    return "C";
  }
  function gradeR2(r2) {
    if (!Number.isFinite(r2)) return "C";
    if (r2 >= 0.75) return "A";
    if (r2 >= 0.5) return "B";
    return "C";
  }
  function gradeMAPE(m) {
    if (!Number.isFinite(m)) return "C";
    if (m < 0.5) return "A";
    if (m <= 1.0) return "B";
    return "C";
  }
  function gradeCapture(c) {
    if (!Number.isFinite(c)) return "C";
    if (c >= 0.9) return "A";
    if (c >= 0.14) return "B";
    return "C";
  }
  function worstGrade(grades) {
    if (grades.includes("C")) return "C";
    if (grades.includes("B")) return "B";
    return "A";
  }

  function divisionStyle(division) {
    if (division === "A") return { label: "Division A", color: "#10b981" };
    if (division === "B") return { label: "Division B", color: "#f59e0b" };
    return { label: "Division C", color: "#ef4444" };
  }

  // -----------------------------
  // 5) Chart.js
  // -----------------------------
  let chartInstance = null;

  function renderChart(times, raw, ref, corr, metricLabel) {
    if (!el.canvas) return;
    if (typeof Chart === "undefined") {
      console.warn("Chart.js non chargé.");
      return;
    }

    const datasets = [
      {
        label: "Données Brutes",
        data: raw,
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
        data: ref,
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
        data: corr,
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

    const ctx = el.canvas.getContext("2d");

    if (chartInstance) {
      chartInstance.data.labels = times;
      chartInstance.data.datasets = datasets;
      chartInstance.options.scales.y.title.text = `${metricLabel} (µg/m³)`;
      chartInstance.update();
      return;
    }

    chartInstance = new Chart(ctx, {
      type: "line",
      data: { labels: times, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top" },
          tooltip: {
            callbacks: {
              label: (context) => {
                let label = context.dataset.label || "";
                if (label) label += ": ";
                if (context.parsed.y != null) {
                  label += Number(context.parsed.y).toFixed(1) + " µg/m³";
                }
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
            title: { display: true, text: `${metricLabel} (µg/m³)` },
          },
        },
      },
    });
  }

  // -----------------------------
  // 6) État global
  // -----------------------------
  const STATE = {
    metric: METRIC,
    aligned: [],
    captureRate: 0,
    expectedCount: 0,
    times: [],
    raw: [],
    ref: [],
    corr: [],
  };

  function metricLabel(metric) {
    if (metric === "pm1") return "PM1";
    if (metric === "pm10") return "PM10";
    return "PM2.5";
  }

  function setDivision(division) {
    const { label, color } = divisionStyle(division);
    if (el.statDivision) {
      el.statDivision.textContent = label;
      el.statDivision.style.color = color;
    }
    if (el.cardDivision) {
      el.cardDivision.style.borderLeft = `4px solid ${color}`;
    }
  }

  // -----------------------------
  // 7) Calcul correction + KPIs
  // -----------------------------
  function applyCorrectionAndUpdate() {
    const a = el.coeffA ? (parseFloat(el.coeffA.value) || 0) : 0;
    const b = el.coeffB ? (parseFloat(el.coeffB.value) || 1) : 1;

    if (!Number.isFinite(b) || b === 0) {
      alert("b (pente) doit être un nombre non nul.");
      return;
    }

    STATE.corr = STATE.raw.map((v) => {
      if (!Number.isFinite(v)) return null;
      const c = (v - a) / b;
      return c > 0 ? c : 0;
    });

    // KPIs
    const x = STATE.ref.filter((v, i) => Number.isFinite(v) && Number.isFinite(STATE.raw[i]));
    const y = STATE.raw.filter((v, i) => Number.isFinite(v) && Number.isFinite(STATE.ref[i]));
    const ref2 = [];
    const corr2 = [];
    for (let i = 0; i < STATE.ref.length; i++) {
      const r = STATE.ref[i];
      const c = STATE.corr[i];
      if (Number.isFinite(r) && Number.isFinite(c)) {
        ref2.push(r);
        corr2.push(c);
      }
    }

    const r2 = rSquared(x, y);         // raw vs ref
    const eRMSE = rmse(ref2, corr2);   // corrected vs ref
    const eMAPE = mape(ref2, corr2);   // corrected vs ref

    if (el.statR2) el.statR2.textContent = fmt(r2, 3);
    if (el.statRMSE) el.statRMSE.textContent = Number.isFinite(eRMSE) ? eRMSE.toFixed(2) : "--";

    // Division A/B/C (pente, R², MAPE, data capture)
    const gSlope = gradeSlope(b);
    const gR2 = gradeR2(r2);
    const gMAPE = gradeMAPE(eMAPE);
    const gCap = gradeCapture(STATE.captureRate);
    const division = worstGrade([gSlope, gR2, gMAPE, gCap]);
    setDivision(division);

    renderChart(STATE.times, STATE.raw, STATE.ref, STATE.corr, metricLabel(STATE.metric));

    // Sauvegarde la calibration
    try {
      localStorage.setItem(
        `nebuleair_calib_${STATE.metric}`,
        JSON.stringify({ a, b, at: new Date().toISOString() })
      );
    } catch (_) {}
  }

  // -----------------------------
  // 8) Chargement + auto-calibration
  // -----------------------------
  async function loadAndProcess() {
    if (!["pm1", "pm25", "pm10"].includes(STATE.metric)) {
      throw new Error(`metric invalide: ${STATE.metric} (pm1|pm25|pm10)`);
    }

    const [nebText, atmText] = await Promise.all([
      fetchText(NEBULEAIR_CSV_URL),
      fetchText(ATMOSUD_CSV_URL),
    ]);

    const nebPoints = parseNebuleAirCSV(nebText);
    let atmPoints = parseAtmoSudCSV(atmText, ATMOSUD_TZ_OFFSET_HOURS);

    // Filtre flag A (validé) côté AtmoSud sur le metric choisi
    if (REQUIRE_FLAG_A) {
      const flagKey = STATE.metric === "pm1" ? "pm1_flag" : (STATE.metric === "pm10" ? "pm10_flag" : "pm25_flag");
      atmPoints = atmPoints.filter((p) => (p[flagKey] || "").toUpperCase() === "A");
    }

    // Agrégation horaire (NebuleAir peut être à 10 min, AtmoSud souvent horaire)
    const nebMap = aggregateHourly(nebPoints, STATE.metric, ["temperature", "humidite"]);
    const atmMap = aggregateHourly(atmPoints, STATE.metric);

    const { aligned, captureRate, expectedCount } = align(nebMap, atmMap, STATE.metric);

    STATE.aligned = aligned;
    STATE.captureRate = captureRate;
    STATE.expectedCount = expectedCount;

    if (aligned.length < 2) {
      alert("Pas assez de points communs NebuleAir ↔ AtmoSud après alignement/filtrage.");
      return;
    }

    // Remplit les tableaux pour le chart
    STATE.times = aligned.map((p) => p.t);
    STATE.raw = aligned.map((p) => p.raw);
    STATE.ref = aligned.map((p) => p.ref);

    // Auto-calibration recommandée (régression raw vs ref)
    const x = STATE.ref;
    const y = STATE.raw;
    const { a, b } = linearRegression(x, y);

    // Si déjà une calib sauvegardée, on la recharge, sinon on met la recommandée
    let usedA = a, usedB = b;
    try {
      const saved = localStorage.getItem(`nebuleair_calib_${STATE.metric}`);
      if (saved) {
        const obj = JSON.parse(saved);
        if (Number.isFinite(obj?.a) && Number.isFinite(obj?.b) && obj.b !== 0) {
          usedA = obj.a;
          usedB = obj.b;
        }
      }
    } catch (_) {}

    if (el.coeffA) el.coeffA.value = Number.isFinite(usedA) ? usedA.toFixed(3) : "0.000";
    if (el.coeffB) el.coeffB.value = Number.isFinite(usedB) ? usedB.toFixed(3) : "1.000";

    applyCorrectionAndUpdate();
  }

  // -----------------------------
  // 9) Export
  // -----------------------------
  function exportCSV() {
    const a = el.coeffA ? (parseFloat(el.coeffA.value) || 0) : 0;
    const b = el.coeffB ? (parseFloat(el.coeffB.value) || 1) : 1;

    if (!Number.isFinite(b) || b === 0) {
      alert("b (pente) invalide : export impossible.");
      return;
    }

    const header = [
      "timestamp_utc",
      `ref_${STATE.metric}`,
      `neb_raw_${STATE.metric}`,
      `neb_corr_${STATE.metric}`,
      "temperature_C",
      "humidite_pct",
    ].join(",");

    const lines = [header];

    for (let i = 0; i < STATE.times.length; i++) {
      const t = STATE.times[i];
      const raw = STATE.raw[i];
      const ref = STATE.ref[i];
      const temp = STATE.aligned[i]?.temperature;
      const hum = STATE.aligned[i]?.humidite;

      const corr = Number.isFinite(raw) ? Math.max(0, (raw - a) / b) : "";

      lines.push(
        [
          t instanceof Date ? t.toISOString() : String(t),
          Number.isFinite(ref) ? ref : "",
          Number.isFinite(raw) ? raw : "",
          corr,
          Number.isFinite(temp) ? temp : "",
          Number.isFinite(hum) ? hum : "",
        ].join(",")
      );
    }

    const fname = `nebuleair_vs_atmosud_${STATE.metric}_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV(fname, lines.join("\n"));
  }

  // -----------------------------
  // 10) Init
  // -----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    if (el.btnApply) el.btnApply.addEventListener("click", (e) => { e.preventDefault(); applyCorrectionAndUpdate(); });
    if (el.btnExport) el.btnExport.addEventListener("click", (e) => { e.preventDefault(); exportCSV(); });

    loadAndProcess().catch((err) => {
      console.error(err);
      alert(
        "Impossible de charger/traiter les données.\n" +
        "Vérifie les chemins CSV et que les fichiers sont accessibles depuis le navigateur."
      );
    });
  });
})();
