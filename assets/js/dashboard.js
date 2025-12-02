// assets/js/dashboard.js

document.addEventListener("DOMContentLoaded", function () {
  console.log("[NebuleAir] Dashboard JS chargé");

  const INFLUX_URL = "https://nebuleairproxy.onrender.com/query";
  const BUCKET = "Nodule Air";

  let currentRange = "1h";
  let customRange = null;

  let labelsRaw = [];
  let series = { pm1: [], pm25: [], pm10: [], temperature: [], humidite: [] };

  // ============================
  //  INIT CHART
  // ============================
  const canvas = document.getElementById("mainChart");
  if (!canvas) return console.error("Canvas introuvable");
  const ctx = canvas.getContext("2d");

  const mainChart = new Chart(ctx, {
    type: "line",
    data: { datasets: [
      { label: "PM1", borderColor: "#007bff", backgroundColor: "rgba(0,123,255,0.15)", data: [], fill: true, spanGaps: false },
      { label: "PM2.5", borderColor: "#ff9800", backgroundColor: "rgba(255,152,0,0.15)", data: [], fill: true, spanGaps: false },
      { label: "PM10", borderColor: "#e91e63", backgroundColor: "rgba(233,30,99,0.15)", data: [], fill: true, spanGaps: false },
      { label: "Température", borderColor: "#00c853", backgroundColor: "rgba(0,200,83,0.15)", data: [], fill: true, spanGaps: false },
      { label: "Humidité", borderColor: "#26c6da", backgroundColor: "rgba(38,198,218,0.15)", data: [], fill: true, spanGaps: false },
    ]},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", labels: { usePointStyle: true } },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            title: (items) => items.length ? new Date(items[0].parsed.x).toLocaleString("fr-FR",{hour:"2-digit",minute:"2-digit"}) : ""
          }
        }
      },
      scales: {
        x: { type: "time", time: { unit: "minute", displayFormats: { minute: "HH:mm" } } },
        y: { beginAtZero: true, title: { display: true, text: "Valeur" } }
      }
    }
  });

  // ============================
  //  PARSE CSV INFLUX
  // ============================
  function parseInfluxCsv(raw) {
    const lines = raw.split("\n").filter(l => l && !l.startsWith("#"));
    if (lines.length < 2) return { labels: [], values: [] };
    const header = lines[0].split(",");
    const timeIndex = header.indexOf("_time");
    const valIndex = header.indexOf("_value");
    const labels = [], values = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length <= Math.max(timeIndex, valIndex)) continue;
      const t = new Date(cols[timeIndex]);
      const v = parseFloat(cols[valIndex]);
      if (!isNaN(v)) { labels.push(t); values.push(v); }
    }
    return { labels, values };
  }

  // ============================
  //  FLUX QUERIES
  // ============================
  function buildRangeClause() {
    if (customRange) return `|> range(start: ${customRange.start}, stop: ${customRange.stop})`;
    const map = { "1h":"-1h","6h":"-6h","24h":"-24h","7j":"-7d","30j":"-30d" };
    return `|> range(start: ${map[currentRange]||"-1h"})`;
  }

  function getWindowEvery() {
    switch (currentRange) {
      case "1h": return "1m";
      case "6h": return "2m";
      case "24h": return "5m";
      case "7j": return "30m";
      case "30j": return "1h";
      default: return "1m";
    }
  }

  async function fetchField(field) {
    const flux = `from(bucket:"${BUCKET}") ${buildRangeClause()} |> filter(fn:(r)=>r._measurement=="nebuleair" and r._field=="${field}") |> aggregateWindow(every:${getWindowEvery()},fn:mean,createEmpty:false) |> yield()`;
    const res = await fetch(INFLUX_URL, { method:"POST", body: flux });
    const text = await res.text();
    return parseInfluxCsv(text);
  }

  // ============================
  //  DATASET GAPS
  // ============================
  function buildDatasetWithGaps(values) {
    if (!labelsRaw.length) return [];
    const deltas = [];
    for (let i=1;i<labelsRaw.length;i++) deltas.push(labelsRaw[i]-labelsRaw[i-1]);
    deltas.sort((a,b)=>a-b);
    const step = deltas[Math.floor(deltas.length/2)] || 60000;
    const threshold = step*3;
    const data = [];
    for (let i=0;i<labelsRaw.length;i++) {
      const t = labelsRaw[i];
      const v = values[i];
      if (i>0 && (t-labelsRaw[i-1])>threshold) {
        const mid = new Date(labelsRaw[i-1].getTime()+(t-labelsRaw[i-1])/2);
        data.push({x:mid,y:null});
      }
      data.push({x:t,y:!isNaN(v)?v:null});
    }
    return data;
  }

  // ============================
  //  UI + CHART UPDATE
  // ============================
  function updateCards() {
    function setVal(id, arr, d=1){ 
      const el=document.getElementById(id); 
      el.textContent = (!arr.length || isNaN(arr.at(-1)))?"--":arr.at(-1).toFixed(d);
    }
    setVal("pm1-value",series.pm1); setVal("pm25-value",series.pm25);
    setVal("pm10-value",series.pm10); setVal("temp-value",series.temperature);
    setVal("hum-value",series.humidite,0);
  }

  function updateChart() {
    mainChart.data.datasets[0].data = buildDatasetWithGaps(series.pm1);
    mainChart.data.datasets[1].data = buildDatasetWithGaps(series.pm25);
    mainChart.data.datasets[2].data = buildDatasetWithGaps(series.pm10);
    mainChart.data.datasets[3].data = buildDatasetWithGaps(series.temperature);
    mainChart.data.datasets[4].data = buildDatasetWithGaps(series.humidite);
    mainChart.update();
  }

  async function loadAllData() {
    try {
      const res = await Promise.all([
        fetchField("pm1"), fetchField("pm25"), fetchField("pm10"),
        fetchField("temperature"), fetchField("humidite")
      ]);
      labelsRaw = res[0].labels;
      series.pm1=res[0].values; series.pm25=res[1].values;
      series.pm10=res[2].values; series.temperature=res[3].values; series.humidite=res[4].values;
      updateCards(); updateChart();
    } catch(e){ console.error("Erreur Influx:", e); }
  }

  // ============================
  //  BOUTONS / ÉVÈNEMENTS
  // ============================
  document.querySelectorAll(".range-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".range-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active"); currentRange=btn.dataset.range; customRange=null; loadAllData();
    });
  });

  document.getElementById("apply-range").addEventListener("click",()=>{
    const start=document.getElementById("start-date").value;
    const end=document.getElementById("end-date").value;
    if(!start||!end) return alert("Choisis les dates");
    customRange={start:new Date(start).toISOString(), stop:new Date(end).toISOString()};
    loadAllData();
  });

  ["pm1","pm25","pm10","temp","hum"].forEach((id,i)=>{
    const cb=document.getElementById(`${id}-toggle`);
    if(cb) cb.addEventListener("change",()=>{
      mainChart.getDatasetMeta(i).hidden=!cb.checked; mainChart.update();
    });
  });

  document.getElementById("reset-zoom").addEventListener("click",()=>{customRange=null;currentRange="1h";loadAllData();});

  document.getElementById("export-csv").addEventListener("click",()=>{
    if(!labelsRaw.length) return alert("Pas de données");
    let csv="time,pm1,pm25,pm10,temperature,humidite\n";
    for(let i=0;i<labelsRaw.length;i++){
      csv+=`${labelsRaw[i].toISOString()},${series.pm1[i]||""},${series.pm25[i]||""},${series.pm10[i]||""},${series.temperature[i]||""},${series.humidite[i]||""}\n`;
    }
    const blob=new Blob([csv],{type:"text/csv"}); const a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download="nebuleair_export.csv"; a.click();
  });

  // ============================
  //  LEAFLET MAP
  // ============================
  (function initMap(){
    const lat=43.305440952514594, lon=5.3948736958397765;
    const el=document.getElementById("map"); if(!el) return;
    const map=L.map("map").setView([lat,lon],18);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(map);
    L.marker([lat,lon]).addTo(map).bindPopup("<b>NebuleAir – Capteur extérieur</b>");
  })();

  // ============================
  //  INIT
  // ============================
  loadAllData();
  setInterval(loadAllData, 60000);
});
