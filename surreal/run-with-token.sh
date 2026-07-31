#!/bin/bash
# run-with-token.sh <token> <arquivo.surql>
# Aplica um arquivo SurrealQL no Cloud usando o token temporário (10min)
set -e

TOKEN="$1"
FILE="$2"
HTTP="https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud"

if [[ -z "$TOKEN" || -z "$FILE" ]]; then
  echo "Uso: ./surreal/run-with-token.sh <jwt_token> <arquivo.surql>"
  exit 1
fi

curl -s -w "\nHTTP %{http_code}" \
  -X POST "${HTTP}/sql" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "surreal-ns: ficv" \
  -H "surreal-db: salespulse" \
  -H "Content-Type: text/plain" \
  --data-binary @"$FILE" | python3 -c "
import sys, json
raw = sys.stdin.read().strip().split('\n')
http = raw[-1]
body = '\n'.join(raw[:-1])
try:
    data = json.loads(body)
    erros = [r for r in data if r.get('status') == 'ERR']
    oks   = [r for r in data if r.get('status') == 'OK']
    print(f'{http}  —  OK: {len(oks)}  ERR: {len(erros)}')
    for e in erros[:5]:
        print(' !', str(e.get('result',''))[:200])
    for o in oks:
        if o.get('result') not in [None, [], 'NONE']:
            print(' >', json.dumps(o['result'])[:200])
except:
    print(http, body[:500])
"
