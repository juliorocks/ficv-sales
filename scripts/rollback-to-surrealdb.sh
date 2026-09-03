#!/usr/bin/env bash
# Rollback da migração: volta a produção para o SurrealDB.
# Uso:
#   scripts/rollback-to-surrealdb.sh            # fase de teste: só volta o git p/ main
#   scripts/rollback-to-surrealdb.sh --delta    # pós-cutover c/ dual-write: sincroniza delta Postgres->SurrealDB
#   scripts/rollback-to-surrealdb.sh --full-delta  # pós-cutover seco: sync reverso completo
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-git-only}"

echo "== ROLLBACK PARA SURREALDB =="
echo

# 1. Git: volta para o estado seguro
CUR="$(git branch --show-current || echo detached)"
echo "[1] git — branch atual: $CUR"
if [ "$CUR" != "main" ]; then
  git stash push -u -m "rollback-stash-$(date +%s)" || true
  git checkout main
fi
echo "    -> em main (proxy SurrealDB). Tag de referência: pre-supabase-migration"
echo

# 2. .env.local
if [ -f .env.local ] && grep -q 'jsswkmybkgoxpncnxgdd' .env.local; then
  echo "[2] .env.local ainda aponta pro projeto NOVO."
  echo "    Ajuste manual (produção usa o Vercel, mas o dev local precisa disso):"
  echo "      VITE_SUPABASE_URL=https://znypfroagfwohqeyxyqv.supabase.co"
  echo "      VITE_SUPABASE_ANON_KEY=<anon do projeto antigo>"
else
  echo "[2] .env.local OK"
fi
echo

# 3. Sync reverso do delta (só pós-cutover)
case "$MODE" in
  --delta)
    echo "[3] sincronizando delta Postgres->SurrealDB (rows com updated_at > último cutover)..."
    node scratchpad/migrate/reverse-sync.mjs --since-cutover
    ;;
  --full-delta)
    echo "[3] sync reverso COMPLETO Postgres->SurrealDB (todas as tabelas operacionais)..."
    node scratchpad/migrate/reverse-sync.mjs --all
    ;;
  *)
    echo "[3] modo git-only — sem sync de dados (fase de teste, SurrealDB nunca ficou atrás)."
    ;;
esac
echo

# 4. Checklist manual
cat <<'EOF'
[4] PASSOS MANUAIS (fora do alcance deste script):
    a) Vercel > Settings > Environment Variables:
         VITE_SUPABASE_URL      = https://znypfroagfwohqeyxyqv.supabase.co
         VITE_SUPABASE_ANON_KEY = <anon key do projeto antigo>
    b) Vercel > Deployments > redeploy da tag `pre-supabase-migration`
         (ou: git checkout pre-supabase-migration && vercel --prod)
    c) Supabase: despausar o projeto ANTIGO (znypfroagfwohqeyxyqv) — Restore project
    d) Testar: login staff, Kanban, Conversas, Dashboard
EOF
echo
echo "== rollback (parte automática) concluído =="
