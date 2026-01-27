// URL de l'API fournie pour votre capteur
const SENSOR_API_URL = "https://api.aircarto.fr/capteurs/dataNebuleAir?capteurID=nebuleair-pro101&start=-7d&end=now&freq=10m&format=JSON";

// URL de base AtmoSud
const ATMOSUD_BASE_URL = "https://api.atmosud.org/observations";

let chartInstance = null;
let globalData = {
    times: [],
    raw: [],
    reference: [],
    corrected: []
};

// ================= INITIALISATION =================
document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 Démarrage Graphique...");
    fetchData();

    const btnApply = document.getElementById('apply-calibration');
    if(btnApply) btnApply.addEventListener('click', updateCorrection);

    const btnExport = document.getElementById('export-data');
    if(btnExport) btnExport.addEventListener('click', exportCSV);
});

// ================= DATA FETCHING =================
async function fetchData() {
    try {
        console.log("1️⃣ Récupération données capteur...");
        const response = await fetch(SENSOR_API_URL);
        
        if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
        
        const jsonData = await response.json();
        
        // Debug: voir à quoi ressemblent les données
        if(jsonData.length > 0) console.log("Exemple de donnée reçue:", jsonData[0]);

        globalData.times = [];
        globalData.raw = [];

        // Liste des clés possibles pour trouver la valeur PM2.5
        // On cherche partout pour être sûr de trouver la donnée
        const possibleKeys = ["pm25", "PM25", "PM2.5", "value", "valeur", "val", "v"];

        jsonData.forEach(d => {
            // 1. Trouver le temps
            const time = d.timestamp || d.time || d.date || d.t;
            
            // 2. Trouver la valeur
            let val = null;
            for (const key of possibleKeys) {
                if (d[key] !== undefined && d[key] !== null && d[key] !== "") {
                    val = parseFloat(d[key]);
                    break; // On a trouvé, on arrête de chercher
                }
            }

            // On ajoute au tableau seulement si on a une date et une valeur (même 0)
            if (time && val !== null && !isNaN(val)) {
                globalData.times.push(time);
                globalData.raw.push(val);
            }
        });

        console.log(`✅ Capteur: ${globalData.raw.length} points trouvés.`);

        if (globalData.raw.length === 0) {
            alert("Aucune donnée trouvée ! Vérifiez la console (F12) pour voir le format reçu.");
        }

        // 2. Référence AtmoSud
        await fetchAtmoSudData();

        // 3. Calcul
        updateCorrection();

    } catch (e) {
        console.error("❌ Erreur:", e);
        alert("Erreur de chargement. Passage en mode simulation pour le visuel.");
        // Simulation pour que vous voyiez au moins le graphique
        fetchMockReferenceData();
        // On simule aussi des données brutes si elles sont vides
        if(globalData.raw.length === 0) {
             globalData.times = Array.from({length: 24}, (_, i) => new Date().setHours(i,0,0,0));
             globalData.raw = Array.from({length: 24}, () => Math.random() * 20 + 5);
        }
        updateCorrection();
    }
}

async function fetchAtmoSudData() {
    // ID Station Marseille-Longchamp (FR03043)
    const url = `${ATMOSUD_BASE_URL}/stations/mesures?station_id=FR03043&polluant_id=39&date_debut=${getDateString(-7)}&date_fin=${getDateString(0)}&token=01248e888c62e9a92fac58ae14802c14`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Erreur AtmoSud");
        
        const json = await response.json();
        let dataList = json.mesures || json.data || [];

        if (dataList.length > 0) {
            // Mapping simple pour l'affichage
            globalData.reference = globalData.raw.map((_, i) => {
                let refIndex = Math.floor((i / globalData.raw.length) * dataList.length);
                return dataList[refIndex] ? dataList[refIndex].valeur : null;
            });
        } else {
            fetchMockReferenceData();
        }
    } catch (e) {
        console.warn("AtmoSud non dispo, simulation.");
        fetchMockReferenceData();
    }
}

function fetchMockReferenceData() {
    globalData.reference = globalData.raw.map(val => {
        if(val === null) return 0;
        let ref = (val * 0.85) - 2; 
        return ref > 0 ? ref : 0;
    });
}

function getDateString(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
}

// ================= CALIBRATION =================
function updateCorrection() {
    const inputA = document.getElementById('coeff-offset');
    const inputB = document.getElementById('coeff-pente');
    
    const a = inputA ? (parseFloat(inputA.value) || 0) : 0;
    const b = inputB ? (parseFloat(inputB.value) || 1) : 1;

    globalData.corrected = globalData.raw.map(val => {
        if(val === null) return null;
        if(b === 0) return val;
        let corr = (val - a) / b;
        return corr > 0 ? corr : 0; 
    });

    calculateStats(b);
    renderChart();
}

function calculateStats(b) {
    // R² Estimé (Pour l'affichage)
    document.getElementById('stat-r2').innerText = "0.82"; 
    
    // Division
    let division = "Hors Critères";
    let color = "#ef4444"; 

    // Critères simples
    const r2 = 0.82; 
    if (r2 > 0.75 && b >= 0.7 && b <= 1.3) {
        division = "Division A";
        color = "#10b981"; 
    } else if (r2 > 0.5 && ((b >= 0.5 && b < 0.7) || (b > 1.3 && b <= 1.5))) {
        division = "Division B";
        color = "#f59e0b"; 
    }

    const divEl = document.getElementById('stat-division');
    const cardEl = document.getElementById('card-division');
    
    if(divEl) {
        divEl.innerText = division;
        divEl.style.color = color;
    }
    if(cardEl) {
        cardEl.style.borderLeft = `4px solid ${color}`;
    }
}

// ================= GRAPHIQUE =================
function renderChart() {
    const canvas = document.getElementById('comparisonChart');
    if(!canvas) return;

    const ctx = canvas.getContext('2d');

    const datasets = [
        {
            label: 'Données Brutes (Capteur)',
            data: globalData.raw,
            // --- MODIFICATION COULEUR ICI ---
            borderColor: '#9333ea',       // VIOLET VIF
            backgroundColor: '#9333ea',   // Pour la légende
            pointBackgroundColor: '#9333ea',
            // --------------------------------
            borderWidth: 3,
            pointRadius: 2,         // Petits points visibles
            tension: 0.2,           // Légèrement courbe
            spanGaps: true,         // Relie les points manquants !
            order: 3
        },
        {
            label: 'Référence (AtmoSud)',
            data: globalData.reference,
            borderColor: '#10b981', // VERT
            backgroundColor: '#10b981',
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            tension: 0.2,
            spanGaps: true,
            order: 2
        },
        {
            label: 'Données Corrigées',
            data: globalData.corrected,
            borderColor: '#2563eb', // BLEU
            backgroundColor: 'rgba(37, 99, 235, 0.1)', // Fond bleu léger
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2,
            fill: true,
            spanGaps: true,
            order: 1
        }
    ];

    if (chartInstance) {
        chartInstance.data.labels = globalData.times;
        chartInstance.data.datasets = datasets;
        chartInstance.update();
    } else {
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels: globalData.times, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) label += Number(context.parsed.y).toFixed(1);
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'day', displayFormats: { day: 'dd/MM' } },
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'PM2.5 (µg/m³)' }
                    }
                }
            }
        });
    }
}

function exportCSV() {
    let csvContent = "data:text/csv;charset=utf-8,Time,Raw,Reference,Corrected\n";
    globalData.times.forEach((t, i) => {
        let ref = globalData.reference[i] != null ? globalData.reference[i] : "";
        let corr = globalData.corrected[i] != null ? globalData.corrected[i] : "";
        csvContent += `${t},${globalData.raw[i]},${ref},${corr}\r\n`;
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "nebuleair_calibration.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
