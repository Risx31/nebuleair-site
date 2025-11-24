// =====================================
// CONFIG
// =====================================
const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
const BUCKET = "Nodule Air";

// Material pastel colors
let COLORS = {
    pm1: "#2962ff",          // bleu
    pm25: "#ff9800",         // orange
    pm10: "#ef5350",         // rouge pastel
    temperature: "#26c6da",  // cyan
    humidite: "#26a69a"      // teal
};

// current period
let currentPeriod = "-6h";

// chart instance
let chart;

// =====================================
// FETCH DATA FOR ONE FIELD
// =====================================
async function getFieldData(field, period) {

    const fluxQuery = `
        from(bucket: "${BUCKET}")
        |> range(start: ${period})
        |> filter(fn: (r) => r._measurement == "nebuleair")
        |> filter(fn: (r) => r._field == "${field}")
        |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
        |> yield()
    `;

    const response = await fetch(INFLUX_URL, {
        method: "POST",
        body: fluxQuery
    });

    const raw = await response.text();
    console.log("FIELD", field, "RAW:", raw);

    const rows = raw.split("\n").filter(r => r.includes(",_field"));

    let times = [];
    let values = [];

    rows.forEach(row => {
        const cols = row.split(",");
        const t = cols[5];
        const v = parseFloat(cols[6]);

        times.push(t);
        values.push(v);
    });

    return { times, values };
}

// =====================================
// INITIALIZE CHART
// =====================================
function initChart() {
    const ctx = document.getElementById("chart").getContext("2d");

    chart = new Chart(ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: []
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: { display: true },
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
            },

            scales: {
                x: {
                    type: "time",
                    time: { unit: "minute" }
                },
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// =====================================
// UPDATE ALL SELECTED CURVES
// =====================================
async function updateDashboard() {

    const selected = [...document.querySelectorAll(".curve:checked")].map(x => x.value);

    // Reset datasets
    chart.data.labels = [];
    chart.data.datasets = [];

    let firstLabelSet = false;

    for (let field of selected) {
        const { times, values } = await getFieldData(field, currentPeriod);

        if (!firstLabelSet && times.length > 0) {
            chart.data.labels = times.map(t => new Date(t));
            firstLabelSet = true;
        }

        chart.data.datasets.push({
            label: field.toUpperCase(),
            data: values,
            borderColor: COLORS[field],
            borderWidth: 2,
            tension: 0.22,
            pointRadius: 0,
            fill: false
        });

        // Update live values
        if (values.length > 0) {
            const last = values[values.length - 1];
            if (field === "pm1") document.getElementById("livePM1").innerText = last.toFixed(2);
            if (field === "pm25") document.getElementById("livePM25").innerText = last.toFixed(2);
            if (field === "pm10") document.getElementById("livePM10").innerText = last.toFixed(2);
            if (field === "temperature") document.getElementById("liveTemp").innerText = last.toFixed(2) + "°C";
            if (field === "humidite") document.getElementById("liveHum").innerText = last.toFixed(2) + "%";
        }
    }

    chart.update();
}

// =====================================
// PERIOD BUTTONS
// =====================================
document.querySelectorAll(".period-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        currentPeriod = btn.dataset.period;
        updateDashboard();
    });
});

// =====================================
// CUSTOM DATE RANGE
// =====================================
document.getElementById("applyCustom").addEventListener("click", () => {
    const start = document.getElementById("customStart").value;
    const end = document.getElementById("customEnd").value;

    if (!start || !end) return;

    currentPeriod = `time(v: ${start}T00:00:00Z) |> range(stop: ${end}T23:59:59Z)`;
    updateDashboard();
});

// =====================================
// CURVE CHECKBOXES
// =====================================
document.querySelectorAll(".curve").forEach(cb => {
    cb.addEventListener("change", updateDashboard);
});

// =====================================
// RESET ZOOM
// =====================================
document.getElementById("resetZoom").addEventListener("click", () => {
    chart.resetZoom();
});

// =====================================
// EXPORT CSV
// =====================================
document.getElementById("exportCSV").addEventListener("click", () => {

    let csv = "time";

    chart.data.datasets.forEach(ds => {
        csv += "," + ds.label;
    });

    csv += "\n";

    chart.data.labels.forEach((t, i) => {
        let line = new Date(t).toISOString();

        chart.data.datasets.forEach(ds => {
            line += "," + (ds.data[i] ?? "");
        });

        csv += line + "\n";
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "nebuleair_data.csv";
    a.click();

    URL.revokeObjectURL(url);
});

// =====================================
// AUTO REFRESH
// =====================================
setInterval(updateDashboard, 15000);

// =====================================
// START
// =====================================
initChart();
updateDashboard();

