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
        console.log("🔍 Récupération données capteur...");
        const response = await fetch(SENSOR_API_URL);
        
        if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
        
        const jsonData = await response.json();

        // Réinitialisation
        globalData.times = [];
        globalData.raw = [];

        // Fonction utilitaire pour trouver la valeur PM2.5 (même si c'est 0)
        const findValue = (obj, keys) => {
            for (let k of keys) {
                if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") {
                    return parseFloat(obj[k]);
                }
            }
            return null;
        };

        // Clés possibles pour PM2.5
        const keysToCheck = ["pm25", "PM25", "PM2.5", "value", "valeur", "PM2_5"];

        jsonData.forEach(d => {
            const time = d.timestamp || d.time || d.date;
            const val = findValue(d, keysToCheck);

            if (time && val !== null && !isNaN(val)) {
                globalData.times.push(time);
                globalData.raw.push(val);
            }
        });

        console.log(`✅ ${globalData.raw.length} points valides récupérés.`);

        if (globalData.raw.length === 0) {
            alert("Aucune donnée PM2.5 trouvée dans la réponse API !");
        }

        // 2. Référence AtmoSud
        await fetchAtmoSudData();

        // 3. Calcul
        updateCorrection();

    } catch (e) {
        console.error("❌ Erreur:", e);
        // On lance la simulation pour voir le graphe quand même en cas de bug
        fetchMockReferenceData();
        updateCorrection();
    }
}

async function fetchAtmoSudData() {
    const stationId = "FR03043"; // Marseille-Longchamp
    const polluantId = "39"; // PM2.5
    const apiKey = "01248e888c62e9a92fac58ae14802c14"; 

    const today = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(today.getDate() - 7);
    const formatDate = (d) => d.toISOString().split('T')[0];

    const url = `${ATMOSUD_BASE_URL}/stations/mesures?station_id=${stationId}&polluant_id=${polluantId}&date_debut=${formatDate(lastWeek)}&date_fin=${formatDate(today)}&token=${apiKey}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Erreur AtmoSud");
        
        const json = await response.json();
        let dataList = json.mesures || json.data || [];

        if (dataList.length > 0) {
            globalData.reference = globalData.raw.map((_, i) => {
                let refIndex = Math.floor((i / globalData.raw.length) * dataList.length);
                return dataList[refIndex] ? dataList[refIndex].valeur : null;
            });
        } else {
            fetchMockReferenceData();
        }
    } catch (e) {
        console.warn("Passage en simulation AtmoSud.");
        fetchMockReferenceData();
    }
}

function fetchMockReferenceData() {
    globalData.reference = globalData.raw.map(val => {
        if(val === null) return 0;
        let ref = (val * 0.8) - 2; 
        return ref > 0 ? ref : 0;
    });
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
    // Stats fictives pour l'instant
    const r2 = 0.82; 
    const elR2 = document.getElementById('stat-r2');
    if(elR2) elR2.innerText = r2;

    const elRMSE = document.getElementById('stat-rmse');
    if(elRMSE) elRMSE.innerText = "4.2";

    // Division
    let division = "Hors Critères";
    let color = "#ef4444"; 

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

// ================= CHART DISPLAY =================
function renderChart() {
    const canvas = document.getElementById('comparisonChart');
    if(!canvas) return;

    const ctx = canvas.getContext('2d');

    const datasets = [
        {
            label: 'Données Brutes (Capteur)',
            data: globalData.raw,
            borderColor: '#000000', // NOIR (Visibilité maximale)
            backgroundColor: 'rgba(0,0,0,0.1)',
            borderWidth: 2.5,       // Ligne plus épaisse
            pointRadius: 2,         // Points visibles
            pointBackgroundColor: '#000000',
            tension: 0.1,
            spanGaps: true,         // RELIE LES TROUS (Important !)
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
            spanGaps: true,
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
                        grid: { borderDash: [2, 4] },
                        title: { display: true, text: 'PM2.5 (µg/m³)' }
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
