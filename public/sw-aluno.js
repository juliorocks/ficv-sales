// Service worker do Portal do Aluno — existe só pra o navegador oferecer "Instalar app".
// NÃO faz cache (o deploy da Vercel serve sempre a versão nova); requisições seguem direto pra rede.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => { /* passa direto */ })
