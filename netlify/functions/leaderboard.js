// Proxy para o leaderboard oficial de MMR (dota2.com), separado da Steam Web API — não precisa de chave.
// Uso: /.netlify/functions/leaderboard?division=europe
// Divisões válidas (nome pedido pelo front-end): americas | europe | china | se_asia

const CANDIDATES = {
  americas: ["americas"],
  europe: ["europe"],
  china: ["china"],
  se_asia: ["se_asia"],
};

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
};

async function tryDivision(name) {
  const url = `https://www.dota2.com/webapi/ILeaderboard/GetDivisionLeaderboard/v0001?division=${name}&leaderboard=0`;
  const resp = await fetch(url, { headers: HEADERS });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* não era JSON */ }
  return { name, status: resp.status, data, preview: text.slice(0, 200) };
}

exports.handler = async (event) => {
  const requested = (event.queryStringParameters && event.queryStringParameters.division) || "europe";
  const candidates = CANDIDATES[requested] || [requested];
  const noCacheHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  const attempts = [];
  for (const name of candidates) {
    let result;
    try { result = await tryDivision(name); }
    catch (err) { result = { name, error: String(err) }; }
    attempts.push(result);
    if (result.data && result.data.success === 1 && result.data.leaderboard) {
      // IMPORTANTE: sempre statusCode 200 — um 502 aqui faz o CDN do Netlify
      // cair no modo "stale-if-error" e servir uma resposta antiga em cache.
      return { statusCode: 200, headers: noCacheHeaders, body: JSON.stringify({ ok: true, ...result.data }) };
    }
  }

  // nenhuma variação funcionou — devolve diagnóstico completo, ainda como 200
  return {
    statusCode: 200,
    headers: noCacheHeaders,
    body: JSON.stringify({ ok: false, error: "Nenhuma variação de nome de divisão funcionou", requested, attempts }),
  };
};
