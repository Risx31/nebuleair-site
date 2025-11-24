// ======================================================
// API.JS — Module central pour InfluxDB via proxy Render
// ======================================================

// URL du proxy Render (INFLUXDB CLOUD)
const API_INFLUX = "https://nebuleairproxy.onrender.com/query";
const API_BUCKET = "Nodule Air";

// ===============================
// Fonction générique : envoyer un script Flux
// ===============================

async function queryFlux(fluxQuery) {
    try {
        const response = await fetch(API_INFLUX, {
            method: "POST",
            body: fluxQuery
        });

        const raw = await response.text();
        return raw;
    } catch (e) {
        console.error("Erreur Flux:", e);
        return "";
    }
}

// ===============================
// Récupérer série temporelle
// field = "pm25"
// period = "-6h" par exemple
// ===============================

async function getFieldSeries(field, period) {

    const flux = `
        from(bucket: "${API_BUCKET}")
            |> range(start: ${period})
            |> filter(fn: (r) => r._measurement == "nebuleair")
            |> filter(fn: (r) => r._field == "${field}")
            |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
            |> yield()
    `;

    const raw = await queryFlux(flux);

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

// ===============================
// Récupérer dernière valeur d’un champ
// ===============================

async function getFieldLatest(field) {
    const flux = `
        from(bucket: "${API_BUCKET}")
            |> range(start: -2d)
            |> filter(fn: (r) => r._measurement == "nebuleair")
            |> filter(fn: (r) => r._field == "${field}")
            |> last()
    `;

    const raw = await queryFlux(flux);

    const rows = raw.split("\n").filter(r => r.includes(",_field"));

    if (rows.length === 0) {
        return { value: null, time: null };
    }

    const cols = rows[0].split(",");

    return {
        time: cols[5],
        value: parseFloat(cols[6])
    };
}

// ===============================
// Export CSV universel
// ===============================

function exportCSVFromChart(chart) {
    let csv = "time";

    chart.data.datasets.forEach(ds => csv += "," + ds.label);
    csv += "\n";

    chart.data.labels.forEach((t, i) => {
        let line = new Date(t).toISOString();
        chart.data.datasets.forEach(ds => line += "," + (ds.data[i] ?? ""));
        csv += line + "\n";
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "nebuleair_export.csv";
    a.click();

    URL.revokeObjectURL(url);
}
