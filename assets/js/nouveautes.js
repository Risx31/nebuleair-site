/******************************************************
 * Nouveautés – NebuleAir
 * Page de test des nouvelles fonctionnalités
 ******************************************************/

console.log("[NebuleAir] Nouveautés chargées");

const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
const BUCKET = "Nodule Air";

// ========================= //
//  Générique : requête Flux //
// ========================= //
async function influxQuery(flux) {
    const url = `${INFLUX_URL}?bucket=${encodeURIComponent(BUCKET)}`;

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: flux })
    });

    const data = await res.json();
    return data.results || [];
}


// ============================================ //
//             FONCTIONNALITÉ : COMPARAISON
// ============================================ //

let compareChart = null;

document.getElementById("btn-compare").addEventListener("click", async () => {
    const field = document.getElementById("compare-field").value;

    const Astart = document.getElementById("startA").value;
    const Aend = document.getElementById("endA").value;

    const Bstart = document.getElementById("startB").value;
    const Bend = document.getElementById("endB").value;

    if (!Astart || !Aend || !Bstart || !Bend) {
        alert("Toutes les dates doivent être renseignées !");
        return;
    }

    const fluxA = `
        from(bucket: "${BUCKET}")
        |> range(start: ${JSON.stringify(Astart)}, stop: ${JSON.stringify(Aend)})
        |> filter(fn: (r) => r._field == "${field}")
    `;

    const fluxB = `
        from(bucket: "${BUCKET}")
        |> range(start: ${JSON.stringify(Bstart)}, stop: ${JSON.stringify(Bend)})
        |> filter(fn: (r) => r._field == "${field}")
    `;

    const dataA = await influxQuery(fluxA);
    const dataB = await influxQuery(fluxB);

    const pointsA = dataA.map(r => ({
        x: r._time,
        y: r._value
    }));

    const pointsB = dataB.map(r => ({
        x: r._time,
        y: r._value
    }));

    if (compareChart) compareChart.destroy();

    compareChart = new Chart(
        document.getElementById("compareChart").getContext("2d"),
        {
            type: "line",
            data: {
                datasets: [
                    {
                        label: `Période A (${field})`,
                        borderColor: "#007bff",
                        data: pointsA
                    },
                    {
                        label: `Période B (${field})`,
                        borderColor: "#ff2e63",
                        data: pointsB
                    }
                ]
            },
            options: {
                scales: {
                    x: { type: "time", time: { unit: "minute" } }
                }
            }
        }
    );
});


// ============================================ //
//               FONCTIONNALITÉ : UPTIME
// ============================================ //

async function loadUptime() {
    const flux = `
        from(bucket: "${BUCKET}")
        |> range(start: -24h)
        |> filter(fn: (r) => r._field == "pm25")
    `;

    const raw = await influxQuery(flux);

    const timestamps = raw.map(r => new Date(r._time).getTime());
    timestamps.sort((a, b) => a - b);

    const diffs = [];
    for (let i = 1; i < timestamps.length; i++) {
        diffs.push((timestamps[i] - timestamps[i - 1]) / 60000);
    }

    const uptimePercent = 100 - (diffs.filter(d => d > 2).length / diffs.length) * 100;

    document.getElementById("uptime-value").textContent =
        uptimePercent.toFixed(1) + " %";

    // petit graphique de stabilité
    const ctx = document.getElementById("uptimeChart").getContext("2d");
    new Chart(ctx, {
        type: "bar",
        data: {
            labels: diffs.map((_, i) => i),
            datasets: [{
                label: "Intervalle entre mesures (min)",
                data: diffs
            }]
        }
    });
}

loadUptime();


// ============================================ //
//        FONCTIONNALITÉ : ANOMALIES
// ============================================ //

document.getElementById("btn-scan-anomaly").addEventListener("click", async () => {
    const flux = `
        from(bucket: "${BUCKET}")
        |> range(start: -6h)
        |> filter(fn: (r) => r._measurement == "nebuleair")
        |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
    `;

    const arr = await influxQuery(flux);

    const anomalies = [];
    for (let row of arr) {
        if (row.pm25 > 200 || row.temperature < -5 || row.temperature > 60) {
            anomalies.push(row);
        }
    }

    const ul = document.getElementById("anomaly-list");
    ul.innerHTML = "";
    anomalies.forEach(a => {
        const li = document.createElement("li");
        li.textContent = `${a._time} → anomalie détectée`;
        ul.appendChild(li);
    });
});


// ============================================ //
//          FONCTIONNALITÉ : TENDANCES
// ============================================ //

async function loadTrends() {
    const fields = ["pm1", "pm25", "pm10", "temperature", "humidite"];
    const flux = `
        from(bucket: "${BUCKET}")
        |> range(start: -1h)
        |> filter(fn: (r) => r._measurement == "nebuleair")
        |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
    `;

    const arr = await influxQuery(flux);

    const last = arr[arr.length - 1];
    const first = arr[0];

    const ul = document.getElementById("trend-list");
    ul.innerHTML = "";

    fields.forEach(f => {
        const trend = last[f] - first[f];

        const li = document.createElement("li");
        li.innerHTML = `${f} : ${
            trend > 0
                ? `⬆️ +${trend.toFixed(2)}`
                : trend < 0
                ? `⬇️ ${trend.toFixed(2)}`
                : "➡️ stable"
        }`;

        ul.appendChild(li);
    });
}

loadTrends();
