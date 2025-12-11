// =============================
//  CONFIG
// =============================

const DEFAULT_FIELD = "pm25"; // Pour l'AQI
const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
const BUCKET = "Nodule Air";

// Format "2025-11-24T16:29:24.511Z" -> "24/11/2025 à 17:29"
function formatDateTime(isoString) {
    if (!isoString) return "--";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString; // au cas où

    const date = d.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });

    const time = d.toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit"
    });

    return `${date} à ${time}`;
}

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

    const lines = raw.trim().split("\n");

    // Influx CSV : la vraie ligne data commence par ",_result"
    const dataLine = lines.find(line => line.startsWith(",_result"));

    if (!dataLine) {
        return { value: null, time: null };
    }

    const cols = dataLine.split(",");

    const time = cols[5];              // colonne _time
    const value = parseFloat(cols[6]); // colonne _value

    return {
        time,
        value: isNaN(value) ? null : value
    };
}

// ======================================
//  AQI CALCULATION (ONLY PM2.5 NEEDED)
// ======================================

function computeAQI(pm25) {
    if (pm25 === null) return { aqi: null, message: "Indisponible" };

    if (pm25 <= 12)  return { aqi: 1, message: "Excellent" };
    if (pm25 <= 35)  return { aqi: 2, message: "Bon" };
    if (pm25 <= 55)  return { aqi: 3, message: "Moyen" };
    if (pm25 <= 150) return { aqi: 4, message: "Mauvais" };
    if (pm25 <= 250) return { aqi: 5, message: "Très mauvais" };
    return { aqi: 6, message: "Dangereux" };
}

// ======================================
//  STATUS LOADING (Version Corrigée)
// ======================================

async function loadStatus() {
    // 1. On ajoute "rssi" (ou "RSSI") à la liste des requêtes
    const [pm1, pm25, pm10, temp, hum, rssi] = await Promise.all([
        getLatest("pm1"),
        getLatest("pm25"),
        getLatest("pm10"),
        getLatest("temperature"),
        getLatest("humidite"),
        getLatest("rssi") // <--- Vérifiez ici aussi le nom du champ (ex: "RSSI")
    ]);

    // Valeurs des cartes
    document.getElementById("statusPM1").innerText  = pm1.value  ?? "--";
    document.getElementById("statusPM25").innerText = pm25.value ?? "--";
    document.getElementById("statusPM10").innerText = pm10.value ?? "--";

    document.getElementById("statusTemp").innerText =
        temp.value !== null ? `${temp.value} °C` : "--";

    document.getElementById("statusHum").innerText =
        hum.value !== null ? `${hum.value} %` : "--";

    // Mise à jour du RSSI
    document.getElementById("statusRSSI").innerText = 
        rssi.value !== null ? `${rssi.value} dBm` : "--";

    // Dernière mise à jour = time le plus récent
    const times = [pm1.time, pm25.time, pm10.time, temp.time, hum.time, rssi.time].filter(Boolean);
    const last = times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;

    document.getElementById("statusLastUpdate").innerText = last
        ? formatDateTime(last)
        : "--";

    // Uptime
    if (last) {
        const t = new Date(last);
        const diffMs = Date.now() - t.getTime();
        const hours = Math.floor(diffMs / 3600000);
        const mins  = Math.floor((diffMs % 3600000) / 60000);

        document.getElementById("statusUptime").innerText = `${hours}h ${mins}min`;
    } else {
        document.getElementById("statusUptime").innerText = "--";
    }

    // AQI
    const aqi = computeAQI(pm25.value);
    document.getElementById("statusAQI").innerText        = aqi.aqi ?? "--";
    document.getElementById("statusAQIMessage").innerText = aqi.message;

    // Indicateurs OK/Erreur
    document.getElementById("statusNextPM").innerText =
        (pm1.value !== null || pm25.value !== null || pm10.value !== null) ? "OK" : "Erreur";

    document.getElementById("statusBME").innerText =
        (temp.value !== null && hum.value !== null) ? "OK" : "Erreur";
}

setInterval(loadStatus, 15000);
loadStatus();
