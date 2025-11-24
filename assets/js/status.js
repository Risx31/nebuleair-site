// =============================
//  CONFIG
// =============================

const DEFAULT_FIELD = "pm25"; // Pour l'AQI
const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
const BUCKET = "Nodule Air";

// =============================
//  FETCH LATEST VALUE FOR ANY FIELD
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
        body: fluxQuery,
    });

    const raw = await response.text();
    console.log("RAW LATEST (" + field + "):", raw);

    const rows = raw.split("\n").filter(r => r.includes(",_field"));

    if (rows.length === 0) return { value: null, time: null };

    const cols = rows[0].split(",");

    return {
        time: cols[5],
        value: parseFloat(cols[6]),
    };
}

// ======================================
//  AQI CALCULATION (ONLY PM2.5 NEEDED)
// ======================================

function computeAQI(pm25) {
    if (pm25 === null) return { aqi: null, message: "Indisponible" };

    if (pm25 <= 12) return { aqi: 1, message: "Excellent" };
    if (pm25 <= 35) return { aqi: 2, message: "Bon" };
    if (pm25 <= 55) return { aqi: 3, message: "Moyen" };
    if (pm25 <= 150) return { aqi: 4, message: "Mauvais" };
    if (pm25 <= 250) return { aqi: 5, message: "Très mauvais" };
    return { aqi: 6, message: "Dangereux" };
}

// ======================================
//  STATUS LOADING
// ======================================

async function loadStatus() {

    // Fetch all last values in parallel
    const [
        pm1,
        pm25,
        pm10,
        temp,
        hum
    ] = await Promise.all([
        getLatest("pm1"),
        getLatest("pm25"),
        getLatest("pm10"),
        getLatest("temperature"),
        getLatest("humidite")
    ]);

    // Fill values
    document.getElementById("statusPM1").innerText = pm1.value ?? "--";
    document.getElementById("statusPM25").innerText = pm25.value ?? "--";
    document.getElementById("statusPM10").innerText = pm10.value ?? "--";
    document.getElementById("statusTemp").innerText = temp.value ? temp.value + " °C" : "--";
    document.getElementById("statusHum").innerText = hum.value ? hum.value + " %" : "--";

    // Last update based on PM25 timestamp
    const last = pm25.time || pm1.time || pm10.time || temp.time || hum.time;
    document.getElementById("statusLastUpdate").innerText = last ?? "--";

    // Compute uptime (approx = "now - last update")
    if (last) {
        const t = new Date(last);
        const diffMs = Date.now() - t.getTime();
        const hours = Math.floor(diffMs / 3600000);
        const mins = Math.floor((diffMs % 3600000) / 60000);

        document.getElementById("statusUptime").innerText =
            `${hours}h ${mins}min`;
    } else {
        document.getElementById("statusUptime").innerText = "--";
    }

    // AQI
    const aqi = computeAQI(pm25.value);
    document.getElementById("statusAQI").innerText = aqi.aqi ?? "--";
    document.getElementById("statusAQIMessage").innerText = aqi.message;

    // Sensor health (basic logic)
    document.getElementById("statusNextPM").innerText =
        pm1.value !== null || pm25.value !== null || pm10.value !== null
            ? "OK" : "Erreur";

    document.getElementById("statusBME").innerText =
        temp.value !== null && hum.value !== null ? "OK" : "Erreur";

    // RSSI (if you send it later → via MQTT or Influx)
    document.getElementById("statusRSSI").innerText = "--";
}

// Auto refresh every 15 sec
setInterval(loadStatus, 15000);
loadStatus();
