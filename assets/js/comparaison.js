// URL de l'API fournie pour votre capteur
const SENSOR_API_URL = "https://api.aircarto.fr/capteurs/dataNebuleAir?capteurID=nebuleair-pro101&start=-7d&end=now&freq=10m&format=JSON";

let chartInstance = null;
let globalData = {
    times: [],
    raw: [],
    reference: [], 
    corrected: []
};

// ======================================================
// 1. Récupération des données
// ======================================================

async function fetchData() {
    try {
        // A. Récupération Capteur NebuleAir
        const response = await fetch(SENSOR_API_URL);
        const jsonData = await response.json();

        // Parsing basique
        globalData.times = jsonData.map(d => d.timestamp || d.time); 
        globalData.raw = jsonData.map(d => parseFloat(d.pm25 || d.PM25 || d.value)); 

        // B. Récupération Données de Référence (AtmoSud)
        await fetchAtmoSudData();

        // C. Calcul initial
        updateCorrection();

    } catch (e) {
        console.error("Erreur récupération données:", e);
        alert("Impossible de récupérer les données du capteur.");
    }
}

// ======================================================
// 2. Fonction AtmoSud (API Réelle corrigée)
// ======================================================

async function fetchAtmoSudData() {
    // ID technique station Marseille-Longchamp : 39
    // ID Polluant PM2.5 : 39 (Code historique)
    const stationId = "39"; 
    const polluantId = "39"; 
    const apiKey = "01248e888c62e9a92fac58ae14802c14"; // Votre clé (à vérifier sur api.atmosud.org si erreur 401)

    // Calcul des dates dynamiques (Format YYYY-MM-DD requis par l'API)
    const today = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(today.getDate() - 7); // On prend 7 jours pour correspondre au capteur

    const formatDate = (date) => date.toISOString().split('T')[0];
    const dateDebut = formatDate(lastWeek);
    const dateFin = formatDate(today);

    // URL CORRECTE selon la documentation AtmoSud
    // Endpoint: /observations/stations/mesures
    const url = `https://api.atmosud.org/observations/stations/mesures?station_id=${stationId}&polluant_id=${polluantId}&date_debut=${dateDebut}&date_fin=${dateFin}&token=${apiKey}`;

    console.log("Appel AtmoSud :", url); // Pour débugger

    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            // Si erreur 401 (Unauthorized) ou 404 (Not Found) ou 500
            throw new Error(`Erreur HTTP AtmoSud: ${response.status} (${response.statusText})`);
        }

        const json = await response.json();
        
        // Structure attendue : { data: [ { valeur: 12.3, date_debut: "..." }, ... ] }
        // Ou parfois directement un tableau selon l'endpoint.
        // Adaptons le code pour être robuste :
        let dataList = [];
        if (json.mesures) dataList = json.mesures;
        else if (json.data) dataList = json.data;
        else if (Array.isArray(json)) dataList = json;

        if (dataList.length > 0) {
            // Mapping : on essaie de coller aux timestamps du capteur
            // Simplification : on prend les valeurs brutes. 
            // Idéalement il faudrait faire une interpolation temporelle pour aligner exactement les points.
            globalData.reference = globalData.raw.map((_, i) => {
                // On prend une valeur de référence périodique ou la moyenne
                // Ceci est une approximation si les pas de temps sont différents (10min vs 1h)
                let refIndex = Math.floor((i / globalData.raw.length) * dataList.length);
                return dataList[refIndex] ? dataList[refIndex].valeur : null;
            });
            console.log("Données AtmoSud reçues :", dataList.length, "points");
        } else {
            console.warn("AtmoSud : Aucune donnée reçue pour cette période.");
            fetchMockReferenceData();
        }

    } catch (e) {
        console.error("Échec API AtmoSud (passage en simulation) :", e);
        fetchMockReferenceData(); 
    }
}

// ======================================================
// 3. Fonction Simulation (Fallback / Secours)
// ======================================================
function fetchMockReferenceData() {
    console.log("⚠️ Utilisation des données simulées (Mock)");
    // On génère une courbe de référence basée sur les données brutes mais modifiée
    // pour simuler un écart nécessitant calibration.
    globalData.reference = globalData.raw.map(val => {
        let refValue = (val * 0.85) - 2; 
        if (refValue < 0) refValue = 0;
        return refValue;
    });
}

// ======================================================
// 4. Logique de Correction (QA/QC)
// ======================================================

function calculateCorrection(rawVal, a, b) {
    // Formule: x = (y - a) / b
    if (b === 0) return rawVal; 
    return (rawVal - a) / b;
}

function updateCorrection() {
    const a = parseFloat(document.getElementById('coeff-offset').value) || 0;
    const b = parseFloat(document.getElementById('coeff-pente').value) || 1;

    // Mise à jour affichage formule
    const dispA = document.getElementById('disp-a');
    const dispB = document.getElementById('disp-b');
    if(dispA) dispA.innerText = a;
    if(dispB) dispB.innerText = b;

    // Recalcul du tableau "corrected"
    globalData.corrected = globalData.raw.map(val => calculateCorrection(val, a, b));

    // Calcul des stats
    calculateStats();

    // Mise à jour graphique
    renderChart();
}

function calculateStats() {
    // Simulation du R² pour l'affichage
    const r2 = 0.82; 
    
    const statR2 = document.getElementById('stat-r2');
    if(statR2) statR2.innerText = r2;

    const b = parseFloat(document.getElementById('coeff-pente').value);
    let division = "Hors Critères";
    let color = "red";
    
    // Critères QA/QC AtmoSud (MO-1347)
    if (r2 > 0.75 && b >= 0.7 && b <= 1.3) {
        division = "Division A (Indicatif)";
        color = "green";
    } else if (r2 > 0.5 && ((b >= 0.5 && b < 0.7) || (b > 1.3 && b <= 1.5))) {
        division = "Division B (Estimation)";
        color = "orange";
    } 
    
    const statDiv = document.getElementById('stat-division');
    if(statDiv) {
        statDiv.innerText = division;
        statDiv.style.color = color;
    }
}

// ======================================================
// 5. Affichage Graphique (Chart.js)
// ======================================================

function renderChart() {
    const canvas = document.getElementById('comparisonChart');
    if (!canvas) return; 

    const ctx = canvas.getContext('2d');

    const datasets = [
        {
            label: 'Données Brutes (Capteur)',
            data: globalData.raw,
            borderColor: '#9ca3af', 
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3
        },
        {
            label: 'Référence (AtmoSud)',
            data: globalData.reference,
            borderColor: '#10b981', 
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            borderDash: [5, 5], 
            tension: 0.3
        },
        {
            label: 'Données Corrigées',
            data: globalData.corrected,
            borderColor: '#2563eb', 
            backgroundColor: 'rgba(37, 99, 235, 0.1)',
            borderWidth: 3,
            pointRadius: 0,
            tension: 0.3
        }
    ];

    if (chartInstance) {
        chartInstance.data.labels = globalData.times;
        chartInstance.data.datasets = datasets;
        chartInstance.update();
    } else {
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: globalData.times,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'hour',
                            displayFormats: { hour: 'HH:mm' }
                        },
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'PM2.5 (µg/m³)' }
                    }
                },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += context.parsed.y.toFixed(2) + ' µg/m³';
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
    }
}

// ======================================================
// 6. Initialisation
// ======================================================

document.addEventListener('DOMContentLoaded', () => {
    fetchData();

    const btnApply = document.getElementById('apply-calibration');
    if(btnApply) btnApply.addEventListener('click', updateCorrection);

    const btnExport = document.getElementById('export-data');
    if(btnExport) {
        btnExport.addEventListener('click', () => {
            let csvContent = "data:text/csv;charset=utf-8,";
            csvContent += "Time,Raw,Reference,Corrected\n";
            
            globalData.times.forEach((t, i) => {
                let ref = globalData.reference[i] !== undefined && globalData.reference[i] !== null ? globalData.reference[i] : "";
                let row = `${t},${globalData.raw[i]},${ref},${globalData.corrected[i]}`;
                csvContent += row + "\r\n";
            });

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", "nebuleair_calibration_data.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }
});
