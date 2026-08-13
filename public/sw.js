const CACHE = "dota-torneios-v2";
const ASSETS = ["./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Nunca cachear chamadas de API nem a agenda manual (dados sempre têm que vir frescos)
  if (e.request.url.includes("/api/") || e.request.url.includes("/.netlify/functions/") || e.request.url.includes("agenda.json")) return;

  const isCoreFile = /\.(html|js|css)$/.test(new URL(e.request.url).pathname) || e.request.mode === "navigate";

  if (isCoreFile) {
    // network-first: sempre tenta buscar a versão mais nova; só usa cache se estiver offline
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // cache-first pra imagens/ícones (mudam pouco, não custa nada manter)
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => cached);
    })
  );
});
