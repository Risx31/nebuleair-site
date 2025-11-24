// ============================================================
// Configuration
// ============================================================

const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
const BUCKET = "Nodule Air";
let currentPeriod = "-1h";

let chart;

// ============================================================
// Fonction : parseur CSV robuste pour InfluxDB Cloud
// ============================================================

function parseInfluxCSV(text) {
    const lines = text
        .split("\n")
        .map(l => l.trim())
        .filter(l => l && !l.startsWith(",result,table"));

    const result = [];

    for (let line of lines) {
        const cols = line.split(",");

        if (cols.length < 7) continue;

        const time = cols[5];      // _time
        const value = parseFloat(cols[6]);  // _value
        if (isNaN(value)) continue;

        result.push({
            t: new Date(time),
            v: value
        });
    }

    return result;
}

// ============================================================
// Envoi de requête FLUX au proxy Render
// ============================================================

async function loadField(field) {
    const flux = `
from(bucket: "${BUCKET}")
  |> range(start: ${currentPeriod})
  |> filter(fn: (r) => r._measurement == "nebuleair")
  |> filter(fn: (r) => r._field == "${field}")
  |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
  |> keep(columns: ["_time","_value"])
`;

    const response = await fetch(INFLUX_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: flux
    });

    const csv = await response.text();
    return parseInfluxCSV(csv);
}

// ============================================================
// Initialisation du graphique Chart.js
// ============================================================

function initChart() {
    const ctx = document.getElementById("chart").getContext("2d");

    chart = new Chart(ctx, {
        type: "line",
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: "time",
                    time: { unit: "minute" }
                }
            },
            plugins: {
                zoom: {
                    zoom: {
                        wheel: { enabled: true },
                        pinch: { enabled: true },
                        mode: "x"
                    },
                    pan: {
                        enabled: true,
                        mode: "x"
                    }
                }
            }
        }
    });
}

// ============================================================
// Met à jour les valeurs LIVE au-dessus du graphique
// ============================================================

function updateLiveValues(series) {
    if (series.pm1.length)
        livePM1.textContent = series.pm1.at(-1).v.toFixed(2);

    if (series.pm25.length)
        livePM25.textContent = series.pm25.at(-1).v.toFixed(2);

    if (series.pm10.length)
        livePM10.textContent = series.pm10.at(-1).v.toFixed(2);

    if (series.temperature.length)
        liveTemp.textContent = series.temperature.at(-1).v.toFixed(1) + "°C";

    if (series.humidite.length)
        liveHum.textContent = series.humidite.at(-1).v.toFixed(1) + "%";
}

// ============================================================
// Met à jour le graphique Chart.js
// ============================================================

function updateChart(series) {
    chart.data.labels = series.pm25.map(p => p.t); // timeline commune

    chart.data.datasets = [];

    const colors = {
        pm1: "#2962ff",
        pm25: "#ff9800",
        pm10: "#ef5350",
        temperature: "#26c6da",
        humidite: "#26a69a"
    };

    for (let field of Object.keys(series)) {
        const checkbox = document.querySelector(`input[value="${field}"]`);
        if (!checkbox.checked) continue;

        chart.data.datasets.push({
            label: field.toUpperCase(),
            data: series[field].map(p => p.v),
            borderColor: colors[field],
            tension: 0.25,
            borderWidth: 2,
            pointRadius: 0
        });
    }

    chart.update();
}

// ============================================================
// Fonction principale : recharge tout
// ============================================================

async function refreshDashboard() {
    const fields = ["pm1", "pm25", "pm10", "temperature", "humidite"];

    const series = {};

    for (let f of fields)
        series[f] = await loadField(f);

    updateLiveValues(series);
    updateChart(series);
}

// ============================================================
// Listeners : périodes
// ============================================================

document.querySelectorAll(".period-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".period-btn")
            .forEach(b => b.classList.remove("active"));

        btn.classList.add("active");
        currentPeriod = btn.dataset.period;
        refreshDashboard();
    });
});

// ============================================================
// Listeners : checkbox des courbes
// ============================================================

document.querySelectorAll(".curve").forEach(cb => {
    cb.addEventListener("change", refreshDashboard);
});

// ============================================================
// Zoom reset
// ============================================================

document.getElementById("resetZoom").addEventListener("click", () => {
    chart.resetZoom();
});

// ============================================================
// Export CSV
// ============================================================

document.getElementById("exportCSV").addEventListener("click", () => {
    let csv = "time,pm1,pm25,pm10,temperature,humidite\n";

    const labels = chart.data.labels;

    labels.forEach((t, i) => {
        const row = [
            new Date(t).toISOString(),
            chart.data.datasets[0]?.data[i] ?? "",
            chart.data.datasets[1]?.data[i] ?? "",
            chart.data.datasets[2]?.data[i] ?? "",
            chart.data.datasets[3]?.data[i] ?? "",
            chart.data.datasets[4]?.data[i] ?? ""
        ];
        csv += row.join(",") + "\n";
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "nebuleair_export.csv";
    a.click();

    URL.revokeObjectURL(url);
});

// ============================================================
// INITIALISATION
// ============================================================

initChart();
refreshDashboard();
setInterval(refreshDashboard, 15000);
