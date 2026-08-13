// Proxy para a OpenDota API.
// Uso: /.netlify/functions/opendota?path=leagues
//      /.netlify/functions/opendota?path=leagues/16935/matches
//      /.netlify/functions/opendota?path=matches/7891234567
//      /.netlify/functions/opendota?path=constants/heroes
//      /.netlify/functions/opendota?path=constants/items

const BASE = "https://api.opendota.com/api";

// Caminhos permitidos (evita virar um proxy aberto pra qualquer URL)
function isAllowed(path) {
  return (
    path === "leagues" ||
    path === "teams" ||
    /^leagues\/\d+\/matches$/.test(path) ||
    /^matches\/\d+$/.test(path) ||
    /^teams\/\d+$/.test(path) ||
    /^players\/\d+$/.test(path) ||
    path === "proMatches" ||
    path === "constants/heroes" ||
    path === "constants/items"
  );
}

exports.handler = async (event) => {
  const path = event.queryStringParameters && event.queryStringParameters.path;

  if (!path || !isAllowed(path)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "path inválido ou não permitido" }),
    };
  }

  try {
    const resp = await fetch(`${BASE}/${path}`);
    const data = await resp.json();

    // cache curto no navegador/CDN pra não bater na OpenDota toda hora
    const cacheSeconds = path.startsWith("constants/") || path.startsWith("teams/") || path === "teams" ? 86400
      : path.startsWith("players/") ? 3600
      : path === "proMatches" ? 60
      : 30;

    return {
      statusCode: resp.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${cacheSeconds}`,
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Falha ao consultar a OpenDota", detail: String(err) }),
    };
  }
};
