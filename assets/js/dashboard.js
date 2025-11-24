//-----------------------------------------------------------
// Dashboard.js (version stable sans zoom)
// Compatible avec :
// - https://nebuleairproxy.onrender.com/
// - Chart.js 4.x
// - CSV InfluxDB Cloud
//-----------------------------------------------------------

// Proxy API
const API_URL = "https://nebuleairproxy.onrender.com/query";

// Chart instance
let chart = null;

// ===========================================================
// 1) Charger les données depuis Influx via le proxy Render
// ===========================================================
async function loadInflux(period = "-1h", start = null, end = null) {
    let flux = `
from(bucket: "Nodule Air")
  |> range(start: ${start ? `"${start}"` : period}, stop: ${end ? `"${end}"` : "now()"})
  |> filter(fn: (r) => r._measurement == "nebuleair")
  |> filter(fn: (r) => 
        r._field == "pm1" or 
        r._field == "pm25" or 
        r._field == "pm10" or 
        r._field == "temperature" or 
        r._field == "humidite")
  |> keep(columns: ["_time","_value","_field"])
  |> aggregateWindow(every: 1m, fn: mean)
  |> yield(name:"mean")
`;

    const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: flux
    });

    const text = await res.text();
    return parseInfluxCSV(text);
}

// ===========================================================
// 2) Parser le CSV Influx → Objet JS exploitable
// ===========================================================
function parseInfluxCSV(csv) {
    const lignes = csv.trim().split("\n");

    // Dictionnaire vide
    const data = {
        pm1: [],
        pm25: [],
        pm10: [],
        temperature: [],
        humidite: []
    };

    // On commence à la ligne 1 pour sauter l'entête
    for (let i = 1; i < lignes.length; i++) {
        const line = lignes[i].trim();
        if (!line) continue;

        const cols = line.split(",");

        if (cols.length < 7) continue;

        const time = new Date(cols[4]);
        const value = parseFloat(cols[5]);
        const field = cols[6];

        if (!data[field]) continue;

        data[field].push({
            time: time,
            value: value
        });
    }

    return data;
}

// ===========================================================
// 3) Mettre à jour les encadrés LIVE
// ===========================================================
function updateLiveValues(data) {
    const mapping = {
        livePM1: "pm1",
        livePM25: "pm25",
        livePM10: "pm10",
        liveTemp: "temperature",
        liveHum: "humidite"
    };

    for (const id in mapping) {
        const field = mapping[id];
        const el = document.getElementById(id);

        if (!el) continue;

        const arr = data[field];
        if (arr && arr.length > 0) {
            let val = arr[arr.length - 1].value;

            if (field === "temperature") val = val.toFixed(1) + "°C";
            else if (field === "humidite") val = val.toFixed(1) + "%";
            else val = val.toFixed(1);

            el.textContent = val;
        } else {
            el.textContent = "--";
        }
    }
}

// ===========================================================
// 4) Graphique Chart.js (sans zoom)
// ===========================================================
function updateChart(data) {
    const ctx = document.getElementById("chart").getContext("2d");

    const colors = {
        pm1: "#2962ff",
        pm25: "#ff9800",
        pm10: "#e53935",
        temperature: "#00acc1",
        humidite: "#26a69a"
    };

    const datasets = [];

    document.querySelectorAll(".curve").forEach(chk => {
        if (chk.checked) {
            const f = chk.value;

            datasets.push({
                label: f.toUpperCase(),
                data: data[f].map(pt => ({ x: pt.time, y: pt.value })),
                borderColor: colors[f],
                borderWidth: 2,
                pointRadius: 0,
                fill: false,
                tension: 0.25
            });
        }
    });

    if (chart) chart.destroy();

    chart = new Chart(ctx, {
        type: "line",
        data: { datasets },
        options: {
            responsive: true,
            scales: {
                x: { type: "time", time: { tooltipFormat: "HH:mm" } },
                y: { beginAtZero: false }
            }
        }
    });
}

// ===========================================================
// 5) Sélection période (boutons)
// ===========================================================
document.querySelectorAll(".period-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        loadAndRender(btn.dataset.period);
    });
});

// ===========================================================
// 6) Période personnalisée
// ===========================================================
document.getElementById("applyCustom").addEventListener("click", () => {
    const s = document.getElementById("customStart").value;
    const e = document.getElementById("customEnd").value;
    if (!s || !e) return;

    loadAndRender(null, s, e);
});

// ===========================================================
// 7) Fonction centrale
// ===========================================================
async function loadAndRender(period = "-1h", start = null, end = null) {
    const data = await loadInflux(period, start, end);
    if (!data) return;

    updateLiveValues(data);
    updateChart(data);
}

// ===========================================================
// 8) Initialisation (1h par défaut)
// ===========================================================
loadAndRender("-1h");

// ===========================================================
// 9) Export CSV
// ===========================================================
document.getElementById("exportCSV").addEventListener("click", () => {
    if (!chart) return;

    let csv = "time,field,value\n";

    chart.data.datasets.forEach(ds => {
        ds.data.forEach(p => {
            csv += `${p.x.toISOString()},${ds.label},${p.y}\n`;
        });
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "nebuleair_export.csv";
    a.click();

    URL.revokeObjectURL(url);
});
