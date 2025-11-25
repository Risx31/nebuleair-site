// =============================
//  CONFIG
// =============================

const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
const BUCKET = "Nodule Air";

let compareChart = null;

// =============================
//  Helpers Influx
// =============================

// Récupère une série entre deux dates ISO (string)
async function getSeriesRange(field, startISO, endISO) {
    const fluxQuery = `
    from(bucket: "${BUCKET}")
      |> range(start: time(v: "${startISO}"), stop: time(v: "${endISO}"))
      |> filter(fn: (r) => r._measurement == "nebuleair")
      |> filter(fn: (r) => r._field == "${field}")
      |> keep(columns: ["_time", "_value"])
      |> sort(columns: ["_time"])
  `;

    const response = await fetch(INFLUX_URL, {
        method: "POST",
        body: fluxQuery
    });

    if (!response.ok) {
        console.error("Erreur Influx:", response.status, response.statusText);
        throw new Error("Erreur de requête Influx");
    }

    const raw = await response.text();
    console.log("RAW SERIES", field, startISO, endISO, raw);

    const lines = raw.trim().split("\n").filter(l => l.startsWith(",_result"));

    return lines
        .map(line => {
            const cols = line.split(",");
            return {
                time: cols[5],
                value: parseFloat(cols[6])
            };
        })
        .filter(p => !isNaN(p.value));
}

// Convertit la série en points {x: Date, y: value} pour Chart.js time scale
function toChartPoints(series) {
    return series.map(p => ({
        x: new Date(p.time),
        y: p.value
    }));
}

// =============================
//  Helpers UI
// =============================

function getInputValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : "";
}

function showToast(msg) {
    // Version simple : alert. Tu peux faire plus joli plus tard.
    alert(msg);
}

// =============================
//  Création / mise à jour du graphe
// =============================

function updateCompareChart(field, series1, series2, label1, label2) {
    const ctx = document.getElementById("compareChart");
    if (!ctx) return;

    const data1 = toChartPoints(series1);
    const data2 = toChartPoints(series2);

    if (!data1.length && !data2.length) {
        showToast("Aucune donnée à afficher pour ces plages.");
        return;
    }

    const datasets = [];

    if (data1.length) {
        datasets.push({
            label: `${label1}`,
            data: data1,
            borderColor: "rgba(37, 99, 235, 1)",        // bleu
            backgroundColor: "rgba(37, 99, 235, 0.15)",
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 2
        });
    }

    if (data2.length) {
        datasets.push({
            label: `${label2}`,
            data: data2,
            borderColor: "rgba(239, 68, 68, 1)",        // rouge
            backgroundColor: "rgba(239, 68, 68, 0.15)",
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 2
        });
    }

    const yLabelMap = {
        pm1: "Concentration (µg/m³)",
        pm25: "Concentration (µg/m³)",
        pm10: "Concentration (µg/m³)",
        temperature: "Température (°C)",
        humidite: "Humidité (%)"
    };

    const yTitle = yLabelMap[field] || "Valeur";

    if (compareChart) {
        compareChart.destroy();
    }

    compareChart = new Chart(ctx, {
        type: "line",
        data: {
            datasets
        },
        options: {
            parsing: false, // on donne {x,y}
            responsive: true,
            interaction: {
                mode: "nearest",
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: "top"
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const v = ctx.parsed.y;
                            return `${ctx.dataset.label} : ${v.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: "time",
                    time: {
                        unit: "hour"
                    },
                    title: {
                        display: true,
                        text: "Date / heure"
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: yTitle
                    }
                }
            }
        }
    });
}

// =============================
//  Logique du bouton "Comparer"
// =============================

async function handleCompareClick() {
    const field = getInputValue("cmpField");

    const r1Start = getInputValue("cmpRange1Start");
    const r1End   = getInputValue("cmpRange1End");
    const r2Start = getInputValue("cmpRange2Start");
    const r2End   = getInputValue("cmpRange2End");

    if (!field || !r1Start || !r1End || !r2Start || !r2End) {
        showToast("Merci de remplir les deux plages de temps et de choisir une grandeur.");
        return;
    }

    const start1ISO = new Date(r1Start).toISOString();
    const end1ISO   = new Date(r1End).toISOString();
    const start2ISO = new Date(r2Start).toISOString();
    const end2ISO   = new Date(r2End).toISOString();

    if (start1ISO >= end1ISO || start2ISO >= end2ISO) {
        showToast("Chaque plage doit avoir une date de début strictement avant la date de fin.");
        return;
    }

    try {
        // Série 1 & 2 en parallèle
        const [series1, series2] = await Promise.all([
            getSeriesRange(field, start1ISO, end1ISO),
            getSeriesRange(field, start2ISO, end2ISO)
        ]);

        updateCompareChart(
            field,
            series1,
            series2,
            "Plage 1",
            "Plage 2"
        );
    } catch (e) {
        console.error(e);
        showToast("Erreur lors du chargement des données.");
    }
}

// =============================
//  Init
// =============================

document.addEventListener("DOMContentLoaded", () => {

    const btn = document.getElementById("cmpBtn");
    if (btn) {
        btn.addEventListener("click", handleCompareClick);
    }

    // Option : préremplir automatiquement les plages (ex : aujourd’hui vs hier)
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const yesterdayStart = new Date(oneHourAgo.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    function setDt(id, d) {
        const el = document.getElementById(id);
        if (!el) return;
        // format YYYY-MM-DDTHH:MM pour datetime-local
        const pad = (n) => String(n).padStart(2, "0");
        const yyyy = d.getFullYear();
        const mm = pad(d.getMonth() + 1);
        const dd = pad(d.getDate());
        const hh = pad(d.getHours());
        const mi = pad(d.getMinutes());
        el.value = `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    }

    // Par défaut : plage 1 = dernière heure, plage 2 = même heure la veille
    setDt("cmpRange1Start", oneHourAgo);
    setDt("cmpRange1End", now);
    setDt("cmpRange2Start", yesterdayStart);
    setDt("cmpRange2End", yesterdayEnd);
});
