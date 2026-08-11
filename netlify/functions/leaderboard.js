// Proxy para o leaderboard oficial de MMR (dota2.com), separado da Steam Web API — não precisa de chave.
// Uso: /.netlify/functions/leaderboard?division=europe
// Divisões válidas: americas | europe | china | se_asia

const VALID = ["americas", "europe", "china", "se_asia"];

exports.handler = async (event) => {
  const division = (event.queryStringParameters && event.queryStringParameters.division) || "europe";
  if (!VALID.includes(division)) {
    return { statusCode: 400, body: JSON.stringify({ error: "divisão inválida" }) };
  }

  const url = `https://www.dota2.com/webapi/ILeaderboard/GetDivisionLeaderboard/v0001?division=${division}`;

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
      },
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); }
    catch {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Resposta da Valve não é JSON", status: resp.status, preview: text.slice(0, 300) }),
      };
    }
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=1800", // a Valve só atualiza de hora em hora
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "Falha ao consultar o leaderboard da Valve", detail: String(err) }) };
  }
};
