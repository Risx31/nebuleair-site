document.addEventListener("DOMContentLoaded", function () {
    const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
    const BUCKET = "Nodule Air";

    let currentRange = "1h";
    let customRange = null;
    let labelsRaw = [];
    let series = { pm1: [], pm25: [], pm10: [], temperature: [], humidite: [], rssi: [] };

    // --- 1. THÈME & BANANE ---
    const body = document.body;
    const themeBtn = document.getElementById("themeToggle");
    const banana = document.getElementById("userProfileBanana");

    function toggleTheme() {
        body.classList.toggle("dark");
        body.classList.toggle("light");
        localStorage.setItem("theme", body.classList.contains("dark") ? "dark" : "light");
    }

    [themeBtn, banana].forEach(el => el?.addEventListener("click", toggleTheme));
    body.className = localStorage.getItem("theme") || "light";

    // --- 2. GRAPHIQUE ---
    const ctx = document.getElementById("mainChart")?.getContext("2d");
    if (!ctx) return;

    const mainChart = new Chart(ctx, {
        type: "line",
        data: {
            datasets: [
                { label: "PM1", data: [], borderColor: "#007bff", yAxisID: 'y', tension: 0.3 },
                { label: "PM2.5", data: [], borderColor: "#ff9800", yAxisID: 'y', tension: 0.3 },
                { label: "PM10", data: [], borderColor: "#e91e63", yAxisID: 'y', tension: 0.3 },
                { label: "Temp", data: [], borderColor: "#00c853", yAxisID: 'y1', tension: 0.3 },
                { label: "Hum", data: [], borderColor: "#26c6da", yAxisID: 'y1', tension: 0.3 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { type: "time", time: { unit: 'minute' } },
                y: { position: 'left', beginAtZero: true },
                y1: { position: 'right', grid: { drawOnChartArea: false } }
            }
        }
    });

    // --- 3. LOGIQUE DATA ---
    async function fetchField(field) {
        let range = customRange ? `|> range(start: ${customRange.start}, stop: ${customRange.stop})` : `|> range(start: -${currentRange})`;
        const query = `from(bucket: "${BUCKET}") ${range} |> filter(fn: (r) => r._measurement == "nebuleair" and r._field == "${field}") |> aggregateWindow(every: 1m, fn: mean, createEmpty: false) |> yield()`;
        
        const resp = await fetch(INFLUX_URL, { method: "POST", body: query });
        const text = await resp.text();
        const lines = text.split("\n").filter(l => l.includes(",") && !l.startsWith("#"));
        const header = lines[0]?.split(",");
        const tIdx = header?.indexOf("_time"), vIdx = header?.indexOf("_value");
        
        return {
            labels: lines.slice(1).map(l => l.split(",")[tIdx]),
            values: lines.slice(1).map(l => parseFloat(l.split(",")[vIdx]))
        };
    }

    function updateUI() {
        const maps = { "pm1-value": series.pm1, "pm25-value": series.pm25, "pm10-value": series.pm10, "temp-value": series.temperature, "hum-value": series.humidite, "wifi-value": series.rssi };
        for (let id in maps) {
            const el = document.getElementById(id);
            if (el) el.textContent = maps[id].length ? maps[id][maps[id].length - 1].toFixed(1) : "--";
        }
        
        const keys = ["pm1", "pm25", "pm10", "temperature", "humidite"];
        keys.forEach((k, i) => {
            mainChart.data.datasets[i].data = labelsRaw.map((t, idx) => ({ x: t, y: series[k][idx] }));
        });
        mainChart.update();
    }

    async function loadAllData() {
        try {
            const res = await Promise.all(["pm1", "pm25", "pm10", "temperature", "humidite", "rssi"].map(f => fetchField(f)));
            body.classList.remove("state-error");
            labelsRaw = res[0].labels.map(t => new Date(t));
            series.pm1 = res[0].values; series.pm25 = res[1].values; series.pm10 = res[2].values;
            series.temperature = res[3].values; series.humidite = res[4].values; series.rssi = res[5].values;
            updateUI();
        } catch (e) {
            body.classList.add("state-error");
        }
    }

    // --- 4. ÉVÉNEMENTS ---
    document.querySelectorAll(".btn-range").forEach(b => b.addEventListener("click", () => {
        document.querySelectorAll(".btn-range").forEach(btn => btn.classList.remove("active"));
        b.classList.add("active");
        currentRange = b.dataset.range.replace('j', 'd');
        customRange = null;
        loadAllData();
    }));

    // Snake
    let secret = "snake", buffer = "";
    document.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT") return;
        buffer = (buffer + e.key.toLowerCase()).slice(-secret.length);
        if (buffer === secret) {
            document.getElementById("snake-container")?.classList.remove("snake-hidden");
            window.NebuleAirSnake?.init("snakeCanvas");
        }
        if (e.key === "Escape") document.getElementById("snake-container")?.classList.add("snake-hidden");
    });
    document.getElementById("snake-close")?.addEventListener("click", () => document.getElementById("snake-container").classList.add("snake-hidden"));

    // Map
    const map = L.map("map").setView([43.30544, 5.39487], 18);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
    L.marker([43.30544, 5.39487]).addTo(map);

    loadAllData();
    setInterval(loadAllData, 60000);
});
