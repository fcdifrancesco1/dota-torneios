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
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function lsSet(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

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
async function scheduleFetch(days = 21) {
  const res = await fetch(`/api/schedule?days=${days}`);
  if (!res.ok) throw new Error(`Schedule: ${res.status}`);
  return res.json();
}
async function stratzQuery(query, variables) {
  const res = await fetch("/api/stratz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    let msg = (json.errors && json.errors.map((e) => e.message).join("; ")) || json.error || `Stratz: ${res.status}`;
    if (json.stratzStatus != null || json.preview) {
      msg += ` (status STRATZ: ${json.stratzStatus} — prévia: ${json.preview || ""})`;
    }
    throw new Error(msg);
  }
  return json.data;
}

// nomes amigáveis pras posições — usados no ranking, no explorador de heróis, etc.
const POSITION_LABELS = {
  POSITION_1: "Posição 1 (Carry)",
  POSITION_2: "Posição 2 (Mid)",
  POSITION_3: "Posição 3 (Offlane)",
  POSITION_4: "Posição 4 (Suporte)",
  POSITION_5: "Posição 5 (Suporte duro)",
};
const REGION_TO_STRATZ_DIVISION = { americas: "AMERICAS", europe: "EUROPE", china: "CHINA", se_asia: "SE_ASIA" };


/* ---------- tema ---------- */
(function initTheme() {
  const saved = localStorage.getItem("dota:theme");
  document.documentElement.setAttribute("data-theme", saved || "dark");
  $("#theme-toggle").textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "☀️" : "🌙";
})();
$("#theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("dota:theme", next);
  $("#theme-toggle").textContent = next === "dark" ? "☀️" : "🌙";
});

/* ---------- constantes (heróis/itens), cache 24h ---------- */
let HEROES = {}, ITEMS = {}, ITEMS_BY_ID = {};
async function loadConstants() {
  const cached = lsGet("dota:constants:v2", null);
  const now = Date.now();
  if (cached && now - cached.ts < 24 * 3600 * 1000) {
    HEROES = cached.heroes; ITEMS = cached.items; ITEMS_BY_ID = cached.itemsById;
    return;
  }
  const [heroes, items] = await Promise.all([odFetch("constants/heroes"), odFetch("constants/items")]);
  HEROES = heroes; ITEMS = items;
  ITEMS_BY_ID = {};
  Object.values(items).forEach((it) => { if (it && it.id != null) ITEMS_BY_ID[it.id] = it; });
  lsSet("dota:constants:v2", { ts: now, heroes, items, itemsById: ITEMS_BY_ID });
}
function heroImg(heroId) { const h = HEROES[heroId]; return h ? `${CDN}${h.img}` : ""; }
function heroName(heroId) { const h = HEROES[heroId]; return h ? h.localized_name : "?"; }
function itemImg(itemId) { const it = ITEMS_BY_ID[itemId]; return it ? `${CDN}${it.img}` : ""; }

/* ---------- nomes de time / jogador (fallback) ---------- */
async function enrichTeamNames(matches) {
  const cache = lsGet("dota:teamNames", {});
  const missing = new Set();
  matches.forEach((m) => {
    if (!m.radiant_name && m.radiant_team_id && !cache[m.radiant_team_id]) missing.add(m.radiant_team_id);
    if (!m.dire_name && m.dire_team_id && !cache[m.dire_team_id]) missing.add(m.dire_team_id);
  });
  if (missing.size) {
    await Promise.all([...missing].map(async (id) => {
      try { const t = await odFetch(`teams/${id}`); cache[id] = (t && (t.name || t.tag)) || `Time ${id}`; }
      catch { cache[id] = `Time ${id}`; }
    }));
    lsSet("dota:teamNames", cache);
  }
  matches.forEach((m) => {
    if (!m.radiant_name && m.radiant_team_id) m.radiant_name = cache[m.radiant_team_id];
    if (!m.dire_name && m.dire_team_id) m.dire_name = cache[m.dire_team_id];
  });
  return matches;
}

/* ---------- logos dos times (cache) ---------- */
async function ensureTeamLogos(teamIds) {
  const cache = lsGet("dota:teamLogos", {});
  const ids = [...new Set(teamIds.filter((id) => id != null))];
  const missing = ids.filter((id) => !(id in cache));
  if (missing.length) {
    await Promise.all(missing.map(async (id) => {
      try { const t = await odFetch(`teams/${id}`); cache[id] = (t && t.logo_url) || null; }
      catch { cache[id] = null; }
    }));
    lsSet("dota:teamLogos", cache);
  }
  return cache;
}
function teamLogoImg(logoUrl, teamName) {
  if (!logoUrl) return `<span class="team-logo team-logo-empty"></span>`;
  return `<img class="team-logo" src="${logoUrl}" alt="${teamName || ""}">`;
}

/* ---------- agrupar cards de série por data ---------- */
function groupSeriesByDate(seriesList) {
  const groups = [];
  const byKey = {};
  seriesList.forEach((s) => {
    const d = new Date(s.startTime * 1000);
    const key = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
    if (!byKey[key]) { byKey[key] = { label: key, items: [] }; groups.push(byKey[key]); }
    byKey[key].items.push(s);
  });
  return groups;
}
async function renderSeriesGrouped(seriesList) {
  const teamIds = seriesList.flatMap((s) => [s.teamAId, s.teamBId]);
  await ensureTeamLogos(teamIds);
  const logos = lsGet("dota:teamLogos", {});
  const groups = groupSeriesByDate(seriesList);
  return groups.map((g) => `
    <div class="date-group">
      <div class="date-group-header">${g.label}</div>
      <div class="match-grid">${g.items.map((s, i) => renderSeriesCard(s, seriesList.indexOf(s), logos)).join("")}</div>
    </div>`).join("");
}
async function enrichPlayerNames(players) {
  const cache = lsGet("dota:playerNames", {});
  const missing = players.map((p) => p.account_id).filter((id) => id != null && !(id in cache));
  if (missing.length) {
    await Promise.all(missing.map(async (id) => {
      try { const data = await odFetch(`players/${id}`); cache[id] = (data && data.profile && data.profile.name) || null; }
      catch { cache[id] = null; }
    }));
    lsSet("dota:playerNames", cache);
  }
  players.forEach((p) => { p.display_name = (p.account_id != null && cache[p.account_id]) || p.personaname || "—"; });
  return players;
}

/* ---------- estado ---------- */
let currentLeague = null; // { leagueid, name } ou null = visão geral
let liveTimer = null;
let cachedMatches = null; // resultados do torneio selecionado

/* ---------- lista de torneios (busca) ---------- */
let allLeagues = null;
async function ensureLeaguesLoaded() {
  if (allLeagues) return allLeagues;
  const cached = lsGet("dota:leaguesCache", null);
  if (cached && Date.now() - cached.ts < 3600 * 1000) { allLeagues = cached.data; return allLeagues; }
  const data = await odFetch("leagues");
  allLeagues = data;
  lsSet("dota:leaguesCache", { ts: Date.now(), data });
  return allLeagues;
}
function leagueNameById(id) {
  const l = (allLeagues || []).find((x) => String(x.leagueid) === String(id));
  return l ? l.name : `Torneio #${id}`;
}
function isTopTierLeague(id) {
  const l = (allLeagues || []).find((x) => String(x.leagueid) === String(id));
  const tier = l && l.tier ? String(l.tier).toLowerCase() : "";
  return tier === "premium" || tier === "professional";
}

/* ---------- "Recentes": últimos torneios premium/profissionais realmente disputados ---------- */
// PROFESSIONAL da STRATZ é bem mais amplo/genérico que o "professional" da OpenDota — inclui
// torneios regionais pequenos com dados de time incompletos, então deixamos de fora aqui.
const STRATZ_TOP_TIERS = ["MINOR", "MAJOR", "INTERNATIONAL", "DPC_LEAGUE", "DPC_LEAGUE_FINALS"];

async function computeRecentlyPlayedLeagues() {
  const cached = lsGet("dota:recentlyPlayed:v4", null);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.data;
  try {
    const data = await stratzQuery(
      `query($tiers: [LeagueTier]) {
        leagues(request: { tiers: $tiers, leagueEnded: true, take: 25 }) { id displayName endDateTime }
      }`,
      { tiers: STRATZ_TOP_TIERS }
    );
    const list = (data && data.leagues) || [];
    if (!list.length) throw new Error("STRATZ sem torneios encerrados");
    const sorted = list.filter((l) => l.endDateTime).sort((a, b) => b.endDateTime - a.endDateTime).slice(0, 5);
    const out = sorted.map((l) => ({ leagueid: l.id, name: l.displayName }));
    lsSet("dota:recentlyPlayed:v4", { ts: Date.now(), data: out });
    return out;
  } catch {
    return computeRecentlyPlayedLeaguesFallback(); // STRATZ fora do ar/sem token — volta pro jeito antigo
  }
}
async function computeRecentlyPlayedLeaguesFallback() {
  try {
    const proMatches = await odFetch("proMatches");
    await ensureLeaguesLoaded().catch(() => {});
    const seen = new Set();
    const ordered = [];
    (proMatches || []).forEach((m) => {
      if (!seen.has(m.leagueid) && isTopTierLeague(m.leagueid)) { seen.add(m.leagueid); ordered.push(m.leagueid); }
    });
    return ordered.slice(0, 5).map((id) => ({ leagueid: id, name: leagueNameById(id) }));
  } catch { return []; }
}
async function renderRecent() {
  const box = $("#league-recent");
  box.innerHTML = `<span class="section-sub">Carregando recentes...</span>`;
  const recent = await computeRecentlyPlayedLeagues();
  if (!recent.length) { box.innerHTML = ""; return; }
  box.innerHTML = "Recentes: " + recent.map((l, i) => `<button data-recent="${i}">${l.name}</button>`).join("");
  box.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => selectLeague(recent[+btn.dataset.recent]));
  });
}
function renderLeagueResults(list) {
  const ul = $("#league-results");
  if (!list.length) { ul.innerHTML = `<div class="empty-state">Nenhum torneio encontrado.</div>`; ul.classList.add("open"); return; }
  ul.innerHTML = list.slice(0, 40).map((l) =>
    `<li data-id="${l.leagueid}"><span>${l.name}</span><span class="league-tier">${(l.tier || "?").toUpperCase()}</span></li>`
  ).join("");
  ul.classList.add("open");
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
  if (q.length < 2) { $("#league-results").innerHTML = ""; $("#league-results").classList.remove("open"); return; }
  searchDebounce = setTimeout(async () => {
    try {
      const leagues = await ensureLeaguesLoaded();
      renderLeagueResults(leagues.filter((l) => l.name && l.name.toLowerCase().includes(q)));
    } catch { toast("Erro ao buscar torneios."); }
  }, 300);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) { $("#league-results").classList.remove("open"); }
});

/* ---------- seleção de torneio ---------- */
function selectLeague(league) {
  if (!league) return;
  currentLeague = { leagueid: league.leagueid, name: league.name };
  cachedMatches = null;

  $("#league-search").value = "";
  $("#league-results").innerHTML = "";
  $("#league-results").classList.remove("open");

  $("#league-title").textContent = currentLeague.name;
  $("#center-default").classList.add("hidden");
  $("#center-league").classList.remove("hidden");
  switchTab("live");
  loadStandingsFor(currentLeague.leagueid, currentLeague.name, false);
}
$("#btn-change-league").addEventListener("click", () => {
  stopLivePolling();
  currentLeague = null;
  $("#center-league").classList.add("hidden");
  $("#center-default").classList.remove("hidden");
  loadCenterDefault();
  loadDefaultStandings();
});

/* ---------- abas (torneio selecionado) ---------- */
function switchTab(tab) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
  $(`#tab-${tab}`).classList.remove("hidden");
  if (tab === "live") { loadLive(); startLivePolling(); } else stopLivePolling();
  if (tab === "results") loadResults();
}
$$(".tab-btn").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

function startLivePolling() { stopLivePolling(); liveTimer = setInterval(loadLive, 30000); }
function stopLivePolling() { if (liveTimer) clearInterval(liveTimer); liveTimer = null; }

async function loadLive() {
  const box = $("#live-list");
  if (!currentLeague) return;
  try {
    const data = await liveFetch(currentLeague.leagueid);
    const games = (data && data.result && data.result.games) || [];
    if (!games.length) { box.innerHTML = `<div class="empty-state">Nenhuma partida ao vivo agora neste torneio.</div>`; return; }
    box.innerHTML = `<div class="match-grid">${games.map((g, i) => renderLiveCard(g, i)).join("")}</div>`;
    box.querySelectorAll("[data-live]").forEach((el) => el.addEventListener("click", () => openLiveGame(games[+el.dataset.live])));
  } catch { box.innerHTML = `<div class="empty-state">Não foi possível carregar partidas ao vivo.</div>`; }
}
function renderLiveCard(g, idx) {
  const sb = g.scoreboard;
  const radiantName = (g.radiant_team && g.radiant_team.team_name) || "Radiant";
  const direName = (g.dire_team && g.dire_team.team_name) || "Dire";
  const rScore = sb && sb.radiant ? sb.radiant.score : 0;
  const dScore = sb && sb.dire ? sb.dire.score : 0;
  const minutes = sb ? Math.floor(sb.duration / 60) : 0;
  return `<div class="match-card" data-live="${idx}">
      <span class="live-badge">● Ao vivo · ${minutes}min</span>
      <div class="match-teams" style="margin-top:8px">
        <span class="team-name">${radiantName}</span>
        <span class="score">${rScore} - ${dScore}</span>
        <span class="team-name" style="text-align:right">${direName}</span>
      </div>
    </div>`;
}

/* ---------- detalhe de partida ao vivo (formato diferente do resultado finalizado) ---------- */
function getSidePlayers(sb, side) {
  const s = sb && sb[side];
  if (!s) return [];
  return s.players || s.player || [];
}
async function openLiveGame(g) {
  $("#match-modal").classList.remove("hidden");
  $("#match-detail").innerHTML = `<div class="empty-state">Carregando...</div>`;
  try {
    const sb = g.scoreboard || {};
    const rPlayers = getSidePlayers(sb, "radiant");
    const dPlayers = getSidePlayers(sb, "dire");
    await enrichPlayerNames([...rPlayers, ...dPlayers]);
    $("#match-detail").innerHTML = renderLiveMatchDetail(g);
  } catch { $("#match-detail").innerHTML = `<div class="empty-state">Erro ao carregar a partida ao vivo.</div>`; }
}
function renderLiveMatchDetail(g) {
  const sb = g.scoreboard || {};
  const rName = (g.radiant_team && g.radiant_team.team_name) || "Radiant";
  const dName = (g.dire_team && g.dire_team.team_name) || "Dire";
  const minutes = Math.floor((sb.duration || 0) / 60);
  const picksBansBlock = (side, isPick) => {
    const arr = (sb[side] && sb[side][isPick ? "picks" : "bans"]) || [];
    if (!arr.length) return "";
    return arr.map((p, i) =>
      `<div class="hero-chip ${isPick ? "" : "banned"}">
        <img src="${heroImg(p.hero_id)}" alt="${heroName(p.hero_id)}" title="${heroName(p.hero_id)}">
        <span class="pick-order">${i + 1}</span>
      </div>`
    ).join("");
  };
  const playerRow = (p) => {
    const items = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5]
      .map((it) => (it ? `<img src="${itemImg(it)}" alt="">` : `<img src="" alt="" style="opacity:0">`)).join("");
    return `<tr>
      <td><div class="player-hero"><img src="${heroImg(p.hero_id)}" alt="">${(p.display_name && p.display_name !== "—") ? p.display_name : `Jogador ${p.account_id ?? "?"}`}</div></td>
      <td class="numeric">${p.kills ?? 0}/${p.death ?? 0}/${p.assists ?? 0}</td>
      <td class="numeric">${p.gold_per_min ?? "-"}</td>
      <td class="numeric">${p.xp_per_min ?? "-"}</td>
      <td><div class="items-row">${items}</div></td>
    </tr>`;
  };
  return `
    <div class="match-header">
      <div><span class="live-badge">● Ao vivo</span></div>
      <div>${rName} <span class="score">${(sb.radiant && sb.radiant.score) || 0} - ${(sb.dire && sb.dire.score) || 0}</span> ${dName}</div>
      <div class="match-meta" style="justify-content:center;gap:16px"><span>${minutes} min (em andamento)</span></div>
    </div>
    <div class="team-block-title">Picks &amp; bans — ${rName}</div>
    <div class="picks-row">${picksBansBlock("radiant", true)}${picksBansBlock("radiant", false)}</div>
    <div class="team-block-title">Picks &amp; bans — ${dName}</div>
    <div class="picks-row">${picksBansBlock("dire", true)}${picksBansBlock("dire", false)}</div>
    <div class="team-block-title">${rName}</div>
    <table class="player-table">
      <thead><tr><th>Jogador</th><th>KDA</th><th>GPM</th><th>XPM</th><th>Itens</th></tr></thead>
      <tbody>${getSidePlayers(sb, "radiant").map(playerRow).join("")}</tbody>
    </table>
    <div class="team-block-title">${dName}</div>
    <table class="player-table">
      <thead><tr><th>Jogador</th><th>KDA</th><th>GPM</th><th>XPM</th><th>Itens</th></tr></thead>
      <tbody>${getSidePlayers(sb, "dire").map(playerRow).join("")}</tbody>
    </table>
  `;
}

/* ---------- agrupamento de partidas em séries (bo1/bo3/bo5) ---------- */
function seriesWinsNeeded(seriesType) {
  if (seriesType === 2) return 3; // bo5
  if (seriesType === 1) return 2; // bo3
  return 1; // bo1 / desconhecido
}
function groupIntoSeries(matches) {
  const groups = {};
  matches.forEach((m) => {
    const key = m.series_id ? `s-${m.series_id}` : `single-${m.match_id}`;
    (groups[key] = groups[key] || []).push(m);
  });
  return Object.values(groups).map((games) => {
    games.sort((a, b) => a.start_time - b.start_time);
    const first = games[0];
    const teamAId = first.radiant_team_id, teamBId = first.dire_team_id;
    const wins = {};
    games.forEach((g) => {
      const winnerId = g.radiant_win ? g.radiant_team_id : g.dire_team_id;
      wins[winnerId] = (wins[winnerId] || 0) + 1;
    });
    const scoreA = wins[teamAId] || 0, scoreB = wins[teamBId] || 0;
    const seriesType = first.series_type || 0;
    const needed = seriesWinsNeeded(seriesType);
    const decided = Math.max(scoreA, scoreB) >= needed;
    return {
      games, teamAId, teamBId,
      teamAName: first.radiant_name || `Time ${teamAId}`,
      teamBName: first.dire_name || `Time ${teamBId}`,
      scoreA, scoreB, decided,
      startTime: games[games.length - 1].start_time,
    };
  });
}

async function loadResults() {
  const box = $("#results-list");
  box.innerHTML = `<div class="empty-state">Carregando...</div>`;
  try {
    if (!cachedMatches) {
      let matches = await odFetch(`leagues/${currentLeague.leagueid}/matches`);
      cachedMatches = await enrichTeamNames(matches);
      cachedMatches.sort((a, b) => b.start_time - a.start_time);
    }
    if (!cachedMatches.length) { box.innerHTML = `<div class="empty-state">Nenhuma partida finalizada ainda.</div>`; return; }
    let series;
    try {
      series = attachOpenDotaGames(await fetchStratzSeriesForLeague(currentLeague.leagueid), cachedMatches);
    } catch {
      series = groupIntoSeries(cachedMatches); // fallback: nosso agrupamento por conectividade
    }
    series.sort((a, b) => b.startTime - a.startTime);
    box.innerHTML = await renderSeriesGrouped(series);
    attachSeriesClicks(box, series);
  } catch { box.innerHTML = `<div class="empty-state">Erro ao carregar resultados.</div>`; }
}
function renderSeriesCard(s, idx, logos) {
  const aWon = s.decided && s.scoreA > s.scoreB;
  const bWon = s.decided && s.scoreB > s.scoreA;
  const logoA = logos ? logos[s.teamAId] : null;
  const logoB = logos ? logos[s.teamBId] : null;
  return `<div class="match-card" data-series="${idx}">
      <div class="match-teams">
        <div class="team-side">
          ${teamLogoImg(logoA, s.teamAName)}
          <span class="team-name ${aWon ? "winner" : ""}">${s.teamAName}</span>
        </div>
        <span class="score">${s.scoreA} - ${s.scoreB}</span>
        <div class="team-side team-side-right">
          <span class="team-name ${bWon ? "winner" : ""}">${s.teamBName}</span>
          ${teamLogoImg(logoB, s.teamBName)}
        </div>
      </div>
      <div class="match-meta"><span>${s.games.length} jogo${s.games.length > 1 ? "s" : ""}${s.decided ? "" : " · em andamento"}</span></div>
    </div>`;
}
function attachSeriesClicks(container, seriesList) {
  container.querySelectorAll("[data-series]").forEach((el) => {
    el.addEventListener("click", () => openSeries(seriesList[+el.dataset.series]));
  });
}

/* ---------- séries de um torneio via STRATZ (com fallback pro agrupamento antigo) ---------- */
async function fetchStratzSeriesForLeague(leagueId) {
  const data = await stratzQuery(
    `query($id: Int!) {
      league(id: $id) {
        series {
          id teamOneWinCount teamTwoWinCount winningTeamId lastMatchDateTime
          teamOne { id name logo }
          teamTwo { id name logo }
          matches { id }
        }
      }
    }`,
    { id: Number(leagueId) }
  );
  const raw = (data && data.league && data.league.series) || [];
  if (!raw.length) throw new Error("STRATZ ainda não tem séries pra esse torneio");
  const logos = lsGet("dota:teamLogos", {});
  const series = raw.map((s) => {
    if (s.teamOne && s.teamOne.logo) logos[s.teamOne.id] = s.teamOne.logo;
    if (s.teamTwo && s.teamTwo.logo) logos[s.teamTwo.id] = s.teamTwo.logo;
    return {
      id: s.id,
      teamAId: s.teamOne && s.teamOne.id,
      teamBId: s.teamTwo && s.teamTwo.id,
      teamAName: (s.teamOne && s.teamOne.name) || `Time ${s.teamOne && s.teamOne.id}`,
      teamBName: (s.teamTwo && s.teamTwo.name) || `Time ${s.teamTwo && s.teamTwo.id}`,
      scoreA: s.teamOneWinCount || 0,
      scoreB: s.teamTwoWinCount || 0,
      decided: s.winningTeamId != null,
      startTime: s.lastMatchDateTime || 0,
      gameIds: (s.matches || []).map((m) => String(m.id)),
      games: [], // preenchido sob demanda com attachOpenDotaGames()
    };
  });
  lsSet("dota:teamLogos", logos);
  return series;
}
function attachOpenDotaGames(series, openDotaMatches) {
  const byId = {};
  (openDotaMatches || []).forEach((m) => (byId[String(m.match_id)] = m));
  series.forEach((s) => {
    s.games = (s.gameIds || []).map((id) => byId[id]).filter(Boolean).sort((a, b) => a.start_time - b.start_time);
  });
  return series;
}

/* ---------- classificação (coluna direita): com grupos inferidos + cores ---------- */
function computeStandingsFromSeries(series) {
  const table = {};
  const ensure = (id, name) => (table[id] = table[id] || { id: String(id), name, seriesW: 0, seriesL: 0, mapsW: 0, mapsL: 0 });
  series.forEach((s) => {
    if (s.teamAId == null || s.teamBId == null) return;
    const A = ensure(s.teamAId, s.teamAName), B = ensure(s.teamBId, s.teamBName);
    A.mapsW += s.scoreA; A.mapsL += s.scoreB;
    B.mapsW += s.scoreB; B.mapsL += s.scoreA;
    if (s.decided) {
      if (s.scoreA > s.scoreB) { A.seriesW++; B.seriesL++; } else { B.seriesW++; A.seriesL++; }
    }
  });
  return Object.values(table).sort((a, b) =>
    b.seriesW - a.seriesW || (b.mapsW - b.mapsL) - (a.mapsW - a.mapsL) || b.mapsW - a.mapsW
  );
}

// times que nunca se enfrentaram não podem estar no mesmo grupo/chave —
// usamos isso pra separar grupos automaticamente enquanto eles não se cruzam nos playoffs
// (fallback pra quando o STRATZ não tem a chave/grupo oficial cadastrada — nem sempre tem).
function computeGroupClustersFromSeries(series) {
  const parent = {};
  const find = (x) => { if (parent[x] === undefined) parent[x] = x; return parent[x] === x ? x : (parent[x] = find(parent[x])); };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  series.forEach((s) => {
    if (s.teamAId == null || s.teamBId == null) return;
    const a = String(s.teamAId), b = String(s.teamBId);
    find(a); find(b); union(a, b);
  });
  const clusters = {};
  Object.keys(parent).forEach((id) => { const root = find(id); (clusters[root] = clusters[root] || []).push(id); });
  return Object.values(clusters);
}

function renderStandingsTable(series) {
  const body = $("#standings-body");
  const clusters = computeGroupClustersFromSeries(series);
  const allRows = computeStandingsFromSeries(series);
  const byId = {}; allRows.forEach((r) => (byId[r.id] = r));

  // só vale a pena separar em grupos visuais se houver mais de 1 cluster com 2+ times
  const realGroups = clusters.filter((c) => c.length > 1);
  const useGroups = realGroups.length > 1;

  const renderGroup = (rows, label) => {
    const rowsHtml = rows.map((r, i) =>
      `<tr><td>${i + 1}</td><td>${r.name}</td><td class="numeric">${r.seriesW}-${r.seriesL}</td><td class="numeric">${r.mapsW}-${r.mapsL}</td></tr>`
    ).join("");
    return (label ? `<tr class="group-label-row"><td colspan="4">${label}</td></tr>` : "") + rowsHtml;
  };

  if (!allRows.length) { body.innerHTML = `<tr><td colspan="4" class="empty-state">Sem dados suficientes.</td></tr>`; return; }

  if (useGroups) {
    const letters = "ABCDEFGH";
    let html = "";
    realGroups
      .map((ids) => ids.map((id) => byId[id]).filter(Boolean).sort((a, b) => b.seriesW - a.seriesW || (b.mapsW - b.mapsL) - (a.mapsW - a.mapsL)))
      .sort((a, b) => b.length - a.length)
      .forEach((rows, i) => { html += renderGroup(rows, `Grupo ${letters[i] || i + 1}`); });
    body.innerHTML = html;
  } else {
    body.innerHTML = renderGroup(allRows, null);
  }
}

async function loadStandingsFor(leagueId, leagueName, isDefault) {
  const body = $("#standings-body");
  $("#standings-title").textContent = "Classificação";
  $("#standings-sub").textContent = isDefault ? `${leagueName} (último encerrado)` : leagueName;
  body.innerHTML = `<tr><td colspan="4" class="empty-state">Carregando...</td></tr>`;
  try {
    let series;
    try {
      series = await fetchStratzSeriesForLeague(leagueId); // fonte principal: STRATZ já entrega a série pronta
    } catch {
      let matches = (cachedMatches && !isDefault) ? cachedMatches : await odFetch(`leagues/${leagueId}/matches`);
      matches = await enrichTeamNames(matches);
      series = groupIntoSeries(matches); // fallback: nosso agrupamento por conectividade
    }
    renderStandingsTable(series);
  } catch { body.innerHTML = `<tr><td colspan="4" class="empty-state">Erro ao calcular classificação.</td></tr>`; }
}


/* ---------- visão geral (sem torneio selecionado) ---------- */
async function loadCenterDefault() {
  await Promise.all([loadUpcoming(), loadRecentResults()]);
}

async function loadUpcoming() {
  const box = $("#upcoming-list");
  const label = $("#next-league-name");
  box.innerHTML = `<div class="empty-state">Carregando...</div>`;

  let liveHtml = "";
  let liveGames = [];
  try {
    const liveData = await liveFetch(); // sem league_id = todas as partidas de liga ao vivo agora
    const allLive = (liveData && liveData.result && liveData.result.games) || [];
    await ensureLeaguesLoaded().catch(() => {});
    liveGames = allLive.filter((g) => isTopTierLeague(g.league_id)); // só torneios premium/profissionais
    if (liveGames.length) {
      const liveCards = liveGames.map((g, i) => renderLiveCard(g, i)).join("");
      liveHtml = `<div class="date-group"><div class="date-group-header">Ao vivo agora</div><div class="match-grid">${liveCards}</div></div>`;
    }
  } catch { /* segue sem a seção de ao vivo se essa chamada falhar */ }

  let scheduledHtml = "";
  try {
    const data = await scheduleFetch(21);
    const games = (data && data.result && data.result.games) || [];
    if (games.length) {
      await ensureLeaguesLoaded().catch(() => {});
      const byLeague = {};
      games.forEach((g) => { (byLeague[g.league_id] = byLeague[g.league_id] || []).push(g); });
      let bestLeagueId = null, bestTime = Infinity;
      Object.entries(byLeague).forEach(([lid, list]) => {
        if (!isTopTierLeague(lid)) return;
        const min = Math.min(...list.map((g) => g.starttime || Infinity));
        if (min < bestTime) { bestTime = min; bestLeagueId = lid; }
      });
      if (bestLeagueId) {
        label.textContent = `— ${leagueNameById(bestLeagueId)}`;
        const nextGames = byLeague[bestLeagueId].sort((a, b) => (a.starttime || 0) - (b.starttime || 0)).slice(0, 10);
        const cardsHtml = await Promise.all(nextGames.map(renderUpcomingCard));
        scheduledHtml = `<div class="date-group"><div class="date-group-header">Agendadas</div><div class="match-grid">${cardsHtml.join("")}</div></div>`;
      }
    }
  } catch { /* a agenda oficial da Valve é instável — segue só com o que tiver */ }

  // complemento via STRATZ: nome do próximo torneio grande, mesmo sem agenda de partidas específica
  let nextTournamentHtml = "";
  if (!scheduledHtml) {
    try {
      const data = await stratzQuery(
        `query($tiers: [LeagueTier]) {
          leagues(request: { tiers: $tiers, isFutureLeague: true, take: 25 }) { id displayName startDateTime }
        }`,
        { tiers: STRATZ_TOP_TIERS }
      );
      const list = ((data && data.leagues) || []).filter((l) => l.startDateTime).sort((a, b) => a.startDateTime - b.startDateTime);
      if (list.length) {
        const next = list[0];
        const when = new Date(next.startDateTime * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
        label.textContent = `— ${next.displayName}`;
        nextTournamentHtml = `<div class="date-group"><div class="date-group-header">Próximo torneio</div>
          <div class="match-card" style="cursor:default"><div class="match-teams"><span class="team-name">${next.displayName}</span></div>
          <div class="match-meta"><span>Início previsto: ${when}</span></div></div></div>`;
      }
    } catch { /* STRATZ fora do ar — segue sem esse complemento */ }
  }

  if (!liveHtml && !scheduledHtml && !nextTournamentHtml) {
    box.innerHTML = `<div class="empty-state">Nenhuma partida ao vivo ou agendada encontrada agora.</div>`;
    label.textContent = "";
    return;
  }
  box.innerHTML = liveHtml + scheduledHtml + nextTournamentHtml;
  box.querySelectorAll("[data-live]").forEach((el) => el.addEventListener("click", () => openLiveGame(liveGames[+el.dataset.live])));
}
async function renderUpcomingCard(g) {
  const cache = lsGet("dota:teamNames", {});
  const rId = g.radiant_team_id, dId = g.dire_team_id;
  let rName = (g.radiant_team && (g.radiant_team.team_name || g.radiant_team.name)) || cache[rId];
  let dName = (g.dire_team && (g.dire_team.team_name || g.dire_team.name)) || cache[dId];
  if (!rName && rId) { try { const t = await odFetch(`teams/${rId}`); rName = (t && (t.name || t.tag)); cache[rId] = rName; } catch {} }
  if (!dName && dId) { try { const t = await odFetch(`teams/${dId}`); dName = (t && (t.name || t.tag)); cache[dId] = dName; } catch {} }
  lsSet("dota:teamNames", cache);
  rName = rName || "A definir"; dName = dName || "A definir";
  const when = g.starttime ? new Date(g.starttime * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Data a definir";
  return `<div class="match-card">
      <div class="match-teams">
        <span class="team-name">${rName}</span>
        <span class="score" style="font-size:13px">vs</span>
        <span class="team-name" style="text-align:right">${dName}</span>
      </div>
      <div class="match-meta"><span>${when}</span></div>
    </div>`;
}

async function loadRecentResults() {
  const box = $("#recent-results-list");
  const label = $("#last-league-name");
  box.innerHTML = `<div class="empty-state">Carregando...</div>`;
  try {
    const recent = await computeRecentlyPlayedLeagues();
    if (!recent.length) { box.innerHTML = `<div class="empty-state">Nenhum torneio premium/profissional recente encontrado.</div>`; return; }
    const best = recent[0];
    label.textContent = `— ${best.name}`;

    let matches = await odFetch(`leagues/${best.leagueid}/matches`);
    matches = await enrichTeamNames(matches);
    matches.sort((a, b) => b.start_time - a.start_time);

    let series;
    try {
      series = attachOpenDotaGames(await fetchStratzSeriesForLeague(best.leagueid), matches);
    } catch {
      series = groupIntoSeries(matches); // fallback: nosso agrupamento por conectividade
    }
    series = series.sort((a, b) => b.startTime - a.startTime).slice(0, 8);
    box.innerHTML = await renderSeriesGrouped(series);
    attachSeriesClicks(box, series);

    // guarda o id pra classificação padrão usar o mesmo torneio
    window.__lastFinishedLeagueId = best.leagueid;
    window.__lastFinishedLeagueName = best.name;
  } catch {
    box.innerHTML = `<div class="empty-state">Não foi possível carregar os últimos resultados.</div>`;
  }
}

async function loadDefaultStandings() {
  if (window.__lastFinishedLeagueId) {
    cachedMatches = null;
    await loadStandingsFor(window.__lastFinishedLeagueId, window.__lastFinishedLeagueName, true);
  } else {
    $("#standings-sub").textContent = "";
    $("#standings-body").innerHTML = `<tr><td colspan="4" class="empty-state">Carregando...</td></tr>`;
  }
}

/* ---------- detalhe da série (modal) ---------- */
function openSeries(s) {
  $("#series-modal").classList.remove("hidden");
  $("#series-title").textContent = `${s.teamAName} ${s.scoreA} - ${s.scoreB} ${s.teamBName}`;
  const box = $("#series-games");
  box.innerHTML = s.games.map((g, i) => {
    const winnerName = g.radiant_win ? (g.radiant_name || s.teamAName) : (g.dire_name || s.teamBName);
    const date = new Date(g.start_time * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    return `<div class="match-card" data-game="${g.match_id}">
      <div class="match-teams">
        <span class="team-name">Jogo ${i + 1}</span>
        <span class="score">${g.radiant_score ?? "-"} - ${g.dire_score ?? "-"}</span>
        <span class="team-name" style="text-align:right">${winnerName} venceu</span>
      </div>
      <div class="match-meta"><span>${date}</span><span>${Math.round(g.duration / 60)} min</span></div>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-game]").forEach((el) => el.addEventListener("click", () => openMatch(el.dataset.game)));
}
$("#btn-close-series").addEventListener("click", () => $("#series-modal").classList.add("hidden"));
$("#series-modal-backdrop").addEventListener("click", () => $("#series-modal").classList.add("hidden"));

/* ---------- detalhe da partida (modal) ---------- */
async function openMatch(matchId) {
  $("#match-modal").classList.remove("hidden");
  $("#match-detail").innerHTML = `<div class="empty-state">Carregando partida...</div>`;
  try {
    const m = await odFetch(`matches/${matchId}`);
    await enrichTeamNames([m]);
    await enrichPlayerNames(m.players || []);
    $("#match-detail").innerHTML = renderMatchDetail(m);
  } catch { $("#match-detail").innerHTML = `<div class="empty-state">Erro ao carregar detalhe da partida.</div>`; }
}
$("#btn-close-match").addEventListener("click", () => $("#match-modal").classList.add("hidden"));
$("#match-modal-backdrop").addEventListener("click", () => $("#match-modal").classList.add("hidden"));

function renderMatchDetail(m) {
  const rName = m.radiant_name || "Radiant", dName = m.dire_name || "Dire";
  const pb = m.picks_bans || [];
  const picksBansBlock = (team) => {
    const items = pb.filter((p) => p.team === team).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!items.length) return "";
    return items.map((p) =>
      `<div class="hero-chip ${p.is_pick ? "" : "banned"}">
        <img src="${heroImg(p.hero_id)}" alt="${heroName(p.hero_id)}" title="${heroName(p.hero_id)}">
        <span class="pick-order">${(p.order ?? 0) + 1}</span>
      </div>`
    ).join("");
  };
  const playersRadiant = (m.players || []).filter((p) => p.player_slot < 128);
  const playersDire = (m.players || []).filter((p) => p.player_slot >= 128);
  const playerRow = (p) => {
    const items = [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5]
      .map((it) => (it ? `<img src="${itemImg(it)}" alt="">` : `<img src="" alt="" style="opacity:0">`)).join("");
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
    <div class="picks-row">${picksBansBlock(0)}</div>
    <div class="team-block-title">Picks &amp; bans — ${dName}</div>
    <div class="picks-row">${picksBansBlock(1)}</div>
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

/* ---------- Ranking MMR (aba do topo) ---------- */
$$(".main-tab-btn").forEach((btn) => btn.addEventListener("click", () => switchMainView(btn.dataset.view)));
function switchMainView(view) {
  $$(".main-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#layout").classList.toggle("hidden", view !== "torneios");
  $("#view-ranking").classList.toggle("hidden", view !== "ranking");
  $("#view-heroes").classList.toggle("hidden", view !== "heroes");
  if (view === "ranking" && !window.__rankingLoadedOnce) {
    window.__rankingLoadedOnce = true;
    loadRanking("europe");
  }
  if (view === "heroes" && !window.__heroesLoadedOnce) {
    window.__heroesLoadedOnce = true;
    populateHeroesGrid();
  }
}
$$("#region-tabs .region-tab-btn").forEach((btn) => btn.addEventListener("click", () => {
  $$("#region-tabs .region-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
  loadRanking(btn.dataset.region);
}));

async function loadRanking(division) {
  const requestId = ++window.__rankingRequestId || (window.__rankingRequestId = 1);
  const body = $("#ranking-body");
  $("#ranking-updated").textContent = "";
  body.innerHTML = `<tr><td colspan="4" class="empty-state">Carregando...</td></tr>`;
  try {
    const stratzDivision = REGION_TO_STRATZ_DIVISION[division] || "EUROPE";
    const data = await stratzQuery(
      `query($div: LeaderboardDivision) {
        leaderboard {
          season(request: { leaderBoardDivision: $div }) {
            playerCount
            players {
              rank steamAccountId winRate matchCount position
              topHeroOne topHeroTwo topHeroThree
              steamAccount { name avatar }
            }
          }
        }
      }`,
      { div: stratzDivision }
    );
    if (requestId !== window.__rankingRequestId) return;
    const players = (data && data.leaderboard && data.leaderboard.season && data.leaderboard.season.players) || [];
    if (!players.length) {
      body.innerHTML = `<tr><td colspan="4" class="empty-state">Nenhum jogador encontrado pra essa região.</td></tr>`;
      return;
    }
    const total = data.leaderboard.season.playerCount;
    $("#ranking-updated").textContent = `${total.toLocaleString("pt-BR")} jogadores rankeados nessa região — dados do STRATZ`;
    body.innerHTML = players.map((p) => {
      const acc = p.steamAccount || {};
      const avatar = acc.avatar ? `<img class="player-avatar" src="${acc.avatar}" alt="">` : `<span class="player-avatar player-avatar-empty"></span>`;
      const winPct = p.matchCount ? Math.round((p.winRate || 0) * 100) : "-";
      const heroes = [p.topHeroOne, p.topHeroTwo, p.topHeroThree].filter(Boolean)
        .map((hid) => `<img class="ranking-hero" src="${heroImg(hid)}" alt="${heroName(hid)}" title="${heroName(hid)}">`).join("");
      const posLabel = p.position && POSITION_LABELS[p.position] ? POSITION_LABELS[p.position].replace(/ \(.+\)/, "") : "—";
      return `<tr>
        <td>${p.rank}</td>
        <td><div class="player-country">${avatar}${acc.name || `Jogador ${p.steamAccountId}`}</div></td>
        <td class="numeric">${winPct}${p.matchCount ? "%" : ""}</td>
        <td>${posLabel}</td>
        <td><div class="ranking-heroes">${heroes}</div></td>
      </tr>`;
    }).join("");
  } catch (err) {
    if (requestId !== window.__rankingRequestId) return;
    body.innerHTML = `<tr><td colspan="4" class="empty-state" style="white-space:normal">Erro ao carregar o ranking.<br>${err.message || ""}</td></tr>`;
  }
}

/* ---------- Heróis: posição mais jogada + build de item (STRATZ) ---------- */
function populateHeroesGrid() {
  const grid = $("#heroes-grid");
  const ids = Object.keys(HEROES).sort((a, b) => heroName(a).localeCompare(heroName(b)));
  grid.innerHTML = ids.map((id) =>
    `<button class="hero-grid-icon" data-hero="${id}" title="${heroName(id)}"><img src="${heroImg(id)}" alt="${heroName(id)}"></button>`
  ).join("");
  grid.querySelectorAll(".hero-grid-icon").forEach((btn) => {
    btn.addEventListener("click", () => {
      grid.querySelectorAll(".hero-grid-icon").forEach((b) => b.classList.toggle("active", b === btn));
      loadHeroBuild(btn.dataset.hero);
    });
  });
}
$("#hero-search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  $("#heroes-grid").querySelectorAll(".hero-grid-icon").forEach((btn) => {
    const match = !q || heroName(btn.dataset.hero).toLowerCase().includes(q);
    btn.style.display = match ? "" : "none";
  });
});

let heroBuildRequestId = 0;
async function loadHeroBuild(heroId) {
  const myId = ++heroBuildRequestId;
  const panel = $("#hero-detail");
  panel.innerHTML = `<div class="empty-state">Carregando ${heroName(heroId)}...</div>`;
  try {
    const data = await stratzQuery(
      `query($heroId: Short!) {
        heroStats {
          stats(heroIds: [$heroId], groupByPosition: true) { position matchCount winCount }
          itemStartingPurchase(heroId: $heroId) { itemId position matchCount winCount }
          itemBootPurchase(heroId: $heroId) { itemId position matchCount winCount }
          itemFullPurchase(heroId: $heroId) { itemId position time matchCount winCount }
        }
      }`,
      { heroId: Number(heroId) }
    );
    if (myId !== heroBuildRequestId) return;
    const hs = (data && data.heroStats) || {};
    const stats = (hs.stats || []).filter((s) => s.position && s.position !== "UNKNOWN" && s.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount);
    if (!stats.length) {
      panel.innerHTML = `<div class="hero-detail-header"><img src="${heroImg(heroId)}" alt=""><h2>${heroName(heroId)}</h2></div>
        <div class="empty-state">Sem dados de posição suficientes pra esse herói ainda.</div>`;
      return;
    }
    renderHeroDetail(heroId, stats, hs, stats[0].position);
  } catch (err) {
    if (myId !== heroBuildRequestId) return;
    panel.innerHTML = `<div class="hero-detail-header"><img src="${heroImg(heroId)}" alt=""><h2>${heroName(heroId)}</h2></div>
      <div class="empty-state" style="white-space:normal">Erro ao carregar dados do STRATZ.<br>${err.message || ""}</div>`;
  }
}
function renderHeroDetail(heroId, stats, hs, selectedPosition) {
  const panel = $("#hero-detail");
  const tabsHtml = stats.map((s) => {
    const pct = s.matchCount ? Math.round((s.winCount / s.matchCount) * 100) : 0;
    const label = (POSITION_LABELS[s.position] || s.position).replace(/ \(.+\)/, "");
    return `<button class="position-tab-btn ${s.position === selectedPosition ? "active" : ""}" data-pos="${s.position}">
      ${label}<span class="ptb-sub">${pct}% vitórias · ${s.matchCount.toLocaleString("pt-BR")} jogos</span>
    </button>`;
  }).join("");

  const itemSection = (title, items, opts) => {
    const filtered = items.filter((i) => i.position === selectedPosition).sort((a, b) => b.matchCount - a.matchCount);
    const top = opts.sortByTime
      ? filtered.slice(0, opts.take).sort((a, b) => (a.time || 0) - (b.time || 0))
      : filtered.slice(0, opts.take);
    if (!top.length) return "";
    const chips = top.map((i) => {
      const pct = i.matchCount ? Math.round((i.winCount / i.matchCount) * 100) : 0;
      return `<div class="item-chip"><img src="${itemImg(i.itemId)}" alt=""><span class="item-badge">${pct}%</span></div>`;
    }).join("");
    return `<div class="item-build-section"><div class="team-block-title">${title}</div><div class="item-build-row">${chips}</div></div>`;
  };

  panel.innerHTML = `
    <div class="hero-detail-header"><img src="${heroImg(heroId)}" alt=""><h2>${heroName(heroId)}</h2></div>
    <div id="hero-position-tabs">${tabsHtml}</div>
    <div id="hero-build-content">
      ${itemSection("Itens iniciais", hs.itemStartingPurchase || [], { take: 6, sortByTime: false })}
      ${itemSection("Botas", hs.itemBootPurchase || [], { take: 3, sortByTime: false })}
      ${itemSection("Build principal (ordem de compra)", hs.itemFullPurchase || [], { take: 8, sortByTime: true })}
    </div>
  `;
  panel.querySelectorAll(".position-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => renderHeroDetail(heroId, stats, hs, btn.dataset.pos));
  });
}

/* ---------- boot ---------- */
(async function boot() {
  await loadConstants().catch(() => {});
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  renderRecent();
  await loadCenterDefault();
  await loadDefaultStandings();
})();
