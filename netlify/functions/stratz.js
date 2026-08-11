// Proxy para o GraphQL do STRATZ (api.stratz.com/graphql).
// O token fica só aqui no backend (variável de ambiente STRATZ_API_TOKEN), nunca exposto ao navegador.
// Uso: POST /.netlify/functions/stratz  com body { query, variables }

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Use POST" }) };
  }

  const token = process.env.STRATZ_API_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: "STRATZ_API_TOKEN não configurada nas variáveis de ambiente do Netlify." }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { query, variables } = body;
  if (!query || typeof query !== "string") {
    return { statusCode: 400, body: JSON.stringify({ error: "campo 'query' obrigatório" }) };
  }
  // só permite leituras — nunca repassa mutations pra proteger a conta
  if (/\bmutation\b/i.test(query)) {
    return { statusCode: 403, body: JSON.stringify({ error: "mutations não são permitidas" }) };
  }

  try {
    const resp = await fetch("https://api.stratz.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "STRATZ_API", // o STRATZ pede um User-Agent identificável
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await resp.text();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: text,
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "Falha ao consultar o STRATZ", detail: String(err) }) };
  }
};
