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
function lsSet(key, value) { 
  try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
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

// nomes amigáveis pras posições
const POSITION_LABELS = {
  POSITION_1: "Posição 1 (Carry)",
  POSITION_2: "Posição 2 (Mid)",
  POSITION_3: "Posição 3 (Offlane)",
  POSITION_4: "Posição 4 (Suporte)",
  POSITION_5: "Posição 5 (Suporte duro)",
};
const NUMERIC_POSITION_LABELS = { 1: "Posição 1", 2: "Posição 2", 3: "Posição 3", 4: "Posição 4", 5: "Posição 5" };
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
function normalizeTeamName(name) { return String(name || "").trim().toLowerCase(); }
async function ensureTeamsByNameIndex() {
  const cached = lsGet("dota:teamsByName", null);
  if (cached && Date.now() - cached.ts < 24 * 3600 * 1000) return cached.data;
  const list = await odFetch("teams");
  const index = {};
  (list || []).forEach((t) => {
    if (t.name) index[normalizeTeamName(t.name)] = t.logo_url || null;
    if (t.tag) index[normalizeTeamName(t.tag)] = index[normalizeTeamName(t.tag)] || t.logo_url || null;
  });
  lsSet("dota:teamsByName", { ts: Date.now(), data: index });
  return index;
}
function teamLogoByName(index, name) {
  return index[normalizeTeamName(name)] || null;
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
let currentLeague = null;
let liveTimer = null;
let cachedMatches = null;

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
    return computeRecentlyPlayedLeaguesFallback();
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
  stopOverviewLivePolling();
  stopOverviewResultsPolling();
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
  startStandingsPolling();
}
$("#btn-change-league").addEventListener("click", () => {
  stopLivePolling();
  stopResultsPolling();
  stopStandingsPolling();
  currentLeague = null;
  $("#center-league").classList.add("hidden");
  $("#center-default").classList.remove("hidden");
  loadCenterDefault();
  loadDefaultStandings();
  startOverviewLivePolling();
  startOverviewResultsPolling();
});

/* ---------- abas (torneio selecionado) ---------- */
function switchTab(tab) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
  $(`#tab-${tab}`).classList.remove("hidden");
  if (tab === "live") { loadLive(); startLivePolling(); } else stopLivePolling();
  if (tab === "results") { loadResults(); startResultsPolling(); } else stopResultsPolling();
}
$$(".tab-btn").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

function startLivePolling() { stopLivePolling(); liveTimer = setInterval(loadLive, 35000); }
function stopLivePolling() { if (liveTimer) clearInterval(liveTimer); liveTimer = null; }

let resultsPollTimer = null;
function startResultsPolling() {
  stopResultsPolling();
  resultsPollTimer = setInterval(() => { cachedMatches = null; loadResults(); }, 60000);
}
function stopResultsPolling() { if (resultsPollTimer) clearInterval(resultsPollTimer); resultsPollTimer = null; }

let standingsPollTimer = null;
function startStandingsPolling() {
  stopStandingsPolling();
  standingsPollTimer = setInterval(() => {
    if (currentLeague) loadStandingsFor(currentLeague.leagueid, currentLeague.name, false);
  }, 60000);
}
function stopStandingsPolling() { if (standingsPollTimer) clearInterval(standingsPollTimer); standingsPollTimer = null; }

async function loadLive() {
  const box = $("#live-list");
  if (!currentLeague) return;
  try {
    const data = await liveFetch(currentLeague.leagueid);
    const games = (data && data.result && data.result.games) || [];
    if (!games.length) { box.innerHTML = `<div class="empty-state">Nenhuma partida ao vivo agora neste torneio.</div>`; return; }
    await ensureTeamLogos(games.flatMap((g) => [g.radiant_team && g.radiant_team.team_id, g.dire_team && g.dire_team.team_id])).catch(() => {});
    box.innerHTML = `<div class="match-grid">${games.map((g, i) => renderLiveCard(g, i)).join("")}</div>`;
    box.querySelectorAll("[data-live]").forEach((el) => el.addEventListener("click", () => openLiveGame(games[+el.dataset.live])));
  } catch { box.innerHTML = `<div class="empty-state">Não foi possível carregar partidas ao vivo.</div>`; }
}
function renderLiveCard(g, idx) {
  const sb = g.scoreboard;
  const radiantId = g.radiant_team && g.radiant_team.team_id;
  const direId = g.dire_team && g.dire_team.team_id;
  const radiantName = (g.radiant_team && g.radiant_team.team_name) || "Radiant";
  const direName = (g.dire_team && g.dire_team.team_name) || "Dire";
  const logos = lsGet("dota:teamLogos", {});
  const rScore = sb && sb.radiant ? sb.radiant.score : 0;
  const dScore = sb && sb.dire ? sb.dire.score : 0;
  const minutes = sb ? Math.floor(sb.duration / 60) : 0;
  return `<div class="match-card" data-live="${idx}">
      <span class="live-badge">● Ao vivo · ${minutes}min</span>
      <div class="match-teams" style="margin-top:8px">
        <div class="team-side">${teamLogoImg(logos[radiantId], radiantName)}<span class="team-name">${radiantName}</span></div>
        <span class="score">${rScore} - ${dScore}</span>
        <div class="team-side team-side-right"><span class="team-name">${direName}</span>${teamLogoImg(logos[direId], direName)}</div>
      </div>
    </div>`;
}

/* ---------- detalhe de partida ao vivo ---------- */
function getSidePlayers(sb, side) {
  const s = sb && sb[side];
  if (!s) return [];
  return s.players || s.player || [];
}
let liveMinimapTimer = null;
let streamsDataCache = null;
async function ensureStreamsData() {
  if (streamsDataCache) return streamsDataCache;
  try {
    const res = await fetch(`/streams.json?_=${Date.now()}`, { cache: "no-store" });
    streamsDataCache = res.ok ? await res.json() : {};
  } catch { streamsDataCache = {}; }
  return streamsDataCache;
}
function getStreamLinksForLeague(streamsData, leagueName) {
  return (streamsData && leagueName && streamsData[leagueName]) || null;
}

async function openLiveGame(g) {
  $("#match-modal").classList.remove("hidden");
  $("#match-detail").innerHTML = `<div class="empty-state">Carregando...</div>`;
  stopLiveMinimap();
  try {
    const sb = g.scoreboard || {};
    const rPlayers = getSidePlayers(sb, "radiant");
    const dPlayers = getSidePlayers(sb, "dire");
    await enrichPlayerNames([...rPlayers, ...dPlayers]);
    await ensureLeaguesLoaded().catch(() => {});
    const streamsData = await ensureStreamsData();
    const leagueName = leagueNameById(g.league_id);
    $("#match-detail").innerHTML = renderLiveMatchDetail(g, getStreamLinksForLeague(streamsData, leagueName));
    startLiveMinimap(g, streamsData);
  } catch { $("#match-detail").innerHTML = `<div class="empty-state">Erro ao carregar a partida ao vivo.</div>`; }
}
function stopLiveMinimap() {
  if (liveMinimapTimer) clearInterval(liveMinimapTimer);
  liveMinimapTimer = null;
}
function startLiveMinimap(g, streamsData) {
  const rName = (g.radiant_team && g.radiant_team.team_name) || "Radiant";
  const dName = (g.dire_team && g.dire_team.team_name) || "Dire";
  const leagueId = g.league_id;
  const refresh = async () => {
    if ($("#match-modal").classList.contains("hidden")) { stopLiveMinimap(); return; }
    try {
      const data = await liveFetch(leagueId);
      const games = (data && data.result && data.result.games) || [];
      const match = games.find((x) =>
        (x.radiant_team && x.radiant_team.team_name) === rName && (x.dire_team && x.dire_team.team_name) === dName
      );
      if (!match) { stopLiveMinimap(); return; }
      const sb = match.scoreboard || {};
      await enrichPlayerNames([...getSidePlayers(sb, "radiant"), ...getSidePlayers(sb, "dire")]).catch(() => {});
      const leagueName = leagueNameById(match.league_id || leagueId);
      $("#match-detail").innerHTML = renderLiveMatchDetail(match, getStreamLinksForLeague(streamsData, leagueName));
      renderMinimapDots(sb);
    } catch { /* mantém o último estado */ }
  };
  renderMinimapDots(g.scoreboard);
  liveMinimapTimer = setInterval(refresh, 6000);
}
const MAP_MIN = -8288, MAP_MAX = 8288;
function worldToPct(x, y) {
  const fx = (x - MAP_MIN) / (MAP_MAX - MAP_MIN);
  const fy = 1 - (y - MAP_MIN) / (MAP_MAX - MAP_MIN);
  return { left: `${Math.min(100, Math.max(0, fx * 100)).toFixed(1)}%`, top: `${Math.min(100, Math.max(0, fy * 100)).toFixed(1)}%` };
}
const RADIANT_BASE = { left: 10, top: 88 };
const DIRE_BASE = { left: 88, top: 10 };
function renderMinimapDots(sb) {
  const box = $("#live-minimap-dots");
  if (!box || !sb) return;
  const rPlayers = getSidePlayers(sb, "radiant");
  const dPlayers = getSidePlayers(sb, "dire");
  const dot = (p, cls, base, jitterIdx) => {
    const dead = (p.respawn_timer || 0) > 0;
    let left, top;
    if (dead) {
      left = `${base.left + (jitterIdx % 3) * 3 - 3}%`;
      top = `${base.top + Math.floor(jitterIdx / 3) * 3 - 3}%`;
    } else {
      if (p.position_x == null || p.position_y == null) return "";
      const pos = worldToPct(p.position_x, p.position_y);
      left = pos.left; top = pos.top;
    }
    return `<div class="minimap-hero ${cls} ${dead ? "minimap-dead" : ""}" style="left:${left};top:${top}" title="${heroName(p.hero_id)}${dead ? " (morto)" : ""}">
      <img src="${heroImg(p.hero_id)}" alt="">
    </div>`;
  };
  box.innerHTML =
    rPlayers.map((p, i) => dot(p, "minimap-radiant", RADIANT_BASE, i)).join("") +
    dPlayers.map((p, i) => dot(p, "minimap-dire", DIRE_BASE, i)).join("");
}
function renderLiveMatchDetail(g, streamLinks) {
  const sb = g.scoreboard || {};
  const rName = (g.radiant_team && g.radiant_team.team_name) || "Radiant";
  const dName = (g.dire_team && g.dire_team.team_name) || "Dire";
  const minutes = Math.floor((sb.duration || 0) / 60);
  const streamButtonsHtml = streamLinks ? `<div class="stream-links">
    ${streamLinks.youtube ? `<a class="stream-btn stream-youtube" href="${streamLinks.youtube}" target="_blank" rel="noopener">▶ YouTube</a>` : ""}
    ${streamLinks.twitch ? `<a class="stream-btn stream-twitch" href="${streamLinks.twitch}" target="_blank" rel="noopener">▶ Twitch</a>` : ""}
    ${streamLinks.kick ? `<a class="stream-btn stream-kick" href="${streamLinks.kick}" target="_blank" rel="noopener">▶ Kick</a>` : ""}
  </div>` : "";
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
    ${streamButtonsHtml}
    <div class="team-block-title">Mapa (atualiza a cada ~6s — posições aproximadas)</div>
    <div id="live-minimap"><div id="live-minimap-dots"></div></div>
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
  if (seriesType === 2) return 3;
  if (seriesType === 1) return 2;
  return 1;
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
      series = groupIntoSeries(cachedMatches);
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

/* ---------- séries de um torneio via STRATZ ---------- */
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
      games: [],
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

/* ---------- classificação (coluna direita) ---------- */
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

function renderStandingsTable(series) {
  const body = $("#standings-body");
  const allRows = computeStandingsFromSeries(series);

  const renderGroup = (rows, label) => {
    const rowsHtml = rows.map((r, i) =>
      `<tr><td>${i + 1}</td><td>${r.name}</td><td class="numeric">${r.seriesW}-${r.seriesL}</td><td class="numeric">${r.mapsW}-${r.mapsL}</td></tr>`
    ).join("");
    return (label ? `<tr class="group-label-row"><td colspan="4">${label}</td></tr>` : "") + rowsHtml;
  };

  if (!allRows.length) { body.innerHTML = `<tr><td colspan="4" class="empty-state">Sem dados suficientes.</td></tr>`; return; }
  body.innerHTML = renderGroup(allRows, null);
}

async function loadStandingsFor(leagueId, leagueName, isDefault) {
  const body = $("#standings-body");
  $("#standings-title").textContent = "Classificação";
  const suffix = isDefault === "live" ? " (ao vivo agora)" : isDefault ? " (último encerrado)" : "";
  $("#standings-sub").textContent = `${leagueName}${suffix}`;
  body.innerHTML = `<tr><td colspan="4" class="empty-state">Carregando...</td></tr>`;
  try {
    let series;
    try {
      series = await fetchStratzSeriesForLeague(leagueId);
    } catch {
      let matches = (cachedMatches && !isDefault) ? cachedMatches : await odFetch(`leagues/${leagueId}/matches`);
      matches = await enrichTeamNames(matches);
      series = groupIntoSeries(matches);
    }
    renderStandingsTable(series);
  } catch { body.innerHTML = `<tr><td colspan="4" class="empty-state">Erro ao calcular classificação.</td></tr>`; }
}

/* ---------- visão geral ---------- */
let overviewLiveTimer = null;
function startOverviewLivePolling() { stopOverviewLivePolling(); overviewLiveTimer = setInterval(refreshOverviewLive, 25000); }
function stopOverviewLivePolling() { if (overviewLiveTimer) clearInterval(overviewLiveTimer); overviewLiveTimer = null; }

let overviewResultsTimer = null;
function startOverviewResultsPolling() {
  stopOverviewResultsPolling();
  overviewResultsTimer = setInterval(() => { loadRecentResults(); loadDefaultStandings(); }, 60000);
}
function stopOverviewResultsPolling() { if (overviewResultsTimer) clearInterval(overviewResultsTimer); overviewResultsTimer = null; }

async function refreshOverviewLive() {
  const upcomingBox = $("#upcoming-list");
  if (!upcomingBox) return;
  try {
    const liveData = await liveFetch();
    const allLive = (liveData && liveData.result && liveData.result.games) || [];
    await ensureLeaguesLoaded().catch(() => {});
    const liveGames = allLive.filter((g) => isTopTierLeague(g.league_id));
    let block = $("#upcoming-live-block");
    if (!liveGames.length) { if (block) block.remove(); return; }

    await ensureTeamLogos(liveGames.flatMap((g) => [g.radiant_team && g.radiant_team.team_id, g.dire_team && g.dire_team.team_id])).catch(() => {});
    const cardsHtml = liveGames.map((g, i) => renderLiveCard(g, i)).join("");
    if (block) {
      block.querySelector(".match-grid").innerHTML = cardsHtml;
    } else {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = `<div class="date-group" id="upcoming-live-block"><div class="date-group-header">Ao vivo agora</div><div class="match-grid">${cardsHtml}</div></div>`;
      upcomingBox.prepend(wrapper.firstElementChild);
      block = $("#upcoming-live-block");
    }
    block.querySelectorAll("[data-live]").forEach((el) => el.addEventListener("click", () => openLiveGame(liveGames[+el.dataset.live])));
  } catch { /* mantém último estado */ }
}

async function loadCenterDefault() {
  window.__featuredLeague = await determineFeaturedLeague();
  await Promise.all([loadUpcoming(), loadRecentResults()]);
}

async function determineFeaturedLeague() {
  let liveGames = [];
  try {
    const liveData = await liveFetch();
    const allLive = (liveData && liveData.result && liveData.result.games) || [];
    await ensureLeaguesLoaded().catch(() => {});
    liveGames = allLive.filter((g) => isTopTierLeague(g.league_id));
  } catch { /* ignora se falhar */ }

  if (liveGames.length) {
    const counts = {};
    liveGames.forEach((g) => { counts[g.league_id] = (counts[g.league_id] || 0) + 1; });
    const bestId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    return { leagueid: bestId, name: leagueNameById(bestId), isLive: true, liveGames };
  }

  const recent = await computeRecentlyPlayedLeagues();
  if (recent.length) return { leagueid: recent[0].leagueid, name: recent[0].name, isLive: false, liveGames: [] };
  return null;
}

function teamNameMatches(a, b) {
  const na = normalizeTeamName(a), nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}
function leagueIdByName(name) {
  const l = (allLeagues || []).find((x) => x.name === name);
  return l ? l.leagueid : null;
}
function normalizeNick(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

/* ---------- Estatísticas de 100% das Partidas com Cache Persistente ---------- */
let leagueMatchesCache = {};

async function getMatchesForLeague(leagueId) {
  if (!leagueId) return [];
  if (leagueMatchesCache[leagueId]) return leagueMatchesCache[leagueId];
  try {
    let matches = await odFetch(`leagues/${leagueId}/matches`);
    matches = await enrichTeamNames(matches);
    leagueMatchesCache[leagueId] = matches || [];
    return leagueMatchesCache[leagueId];
  } catch (e) {
    console.error("Erro ao buscar partidas da liga:", e);
    return [];
  }
}

// Busca a partida com cache em disco permanente: só faz download 1 única vez
async function getMatchCached(matchId) {
  if (!matchId) return null;
  const cacheKey = `dota:match:compact:${matchId}`;
  
  const cached = lsGet(cacheKey, null);
  if (cached) return cached;

  try {
    const data = await odFetch(`matches/${matchId}`);
    if (data && data.match_id) {
      const compactMatch = {
        match_id: data.match_id,
        radiant_name: data.radiant_name,
        dire_name: data.dire_name,
        players: (data.players || []).map((p) => ({
          account_id: p.account_id,
          personaname: p.personaname,
          name: p.name,
          player_slot: p.player_slot,
          kills: p.kills || 0,
          deaths: p.deaths || 0,
          assists: p.assists || 0,
          gold_per_min: p.gold_per_min || 0,
          xp_per_min: p.xp_per_min || 0,
          lane_role: p.lane_role || 0,
        })),
      };
      lsSet(cacheKey, compactMatch);
      return compactMatch;
    }
  } catch (err) {
    return null;
  }
  return null;
}

async function getTeamRosterAndStats(teamName, leagueId) {
  if (!teamName || !leagueId) return [];
  try {
    const allMatches = await getMatchesForLeague(leagueId);
    
    // Filtra TODAS as partidas que o time disputou na liga inteira (sem limite)
    const teamMatches = allMatches.filter(
      (m) => teamNameMatches(m.radiant_name, teamName) || teamNameMatches(m.dire_name, teamName)
    );

    if (!teamMatches.length) return [];

    // Baixa em lotes de 6 para evitar sobrecarregar a Netlify
    const fullMatches = [];
    for (let i = 0; i < teamMatches.length; i += 6) {
      const chunk = teamMatches.slice(i, i + 6);
      const results = await Promise.all(chunk.map((m) => getMatchCached(m.match_id)));
      fullMatches.push(...results.filter(Boolean));
    }

    const playersMap = {};

    fullMatches.forEach((match) => {
      const isRadiant = teamNameMatches(match.radiant_name, teamName);
      const sidePlayers = (match.players || []).filter((p) =>
        isRadiant ? p.player_slot < 128 : p.player_slot >= 128
      );

      sidePlayers.forEach((pl, idx) => {
        const id = pl.account_id || pl.personaname || `player_${idx}`;
        if (!playersMap[id]) {
          playersMap[id] = {
            account_id: pl.account_id,
            nickname: pl.name || pl.personaname || `Jogador ${idx + 1}`,
            games: 0,
            kills: 0,
            deaths: 0,
            assists: 0,
            gpm: 0,
            xpm: 0,
            midCount: 0,
            safeCount: 0,
            offCount: 0,
          };
        }

        const p = playersMap[id];
        p.games += 1;
        p.kills += pl.kills;
        p.deaths += pl.deaths;
        p.assists += pl.assists;
        p.gpm += pl.gold_per_min;
        p.xpm += pl.xp_per_min;

        if (pl.lane_role === 2) p.midCount += 1;
        else if (pl.lane_role === 1) p.safeCount += 1;
        else if (pl.lane_role === 3) p.offCount += 1;
      });
    });

    const teamList = Object.values(playersMap);
    if (!teamList.length) return [];

    // 1. Identifica a Posição 2 (Midlaner)
    let midPlayer = teamList.reduce((prev, curr) => (curr.midCount > prev.midCount ? curr : prev), teamList[0]);
    if (midPlayer && midPlayer.midCount > 0) {
      midPlayer.position = 2;
    } else {
      const sortedByGpm = [...teamList].sort((a, b) => (b.gpm / b.games) - (a.gpm / a.games));
      midPlayer = sortedByGpm[1] || sortedByGpm[0];
      if (midPlayer) midPlayer.position = 2;
    }

    // 2. Separa os demais jogadores entre Cores e Suportes por GPM médio
    const remaining = teamList.filter((p) => p !== midPlayer);
    remaining.sort((a, b) => (b.gpm / (b.games || 1)) - (a.gpm / (a.games || 1)));

    if (remaining.length >= 4) {
      const core1 = remaining[0];
      const core2 = remaining[1];
      const sup1 = remaining[2];
      const sup2 = remaining[3];

      // Posição 1 (Carry) vs Posição 3 (Offlane)
      if (core1.safeCount >= core2.safeCount) {
        core1.position = 1;
        core2.position = 3;
      } else {
        core1.position = 3;
        core2.position = 1;
      }

      // Posição 4 (Soft Support) vs Posição 5 (Hard Support)
      sup1.position = 4;
      sup2.position = 5;
    } else {
      remaining.forEach((p, i) => {
        p.position = i === 0 ? 1 : i === 1 ? 3 : i === 2 ? 4 : 5;
      });
    }

    return teamList.sort((a, b) => (a.position || 0) - (b.position || 0));
  } catch (err) {
    console.error("Erro ao calcular médias do time:", err);
    return [];
  }
}

async function openAgendaMatch(item) {
  $("#match-modal").classList.remove("hidden");
  stopLiveMinimap();
  $("#match-detail").innerHTML = `<div class="empty-state">Carregando todas as partidas do torneio...</div>`;

  await ensureLeaguesLoaded().catch(() => {});
  const leagueId = item.torneio ? leagueIdByName(item.torneio) : null;
  const when = new Date(item.data).toLocaleString("pt-BR", { 
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" 
  });

  let rosterA = [], rosterB = [];

  if (leagueId) {
    [rosterA, rosterB] = await Promise.all([
      getTeamRosterAndStats(item.timeA, leagueId),
      getTeamRosterAndStats(item.timeB, leagueId),
    ]);
  }

  const fmt = (n) => (n == null || isNaN(n) ? "-" : Number(n).toFixed(1));
  const rosterRows = (roster) => {
    if (!roster.length) return `<div class="empty-state">Nenhuma partida finalizada encontrada para este time no torneio ainda.</div>`;
    return `<table class="player-table">
      <thead><tr><th>Posição</th><th>Jogador</th><th>Jogos</th><th>K</th><th>D</th><th>A</th><th>KDA</th><th>GPM</th><th>XPM</th></tr></thead>
      <tbody>${roster.map((p) => {
        const k = p.games ? p.kills / p.games : null;
        const d = p.games ? p.deaths / p.games : null;
        const a = p.games ? p.assists / p.games : null;
        const kda = p.games ? (d > 0 ? (k + a) / d : k + a) : null;
        return `<tr>
          <td>${NUMERIC_POSITION_LABELS[p.position] || `Posição ${p.position}` || "—"}</td>
          <td>${p.nickname}</td>
          <td class="numeric">${p.games}</td>
          <td class="numeric">${fmt(k)}</td>
          <td class="numeric">${fmt(d)}</td>
          <td class="numeric">${fmt(a)}</td>
          <td class="numeric">${fmt(kda)}</td>
          <td class="numeric">${p.games ? Math.round(p.gpm / p.games) : "-"}</td>
          <td class="numeric">${p.games ? Math.round(p.xpm / p.games) : "-"}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
  };

  $("#match-detail").innerHTML = `
    <div class="match-header">
      <div>${item.timeA || "A definir"} <span class="score" style="font-size:20px">${item.formato || "vs"}</span> ${item.timeB || "A definir"}</div>
      <div class="match-meta" style="justify-content:center;gap:16px"><span>${when}</span>${item.fase ? `<span>${item.fase}</span>` : ""}</div>
    </div>
    ${!leagueId ? `<div class="section-sub" style="text-align:center;margin-bottom:12px">Médias indisponíveis — torneio "${item.torneio}" não encontrado.</div>` : ""}
    <div class="team-block-title">${item.timeA || "Time A"}</div>
    ${rosterRows(rosterA)}
    <div class="team-block-title">${item.timeB || "Time B"}</div>
    ${rosterRows(rosterB)}
  `;
}

async function loadManualAgenda() {
  try {
    const res = await fetch(`/agenda.json?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return "";
    const items = await res.json();
    if (!Array.isArray(items) || !items.length) return "";

    const now = Date.now();
    const future = items
      .filter((it) => it.data && new Date(it.data).getTime() > now)
      .sort((a, b) => new Date(a.data) - new Date(b.data));
    if (!future.length) return "";

    const teamIndex = await ensureTeamsByNameIndex().catch(() => ({}));
    const cardsHtml = future.map((it, i) => {
      const logoA = teamLogoByName(teamIndex, it.timeA);
      const logoB = teamLogoByName(teamIndex, it.timeB);
      const when = new Date(it.data).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      return `<div class="match-card" data-agenda="${i}">
        <div class="match-teams">
          <div class="team-side">${teamLogoImg(logoA, it.timeA)}<span class="team-name">${it.timeA || "A definir"}</span></div>
          <span class="score" style="font-size:13px">${it.formato || "vs"}</span>
          <div class="team-side team-side-right"><span class="team-name">${it.timeB || "A definir"}</span>${teamLogoImg(logoB, it.timeB)}</div>
        </div>
        <div class="match-meta"><span>${when}</span><span>${it.fase || ""}</span></div>
      </div>`;
    }).join("");

    if (future[0].torneio) $("#next-league-name").textContent = `— ${future[0].torneio}`;
    setTimeout(() => {
      document.querySelectorAll("[data-agenda]").forEach((el) => {
        el.addEventListener("click", () => openAgendaMatch(future[+el.dataset.agenda]));
      });
    }, 0);
    return `<div class="date-group"><div class="date-group-header">Agendadas</div><div class="match-grid">${cardsHtml}</div></div>`;
  } catch { return ""; }
}

async function loadUpcoming() {
  const box = $("#upcoming-list");
  const label = $("#next-league-name");
  box.innerHTML = `<div class="empty-state">Carregando...</div>`;

  const featured = window.__featuredLeague;
  let liveHtml = "";
  const liveGames = (featured && featured.isLive) ? featured.liveGames : [];
  if (liveGames.length) {
    await ensureTeamLogos(liveGames.flatMap((g) => [g.radiant_team && g.radiant_team.team_id, g.dire_team && g.dire_team.team_id])).catch(() => {});
    const liveCards = liveGames.map((g, i) => renderLiveCard(g, i)).join("");
    liveHtml = `<div class="date-group" id="upcoming-live-block"><div class="date-group-header">Ao vivo agora</div><div class="match-grid">${liveCards}</div></div>`;
  }

  let scheduledHtml = await loadManualAgenda();

  if (!scheduledHtml) {
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
    } catch { /* agenda oficial instável */ }
  }

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
    } catch { /* ignora se falhar */ }
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
    const featured = window.__featuredLeague;
    if (!featured) { box.innerHTML = `<div class="empty-state">Nenhum torneio premium/profissional recente encontrado.</div>`; return; }
    label.textContent = `— ${featured.name}${featured.isLive ? " (em andamento)" : ""}`;

    let matches = await odFetch(`leagues/${featured.leagueid}/matches`);
    matches = await enrichTeamNames(matches);
    matches.sort((a, b) => b.start_time - a.start_time);

    let series;
    try {
      series = attachOpenDotaGames(await fetchStratzSeriesForLeague(featured.leagueid), matches);
    } catch {
      series = groupIntoSeries(matches);
    }
    series = series.sort((a, b) => b.startTime - a.startTime).slice(0, 8);
    if (!series.length) { box.innerHTML = `<div class="empty-state">Esse torneio ainda não tem resultados.</div>`; }
    else {
      box.innerHTML = await renderSeriesGrouped(series);
      attachSeriesClicks(box, series);
    }

    window.__lastFinishedLeagueId = featured.leagueid;
    window.__lastFinishedLeagueName = featured.name;
    window.__lastFinishedIsLive = featured.isLive;
  } catch {
    box.innerHTML = `<div class="empty-state">Não foi possível carregar os últimos resultados.</div>`;
  }
}

async function loadDefaultStandings() {
  if (window.__lastFinishedLeagueId) {
    cachedMatches = null;
    await loadStandingsFor(window.__lastFinishedLeagueId, window.__lastFinishedLeagueName, window.__lastFinishedIsLive ? "live" : true);
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
  stopLiveMinimap();
  try {
    const m = await odFetch(`matches/${matchId}`);
    await enrichTeamNames([m]);
    await enrichPlayerNames(m.players || []);
    $("#match-detail").innerHTML = renderMatchDetail(m);
  } catch { $("#match-detail").innerHTML = `<div class="empty-state">Erro ao carregar detalhe da partida.</div>`; }
}
$("#btn-close-match").addEventListener("click", () => { $("#match-modal").classList.add("hidden"); stopLiveMinimap(); });
$("#match-modal-backdrop").addEventListener("click", () => { $("#match-modal").classList.add("hidden"); stopLiveMinimap(); });

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

/* ---------- Ranking MMR ---------- */
$$(".main-tab-btn").forEach((btn) => btn.addEventListener("click", () => switchMainView(btn.dataset.view)));
function switchMainView(view) {
  $$(".main-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#layout").classList.toggle("hidden", view !== "torneios");
  $("#view-ranking").classList.toggle("hidden", view !== "ranking");
  $("#view-heroes").classList.toggle("hidden", view !== "heroes");
  if (view === "torneios" && !currentLeague) { startOverviewLivePolling(); startOverviewResultsPolling(); }
  else { stopOverviewLivePolling(); stopOverviewResultsPolling(); }
  if (view === "torneios" && currentLeague) {
    startStandingsPolling();
    if ($("#tab-results") && !$("#tab-results").classList.contains("hidden")) startResultsPolling();
    if ($("#tab-live") && !$("#tab-live").classList.contains("hidden")) startLivePolling();
  } else {
    stopStandingsPolling();
    stopResultsPolling();
    stopLivePolling();
  }
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

/* ---------- Ranking MMR (STRATZ Leaderboard Aprimorado) ---------- */
/* ---------- Ranking MMR Oficial (Valve via Netlify Function) ---------- */
async function loadRanking(division) {
  const requestId = ++window.__rankingRequestId || (window.__rankingRequestId = 1);
  const body = $("#ranking-body");
  $("#ranking-updated").textContent = "";
  body.innerHTML = `<tr><td colspan="4" class="empty-state">Carregando Leaderboard Oficial da Valve...</td></tr>`;

  try {
    // Chama a Netlify Function configurada
    const res = await fetch(`/.netlify/functions/leaderboard?division=${encodeURIComponent(division)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (requestId !== window.__rankingRequestId) return;

    if (!data.ok || !data.leaderboard || !data.leaderboard.length) {
      body.innerHTML = `<tr><td colspan="4" class="empty-state">Nenhum jogador retornado pela Valve para essa região.</td></tr>`;
      return;
    }

    const players = data.leaderboard;
    const total = data.total_rows || players.length;
    const postTime = data.time_posted 
      ? new Date(data.time_posted * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) 
      : "";

    $("#ranking-updated").textContent = `${total.toLocaleString("pt-BR")} jogadores na tabela oficial — Atualizado pela Valve em ${postTime}`;

    // Exibe os 100 primeiros colocados
    const topPlayers = players.slice(0, 100);

    body.innerHTML = topPlayers.map((p) => {
      const team = p.team_tag ? `<span class="team-tag" style="color:var(--accent,#e0a020);font-weight:bold;margin-right:6px">[${p.team_tag}]</span>` : "";
      const sponsor = p.sponsor ? ` <span style="color:#888;font-size:12px">(${p.sponsor})</span>` : "";
      const country = p.country ? p.country.toUpperCase() : "—";

      return `<tr>
        <td style="font-weight:bold;color:var(--accent,#e0a020);width:60px">${p.rank}</td>
        <td>
          <div style="display:flex;align-items:center">
            <span style="font-weight:600">${team}${p.name || "Anônimo"}${sponsor}</span>
          </div>
        </td>
        <td><span class="country-badge" style="font-size:12px;opacity:0.85">${country}</span></td>
        <td class="numeric" style="color:var(--text-dim, #888);font-size:13px">${p.rank <= 10 ? "Top 10" : p.rank <= 100 ? "Top 100" : "Immortal"}</td>
      </tr>`;
    }).join("");

  } catch (err) {
    if (requestId !== window.__rankingRequestId) return;
    body.innerHTML = `<tr><td colspan="4" class="empty-state" style="white-space:normal">Erro ao carregar o ranking oficial.<br>${err.message || ""}</td></tr>`;
  }
}

/* ---------- Heróis: build por posição (STRATZ) ---------- */
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
    const filtered = items.filter((i) => i.position === selectedPosition);
    const byItem = {};
    filtered.forEach((i) => {
      const acc = byItem[i.itemId] || (byItem[i.itemId] = { itemId: i.itemId, matchCount: 0, winCount: 0, timeSum: 0, timeN: 0 });
      acc.matchCount += i.matchCount || 0;
      acc.winCount += i.winCount || 0;
      if (i.time != null) { acc.timeSum += i.time; acc.timeN++; }
    });
    let list = Object.values(byItem).map((i) => ({ ...i, time: i.timeN ? i.timeSum / i.timeN : null }));
    list.sort((a, b) => b.matchCount - a.matchCount);
    let top = list.slice(0, opts.take);
    if (opts.sortByTime) top = top.sort((a, b) => (a.time || 0) - (b.time || 0));
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
  startOverviewLivePolling();
  startOverviewResultsPolling();
})();