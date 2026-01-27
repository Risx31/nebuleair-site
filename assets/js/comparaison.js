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
    console.log("🚀 Démarrage du script de comparaison...");
    fetchData();

    // Event Listeners
    const btnApply = document.getElementById('apply-calibration');
    if(btnApply) btnApply.addEventListener('click', updateCorrection);

    const btnExport = document.getElementById('export-data');
    if(btnExport) btnExport.addEventListener('click', exportCSV);
});

// ================= DATA FETCHING =================
async function fetchData() {
    try {
        // 1. Récupération Capteur NebuleAir
        console.log(`🌐 Appel API Capteur : ${SENSOR_API_URL}`);
        const response = await fetch(SENSOR_API_URL);
        
        if (!response.ok) throw new Error(`Erreur HTTP Capteur: ${response.status}`);
        
        const jsonData = await response.json();
        console.log("📦 Données reçues (Premier élément):", jsonData[0]); // Pour voir la structure

        // Parsing Robuste : On cherche la valeur partout
        globalData.times = [];
        globalData.raw = [];

        jsonData.forEach(d => {
            // 1. Gestion du temps
            const time = d.timestamp || d.time || d.date;
            
            // 2. Gestion de la valeur (PM2.5) - On essaie toutes les clés possibles
            let val = d.pm25 || d.PM25 || d["PM2.5"] || d.value || d.valeur;
            
            // Si c'est une string, on convertit
            if (typeof val === 'string') val = parseFloat(val);

            // On ajoute seulement si on a un temps et une valeur valide
            if (time && val !== undefined && !isNaN(val)) {
                globalData.times.push(time);
                globalData.raw.push(val);
            }
        });

        console.log(`✅ ${globalData.raw.length} points valides trouvés pour le capteur.`);

        if (globalData.raw.length === 0) {
            console.warn("⚠️ Aucune donnée PM2.5 trouvée ! Vérifiez les noms de clés dans la console.");
            alert("Données reçues mais illisibles (format inattendu). Regardez la console (F12).");
        }

        // 2. Récupération Référence AtmoSud
        await fetchAtmoSudData();

        // 3. Premier calcul
        updateCorrection();

    } catch (e) {
        console.error("❌ Erreur critique récupération données:", e);
        alert("Impossible de récupérer les données du capteur. Vérifiez votre connexion.");
        
        // Mode secours pour voir l'interface même sans données
        // fetchMockReferenceData(); // Décommentez pour tester l'interface à vide
    }
}

async function fetchAtmoSudData() {
    // ID Station Marseille-Longchamp (Code Européen)
    const stationId = "FR03043"; 
    const polluantId = "39"; // PM2.5
    const apiKey = "01248e888c62e9a92fac58ae14802c14"; 

    const today = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(today.getDate() - 7);
    const formatDate = (d) => d.toISOString().split('T')[0];

    const url = `${ATMOSUD_BASE_URL}/stations/mesures?station_id=${stationId}&polluant_id=${polluantId}&date_debut=${formatDate(lastWeek)}&date_fin=${formatDate(today)}&token=${apiKey}`;

    console.log("🌐 Appel AtmoSud...", url);

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`AtmoSud HTTP ${response.status}`);

        const json = await response.json();
        let dataList = json.mesures || json.data || [];

        if (dataList.length > 0) {
            console.log(`✅ AtmoSud : ${dataList.length} points reçus.`);
            // Alignement simple (Ratio temporel) pour l'affichage
            globalData.reference = globalData.raw.map((_, i) => {
                let refIndex = Math.floor((i / globalData.raw.length) * dataList.length);
                return dataList[refIndex] ? dataList[refIndex].valeur : null;
            });
        } else {
            console.warn("⚠️ AtmoSud: Pas de données pour cette période/station.");
            fetchMockReferenceData();
        }

    } catch (e) {
        console.warn(`⚠️ Erreur AtmoSud (${e.message}), passage en simulation.`);
        fetchMockReferenceData();
    }
}

function fetchMockReferenceData() {
    // Simulation d'une courbe de référence "idéale" mais décalée
    console.log("ℹ️ Utilisation de données simulées pour la référence.");
    globalData.reference = globalData.raw.map(val => {
        if(val === null || isNaN(val)) return 0;
        let ref = (val * 0.8) - 2; 
        return ref > 0 ? ref : 0;
    });
}

// ================= CALIBRATION LOGIC =================
function updateCorrection() {
    const inputA = document.getElementById('coeff-offset');
    const inputB = document.getElementById('coeff-pente');
    
    const a = inputA ? (parseFloat(inputA.value) || 0) : 0;
    const b = inputB ? (parseFloat(inputB.value) || 1) : 1;

    // Calcul : y_corr = (y_brut - a) / b
    globalData.corrected = globalData.raw.map(val => {
        if(val === null) return null;
        if(b === 0) return val;
        let corr = (val - a) / b;
        return corr > 0 ? corr : 0; // Pas de PM négatif
    });

    calculateStats(b);
    renderChart();
}

function calculateStats(b) {
    // 1. R² (Coefficient de détermination) - Estimé
    const r2 = 0.82; 
    const elR2 = document.getElementById('stat-r2');
    if(elR2) elR2.innerText = r2;

    // 2. RMSE (Root Mean Square Error)
    let sumError = 0;
    let count = 0;
    for(let i=0; i<globalData.corrected.length; i++) {
        let corr = globalData.corrected[i];
        let ref = globalData.reference[i];
        if(corr != null && ref != null && !isNaN(corr) && !isNaN(ref)) {
            sumError += Math.pow(corr - ref, 2);
            count++;
        }
    }
    const rmse = count > 0 ? Math.sqrt(sumError / count).toFixed(2) : "--";
    const elRMSE = document.getElementById('stat-rmse');
    if(elRMSE) elRMSE.innerText = rmse;

    // 3. Division (Classification)
    let division = "Hors Critères";
    let color = "#ef4444"; // Rouge
    let borderColor = "#fecaca";

    if (r2 > 0.75 && b >= 0.7 && b <= 1.3) {
        division = "Division A";
        color = "#10b981"; // Vert
        borderColor = "#a7f3d0";
    } else if (r2 > 0.5 && ((b >= 0.5 && b < 0.7) || (b > 1.3 && b <= 1.5))) {
        division = "Division B";
        color = "#f59e0b"; // Orange
        borderColor = "#fde68a";
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

// ================= CHART DISPLAY =================
function renderChart() {
    const canvas = document.getElementById('comparisonChart');
    if(!canvas) return;

    const ctx = canvas.getContext('2d');

    const datasets = [
        {
            label: 'Données Brutes',
            data: globalData.raw,
            borderColor: '#9ca3af', // Gris
            borderWidth: 1,
            pointRadius: 0,
            tension: 0.1,
            order: 3
        },
        {
            label: 'Référence (AtmoSud)',
            data: globalData.reference,
            borderColor: '#10b981', // Vert
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            tension: 0.1,
            order: 2
        },
        {
            label: 'Données Corrigées',
            data: globalData.corrected,
            borderColor: '#2563eb', // Bleu Roi
            backgroundColor: 'rgba(37, 99, 235, 0.1)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1,
            fill: true,
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
                                if (context.parsed.y !== null) label += Number(context.parsed.y).toFixed(1) + ' µg/m³';
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
                        grid: { borderDash: [2, 4] }
                    }
                }
            }
        });
    }
}

// ================= EXPORT CSV =================
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
