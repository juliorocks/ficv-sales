# Cutover SurrealDB → Supabase (projeto CRM-FICV)

Sequência para virar a produção. O rollback continua seguro durante todo o
período de dual-write (ver `ROLLBACK.md`).

## Pré-requisitos (fazer antes, sem pressa)

- [ ] **Secrets no GitHub** (repo `juliorocks/ficv-sales` → Settings → Secrets → Actions):
  - `SUPABASE_URL` = `https://jsswkmybkgoxpncnxgdd.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` = (service_role do projeto novo — está no `.env.local`)
- [ ] **Secret no Supabase** (projeto novo → Project Settings → Edge Functions → Secrets):
  - `GITHUB_DISPATCH_TOKEN` = PAT do GitHub com escopo `actions:write` (pode ser o mesmo do `VITE_GITHUB_SYNC_TOKEN`)
- [ ] **Upgrade do projeto novo para Pro** + compute **Small** (Settings → Billing). No Free ele pausa e limita.
- [ ] `npm run build` passa na branch `test-supabase-migration`.
- [ ] Rodar 1x cada workflow de sync no GitHub (Actions → Run workflow) e conferir
      que gravou no Postgres (dual-write) sem erro.

## Cutover (janela curta, ~5 min)

1. **Vercel → Settings → Environment Variables** (Production), trocar:
   ```
   VITE_SUPABASE_URL      = https://jsswkmybkgoxpncnxgdd.supabase.co
   VITE_SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impzc3drbXlia2dveHBuY254Z2RkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NDE2NDIsImV4cCI6MjEwNDAxNzY0Mn0.QeFd3l_pyNeoN5lVUy1d1Vo47KsbQ4vWaNXD_f2js9s
   ```
   (as `VITE_SURREAL_*` podem ficar — o código novo não usa.)

2. **Merge + deploy** (dispara o build no Vercel):
   ```bash
   git checkout main
   git merge test-supabase-migration
   git push origin main
   ```

3. **Repontar a ingestão de leads:**
   - **WideChat** (painel → webhooks): URL →
     `https://jsswkmybkgoxpncnxgdd.supabase.co/functions/v1/widechat-webhook`
   - **SendPulse**: NÃO tem webhook (`sendpulse_webhook_logs` sempre teve 0 registros).
     A ingestão é por **polling** — a edge function `sync-sendpulse-forms` chama a
     API do SendPulse a cada 3 min. Trocar o poller:
     a) **No projeto ANTIGO** (SQL Editor): `SELECT cron.unschedule('sync-sendpulse-forms');`
     b) **No projeto NOVO** (via CLI já linkado):
        ```
        supabase db query "SELECT cron.schedule('sync-sendpulse-forms','*/3 * * * *', \$\$ SELECT net.http_post(url:='https://jsswkmybkgoxpncnxgdd.supabase.co/functions/v1/sync-sendpulse-forms', headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY_NOVO>'), body:=jsonb_build_object('trigger','cron')); \$\$);" --linked
        ```
     (o cron novo está DESLIGADO de propósito até aqui, pra não haver dois pollers.)

4. **Verificar** (com um usuário staff):
   - Login com a senha atual
   - Kanban carrega, arrastar um lead grava
   - Conversas abre e mostra histórico
   - Mandar um WhatsApp de teste para o número comercial → em ~10s aparece um
     lead/mensagem novo no Kanban (webhook → Postgres)
   - Dashboard de qualidade e Campanhas carregam

## Depois do cutover

- **Dual-write fica ligado** (edge functions espelham no SurrealDB; GH Actions
  gravam nos dois). Rollback continua sem perda.
- Monitorar 24–48h. Logs das edge functions: Supabase → Edge Functions → Logs.
- Depois de ~2–4 semanas estável:
  - Remover as chamadas `mirror(...)` das edge functions e o dual-write dos
    `scripts/sync-*.mjs` (tirar `pg-mirror` → deixar só Postgres, ou o contrário
    se decidir manter SurrealDB… não vai ser o caso).
  - Desativar a instância SurrealDB Cloud.
  - Apagar `supabase/functions/sync-sendpulse-api` (legado, não usado).
  - Remover `src/lib/surreal.ts` (já não é importado).

## Rollback

`scripts/rollback-to-surrealdb.sh` + reverter env do Vercel + repontar webhooks
de volta + `Restore project` no Supabase antigo. Ver `ROLLBACK.md`.
