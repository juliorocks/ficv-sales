#!/bin/bash
# Publica o sistema no servidor AWS (homologação ou produção).
# Uso: scripts/deploy-aws.sh <hml|prod> [tudo|site|funcoes|migrations] [--sim]
#   tudo (padrão) = migrations + funções + site. --sim pula a confirmação (produção sempre pede, a menos que --sim).
# Nada de segredo aqui: a chave anon vem do .env do próprio servidor, a chave SSH é ~/.ssh/chave-erp-<hml|prod>.pem.
# Servidor = DNS (sistema-hml / sistema do cidadeviva.org); IP nunca entra no repositório.
set -euo pipefail
cd "$(dirname "$0")/.."

AMB="${1:-}"; ALVO="${2:-tudo}"; SIM=0
for a in "$@"; do [ "$a" = "--sim" ] && SIM=1; done
case "$AMB" in
  hml)  HOST="sistema-hml.cidadeviva.org"; API="https://api-hml.cidadeviva.org" ;;
  prod) HOST="sistema.cidadeviva.org";     API="https://api.cidadeviva.org" ;;
  *) echo "Uso: $0 <hml|prod> [tudo|site|funcoes|migrations] [--sim]"; exit 1 ;;
esac
case "$ALVO" in tudo|site|funcoes|migrations|--sim) ;; *) echo "alvo inválido: $ALVO"; exit 1 ;; esac
[ "$ALVO" = "--sim" ] && ALVO=tudo

KEY="${DEPLOY_KEY:-$HOME/.ssh/chave-erp-$AMB.pem}"
[ -f "$KEY" ] || { echo "Chave SSH não encontrada: $KEY"; exit 1; }
SSH_OPTS=(-i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
srv() { ssh "${SSH_OPTS[@]}" "ubuntu@$HOST" "$@"; }
STACK='~/ficv-stack'
DC='sudo docker compose -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.ficv.yml'

# Guarda de produção: só publica o que está no main e já foi para o GitHub.
if [ "$AMB" = "prod" ]; then
  [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Produção só a partir do main."; exit 1; }
  git fetch -q origin main
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main local diferente do origin/main (falta push ou pull)."; exit 1; }
fi
git status --short -- src supabase/functions supabase/migrations public index.html package.json vite.config.* | grep -q . \
  && echo "AVISO: há mudanças não commitadas em src, funções ou migrations; elas serão publicadas assim mesmo." || true

if [ "$AMB" = "prod" ] && [ "$SIM" != "1" ]; then
  r=""; read -r -p "Publicar '$ALVO' em PRODUÇÃO ($HOST)? Digite 'producao' para confirmar: " r || true
  [ "$r" = "producao" ] || { echo "Cancelado."; exit 1; }
fi

echo "== $AMB ($HOST) · $ALVO · commit $(git rev-parse --short HEAD)"
srv "test -d $STACK" || { echo "~/ficv-stack não existe no servidor."; exit 1; }

# ---------- migrations ----------
migrations() {
  echo "-- migrations"
  srv "sudo docker exec supabase-db psql -U supabase_admin -d postgres -qAt -c \"create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, name text, statements text[])\"" >/dev/null
  APLICADAS=$(srv "sudo docker exec supabase-db psql -U supabase_admin -d postgres -qAt -c 'select version from supabase_migrations.schema_migrations'")
  N=0
  for f in $(ls supabase/migrations/*.sql | sort); do
    v=$(basename "$f" | cut -d_ -f1); nome=$(basename "$f" .sql | cut -d_ -f2-)
    echo "$APLICADAS" | grep -qx "$v" && continue
    echo "   aplicando $v $nome"
    { echo "SET session_replication_role=default;"; cat "$f"; } | srv "sudo docker exec -i supabase-db psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 --single-transaction" >/dev/null
    srv "sudo docker exec supabase-db psql -U supabase_admin -d postgres -qAt -c \"insert into supabase_migrations.schema_migrations(version,name) values ('$v','$nome') on conflict do nothing\"" >/dev/null
    N=$((N+1))
  done
  echo "   $N migration(s) aplicada(s)"
}

# ---------- funções ----------
funcoes() {
  echo "-- funções"
  rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
    --exclude '.DS_Store' --exclude '*.test.ts' --exclude 'main' --exclude 'hello' \
    supabase/functions/ "ubuntu@$HOST:ficv-stack/volumes/functions/"
  srv "cd $STACK && $DC restart functions >/dev/null 2>&1"
  echo "   $(ls supabase/functions | grep -v '^_' | wc -l | tr -d ' ') funções publicadas, runtime reiniciado"
}

# ---------- site ----------
site() {
  echo "-- site"
  ANON=$(srv "grep '^ANON_KEY=' $STACK/.env | cut -d= -f2-")
  [ -n "$ANON" ] || { echo "ANON_KEY não encontrada no servidor."; exit 1; }
  npx tsc --noEmit -p tsconfig.json
  git checkout -q -- 'tsconfig*.tsbuildinfo' 2>/dev/null || true
  OUT=$(mktemp -d)
  VITE_SUPABASE_URL="$API" VITE_SUPABASE_ANON_KEY="$ANON" npx vite build --outDir "$OUT" --emptyOutDir >"$OUT.log" 2>&1 || { tail -30 "$OUT.log"; exit 1; }
  rm -f "$OUT.log"
  git checkout -q -- 'tsconfig*.tsbuildinfo' 2>/dev/null || true
  # o site compilado não pode apontar para outro ambiente
  if grep -rq "jsswkmybkgoxpncnxgdd" "$OUT"; then echo "ERRO: build referencia o Supabase antigo."; rm -rf "$OUT"; exit 1; fi
  rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$OUT/" "ubuntu@$HOST:ficv-stack/site/"
  rm -rf "$OUT"
  echo "   site publicado"
}

# ---------- verificação ----------
verificar() {
  echo "-- verificação"
  ANON=$(srv "grep '^ANON_KEY=' $STACK/.env | cut -d= -f2-")
  c() { curl -s -m 20 -o /dev/null -w "%{http_code}" "$@"; }
  echo "   site /aluno ........ $(c "https://$HOST/aluno")"
  echo "   login (health) ..... $(c "$API/auth/v1/health" -H "apikey: $ANON")"
  echo "   REST ............... $(c "$API/rest/v1/stages?select=id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON")"
  echo "   função cpa-form .... $(c -X POST "$API/functions/v1/cpa-form" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -d '{"action":"get","token":"x"}') (404 = respondeu)"
  echo "   contêineres fora do ar: $(srv "cd $STACK && $DC ps --format '{{.Name}} {{.Status}}' | grep -v -E 'Up .*\(healthy\)|supabase-caddy' | wc -l | tr -d ' '")"
}

case "$ALVO" in
  tudo) migrations; funcoes; site ;;
  migrations) migrations ;;
  funcoes) funcoes ;;
  site) site ;;
esac
verificar
echo "== concluído"
