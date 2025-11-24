// =====================================================
// COMMON.JS — Fonctions globales + Thème sombre
// =====================================================

// =====================================================
// Apply theme instantly on page load
// =====================================================

document.addEventListener("DOMContentLoaded", () => {
    applySavedTheme();
    setupThemeToggle();
});

// =====================================================
// Apply theme (dark/light)
// =====================================================

function applySavedTheme() {
    const savedTheme = localStorage.getItem("theme") || "light";
    document.body.className = savedTheme;

    const toggle = document.getElementById("themeToggle");
    if (toggle) {
        toggle.textContent = savedTheme === "dark" ? "☀️" : "🌙";
    }
}

// =====================================================
// Theme toggle button
// =====================================================

function setupThemeToggle() {
    const toggle = document.getElementById("themeToggle");
    if (!toggle) return;

    toggle.addEventListener("click", () => {
        const isDark = document.body.classList.contains("dark");

        if (isDark) {
            document.body.classList.remove("dark");
            document.body.classList.add("light");
            localStorage.setItem("theme", "light");
            toggle.textContent = "🌙";
        } else {
            document.body.classList.remove("light");
            document.body.classList.add("dark");
            localStorage.setItem("theme", "dark");
            toggle.textContent = "☀️";
        }
    });
}

// =====================================================
// Time formatting utility
// =====================================================

function formatTime_ISO(isoString) {
    if (!isoString) return "--";
    const d = new Date(isoString);
    return d.toLocaleString("fr-FR");
}

// =====================================================
// Helper: remove all children
// =====================================================

function clearElement(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}
