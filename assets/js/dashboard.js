// ======================================================================
//  CONFIG INFLUXDB  (À ADAPTER !)
// ======================================================================
const INFLUX_URL = "https://eu-central-1-1.aws.cloud2.influxdata.com"; // ex: "http://172.23.3.27:8086/api/v2/query"
const INFLUX_ORG = "4ec803aa73783a39";         // ton "org" Influx
const INFLUX_BUCKET = "Nodule Air";      // ton bucket
const INFLUX_TOKEN = "KtAB26SGGkxxO5m2hNQQxb9xK3ZXVnjR3odF4nO9zmWckbH7OOoaEQiOUVQ_smd3Pa7-4IQ52oNU8D33jhAO-Q=="; // ⚠️ OK pour des tests locaux, PAS pour GitHub

// ======================================================================
//  ELEMENTS DU DOM
// ======================================================================
const pm1Card = document.getElementById("pm1-value");
const pm25Card = document.getElementById("pm25-value");
const pm10Card = document.getElementById("pm10-value");
const tempCard = document.getElementById("temp-value");
const humCard = document.getElementById("hum-value");

const rangeButtons = document.querySelectorAll(".range-btn");
const applyBtn = document.getElementById("apply-range");

const pm1Toggle = document.getElementById("pm1-toggle");
const pm25Toggle = document.getElementById("pm25-toggle");
const pm10Toggle = document.getElementById("pm10-toggle");
const tempToggle = document.getElementById("temp-toggle");
const humToggle = document.getElementById("hum-toggle");

const resetZoomBtn = document.getElementById("reset-zoom");
const exportCsvBtn = document.getElementById("export-csv");

// ======================================================================
//  CHART.JS
// ======================================================================
const ctx = document.getElementById("mainChart").getContext("2d");

const chart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [
      {
        label: "PM1",
        borderColor: "#007bff",
        backgroundColor: "rgba(0,123,255,0.1)",
        data: [],
        hidden: false,
        tension: 0.2,
        pointRadius: 0
      },
      {
        label: "PM2.5",
        borderColor: "#ff9800",
        backgroundColor: "rgba(255,152,0,0.1)",
        data: [],
        hidden: false,
        tension: 0.2,
        pointRadius: 0
      },
      {
        label: "PM10",
        borderColor: "#e91e63",
        backgroundColor: "rgba(233,30,99,0.1)",
        data: [],
        hidden: false,
        tension: 0.2,
        pointRadius: 0
      },
      {
        label: "TEMPERATURE",
        borderColor: "#00bcd4",
        backgroundColor: "rgba(0,188,212,0.1)",
        data: [],
        hidden: false,
        yAxisID: "y1",
        tension: 0.2,
        pointRadius: 0
      },
      {
        label: "HUMIDITE",
        borderColor: "#4caf50",
        backgroundColor: "rgba(76,175,80,0.1)",
        data: [],
        hidden: false,
        yAxisID: "y2",
        tension: 0.2,
        pointRadius: 0
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false
    },
    plugins: {
      legend: { display: true },
      tooltip: { enabled: true }
    },
    scales: {
      x: {
        title: { display: false }
      },
      y: {
        type: "linear",
        position: "left",
        title: {
          display: true,
          text: "PM (µg/m³)"
        }
      },
      y1: {
        type: "linear",
        position: "right",
        display: true,
        grid: { drawOnChartArea: false },
        title: { display: true, text: "Température (°C)" }
      },
      y2: {
        type: "linear",
        position: "right",
        display: false, // on partage l’axe avec y1 ou tu actives si tu veux
        grid: { drawOnChartArea: false },
        title: { display: true, text: "Humidité (%)" }
      }
    }
  }
});

// ======================================================================
//  OUTILS
// ======================================================================
function formatTimeLabel(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function parseInfluxCSV(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length === 0) return { labels: [], values: [] };

  // Trouver la ligne d'entête (celle qui contient _time,_value,...)
  let headerLine = lines.find(l => l.startsWith(",result,table,_start,_stop,_time,_value"));
  if (!headerLine) return { labels: [], values: [] };

  const headerCols = headerLine.split(",");
  const timeIndex = headerCols.indexOf("_time");
  const valueIndex = headerCols.indexOf("_value");

  const labels = [];
  const values = [];

  for (const line of lines) {
    if (!line) continue;
    if (line[0] === "#") continue;         // commentaires Influx
    if (line.startsWith(",result")) continue; // entête

    const cols = line.split(",");
    if (cols.length <= Math.max(timeIndex, valueIndex)) continue;

    const t = cols[timeIndex];
    const v = parseFloat(cols[valueIndex]);
    if (!isNaN(v)) {
      labels.push(formatTimeLabel(t));
      values.push(v);
    }
  }

  return { labels, values };
}

// ======================================================================
//  REQUÊTE DIRECTE INFLUX
// ======================================================================
async function queryField(field, rangeFlux) {
  const fluxQuery = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: ${rangeFlux})
  |> filter(fn: (r) => r["_measurement"] == "nebuleair" and r["device"] == "NebuleAir" and r["location"] == "exterieur" and r["_field"] == "${field}")
  |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
  |> yield(name: "mean")
`;

  const res = await fetch(`${INFLUX_URL}?org=${encodeURIComponent(INFLUX_ORG)}`, {
    method: "POST",
    headers: {
      "Authorization": `Token ${INFLUX_TOKEN}`,
      "Content-Type": "application/vnd.flux",
      "Accept": "application/csv"
    },
    body: fluxQuery
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Erreur Influx pour ${field}:`, res.status, err);
    return { labels: [], values: [] };
  }

  const text = await res.text();
  console.log(`FIELD ${field} RAW:\n`, text);
  return parseInfluxCSV(text);
}

// ======================================================================
//  LOGIQUE PRINCIPALE
// ======================================================================
let currentRangeKey = "1h";

const RANGE_MAP = {
  "1h": "-1h",
  "6h": "-6h",
  "24h": "-24h",
  "7j": "-7d",
  "30j": "-30d"
};

async function loadData() {
  const rangeFlux = RANGE_MAP[currentRangeKey] || "-1h";

  const [pm1, pm25, pm10, temp, hum] = await Promise.all([
    queryField("pm1", rangeFlux),
    queryField("pm25", rangeFlux),
    queryField("pm10", rangeFlux),
    queryField("temperature", rangeFlux),
    queryField("humidite", rangeFlux)
  ]);

  // Choisir une série comme référence pour l'axe X
  const candidates = [pm1, pm25, pm10, temp, hum].filter(s => s.labels.length > 0);
  const base = candidates[0] || { labels: [] };

  chart.data.labels = base.labels;
  chart.data.datasets[0].data = pm1.values;
  chart.data.datasets[1].data = pm25.values;
  chart.data.datasets[2].data = pm10.values;
  chart.data.datasets[3].data = temp.values;
  chart.data.datasets[4].data = hum.values;

  chart.update();

  // Cartes (dernier point de chaque série)
  pm1Card.textContent =
    pm1.values.length ? pm1.values[pm1.values.length - 1].toFixed(1) : "--";
  pm25Card.textContent =
    pm25.values.length ? pm25.values[pm25.values.length - 1].toFixed(1) : "--";
  pm10Card.textContent =
    pm10.values.length ? pm10.values[pm10.values.length - 1].toFixed(1) : "--";
  tempCard.textContent =
    temp.values.length ? temp.values[temp.values.length - 1].toFixed(1) : "--";
  humCard.textContent =
    hum.values.length ? hum.values[hum.values.length - 1].toFixed(1) : "--";
}

// ======================================================================
//  ÉVÉNEMENTS UI
// ======================================================================
rangeButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    rangeButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentRangeKey = btn.dataset.range;
    loadData().catch(console.error);
  });
});

applyBtn?.addEventListener("click", () => {
  // si tu ajoutes les dates manuelles, tu peux étendre ici
  loadData().catch(console.error);
});

// Toggles des courbes
pm1Toggle.addEventListener("change", () => {
  chart.data.datasets[0].hidden = !pm1Toggle.checked;
  chart.update();
});
pm25Toggle.addEventListener("change", () => {
  chart.data.datasets[1].hidden = !pm25Toggle.checked;
  chart.update();
});
pm10Toggle.addEventListener("change", () => {
  chart.data.datasets[2].hidden = !pm10Toggle.checked;
  chart.update();
});
tempToggle.addEventListener("change", () => {
  chart.data.datasets[3].hidden = !tempToggle.checked;
  chart.update();
});
humToggle.addEventListener("change", () => {
  chart.data.datasets[4].hidden = !humToggle.checked;
  chart.update();
});

// Bouton reset zoom (même si on n'a plus le plugin, on garde pour plus tard)
resetZoomBtn?.addEventListener("click", () => {
  chart.reset(); // remet les limites par défaut
});

// Export CSV simple à partir des données du graphe
exportCsvBtn?.addEventListener("click", () => {
  const labels = chart.data.labels;
  const ds = chart.data.datasets;

  let csv = "time,pm1,pm25,pm10,temperature,humidite\n";
  for (let i = 0; i < labels.length; i++) {
    const row = [
      labels[i],
      ds[0].data[i] ?? "",
      ds[1].data[i] ?? "",
      ds[2].data[i] ?? "",
      ds[3].data[i] ?? "",
      ds[4].data[i] ?? ""
    ];
    csv += row.join(",") + "\n";
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nebuleair_export.csv";
  a.click();
  URL.revokeObjectURL(url);
});

// ======================================================================
//  DÉMARRAGE
// ======================================================================
document.addEventListener("DOMContentLoaded", () => {
  loadData().catch(console.error);
});
