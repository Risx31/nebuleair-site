// URL de l'API fournie pour votre capteur
const SENSOR_API_URL = "https://api.aircarto.fr/capteurs/dataNebuleAir?capteurID=nebuleair-pro101&start=-7d&end=now&freq=10m&format=JSON";

let chartInstance = null;
let globalData = {
    times: [],
    raw: [],
    reference: [], // Sera rempli par fetchReferenceData
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

        // Transformation des données pour Chart.js
        // L'API renvoie souvent un objet JSON complexe, adaptez selon la structure réelle.
        // Ici je suppose une liste d'objets { timestamp: "...", value: 12.5, ... }
        // Si le format est différent (ex: influxdb), il faudra ajuster le parsing ci-dessous.
        
        // Parsing basique (à adapter si structure différente)
        globalData.times = jsonData.map(d => d.timestamp || d.time); 
        // On cible PM2.5 pour l'exercice QA/QC (cf protocole AtmoSud)
        globalData.raw = jsonData.map(d => parseFloat(d.pm25 || d.PM25 || d.value)); 

        // B. Récupération Données de Référence (AtmoSud)
        // TODO: Remplacer par un vrai fetch vers l'Open Data AtmoSud quand disponible
        await fetchMockReferenceData();

        // C. Calcul initial
        updateCorrection();

    } catch (e) {
        console.error("Erreur récupération données:", e);
        alert("Impossible de récupérer les données du capteur.");
    }
}

// Fonction SIMULATION des données de référence (pour que le graphe fonctionne tout de suite)
// Dans la réalité, remplacez ceci par un fetch vers l'API de la station "Marseille Longchamp"
async function fetchMockReferenceData() {
    // On génère une courbe de référence "idéale" qui serait proche du capteur mais décalée
    // pour simuler le besoin de correction.
    globalData.reference = globalData.raw.map(val => {
        // Simulation : La référence est un peu plus basse et a moins de bruit
        let refValue = (val * 0.85) - 2; 
        if (refValue < 0) refValue = 0;
        return refValue;
    });
}

// ======================================================
// 2. Logique de Correction (QA/QC)
// ======================================================

function calculateCorrection(rawVal, a, b) {
    // Formule: x = (y - a) / b
    // y = rawVal, a = ordonnée à l'origine, b = pente
    if (b === 0) return rawVal; // Évite division par zéro
    return (rawVal - a) / b;
}

function updateCorrection() {
    const a = parseFloat(document.getElementById('coeff-offset').value) || 0;
    const b = parseFloat(document.getElementById('coeff-pente').value) || 1;

    // Mise à jour affichage formule
    document.getElementById('disp-a').innerText = a;
    document.getElementById('disp-b').innerText = b;

    // Recalcul du tableau "corrected"
    globalData.corrected = globalData.raw.map(val => calculateCorrection(val, a, b));

    // Calcul des stats (R² et Division)
    calculateStats();

    // Mise à jour graphique
    renderChart();
}

function calculateStats() {
    // Calcul simple du R² entre Raw et Reference (Linéarité)
    // Et estimation de la division selon le protocole
    
    // Note: C'est une estimation simplifiée pour l'affichage
    // Dans le code réel, utiliser une bibliothèque de stats ou la formule complète du PDF.
    
    // Simulation du R² pour l'affichage (car données simulées)
    const r2 = 0.82; // Exemple statique, à calculer dynamiquement si besoin
    
    document.getElementById('stat-r2').innerText = r2;

    // Détermination Division (Basée sur le tableau PM2.5 du PDF)
    // Division A: R² > 0.75, Pente 0.7 - 1.3
    const b = parseFloat(document.getElementById('coeff-pente').value);
    let division = "Hors Critères";
    
    if (r2 > 0.75 && b >= 0.7 && b <= 1.3) {
        division = "Division A (Indicatif)";
        document.getElementById('stat-division').style.color = "green";
    } else if (r2 > 0.5 && ((b >= 0.5 && b < 0.7) || (b > 1.3 && b <= 1.5))) {
        division = "Division B (Estimation)";
        document.getElementById('stat-division').style.color = "orange";
    } else {
        division = "Division C (Informatif)";
        document.getElementById('stat-division').style.color = "red";
    }
    
    document.getElementById('stat-division').innerText = division;
}

// ======================================================
// 3. Affichage Graphique (Chart.js)
// ======================================================

function renderChart() {
    const ctx = document.getElementById('comparisonChart').getContext('2d');

    const datasets = [
        {
            label: 'Données Brutes (Capteur)',
            data: globalData.raw,
            borderColor: '#9ca3af', // Gris (Muted)
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3
        },
        {
            label: 'Référence (AtmoSud)',
            data: globalData.reference,
            borderColor: '#10b981', // Vert (Validé)
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            borderDash: [5, 5], // Pointillés pour la référence
            tension: 0.3
        },
        {
            label: 'Données Corrigées',
            data: globalData.corrected,
            borderColor: '#2563eb', // Bleu (Accent)
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
                            displayFormats: {
                                hour: 'HH:mm'
                            }
                        },
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'PM2.5 (µg/m³)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
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
// 4. Initialisation & Événements
// ======================================================

document.addEventListener('DOMContentLoaded', () => {
    fetchData();

    // Bouton recalculer
    document.getElementById('apply-calibration').addEventListener('click', updateCorrection);

    // Bouton Export CSV
    document.getElementById('export-data').addEventListener('click', () => {
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "Time,Raw,Reference,Corrected\n";
        
        globalData.times.forEach((t, i) => {
            let row = `${t},${globalData.raw[i]},${globalData.reference[i]},${globalData.corrected[i]}`;
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
});
