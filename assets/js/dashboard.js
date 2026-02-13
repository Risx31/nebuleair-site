// assets/js/dashboard.js

document.addEventListener("DOMContentLoaded", function () {
    console.log("[NebuleAir] Dashboard JS chargé");

    const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
    const BUCKET = "Nodule Air";

    let currentRange = "1h";
    let customRange = null;

    // Timestamps bruts (Date)
    let labelsRaw = [];

    // Séries de valeurs
    let series = {
        pm1: [],
        pm25: [],
        pm10: [],
        temperature: [],
        humidite: [],
        rssi: []
    };

const PM25_CAL_KEY = "nebuleair.pm25.calibration.v1";

let correctionEnabled = false;
let calibration = null;

function loadPM25Calibration() {
    try {
        const stored = localStorage.getItem(PM25_CAL_KEY);
        if (!stored) return null;

        const parsed = JSON.parse(stored);

        if (!isFinite(parsed.a) || !isFinite(parsed.b)) return null;

        return parsed;
    } catch (e) {
        console.warn("Erreur chargement calibration:", e);
        return null;
    }
}

calibration = loadPM25Calibration();

const toggle = document.getElementById("toggleCorrection");

if (calibration && toggle) {
    toggle.disabled = false;
} else if (toggle) {
    toggle.disabled = true;
}

toggle?.addEventListener("change", () => {
    correctionEnabled = toggle.checked;
    updateCharts(); // Recalcul immédiat
});


    // ==========================================
    //  1. GESTION DU THÈME (MODE NUIT / BANANE)
    // ==========================================
    const body = document.body;
    const themeToggle = document.getElementById("themeToggle");
    const banana = document.getElementById("userProfileBanana");

    function toggleTheme() {
        if (body.classList.contains("light")) {
            body.classList.replace("light", "dark");
            localStorage.setItem("theme", "dark");
        } else {
            body.classList.replace("dark", "light");
            localStorage.setItem("theme", "light");
        }
    }

    if (themeToggle) themeToggle.addEventListener("click", toggleTheme);
    if (banana) banana.addEventListener("click", toggleTheme);

    const savedTheme = localStorage.getItem("theme") || "light";
    body.className = savedTheme;

    // ============================
    //  2. INIT CHART.JS
    // ============================
    const canvas = document.getElementById("mainChart");
    if (!canvas) {
        console.error("[NebuleAir] Canvas #mainChart introuvable");
        return;
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
                    yAxisID: 'y'
                },
                {
                    label: "PM2.5",
                    data: [],
                    borderColor: "#ff9800",
                    backgroundColor: "rgba(255, 152, 0, 0.15)",
                    borderWidth: 2,
                    tension: 0.25,
                    fill: true,
                    yAxisID: 'y'
                },
                {
                    label: "PM10",
                    data: [],
                    borderColor: "#e91e63",
                    backgroundColor: "rgba(233, 30, 99, 0.15)",
                    borderWidth: 2,
                    tension: 0.25,
                    fill: true,
                    yAxisID: 'y'
                },
                {
                    label: "Température",
                    data: [],
                    borderColor: "#00c853",
                    backgroundColor: "rgba(0, 200, 83, 0.15)",
                    borderWidth: 2,
                    tension: 0.25,
                    fill: true,
                    yAxisID: 'y1'
                },
                {
                    label: "Humidité",
                    data: [],
                    borderColor: "#26c6da",
                    backgroundColor: "rgba(38, 198, 218, 0.15)",
                    borderWidth: 2,
                    tension: 0.25,
                    fill: true,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { position: "top", labels: { usePointStyle: true } }
            },
            scales: {
                x: {
                    type: "time",
                    time: {
                        tooltipFormat: "dd MMM yyyy HH:mm",
                        displayFormats: { minute: "HH:mm", hour: "dd HH'h'", day: "dd MMM" }
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    beginAtZero: true,
                    title: { display: true, text: "µg/m³" }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: "°C / %" }
                }
            }
        }
    });

    // ============================
    //  3. HELPERS INFLUX & FETCH
    // ============================
    function parseInfluxCsv(raw) {
        const lines = raw.split("\n").map(l => l.trim()).filter(l => l !== "" && !l.startsWith("#"));
        if (lines.length < 2) return { labels: [], values: [] };
        const header = lines[0].split(",");
        const tIdx = header.indexOf("_time"), vIdx = header.indexOf("_value");
        const labels = [], values = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(",");
            const v = parseFloat(cols[vIdx]);
            if (!isNaN(v)) { labels.push(cols[tIdx]); values.push(v); }
        }
        return { labels, values };
    }

    function buildRangeClause() {
        if (customRange) return `|> range(start: ${customRange.start}, stop: ${customRange.stop})`;
        const map = { "1h": "-1h", "24h": "-24h", "7j": "-7d", "30j": "-30d" };
        return `|> range(start: ${map[currentRange] || "-1h"})`;
    }

    function getWindowEvery() {
        if (customRange) return "5m";
        const map = { "1h": "1m", "24h": "5m", "7j": "30m", "30j": "1h" };
        return map[currentRange] || "1m";
    }

    async function fetchField(field) {
        const fluxQuery = `from(bucket: "${BUCKET}") ${buildRangeClause()} |> filter(fn: (r) => r._measurement == "nebuleair" and r._field == "${field}") |> aggregateWindow(every: ${getWindowEvery()}, fn: mean, createEmpty: false) |> yield()`;
        const response = await fetch(INFLUX_URL, { method: "POST", body: fluxQuery });
        return parseInfluxCsv(await response.text());
    }

    // ============================
    //  4. MISE À JOUR UI
    // ============================
    function updateUI() {
        // MAJ des Cartes de valeurs
        const mappings = {
            "pm1-value": series.pm1,
            "pm25-value": series.pm25,
            "pm10-value": series.pm10,
            "temp-value": series.temperature,
            "hum-value": series.humidite,
            "wifi-value": series.rssi
        };

        for (let id in mappings) {
            const el = document.getElementById(id);
            if (el) {
                const arr = mappings[id];
                const lastVal = (arr && arr.length > 0) ? arr[arr.length - 1] : null;
                el.textContent = (lastVal !== null && !isNaN(lastVal)) ? lastVal.toFixed(1) : "--";
            }
        }

        // MAJ du Graphique
        if (mainChart) {
            const keys = ["pm1", "pm25", "pm10", "temperature", "humidite"];
            keys.forEach((key, i) => {
                mainChart.data.datasets[i].data = labelsRaw.map((t, idx) => ({ x: t, y: series[key][idx] }));
            });
            mainChart.update();
        }
    }

    async function loadAllData() {
        try {
            const fields = ["pm1", "pm25", "pm10", "temperature", "humidite", "rssi"];
            const results = await Promise.all(fields.map(f => fetchField(f)));
            
            labelsRaw = results[0].labels.map(t => new Date(t));
            series.pm1 = results[0].values;
            series.pm25 = results[1].values;
            series.pm10 = results[2].values;
            series.temperature = results[3].values;
            series.humidite = results[4].values;
            series.rssi = results[5].values;

            updateUI();
        } catch (err) {
            console.error("[NebuleAir] Erreur chargement :", err);
        }
    }

    // ============================
    //  5. EVENTS
    // ============================
    const rangeButtons = document.querySelectorAll(".btn-range");
    rangeButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            rangeButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentRange = btn.dataset.range;
            customRange = null;
            loadAllData();
        });
    });

    document.getElementById("apply-range")?.addEventListener("click", () => {
        const start = document.getElementById("start-date").value;
        const end = document.getElementById("end-date")?.value || new Date().toISOString().split('T')[0];
        if (!start) return alert("Date de début requise");
        customRange = { start: new Date(start).toISOString(), stop: new Date(end).toISOString() };
        rangeButtons.forEach(b => b.classList.remove("active"));
        loadAllData();
    });

    // Visibilité des courbes
    ["pm1", "pm25", "pm10", "temp", "hum"].forEach((id, idx) => {
        document.getElementById(`${id}-toggle`)?.addEventListener("change", (e) => {
            mainChart.setDatasetVisibility(idx, e.target.checked);
            mainChart.update();
        });
    });

// --- Section Export CSV Corrigée ---
document.getElementById("export-csv")?.addEventListener("click", () => {
    if (!labelsRaw.length) return alert("Pas de données à exporter.");

    const freqMinutes = parseInt(document.getElementById("export-freq").value) || 1;
    let csv = "time,pm1,pm25,pm10,temperature,humidite\n";
    
    let lastExportedTime = null;

    for (let i = 0; i < labelsRaw.length; i++) {
        const currentTime = labelsRaw[i].getTime();

        // On exporte si c'est le premier point OU si l'écart est suffisant
        if (!lastExportedTime || (currentTime - lastExportedTime) >= (freqMinutes * 60000)) {
            const t = labelsRaw[i].toISOString();
            const v1 = series.pm1[i] ?? "";
            const v2 = series.pm25[i] ?? "";
            const v3 = series.pm10[i] ?? "";
            const v4 = series.temperature[i] ?? "";
            const v5 = series.humidite[i] ?? "";
            
            csv += `${t},${v1},${v2},${v3},${v4},${v5}\n`;
            lastExportedTime = currentTime;
        }
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nebuleair_export_${freqMinutes}min.csv`;
    a.click();
    URL.revokeObjectURL(url);
});

    // Map Leaflet
    (function() {
        const lat = 43.30544, lon = 5.39487;
        const mapEl = document.getElementById("map");
        if (!mapEl || typeof L === 'undefined') return;
        const map = L.map("map").setView([lat, lon], 18);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
        L.marker([lat, lon]).addTo(map).bindPopup("<b>Capteur NebuleAir</b>");
    })();

    // Snake Easter Egg
    (function() {
        const secret = "snake"; let buffer = "";
        const container = document.getElementById("snake-container");
        document.addEventListener("keydown", (e) => {
            if (document.activeElement.tagName === "INPUT") return;
            buffer = (buffer + e.key.toLowerCase()).slice(-secret.length);
            if (buffer === secret) {
                container?.classList.remove("snake-hidden");
                window.NebuleAirSnake?.init("snakeCanvas");
            }
            if (e.key === "Escape") container?.classList.add("snake-hidden");
        });
        document.getElementById("snake-close")?.addEventListener("click", () => container?.classList.add("snake-hidden"));
    })();

    loadAllData();
    setInterval(loadAllData, 60000);
});
