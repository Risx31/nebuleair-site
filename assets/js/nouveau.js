/**
 * Nouveautés – NebuleAir
 * Version réparée et connectée à l'API AirCarto
 */

console.log("🚀 Module de Test Chargé");

// Configuration API
const CAPTEUR_ID = "nebuleair-pro101";
const BASE_URL = "https://api.aircarto.fr/capteurs/dataNebuleAir";

let compareChartInstance = null;
let uptimeChartInstance = null;

// ================= INITIALISATION =================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Charger les valeurs par défaut dans les inputs de date
    initDateInputs();

    // 2. Charger les données "Santé" (Uptime, Tendances, Anomalies)
    analyzeSensorHealth();

    // 3. Écouteur bouton comparaison
    document.getElementById("btn-compare").addEventListener("click", runComparison);
});

// Initialise les dates (Période A = Hier, Période B = Aujourd'hui)
function initDateInputs() {
    const now = new Date();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const beforeYesterday = new Date(now); beforeYesterday.setDate(now.getDate() - 2);

    // Format compatible datetime-local : YYYY-MM-DDTHH:mm
    const toLocalISO = (d) => d.toLocaleString('sv').replace(' ', 'T').substring(0, 16);

    document.getElementById("startA").value = toLocalISO(beforeYesterday);
    document.getElementById("startB").value = toLocalISO(yesterday);
}

// ================= FONCTIONS API =================
async function fetchNebuleAirData(startStr, endStr) {
    // Conversion des dates ISO pour l'API (Timestamp ou format supporté)
    // L'API AirCarto accepte "start" et "end"
    // On simplifie : on récupère tout via l'URL standard si dates complexes, 
    // ou on construit l'URL. Ici on utilise l'URL qui marche bien.
    
    // Pour simplifier ce labo de test, on va récupérer les 7 derniers jours 
    // et filtrer en JS, car l'API est très rapide.
    const url = `${BASE_URL}?capteurID=${CAPTEUR_ID}&start=-7d&end=now&freq=10m&format=JSON`;
    
    try {
        const res = await fetch(url);
        if(!res.ok) throw new Error("Erreur API");
        const data = await res.json();
        return parseData(data);
    } catch (e) {
        console.error("Erreur Fetch:", e);
        return [];
    }
}

function parseData(jsonData) {
    // Transforme le JSON en tableau propre
    return jsonData.map(d => ({
        time: new Date(d.timestamp || d.time),
        pm25: parseFloat(d.pm25 || d.PM25 || d.value || 0),
        temp: parseFloat(d.temperature || d.temp || 0),
        hum: parseFloat(d.humidity || d.hum || 0)
    })).sort((a,b) => a.time - b.time);
}

// ================= FONCTIONNALITÉ 1 : SANTÉ (Uptime & Tendances) =================
async function analyzeSensorHealth() {
    const data = await fetchNebuleAirData(); // Récupère 7 jours
    if(data.length === 0) return;

    // --- 1. UPTIME (24h) ---
    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    
    const data24h = data.filter(d => d.time >= oneDayAgo);
    
    // Calcul des "trous" > 20 minutes (le capteur envoie toutes les 10 min)
    let missingBlocks = 0;
    let totalBlocks = 0;
    
    // On s'attend à 6 mesures par heure * 24h = 144 mesures
    const expectedPoints = 144;
    const actualPoints = data24h.length;
    
    let uptime = (actualPoints / expectedPoints) * 100;
    if(uptime > 100) uptime = 100;

    // Affichage Score
    const elScore = document.getElementById("uptime-score");
    elScore.textContent = `${uptime.toFixed(1)}%`;
    
    // Couleur dynamique
    if(uptime > 95) elScore.style.color = "#10b981"; // Vert
    else if(uptime > 80) elScore.style.color = "#f59e0b"; // Orange
    else elScore.style.color = "#ef4444"; // Rouge

    document.getElementById("uptime-status").textContent = `${actualPoints} mesures reçues sur ~${expectedPoints} attendues`;

    // Petit Graphique Barres (Nombre de mesures par heure sur 24h)
    renderUptimeChart(data24h);

    // --- 2. TENDANCES (1h) ---
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const data1h = data.filter(d => d.time >= oneHourAgo);
    
    const list = document.getElementById("trend-list");
    list.innerHTML = "";

    if(data1h.length > 1) {
        const start = data1h[0];
        const end = data1h[data1h.length - 1];

        addTrendItem(list, "Particules (PM2.5)", start.pm25, end.pm25, "µg/m³");
        addTrendItem(list, "Température", start.temp, end.temp, "°C");
        addTrendItem(list, "Humidité", start.hum, end.hum, "%");
    } else {
        list.innerHTML = "<li>Pas assez de données récentes.</li>";
    }

    // --- 3. ANOMALIES (Seuils simples) ---
    const anomalies = data24h.filter(d => d.pm25 > 50 || d.temp > 45 || d.temp < -5);
    const tableBody = document.getElementById("anomaly-table-body");
    tableBody.innerHTML = "";

    if(anomalies.length === 0) {
        tableBody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:green;'>✅ Aucune anomalie détectée sur 24h</td></tr>";
    } else {
        anomalies.slice(-10).reverse().forEach(a => { // Montre les 10 dernières
            let type = a.pm25 > 50 ? "Pollution Élevée" : "Température Extrême";
            let val = a.pm25 > 50 ? `${a.pm25} µg` : `${a.temp}°C`;
            let seuil = a.pm25 > 50 ? "> 50" : "[-5, 45]";
            
            const row = `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:6px;">${a.time.toLocaleTimeString()}</td>
                    <td style="padding:6px; color:#ef4444; font-weight:bold;">${type}</td>
                    <td style="padding:6px;">${val}</td>
                    <td style="padding:6px; color:#999;">${seuil}</td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });
    }
}

function addTrendItem(container, label, vStart, vEnd, unit) {
    const diff = vEnd - vStart;
    const icon = diff > 0 ? "↗️" : diff < 0 ? "↘️" : "➡️";
    const color = diff > 0 ? "#ef4444" : "#10b981"; // Rouge si ça monte (pour pollution/temp)
    // Inversion logique pour humidité si on veut, mais restons simples.

    const li = document.createElement("li");
    li.style.marginBottom = "8px";
    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.style.fontSize = "0.9rem";
    
    li.innerHTML = `
        <span>${label}</span>
        <span style="font-weight:bold;">
            ${vEnd.toFixed(1)} ${unit} 
            <span style="font-size:0.8em; color:#666; margin-left:5px;">(${icon} ${Math.abs(diff).toFixed(1)})</span>
        </span>
    `;
    container.appendChild(li);
}

function renderUptimeChart(data24h) {
    const ctx = document.getElementById("uptimeChart").getContext("2d");
    
    // Grouper par heure
    const hours = {};
    for(let i=0; i<24; i++) hours[i] = 0;

    data24h.forEach(d => {
        const h = d.time.getHours();
        hours[h]++;
    });

    if(uptimeChartInstance) uptimeChartInstance.destroy();

    uptimeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(hours).map(h => `${h}h`),
            datasets: [{
                label: 'Mesures / Heure',
                data: Object.values(hours),
                backgroundColor: Object.values(hours).map(v => v >= 5 ? '#10b981' : '#ef4444'),
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, max: 10 } // On attend max 6-7 mesures
            }
        }
    });
}


// ================= FONCTIONNALITÉ 2 : COMPARATEUR =================
async function runComparison() {
    const tStartA = new Date(document.getElementById("startA").value);
    const tStartB = new Date(document.getElementById("startB").value);
    
    // On définit des fenêtres de 24h par défaut si l'input ne donne qu'une date
    // Pour simplifier, on prend [Date Selectionnée] -> [Date Selectionnée + 24h]
    const getEnd = (d) => new Date(d.getTime() + 24 * 60 * 60 * 1000);

    const data = await fetchNebuleAirData(); // On réutilise les 7j (cache implicite navigateur)

    // Filtrage JS
    const setA = data.filter(d => d.time >= tStartA && d.time < getEnd(tStartA));
    const setB = data.filter(d => d.time >= tStartB && d.time < getEnd(tStartB));

    if(setA.length === 0 && setB.length === 0) {
        alert("Aucune donnée trouvée pour ces dates dans l'historique récent (7 jours).");
        return;
    }

    renderCompareChart(setA, setB);
}

function renderCompareChart(dataA, dataB) {
    const ctx = document.getElementById("compareChart").getContext("2d");

    // Astuce : Pour superposer deux jours différents sur le même axe X,
    // on ramène tout à une "date fictive" (ex: 1er Janvier 2000 + Heure réelle)
    const normalizeTime = (d) => {
        const dummy = new Date(2000, 0, 1);
        dummy.setHours(d.time.getHours(), d.time.getMinutes(), 0);
        return dummy;
    };

    const pointsA = dataA.map(d => ({ x: normalizeTime(d), y: d.pm25 }));
    const pointsB = dataB.map(d => ({ x: normalizeTime(d), y: d.pm25 }));

    if(compareChartInstance) compareChartInstance.destroy();

    compareChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Période A (Référence)',
                    data: pointsA,
                    borderColor: '#3b82f6', // Bleu
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    fill: true
                },
                {
                    label: 'Période B (Comparaison)',
                    data: pointsB,
                    borderColor: '#ec4899', // Rose
                    backgroundColor: 'rgba(236, 72, 153, 0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'hour', displayFormats: { hour: 'HH:mm' } },
                    title: { display: true, text: 'Heure de la journée (Superposition)' }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'PM2.5 (µg/m³)' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            // Affiche l'heure seulement
                            const d = new Date(items[0].parsed.x);
                            return d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                        }
                    }
                }
            }
        }
    });
}
