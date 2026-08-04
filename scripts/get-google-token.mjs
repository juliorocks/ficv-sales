#!/usr/bin/env node
// Gera um novo refresh_token para Google Ads via OAuth2
// Uso: node --env-file=.env.local scripts/get-google-token.mjs

import { createServer } from 'http';
import { URL } from 'url';

const CLIENT_ID     = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:8080';
const SCOPE         = 'https://www.googleapis.com/auth/adwords';

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌  GOOGLE_ADS_CLIENT_ID e GOOGLE_ADS_CLIENT_SECRET precisam estar no .env.local');
    process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/auth?' + new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPE,
    access_type:   'offline',
    prompt:        'consent',  // força geração de novo refresh_token
}).toString();

console.log('\n─────────────────────────────────────────────────────────');
console.log('1. Abra este URL no browser:\n');
console.log(authUrl);
console.log('\n2. Faça login com a conta do Google Ads e autorize o acesso.');
console.log('3. Aguardando callback em http://localhost:8080 ...');
console.log('─────────────────────────────────────────────────────────\n');

const server = createServer(async (req, res) => {
    const reqUrl = new URL(req.url, 'http://localhost:8080');
    const code   = reqUrl.searchParams.get('code');
    const error  = reqUrl.searchParams.get('error');

    if (error) {
        res.writeHead(400); res.end(`Erro OAuth: ${error}`);
        console.error('❌  Erro OAuth:', error);
        server.close(); return;
    }
    if (!code) { res.end('Sem código — tente novamente.'); return; }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2 style="font-family:sans-serif">✅ Autorizado! Feche esta aba e volte ao terminal.</h2>');

    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id:     CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri:  REDIRECT_URI,
                grant_type:    'authorization_code',
            }).toString(),
        });
        const tokens = await tokenRes.json();

        if (tokens.error) {
            console.error('❌  Erro ao trocar código:', tokens.error, tokens.error_description);
        } else {
            console.log('✅  Novo refresh_token gerado:\n');
            console.log(tokens.refresh_token);
            console.log('\n─────────────────────────────────────────────────────────');
            console.log('Atualize no .env.local:');
            console.log(`GOOGLE_ADS_REFRESH_TOKEN=${tokens.refresh_token}`);
            console.log('\nE nos secrets do Supabase:');
            console.log(`supabase secrets set GOOGLE_ADS_REFRESH_TOKEN="${tokens.refresh_token}"`);
            console.log('─────────────────────────────────────────────────────────\n');
        }
    } catch (e) {
        console.error('❌  Erro:', e.message);
    }

    server.close();
});

server.listen(8080, () => {
    console.log('Servidor local ouvindo em :8080 — aguardando autorização...\n');
});
