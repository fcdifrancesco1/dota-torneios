// Proxy para a Steam Web API oficial da Valve (IDOTA2Match_570/GetLiveLeagueGames).
// A chave (STEAM_API_KEY) fica só aqui no backend, nunca é exposta ao navegador.
// Uso: /.netlify/functions/live            -> todas as partidas de liga ao vivo
//      /.netlify/functions/live?league_id=X -> filtra por liga

exports.handler = async (event) => {
  const key = process.env.STEAM_API_KEY;

  if (!key) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "STEAM_API_KEY não configurada nas variáveis de ambiente do Netlify.",
      }),
    };
  }

  const leagueId = event.queryStringParameters && event.queryStringParameters.league_id;

  let url = `https://api.steampowered.com/IDOTA2Match_570/GetLiveLeagueGames/v1/?key=${key}`;
  if (leagueId) url += `&league_id=${encodeURIComponent(leagueId)}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();

    return {
      statusCode: resp.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=15", // partidas ao vivo mudam rápido
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Falha ao consultar a Steam Web API", detail: String(err) }),
    };
  }
};
