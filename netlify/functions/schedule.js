// Proxy para a Steam Web API oficial da Valve (IDOTA2Match_570/GetScheduledLeagueGames).
// Retorna partidas de liga agendadas (ainda não iniciadas) num intervalo de datas.
// Uso: /.netlify/functions/schedule                 -> próximos 14 dias (padrão)
//      /.netlify/functions/schedule?days=30         -> próximos 30 dias

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

  const days = Number((event.queryStringParameters && event.queryStringParameters.days) || 14);
  const dateMin = Math.floor(Date.now() / 1000);
  const dateMax = dateMin + days * 24 * 3600;

  const url = `https://api.steampowered.com/IDOTA2Match_570/GetScheduledLeagueGames/v1/?key=${key}&date_min=${dateMin}&date_max=${dateMax}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();

    return {
      statusCode: resp.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
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
