const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
const BUCKET = "Nodule Air";

// Moyenne simple
function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((s, x) => s + x, 0) / arr.length;
}

// =============================
//  Dernière valeur pour un champ
// =============================
async function getLatest(field) {
    const fluxQuery = `
    from(bucket: "${BUCKET}")
      |> range(start: -2d)
      |> filter(fn: (r) => r._measurement == "nebuleair")
      |> filter(fn: (r) => r._field == "${field}")
      |> last()
  `;

    const response = await fetch(INFLUX_URL, {
        method: "POST",
        body: fluxQuery
    });

    const raw = await response.text();
    const lines = raw.trim().split("\n");
    const dataLine = lines.find(l => l.startsWith(",_result"));
    if (!dataLine) return { time: null, value: null };

    const cols = dataLine.split(",");
    const time = cols[5];
    const value = parseFloat(cols[6]);

    return { time, value: isNaN(value) ? null : value };
}

// =============================
//  Série temporelle sur N heures
// =============================
async function getSeries(field, hours) {
    const fluxQuery = `
    from(bucket: "${BUCKET}")
      |> range(start: -${hours}h)
      |> filter(fn: (r) => r._measurement == "nebuleair")
      |> filter(fn: (r) => r._field == "${field}")
      |> keep(columns: ["_time", "_value"])
      |> sort(columns: ["_time"])
  `;

    const response = await fetch(INFLUX_URL, {
        method: "POST",
        body: fluxQuery
    });

    const raw = await response.text();
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

// =============================
//  Uptime (sur 24 h) depuis une série
// =============================
function computeUptimeFromSeries(series) {
    const totalMinutes = 24 * 60;
    if (!series.length) return { percent: 0, missingMinutes: totalMinutes };

    const minutesSet = new Set(
        series.map(p => Math.floor(new Date(p.time).getTime() / 60000))
    );

    const minutesCount = minutesSet.size;
    const percent = Math.min(
        100,
        +((minutesCount / totalMinutes) * 100).toFixed(1)
    );

    return {
        percent,
        missingMinutes: totalMinutes - minutesCount
    };
}

// =============================
//  Tendance (hausse / baisse / stable)
// =============================
function computeTrend(series) {
    if (!series || series.length < 4) {
        return { dir: "stable", text: "Données insuffisantes" };
    }

    const n = Math.min(series.length, 20);
    const subset = series.slice(-n);
    const half = Math.floor(subset.length / 2);

    const older = subset.slice(0, half);
    const recent = subset.slice(half);

    const avgOlder = mean(older.map(p => p.value));
    const avgRecent = mean(recent.map(p => p.value));

    if (avgOlder === null || avgRecent === null) {
        return { dir: "stable", text: "Données insuffisantes" };
    }

    const delta = avgRecent - avgOlder;
    const rel = delta / (Math.abs(avgOlder) > 1e-3 ? Math.abs(avgOlder) : 1);

    if (Math.abs(delta) < 0.1 && Math.abs(rel) < 0.05) {
        return { dir: "stable", text: "Stable" };
    }
    if (delta > 0) return { dir: "up", text: "En hausse" };
    return { dir: "down", text: "En baisse" };
}

// =============================
//  Helpers DOM
// =============================
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

function updateTrendCard(prefix, series, latest) {
    const t = computeTrend(series);

    const arrowEl = document.getElementById(prefix + "Arrow");
    const valueEl = document.getElementById(prefix + "Value");
    const textEl = document.getElementById(prefix + "Text");

    if (valueEl && latest && latest.value != null) {
        valueEl.innerText = latest.value.toFixed(1);
    }

    if (arrowEl) {
        arrowEl.classList.remove("trend-up", "trend-down", "trend-stable");

        let symbol = "→";
        let klass = "trend-stable";

        if (t.dir === "up") { symbol = "▲"; klass = "trend-up"; }
        else if (t.dir === "down") { symbol = "▼"; klass = "trend-down"; }

        arrowEl.innerText = symbol;
        arrowEl.classList.add(klass);
    }

    if (textEl) {
        textEl.innerText = t.text;
    }
}

// =============================
//  Détection d'anomalies
// =============================
function detectAnomalies(latest, uptimePercent) {
    const messages = [];
    const now = Date.now();

    const times = [
        latest.pm1.time,
        latest.pm25.time,
        latest.pm10.time,
        latest.temp.time,
        latest.hum.time
    ]
        .filter(Boolean)
        .map(t => new Date(t).getTime());

    if (!times.length) {
        messages.push("Aucune donnée récente reçue.");
        return messages;
    }

    const last = Math.max(...times);
    const diffMin = (now - last) / 60000;

    if (diffMin > 10) {
        messages.push(`Aucune mesure depuis ${diffMin.toFixed(0)} min.`);
    }

    if (uptimePercent < 90) {
        messages.push(`Disponibilité faible sur 24 h : ${uptimePercent.toFixed(1)} %.`);
    }

    if (latest.pm25.value != null && latest.pm25.value > 35) {
        messages.push(`PM2.5 élevé : ${latest.pm25.value.toFixed(1)} µg/m³.`);
    }

    if (latest.pm10.value != null && latest.pm10.value > 50) {
        messages.push(`PM10 élevé : ${latest.pm10.value.toFixed(1)} µg/m³.`);
    }

    if (latest.hum.value != null && (latest.hum.value < 15 || latest.hum.value > 85)) {
        messages.push(`Humidité atypique : ${latest.hum.value.toFixed(1)} %.`);
    }

    if (latest.temp.value != null && (latest.temp.value < -5 || latest.temp.value > 40)) {
        messages.push(`Température atypique : ${latest.temp.value.toFixed(1)} °C.`);
    }

    return messages;
}

// =============================
//  Chargement principal
// =============================
async function loadNewFeatures() {

    // Dernières valeurs
    const [pm1, pm25, pm10, temp, hum] = await Promise.all([
        getLatest("pm1"),
        getLatest("pm25"),
        getLatest("pm10"),
        getLatest("temperature"),
        getLatest("humidite")
    ]);

    const latest = { pm1, pm25, pm10, temp, hum };

    // -------------------------
    // 1) COMPARAISON PM2.5 24 h / 24 h
    // -------------------------
    const pm25Series48h = await getSeries("pm25", 48);

    const now = Date.now();
    const ms24h = 24 * 3600 * 1000;
    const today = [];
    const yesterday = [];

    pm25Series48h.forEach(p => {
        const t = new Date(p.time).getTime();
        if (t >= now - ms24h) {
            today.push(p.value);
        } else if (t >= now - 2 * ms24h) {
            yesterday.push(p.value);
        }
    });

    const avgToday = mean(today);
    const avgYesterday = mean(yesterday);

    if (avgToday != null) {
        setText("cmpPm25Today", avgToday.toFixed(1) + " µg/m³");
    }
    if (avgYesterday != null) {
        setText("cmpPm25Yesterday", avgYesterday.toFixed(1) + " µg/m³");
    }

    if (avgToday != null && avgYesterday != null) {
        const delta = avgToday - avgYesterday;
        const sign = delta > 0 ? "+" : "";
        setText(
            "cmpPm25Delta",
            `${sign}${delta.toFixed(1)} µg/m³ vs hier`
        );
    } else {
        setText("cmpPm25Delta", "Données insuffisantes");
    }

    // -------------------------
    // 2) UPTIME 24 h (PM2.5)
    // -------------------------
    const pm25Series24h = pm25Series48h.filter(
        p => new Date(p.time).getTime() >= now - ms24h
    );
    const uptime = computeUptimeFromSeries(pm25Series24h);

    setText("uptimePercent", uptime.percent.toFixed(1) + " %");
    setText("uptimeDetail", `${uptime.missingMinutes} minutes manquantes sur 24 h`);

    // -------------------------
    // 3) TENDANCES (1 h)
    // -------------------------
    const [pm1Series, pm25Series1h, pm10Series, tempSeries, humSeries] =
        await Promise.all([
            getSeries("pm1", 1),
            getSeries("pm25", 1),
            getSeries("pm10", 1),
            getSeries("temperature", 1),
            getSeries("humidite", 1)
        ]);

    updateTrendCard("trendPm1", pm1Series, pm1);
    updateTrendCard("trendPm25", pm25Series1h, pm25);
    updateTrendCard("trendPm10", pm10Series, pm10);
    updateTrendCard("trendTemp", tempSeries, temp);
    updateTrendCard("trendHum", humSeries, hum);

    // -------------------------
    // 4) ANOMALIES
    // -------------------------
    const anomalies = detectAnomalies(latest, uptime.percent);
    const list = document.getElementById("anomalyList");

    if (list) {
        list.innerHTML = "";
        if (!anomalies.length) {
            const li = document.createElement("li");
            li.textContent = "Rien à signaler, tout est nominal 😎";
            list.appendChild(li);
        } else {
            anomalies.forEach(msg => {
                const li = document.createElement("li");
                li.textContent = msg;
                list.appendChild(li);
            });
        }
    }
}

// Lancement + refresh toutes les 30 s
document.addEventListener("DOMContentLoaded", () => {
    loadNewFeatures();
    setInterval(loadNewFeatures, 30000);
});

