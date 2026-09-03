# Rollback da migração SurrealDB → Supabase

Estado da migração e como voltar tudo para o SurrealDB se algo der errado.

## Projetos

| | ref / host | papel |
|---|---|---|
| SurrealDB Cloud | `heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud` (ns `ficv` / db `salespulse`) | **primário em produção hoje** |
| Supabase NOVO | `jsswkmybkgoxpncnxgdd` — "CRM-FICV" (São Paulo) | alvo da migração |
| Supabase ANTIGO | `znypfroagfwohqeyxyqv` — "FICV-SALES-Pulse" | pausado; só auth de aluno / Storage histórico |

## Ponto de restauração

- **Tag git `pre-supabase-migration`** — estado seguro: produção rodando SurrealDB via proxy `src/lib/supabase.ts`.
- **Branch `main`** = SurrealDB (não mexer até o cutover). **Branch `test-supabase-migration`** = client Supabase direto.
- **Backup frio SurrealDB**: `scratchpad/migrate/backups/surreal-full/*.ndjson` (todas as tabelas, todas as linhas).
- **Backup Supabase novo**: `scratchpad/migrate/backups/supabase-novo-*.sql` (pg_dump completo — schema + dados).
- **Scripts da migração**: `scratchpad/migrate/` (export, load, auth, storage).

## Fase atual: TESTE (produção intacta)

Nada em produção mudou. O Vercel continua servindo `main` → SurrealDB. O teste roda **local** na branch `test-supabase-migration`.

**Rollback nesta fase = não fazer nada.** É só voltar pra branch `main`:
```
git checkout main
```
O SurrealDB nunca deixou de ser primário e nunca teve escrita/exclusão pela migração (só leitura).

## Depois do CUTOVER (Vercel apontando pro Supabase novo)

Aí o rollback tem custo: escritas feitas no Postgres depois do cutover não estão no SurrealDB.
Por isso o cutover só acontece **com dual-write ativo** (as edge functions revertidas e o
frontend novo escrevem no Postgres E espelham no SurrealDB por ~2-4 semanas). Enquanto o
dual-write estiver ligado, o rollback é sem perda.

### Passos do rollback pós-cutover

1. **Vercel → Environment Variables**: restaurar
   ```
   VITE_SUPABASE_URL      = https://znypfroagfwohqeyxyqv.supabase.co
   VITE_SUPABASE_ANON_KEY = <anon key do projeto ANTIGO>   (ver Supabase dashboard)
   ```
2. **Vercel → Deployments**: "Redeploy" o último deploy da tag `pre-supabase-migration`
   (ou `git checkout pre-supabase-migration && vercel --prod`).
3. **Despausar o Supabase ANTIGO** (`znypfroagfwohqeyxyqv`) — Restore project. Necessário porque
   as edge functions da era SurrealDB são servidas em `znypfro….supabase.co/functions/v1/*`
   (elas escrevem direto no SurrealDB, não no Postgres antigo).
4. **Rodar `scripts/rollback-to-surrealdb.sh`** — sincroniza o delta Postgres→SurrealDB
   (o que foi escrito depois do cutover e ainda não espelhou) e confirma o estado.
5. Validar login (staff via SurrealDB `ac: staff`), Kanban, Conversas.

### Se o dual-write NÃO estava ativo (cutover "seco")

O delta pós-cutover só existe no Postgres. `scripts/rollback-to-surrealdb.sh --full-delta`
faz o sync reverso de TODAS as tabelas operacionais Postgres→SurrealDB antes de voltar.
Aceitável perder segundos/minutos de escrita concorrente durante a virada.

## Restaurar o Supabase novo a partir do dump (se precisar recomeçar sem re-rodar o pipeline)

```
psql "<PG_URL do projeto novo>" -f scratchpad/migrate/backups/supabase-novo-AAAAMMDD-HHMM.sql
```

## Restaurar o SurrealDB a partir do backup frio (só se a instância morrer)

```
cd scratchpad/migrate && node restore-surreal.mjs   # (a criar quando/se necessário)
```
Os `.ndjson` em `backups/surreal-full/` têm os record-ids originais, então o INSERT recria
os registros idênticos.
