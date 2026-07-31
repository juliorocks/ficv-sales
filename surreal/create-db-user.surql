-- Cria usuário root permanente no namespace ficv
-- Rodar uma vez com token cloud (10min), depois usa admin/senha
DEFINE USER IF NOT EXISTS ficv_admin ON NAMESPACE
  PASSWORD 'Ficv@Surreal2026!'
  ROLES OWNER;

-- Alternativa: usuário no banco salespulse
DEFINE USER IF NOT EXISTS ficv_admin ON DATABASE
  PASSWORD 'Ficv@Surreal2026!'
  ROLES OWNER;

-- Confirma
SELECT * FROM $auth;
INFO FOR NS;
