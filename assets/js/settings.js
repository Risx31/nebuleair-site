// =====================================================
// SETTINGS.JS — Gestion des préférences utilisateur
// =====================================================

// Charger les paramètres à l'ouverture
document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    setupSettingsListeners();
});

// =====================================================
// Charger tous les paramètres sauvegardés
// =====================================================

function loadSettings() {
    // Thème
    const savedTheme = localStorage.getItem("theme") || "light";
    const darkToggle = document.getElementById("darkModeToggle");
    if (darkToggle) {
        darkToggle.checked = (savedTheme === "dark");
    }

    // Période par défaut
    const savedPeriod = localStorage.getItem("defaultPeriod") || "-6h";
    const periodSelect = document.getElementById("defaultPeriod");
    if (periodSelect) {
        periodSelect.value = savedPeriod;
    }

    // Fréquence refresh
    const savedRate = localStorage.getItem("refreshRate") || "15000";
    const rateSelect = document.getElementById("refreshRate");
    if (rateSelect) {
        rateSelect.value = savedRate;
    }

    // Mode LIVE
    const liveMode = localStorage.getItem("liveMode") === "true";
    const liveToggle = document.getElementById("liveModeToggle");
    if (liveToggle) {
        liveToggle.checked = liveMode;
    }

    // Couleurs des courbes
    const colorInputs = {
        colorPM1: "pm1",
        colorPM25: "pm25",
        colorPM10: "pm10",
        colorTemp: "temperature",
        colorHum: "humidite"
    };

    for (let id in colorInputs) {
        const elem = document.getElementById(id);
        const key = "color-" + colorInputs[id];
        const saved = localStorage.getItem(key);

        if (elem && saved) elem.value = saved;
    }
}

// =====================================================
// Mise en place des listeners
// =====================================================

function setupSettingsListeners() {

    // Thème sombre
    const darkToggle = document.getElementById("darkModeToggle");
    if (darkToggle) {
        darkToggle.addEventListener("change", () => {
            const isDark = darkToggle.checked;
            localStorage.setItem("theme", isDark ? "dark" : "light");
            document.body.className = isDark ? "dark" : "light";
        });
    }

    // Période par défaut
    const periodSelect = document.getElementById("defaultPeriod");
    if (periodSelect) {
        periodSelect.addEventListener("change", () => {
            localStorage.setItem("defaultPeriod", periodSelect.value);
        });
    }

    // Vitesse de rafraîchissement
    const rateSelect = document.getElementById("refreshRate");
    if (rateSelect) {
        rateSelect.addEventListener("change", () => {
            localStorage.setItem("refreshRate", rateSelect.value);
        });
    }

    // Mode LIVE
    const liveToggle = document.getElementById("liveModeToggle");
    if (liveToggle) {
        liveToggle.addEventListener("change", () => {
            localStorage.setItem("liveMode", liveToggle.checked.toString());
        });
    }

    // Couleurs des courbes
    const colorInputs = {
        colorPM1: "pm1",
        colorPM25: "pm25",
        colorPM10: "pm10",
        colorTemp: "temperature",
        colorHum: "humidite"
    };

    for (let id in colorInputs) {
        const elem = document.getElementById(id);
        const key = "color-" + colorInputs[id];

        if (elem) {
            elem.addEventListener("change", () => {
                localStorage.setItem(key, elem.value);
            });
        }
    }

    // Réinitialisation complete
    const resetBtn = document.getElementById("resetSite");
    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            if (confirm("Voulez-vous réinitialiser toutes les préférences ?")) {
                localStorage.clear();
                location.reload();
            }
        });
    }
}
