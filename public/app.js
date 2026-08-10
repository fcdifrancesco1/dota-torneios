/* ---------- utilidades ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const CDN = "https://cdn.cloudflare.steamstatic.com";

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function odFetch(path) {
  const res = await fetch(`/api/opendota?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`OpenDota ${path}: ${res.status}`);
  return res.json();
}
async function liveFetch(leagueId) {
  const res = await fetch(`/api/live${leagueId ? `?league_id=${leagueId}` : ""}`);
  if (!res.ok) throw new Error(`Live: ${res.status}`);
  return res.json();
}

/* ---------- tema ---------- */
(function initTheme() {
  const saved = localStorage.getItem("dota:theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  else document.documentElement.setAttribute("data-theme", "dark"); // default escuro
  $("#theme-toggle").textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "☀️" : "🌙";
})();
$("#theme-toggle").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("dota:theme", next);
  $("#theme-toggle").textContent = next === "dark" ? "☀️" : "🌙";
});

/* ---------- constantes (heróis/itens), cache 24h ---------- */
let HEROES = {};
let ITEMS = {};
let ITEMS_BY_ID = {};

async function loadConstants() {
  const cached = lsGet("dota:constants:v2", null);
  const now = Date.now();
  if (cached && now - cached.ts < 24 * 3600 * 1000) {
    HEROES = cached.heroes;
    ITEMS = cached.items;
    ITEMS_BY_ID = cached.itemsById;
    return;
  }
  const [heroes, items] = await Promise.all([
    odFetch("constants/heroes"),
    odFetch("constants/items"),
  ]);
  HEROES = heroes;
  ITEMS = items;
  // a OpenDota indexa itens pelo nome interno (ex: "blink"), mas a partida
  // traz o id numérico do item — então montamos o mapa reverso id -> item.
  ITEMS_BY_ID = {};
  Object.values(items).forEach((it) => {
    if (it && it.id != null) ITEMS_BY_ID[it.id] = it;
  });
  lsSet("dota:constants:v2", { ts: now, heroes, items, itemsById: ITEMS_BY_ID });
}

function heroImg(heroId) {
  const h = HEROES[heroId];
  return h ? `${CDN}${h.img}` : "";
}
function heroName(heroId) {
  const h = HEROES[heroId];
  return h ? h.localized_name : "?";
}
function itemImg(itemId) {
  const it = ITEMS_BY_ID[itemId];
  return it ? `${CDN}${it.img}` : "";
}

/* ---------- estado ---------- */
let currentLeague = lsGet("dota:selectedLeague", null);
let liveTimer = null;

/* ---------- navegação entre telas ---------- */
function showView(id) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(`#${id}`).classList.remove("hidden");
}

/* ---------- BUSCA DE TORNEIO ---------- */
let allLeagues = null;

async function ensureLeaguesLoaded() {
  if (allLeagues) return allLeagues;
  const cached = lsGet("dota:leaguesCache", null);
  if (cached && Date.now() - cached.ts < 3600 * 1000) {
    allLeagues = cached.data;
    return allLeagues;
  }
  const data = await odFetch("leagues");
  allLeagues = data;
  lsSet("dota:leaguesCache", { ts: Date.now(), data });
  return allLeagues;
}

function renderRecent() {
  const recent = lsGet("dota:recentLeagues", []);
  const box = $("#league-recent");
  if (!recent.length) { box.innerHTML = ""; return; }
  box.innerHTML = "Recentes: " + recent
    .map((l, i) => `<button data-recent="${i}">${l.name}</button>`)
    .join("");
  box.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => selectLeague(recent[+btn.dataset.recent]));
  });
}

function renderLeagueResults(list) {
  const ul = $("#league-results");
  if (!list.length) {
    ul.innerHTML = `<div class="empty-state">Nenhum torneio encontrado. Tente outro termo.</div>`;
    return;
  }
  ul.innerHTML = list
    .slice(0, 40)
    .map(
      (l) => `<li data-id="${l.leagueid}">
        <span>${l.name}</span>
        <span class="league-tier">${(l.tier || "?").toUpperCase()}</span>
      </li>`
    )
    .join("");
  ul.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => {
      const league = list.find((l) => String(l.leagueid) === li.dataset.id);
      selectLeague(league);
    });
  });
}

let searchDebounce = null;
$("#league-search").addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim().toLowerCase();
  searchDebounce = setTimeout(async () => {
    if (q.length < 2) { $("#league-results").innerHTML = ""; return; }
    try {
      const leagues = await ensureLeaguesLoaded();
      const filtered = leagues.filter((l) => l.name && l.name.toLowerCase().includes(q));
      renderLeagueResults(filtered);
    } catch (err) {
      toast("Erro ao buscar torneios. Tente de novo.");
    }
  }, 300);
});

function selectLeague(league) {
  if (!league) return;
  currentLeague = { leagueid: league.leagueid, name: league.name };
  lsSet("dota:selectedLeague", currentLeague);

  const recent = lsGet("dota:recentLeagues", []).filter((l) => l.leagueid !== currentLeague.leagueid);
  recent.unshift(currentLeague);
  lsSet("dota:recentLeagues", recent.slice(0, 5));

  $("#league-title").textContent = currentLeague.name;
  showView("view-dashboard");
  switchTab("live");
}

$("#btn-change-league").addEventListener("click", () => {
  stopLivePolling();
  currentLeague = null;
  localStorage.removeItem("dota:selectedLeague");
  $("#league-title").textContent = "Torneios Dota 2";
  renderRecent();
  showView("view-search");
});

/* ---------- ABAS ---------- */
function switchTab(tab) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
  $(`#tab-${tab}`).classList.remove("hidden");

  if (tab === "live") { loadLive(); startLivePolling(); }
  else stopLivePolling();

  if (tab === "results") loadResults();
  if (tab === "standings") loadStandings();
}
$$(".tab-btn").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

/* ---------- AO VIVO ---------- */
function startLivePolling() {
  stopLivePolling();
  liveTimer = setInterval(loadLive, 30000);
}
function stopLivePolling() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = null;
}

async function loadLive() {
  const box = $("#live-list");
  if (!currentLeague) return;
  try {
    const data = await liveFetch(currentLeague.leagueid);
    const games = (data && data.result && data.result.games) || [];
    if (!games.length) {
      box.innerHTML = `<div class="empty-state">Nenhuma partida ao vivo agora neste torneio.</div>`;
      return;
    }
    box.innerHTML = games.map(renderLiveCard).join("");
  } catch {
    box.innerHTML = `<div class="empty-state">Não foi possível carregar partidas ao vivo.</div>`;
  }
}

function renderLiveCard(g) {
  const sb = g.scoreboard;
  const radiantName = (g.radiant_team && g.radiant_team.team_name) || "Radiant";
  const direName = (g.dire_team && g.dire_team.team_name) || "Dire";
  const rScore = sb && sb.radiant ? sb.radiant.score : 0;
  const dScore = sb && sb.dire ? sb.dire.score : 0;
  const minutes = sb ? Math.floor(sb.duration / 60) : 0;
  return `
    <div class="match-card">
      <span class="live-badge">● Ao vivo · ${minutes}min</span>
      <div class="match-teams" style="margin-top:8px">
        <span class="team-name">${radiantName}</span>
        <span class="score">${rScore} - ${dScore}</span>
        <span class="team-name" style="text-align:right">${direName}</span>
      </div>
    </div>`;
}

/* ---------- nomes de time (fallback quando a API de partidas não traz) ---------- */
async function enrichTeamNames(matches) {
  const cache = lsGet("dota:teamNames", {});
  const missing = new Set();
  matches.forEach((m) => {
    if (!m.radiant_name && m.radiant_team_id && !cache[m.radiant_team_id]) missing.add(m.radiant_team_id);
    if (!m.dire_name && m.dire_team_id && !cache[m.dire_team_id]) missing.add(m.dire_team_id);
  });
  if (missing.size) {
    await Promise.all(
      [...missing].map(async (id) => {
        try {
          const t = await odFetch(`teams/${id}`);
          cache[id] = (t && (t.name || t.tag)) || `Time ${id}`;
        } catch {
          cache[id] = `Time ${id}`;
        }
      })
    );
    lsSet("dota:teamNames", cache);
  }
  matches.forEach((m) => {
    if (!m.radiant_name && m.radiant_team_id) m.radiant_name = cache[m.radiant_team_id];
    if (!m.dire_name && m.dire_team_id) m.dire_name = cache[m.dire_team_id];
  });
  return matches;
}

/* ---------- RESULTADOS ---------- */
let cachedMatches = null;

async function loadResults() {
  const box = $("#results-list");
  box.innerHTML = `<div class="empty-state">Carregando...</div>`;
  try {
    let matches = await odFetch(`leagues/${currentLeague.leagueid}/matches`);
    matches = await enrichTeamNames(matches);
    cachedMatches = matches.sort((a, b) => b.start_time - a.start_time);
    if (!cachedMatches.length) {
      box.innerHTML = `<div class="empty-state">Nenhuma partida finalizada encontrada ainda para este torneio.</div>`;
      return;
    }
    box.innerHTML = cachedMatches.map(renderResultCard).join("");
    box.querySelectorAll("[data-match]").forEach((el) => {
      el.addEventListener("click", () => openMatch(el.dataset.match));
    });
  } catch {
    box.innerHTML = `<div class="empty-state">Erro ao carregar resultados.</div>`;
  }
}

function renderResultCard(m) {
  const rWin = m.radiant_win;
  const rName = m.radiant_name || "Radiant";
  const dName = m.dire_name || "Dire";
  const date = new Date(m.start_time * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `
    <div class="match-card" data-match="${m.match_id}">
      <div class="match-teams">
        <span class="team-name ${rWin ? "winner" : ""}">${rName}</span>
        <span class="score">${m.radiant_score ?? "-"} - ${m.dire_score ?? "-"}</span>
        <span class="team-name ${!rWin ? "winner" : ""}" style="text-align:right">${dName}</span>
      </div>
      <div class="match-meta"><span>${date}</span><span>${Math.round(m.duration / 60)} min</span></div>
    </div>`;
}

/* ---------- CLASSIFICAÇÃO (calculada a partir dos resultados) ---------- */
async function loadStandings() {
  const body = $("#standings-body");
  body.innerHTML = `<tr><td colspan="4" class="empty-state">Carregando...</td></tr>`;
  try {
    if (!cachedMatches) {
      let matches = await odFetch(`leagues/${currentLeague.leagueid}/matches`);
      cachedMatches = await enrichTeamNames(matches);
    }
    const table = {};
    cachedMatches.forEach((m) => {
      const rId = m.radiant_team_id, dId = m.dire_team_id;
      if (rId == null || dId == null) return;
      table[rId] = table[rId] || { name: m.radiant_name || `Time ${rId}`, w: 0, l: 0 };
      table[dId] = table[dId] || { name: m.dire_name || `Time ${dId}`, w: 0, l: 0 };
      if (m.radiant_win) { table[rId].w++; table[dId].l++; }
      else { table[dId].w++; table[rId].l++; }
    });
    const rows = Object.values(table).sort((a, b) => b.w - a.w || a.l - b.l);
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="4" class="empty-state">Sem dados suficientes ainda para calcular classificação.</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map((r, i) => `<tr><td>${i + 1}</td><td>${r.name}</td><td class="numeric">${r.w}</td><td class="numeric">${r.l}</td></tr>`)
      .join("");
  } catch {
    body.innerHTML = `<tr><td colspan="4" class="empty-state">Erro ao calcular classificação.</td></tr>`;
  }
}

/* ---------- nome oficial de pro player (fallback: nick da Steam) ---------- */
async function enrichPlayerNames(players) {
  const cache = lsGet("dota:playerNames", {});
  const missing = players
    .map((p) => p.account_id)
    .filter((id) => id != null && !(id in cache));

  if (missing.length) {
    await Promise.all(
      missing.map(async (id) => {
        try {
          const data = await odFetch(`players/${id}`);
          const proName = data && data.profile && data.profile.name;
          cache[id] = proName || null; // null = não é pro cadastrado, usa personaname
        } catch {
          cache[id] = null;
        }
      })
    );
    lsSet("dota:playerNames", cache);
  }

  players.forEach((p) => {
    const official = p.account_id != null ? cache[p.account_id] : null;
    p.display_name = official || p.personaname || "—";
  });
  return players;
}

/* ---------- DETALHE DA PARTIDA ---------- */
async function openMatch(matchId) {
  showView("view-match");
  $("#match-detail").innerHTML = `<div class="empty-state">Carregando partida...</div>`;
  try {
    const m = await odFetch(`matches/${matchId}`);
    await enrichTeamNames([m]);
    await enrichPlayerNames(m.players || []);
    $("#match-detail").innerHTML = renderMatchDetail(m);
  } catch {
    $("#match-detail").innerHTML = `<div class="empty-state">Erro ao carregar detalhe da partida.</div>`;
  }
}
$("#btn-back-match").addEventListener("click", () => showView("view-dashboard"));

function renderMatchDetail(m) {
  const rName = m.radiant_name || "Radiant";
  const dName = m.dire_name || "Dire";
  const pb = m.picks_bans || [];
  const picksBansBlock = (team, isPick) => {
    const items = pb.filter((p) => p.team === team && p.is_pick === isPick);
    if (!items.length) return "";
    return items
      .map((p) => `<div class="hero-chip ${isPick ? "" : "banned"}"><img src="${heroImg(p.hero_id)}" alt="${heroName(p.hero_id)}" title="${heroName(p.hero_id)}"></div>`)
      .join("");
  };

  const playersRadiant = (m.players || []).filter((p) => p.player_slot < 128);
  const playersDire = (m.players || []).filter((p) => p.player_slot >= 128);

  const playerRow = (p) => {
    const items = [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5]
      .map((it) => (it ? `<img src="${itemImg(it)}" alt="">` : `<img src="" alt="" style="opacity:0">`))
      .join("");
    return `<tr>
      <td><div class="player-hero"><img src="${heroImg(p.hero_id)}" alt="">${p.display_name || p.personaname || "—"}</div></td>
      <td class="numeric">${p.kills}/${p.deaths}/${p.assists}</td>
      <td class="numeric">${p.gold_per_min}</td>
      <td class="numeric">${p.xp_per_min}</td>
      <td><div class="items-row">${items}</div></td>
    </tr>`;
  };

  return `
    <div class="match-header">
      <div>${rName} <span class="score">${m.radiant_score} - ${m.dire_score}</span> ${dName}</div>
      <div class="match-meta" style="justify-content:center;gap:16px">
        <span>${Math.round(m.duration / 60)} min</span>
        <span>${m.radiant_win ? rName : dName} venceu</span>
      </div>
    </div>

    <div class="team-block-title">Picks &amp; bans — ${rName}</div>
    <div class="picks-row">${picksBansBlock(0, true)}${picksBansBlock(0, false)}</div>
    <div class="team-block-title">Picks &amp; bans — ${dName}</div>
    <div class="picks-row">${picksBansBlock(1, true)}${picksBansBlock(1, false)}</div>

    <div class="team-block-title">${rName}</div>
    <table class="player-table">
      <thead><tr><th>Jogador</th><th>KDA</th><th>GPM</th><th>XPM</th><th>Itens</th></tr></thead>
      <tbody>${playersRadiant.map(playerRow).join("")}</tbody>
    </table>

    <div class="team-block-title">${dName}</div>
    <table class="player-table">
      <thead><tr><th>Jogador</th><th>KDA</th><th>GPM</th><th>XPM</th><th>Itens</th></tr></thead>
      <tbody>${playersDire.map(playerRow).join("")}</tbody>
    </table>
  `;
}

/* ---------- boot ---------- */
(async function boot() {
  await loadConstants().catch(() => {});
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  if (currentLeague) {
    $("#league-title").textContent = currentLeague.name;
    showView("view-dashboard");
    switchTab("live");
  } else {
    renderRecent();
    showView("view-search");
  }
})();
