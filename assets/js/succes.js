// assets/js/succes.js

(function () {
  "use strict";

  // Même codes que ceux utilisés dans snake.js
  const ACHIEVEMENTS = [
    {
      code: "PERMA_TURBO",
      icon: "⚡",
      name: "PERMA-TURBO",
      description: "Rester en turbo pendant au moins la moitié de la partie.",
      condition: "Turbo actif ≥ 50% du temps de jeu, score ≥ 40."
    },
    {
      code: "GAMBLER",
      icon: "🎰",
      name: "GAMBLER",
      description: "Build full casino.",
      condition: "Prendre ≥ 1 Jackpot 💰 et ≥ 1 Double ✨, ne jamais prendre Minceur ✂️, score ≥ 50."
    },
    {
      code: "YOYO_BODY",
      icon: "✂️📏",
      name: "YOYO BODY",
      description: "Jouer avec ta propre masse.",
      condition: "Atteindre une longueur ≥ 25, puis redescendre à ≤ 8 cases dans la même run."
    },
    {
      code: "APPLE_RUSH",
      icon: "🍎🚀",
      name: "APPLE RUSH",
      description: "Sprint sous turbo.",
      condition: "Manger au moins 10 pommes pendant qu’un turbo ⚡ est actif."
    },
    {
      code: "STORM_RIDER",
      icon: "🍏🌪",
      name: "STORM RIDER",
      description: "Survivre à plusieurs pluies de pommes dorées.",
      condition: "Manger ≥ 3 pommes dorées 🍏, score ≥ 70 et longueur max ≥ 25."
    },
    {
      code: "FULL_HOUSE",
      icon: "🎁",
      name: "FULL HOUSE",
      description: "Utiliser tous les bonus dans la même run.",
      condition: "Prendre au moins 1 fois chaque bonus (⚡ ✨ 💰 ✂️) et manger ≥ 2 pommes dorées 🍏, score ≥ 80."
    },
    {
      code: "MARATHON_RUN",
      icon: "🏃‍♂️",
      name: "MARATHON RUN",
      description: "Tenir la distance.",
      condition: "Survivre ≥ 3 minutes dans une seule partie, avec un score ≥ 100."
    }
  ];

  const BONUSES = [
    {
      code: "turbo",
      icon: "⚡",
      name: "Turbo contrôlé",
      effect: "Accélère fortement le serpent pendant 5 s et ajoute +1 point par pomme.",
      rarity: "≈ 2% après chaque pomme mangée."
    },
    {
      code: "double",
      icon: "✨",
      name: "Double Score",
      effect: "Pendant 10 s, chaque pomme rapporte 2× plus de points.",
      rarity: "≈ 3%."
    },
    {
      code: "jackpot",
      icon: "💰",
      name: "Jackpot",
      effect: "Donne immédiatement +5 points.",
      rarity: "≈ 4%."
    },
    {
      code: "slim",
      icon: "✂️",
      name: "Minceur express",
      effect: "Retire plusieurs segments à la queue du serpent (sans descendre sous 3).",
      rarity: "≈ 5%."
    },
    {
      code: "golden",
      icon: "🍏",
      name: "Pomme dorée",
      effect: "Compte comme une pomme, puis fait apparaître 5 nouvelles pommes normales. Disparaît si tu es trop lent.",
      rarity: "≈ 1%."
    }
  ];

  function createCard(title, icon, subtitle, description) {
    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
      <div class="card-icon">${icon}</div>
      <div class="card-title">${title}</div>
      <div class="card-subtitle">${subtitle}</div>
      <div class="card-description">${description}</div>
    `;

    return div;
  }

  function renderAchievements() {
    const container = document.getElementById("achievements-list");
    if (!container) return;

    ACHIEVEMENTS.forEach(a => {
      const card = createCard(
        a.name,
        a.icon,
        a.description,
        a.condition
      );
      container.appendChild(card);
    });
  }

  function renderBonuses() {
    const container = document.getElementById("bonuses-list");
    if (!container) return;

    BONUSES.forEach(b => {
      const card = createCard(
        b.name,
        b.icon,
        b.effect,
        `Rareté : ${b.rarity}`
      );
      container.appendChild(card);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderAchievements();
    renderBonuses();
  });
})();
