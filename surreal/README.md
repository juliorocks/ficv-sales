# SurrealDB — Migração Paralela

## Credenciais

| Item | Valor |
|---|---|
| Endpoint | `https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud` |
| WSS | `wss://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud` |
| Namespace | `ficv` |
| Database | `salespulse` |
| Usuário DB | `ficv_admin` / `Ficv@Surreal2026!` |

Token cloud (Surreal Cloud dashboard) expira em **10 minutos** — use sempre `ficv_admin` no lugar.

## Status

- [x] Schema aplicado (39 tabelas, 2 accesses, 1 function)
- [x] Usuário `ficv_admin` criado com OWNER no namespace
- [ ] Sincronização inicial (aguarda Supabase voltar)
- [ ] Dual-write no app
- [ ] Migração de leitura tabela a tabela
- [ ] Migração de auth
- [ ] Cutover final

## Como rodar o sync inicial

```bash
cd /caminho/para/ficv-sales-1

# Exporta variáveis (ou use .env.surreal)
export SUPABASE_SERVICE_KEY="<service_role_key_do_.env.local>"

# Roda migração completa
node surreal/sync-supabase-to-surreal.js

# Roda só uma tabela (para teste)
node surreal/sync-supabase-to-surreal.js stages
```

Sem `SURREAL_TOKEN`, o script faz signin automático como `ficv_admin`.

## Autenticação app

### Staff (admin/agentes)
```js
// SIGNUP
fetch('/signin', { body: JSON.stringify({
  ac: 'staff', ns: 'ficv', db: 'salespulse',
  email, password, full_name
})})

// SIGNIN
fetch('/signin', { body: JSON.stringify({
  ac: 'staff', ns: 'ficv', db: 'salespulse',
  email, password
})})
```

### Alunos
```js
fetch('/signin', { body: JSON.stringify({
  ac: 'alunos', ns: 'ficv', db: 'salespulse',
  email, password
})})
```
