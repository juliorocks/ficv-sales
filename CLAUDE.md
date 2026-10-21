# SALESPULSE (ficv-sales-1) — mapa do sistema

CRM + Portal do Aluno da Faculdade Internacional Cidade Viva (FICV). Frontend React/TypeScript/Vite
(deploy Vercel, SPA com rewrite pra `index.html`). Backend Supabase: Postgres + Edge Functions em Deno.
Produção: projeto Supabase `jsswkmybkgoxpncnxgdd`. Idioma de trabalho e respostas: português do Brasil.

## Como usar este arquivo (regras permanentes)

- Antes de procurar algo no código, consulte as seções abaixo. Só abra arquivos que o mapa indicar.
- **Toda mudança relevante atualiza este arquivo no mesmo commit**: nova função/tabela/tela, mudança de
  regra de negócio, armadilha nova, pendência resolvida ou aberta. Entrada curta, com data (AAAA-MM-DD).
- Se uma correção revelar um erro que pode se repetir, registre em "Armadilhas conhecidas".
- Não coloque valores de segredo aqui (tokens, chaves, senhas). Só nomes de variáveis.
- Ao criar ou alterar qualquer coisa, commit + push logo em seguida (ver "Convenções").

## Não ler (ruído — economiza tokens)

- `src/utils/chunk_*.sql`, `src/utils/migration_data*.sql`, `src/utils/migrate_kb*.sql`,
  `src/utils/ppc_*.sql`, `src/utils/widechat_integration_tables.sql`: SQL legado já aplicado.
- `build_errors*.txt`, `history.txt`, `*.tsbuildinfo`, `package-lock.json`, `.DS_Store`.
- `vivaconnect/` (zips e binários do Z-PRO), `surreal/` (legado SurrealDB), `_migration-backups/`,
  `supabase/migrations/_archive_surreal_era/`.
- Scripts soltos na raiz (`recalculate-scores*.js`, `check-agents.js`, `__tmp_*.mjs`, etc.): utilitários
  antigos, não fazem parte do app.

## Infra e acesso

- **Supabase prod**: `jsswkmybkgoxpncnxgdd`. O `.env.local` tem `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` (não copiar valores).
- **Deploy de função** (sempre que `_shared/*.ts` mudar, redeploy de TODAS as funções que importam o arquivo —
  commit sozinho não propaga):
  `export SUPABASE_ACCESS_TOKEN=$(grep -E "^SUPABASE_ACCESS_TOKEN=" .env.local | cut -d= -f2- | tr -d '"'"'"' \r') && npx supabase functions deploy <fn> --project-ref jsswkmybkgoxpncnxgdd`
  Nunca `supabase login` (outra conta, dá 403).
- **Quem importa o quê** (rodar `grep -l "_shared/<modulo>" supabase/functions/*/index.ts` pra confirmar):
  `aluno.ts` → aluno-auth, staff-tickets, tutor-virtual, aluno-portal, ticket-transfer;
  `alunoPortalCore.ts` → aluno-portal, staff-tickets, aluno-view; `vivaconnect.ts` → ai-agent, vivaconnect-api,
  vivaconnect-webhook, integrations, tutor-virtual, ticket-emails, marketing-form-submit;
  `ai.ts` → quase todas as de IA e KB; `sponte.ts` → aluno-auth, staff-tickets, integrations, tutor-virtual, ticket-transfer.
- **Migrations**: arquivo `supabase/migrations/AAAAMMDDHHMMSS_nome.sql`. Timestamps repetidos já causaram
  erro de `db push` — conferir `ls supabase/migrations | sort` antes de criar. Migration aplicada direto via
  psql precisa de `supabase migration repair --status applied`. Conexão direta `db.<ref>.supabase.co` às vezes
  não resolve DNS: usar o pooler (`aws-0-sa-east-1.pooler.supabase.com`, usuário `postgres.<ref>`), senha por flag `PGPASSWORD`.
- **GitHub Actions** (`.github/workflows/`): `sync-sponte.yml` (de hora em hora), `sync-meta-ads.yml` (`0 * * * *`),
  `sync-google-ads.yml` (`30 * * * *`); todos têm `workflow_dispatch`.
- **pg_cron** (crons do banco, chamam via `public.cron_call()` com header `x-cron-key`, nunca header anon):
  `lead-followups-dispatch`, `ticket-emails`, `vivaconnect-ai-followups`, `vivaconnect-ai-followup-giveup`,
  `vivaconnect-delivery-status`, `vivaconnect-process-outbox`, além da função de sync Matriculado (sponte → stage).
- **Secrets**: integrações (OpenAI, Sponte, etc.) ficam no Supabase Vault via Gestão > Integrações.
  Edge functions leem com `getSecret()` (`_shared/secrets.ts`): painel primeiro, depois env.

## Frontend (`src/`)

- `App.tsx`: shell principal e roteamento por `activeTab` (kanban, kanban-chat, kanban-courses, dashboard,
  agents, history, tickets, admin...). Barra de filtros da Visão Geral (Agentes/Equipe/Cursos/Data) é DA
  Visão Geral, não do funil. O Kanban tem os próprios filtros (`kanbanDateRange`, `kanbanSearch`, `kanbanAssignee`).
- `hooks/`: `use-auth.tsx` (sessão + perfil, `user.role`), `use-followups.ts`, `use-kanban-state.ts`,
  `use-debounce.ts`, `use-supabase-search.ts`, `use-time-in-stage.ts`.
- `lib/supabase.ts` (cliente do Supabase), `lib/extractText.ts`, `lib/confettiPrefs.ts`, `lib/utils.ts`.
  `lib/surreal.ts` é legado.
- `utils/`: `withTimeout.ts` (usar em toda query de tela), `toast.ts`, `cpf.ts`, `sponteMatch.ts`,
  `matriculaAttribution.ts`, `marketingForms.ts`, `csvProcessor.ts`, `dashboardFilters.tsx`,
  `functionsError.ts` (ler erro de `functions.invoke`), `notificationSound.ts` (som de lead novo / resposta).
- `services/`: `aiSpecialist.ts` (IA de análise), `reprocessor.ts`.
- `types/database.ts`: tipos de `Lead`, `Stage`, `User`, etc.

### Componentes por área (`src/components/`)

- **Kanban** (`kanban/`): `KanbanBoard.tsx` (carrega leads por etapa, RPC `leads_stage_counts`, view
  `lead_pending_replies`, `ai_lead_sessions`, realtime `leads` + `widechat_messages`, toast + som de novo lead);
  `KanbanColumn.tsx` (filtros e ordenação por coluna, paginação `visibleCount`, selo de contagem);
  `LeadCard.tsx` (card: canal, badge de resposta pendente, robô de IA, botão Atender);
  `EditLeadDialog.tsx`, `LeadDialogById.tsx`, `ContactDetailsPanel.tsx`, `LeadHistoryFeed.tsx`,
  `WideChatHistory.tsx` (aba Conversas: mensagens + nota interna), `AtendimentosView.tsx` (inbox via RPC `inbox_leads`),
  `KanbanDateFilter.tsx`, `KanbanSort.tsx`, `NewLeadForm.tsx`, `CreateLeadFab.tsx`, `LossReasonDialog.tsx`.
- **Tickets / Portal do Aluno** (`tickets/`): `TicketDetail.tsx`, `TicketKanban.tsx`, `TicketDashboard.tsx`,
  `SecretariaBoard.tsx`, `NewTicketDialog.tsx` (chamado aberto por agente), `NpsPanel.tsx`, `TicketPortal.tsx`;
  Portal: `AlunoPortalPage.tsx`, `AlunoAuth.tsx` (login por CPF), `AlunoPainel.tsx` (+ `AlunoPainelDrawer.tsx`),
  `AlunoVisualizacao.tsx`, `AlunoHistorico.tsx`, `InstallAppBanner.tsx` (PWA).
- **Follow-ups** (`followups/`): `FollowupsPage.tsx`, `LeadFollowupPanel.tsx`, `NewFollowupDialog.tsx`.
- **Notificações**: `notifications/NotificationBell.tsx` (sino da sidebar: follow-ups vencidos + seletor de som).
- **Marketing** (`marketing/`): construtor e lista de formulários; `PublicMarketingFormPage.tsx` é a página pública.
- **Admin** (`admin/`): `AiAgentSettings` (Vivi, vendas), `TutorVirtualSettings` (Tutor, alunos), `IntegrationsSettings`
  (chaves, Vault), `VivaConnectSettings` / `VivaConnectHub` / `VivaConnectAgentChannels`, `TicketQueuesSettings`,
  `CourseManagement`, `LeadSourceManagement`, `LossReasonManagement`, `WidechatTemplates`, `UserWidechatConfig`,
  `AuditLogPage`, `TmaSettingsManagement`.
- **Soltos** (`components/`): `AgentAdmin`, `AgentProfile`, `AgentReport`, `CampaignsDashboard` (Meta/Google Ads),
  `SponteDashboard`, `GoalDashboard`/`GoalGauge` (metas, ao vivo de `sponte_parcelas`), `KnowledgeBase.tsx` +
  `KbAskPanel.tsx` (Base de Conhecimento), `CSVUploader`, `HistoryLog`, `AlunosPortalList`, `MyProfile`,
  `UserManagement`, `TeamsAdmin`, `TeamFilter`, `QuickReplies`, `Login`, `ForceChangePassword`, `ErrorBoundary`.
- `components/ui/`: primitivos shadcn (Radix). Não editar sem motivo.

## Backend (`supabase/functions/`)

| Função | Papel |
|---|---|
| `widechat-webhook` | Eventos do WideChat (legado): cria/atualiza lead e grava `widechat_messages` |
| `widechat-api` | Envio pelo WideChat a partir do painel (texto, template, mídia) |
| `vivaconnect-webhook` | Entrada do Z-PRO/VivaConnect: grava bruto, parser (`parseWebhook`), IA, reabertura, transições de etapa |
| `vivaconnect-api` | Ações do VivaConnect: `send`, envio por canal (`send_via_channel_id`), status, apagar/editar |
| `ai-agent` | Vivi (IA de vendas): responde leads, usa KB e `hub.ts` (triagem do Hub do Grupo) |
| `tutor-virtual` | Tutor (IA dos alunos): responde chamados, fecha quando aluno confirma, usa Sponte |
| `analyze-conversation` | Análise e score de conversa |
| `kb-ingest`, `kb-ask`, `kb-fetch-url` | Base de Conhecimento: ingestão, busca/resposta (RAG), importação de URL |
| `staff-tickets` | Agente abre chamado pra aluno ou turma (busca no Sponte, cria conta do Portal se preciso) |
| `ticket-transfer` | Transferência de chamado entre filas (usa service role) |
| `ticket-emails` | E-mails de chamados (Resend) + outbox, via cron |
| `email-inbound` | Respostas recebidas por e-mail (depende de MX de `email.ficv.edu.br`) |
| `aluno-auth` | Portal: 1º acesso (CPF = senha inicial), recuperação de senha, limite de tentativas |
| `aluno-portal` | API do Portal do aluno logado: overview, boletim, financeiro |
| `aluno-view` | Visualização compartilhada de aluno (`aluno_view_links`) |
| `sponte-read` | Agregados pro `SponteDashboard` |
| `sync-sponte` | Sponte → `sponte_matriculas`, `sponte_parcelas`, `alunos` |
| `sync-meta-ads`, `sync-google-ads` | Campanhas e insights diários |
| `sync-sendpulse-api`, `sync-sendpulse-forms`, `sendpulse-webhook` | SendPulse → Kanban |
| `marketing-form-submit` | Formulário público → lead (sempre usa o curso do form mais recente) |
| `admin-manage-users` | Criar/gerenciar usuários da equipe |
| `integrations` | Gestão de credenciais e testes de integração |
| `openai-models` | Lista modelos disponíveis na OpenAI |

### Módulos compartilhados (`supabase/functions/_shared/`)

- `ai.ts`: cliente OpenAI, `chatJSON`, `searchKnowledge` (vetorial + keyword + `essencial`), `keywordTerms` com
  `SYNONYM_GROUPS`, `jsonRes`/`corsHeaders`. Tem fallback quando o modelo não aceita `temperature`.
- `db.ts`: `pg()` (cliente de banco). `secrets.ts`: `getSecret()`.
- `email.ts`: `sendEmail` (Resend), `emailLayout`, `portalUrl`, `escHtml`.
- `sponte.ts`: cliente SOAP do Sponte (`sponteCall`), `sponteAlunoByCpf`, `sponteAlunoById`, `sponteBuscarAlunos`,
  `sponteBuscarTurmas`, `sponteRosterTurma`, `records()`, `cpfDigits`, `decodeSponte` (encoding instável do Sponte).
- `aluno.ts`: `ensureAlunoAccount` (cria conta do Portal a partir do CPF no Sponte), `ensureAlunoAccountById`,
  `nomeDivergeDoHistorico` (trava: nome do Sponte diferente do histórico de matrícula bloqueia criação).
- `alunoSponte.ts` (overview/boletim do Sponte), `alunoMoodle.ts` (notas e cursos EAD no Moodle),
  `alunoPortalCore.ts` (`overviewFor`, `boletimFor`, usado por aluno-portal e staff-tickets).
- `vivaconnect.ts`: `parseWebhook`, transições de etapa (`advanceAiStage`, `markAiHandedOff`, `markHumanReplied`,
  `moveToEntradaFromAiAttending`). `hub.ts`: triagem/menu do Hub do Grupo. `gh-dispatch.ts`: dispara workflow do GitHub.

## Banco (Supabase/Postgres)

- **Funil**: `leads` (~3.500), `stages` (6 etapas: IA Atendendo, Entrada, Em Contato, Matriculado, Finalizado, Perdido),
  `lead_sources`, `courses` (13), `motivos_perda`, `lead_followups`, `lead_notes`, `lead_history`,
  `lead_conversation_seen`, view `lead_pending_replies`, RPCs `leads_stage_counts`, `inbox_leads`,
  `delete_stage_and_leads`, `vivaconnect_channels_lookup`, `nps_report`.
- **Conversas**: `widechat_messages` (~73k; `origin` = channel/agent; `interno` = nota interna, sempre excluída de IA,
  badge e reabertura), `widechat_raw_messages`, `widechat_webhook_logs`, `widechat_atendimentos`,
  `widechat_blocklist_contacts`, `messages_logs` (~8k, legado usado pelo dashboard e sponte-read).
- **VivaConnect**: `vivaconnect_channels` (4; tem segredo, RLS admin-only: não SELECT direto, usar a RPC),
  `vivaconnect_agent_channels` (quem atende cada canal), `vivaconnect_settings`, `vivaconnect_hub_destinations`,
  `vivaconnect_hub_routings`, `vivaconnect_hub_locks`, `vivaconnect_blocked_numbers`, `vivaconnect_outbox`,
  `vivaconnect_webhook_logs`.
- **IA**: `ai_lead_sessions` (~447; `status` active/handed_off, `ai_turns`), `ai_agent_settings` (Vivi, 1 linha),
  `tutor_settings` (Tutor, 1 linha), `knowledge_base` (16 docs; `essencial=true` entra sempre) e `knowledge_chunks` (~1.365).
- **Tickets**: `tickets` (~377), `ticket_messages`, `ticket_queues`, `ticket_queue_members`, `ticket_evaluations`
  (NPS), `ticket_email_outbox`.
- **Portal do Aluno**: `alunos` (~880; `sponte_aluno_id`, `ra`, `nome`, `must_change_password`, `nivel`),
  `aluno_auth_attempts` (rate limit), `aluno_view_links`, `aluno_view_log`.
- **Sponte espelho**: `sponte_matriculas` (~3.900; `aluno_id`, `aluno` = nome, `numero_contrato` = RA/contrato),
  `sponte_parcelas` (~20k; base das metas ao vivo).
- **Equipe**: `profiles` (19; `role`, `team_id` = departamento), `agent_profiles` (20; score/metas),
  `agent_team` (5; roster do webhook), `teams`, `user_integrations`, `audit_logs`, `app_settings`.
- **Marketing/Ads**: `marketing_forms`, `marketing_form_submissions`, `sendpulse_forms`, `meta_*`, `google_ads_*`.
- **Usar `ai_lead_sessions`, `vivaconnect_*` e `widechat_*` com cuidado**: são tabelas quentes; ver armadilhas.

## Fluxos principais (o que cada parte faz de fato)

- **Dois canais de WhatsApp**: WideChat (legado, `widechat-*`) e VivaConnect (Z-PRO, `vivaconnect-*`). Os dois
  gravam em `widechat_messages`, diferenciados pela coluna `provider`. A aba Conversas do lead mostra os dois.
- **Etapas do Kanban**: Entrada → IA Atendendo (Vivi atendendo) → Em Contato (SÓ com resposta humana real enviada).
  Lead novo do WhatsApp entra em Entrada. "Matriculado" é movido pelo sync do Sponte (`situacao_id` 1/6).
  Finalizado: volta pra Entrada em 24h parado (cron + webhook).
- **Resposta pendente**: badge do card = mensagens do cliente depois da última resposta nossa e depois de
  `lead_conversation_seen`. Exclui etapas finalizada/perdida/matriculada e leads com IA ativa.
- **Som**: novo lead (realtime `leads` INSERT) e resposta do cliente em lead do agente logado (realtime `widechat_messages`).
  Nível por navegador em `localStorage` (`ficv_lead_sound_scope`: off / new_leads / all).
- **Portal do aluno**: login = e-mail interno `<cpf>@aluno.ficv.br` + senha (CPF no 1º acesso, troca obrigatória).
  Dados ao vivo do Sponte (`alunoSponte.ts`); notas EAD vêm do Moodle; nome exibido é o LOCAL (`alunos.nome`).
- **Score de agente**: média só de `status='approved'` com `final_score > 0`. Meta "atingido" = soma ao vivo de
  `sponte_parcelas`, nunca a coluna `monthly_achieved`.
- **Base de Conhecimento (IA)**: busca combina vetor (`match_knowledge_chunks`), keyword (`match_knowledge_keywords`,
  2 chunks por doc) e documentos `essencial=true` sempre incluídos.

## Regras de negócio (decisões já tomadas)

- Reabertura de lead Finalizado/Perdido: vale QUALQUER mensagem do cliente (decisão 17/09, pedido explícito). Não
  restringir de novo sem confirmar com o usuário. Se o assunto mudou, a IA pergunta antes de presumir o assunto antigo.
- Bot NUNCA reentra em conversa com agente humano falando (qualquer tipo de envio). Testar "cliente responde" antes
  de dar envio como pronto.
- Nota interna (`interno=true`) nunca entra no contexto da IA, no badge, nem na reabertura.
- Lead sem atendente não dispara som de resposta (só novo lead).
- Departamento e atendente: lead sem dono fica na fila compartilhada de Entrada; o filtro de departamento mostra os
  do departamento e os sem dono só no Comercial.
- Financeiro (parcelas) é restrito a admin, agent, secretaria e coordenador (`staff-tickets`).
- Nunca apagar linhas de `agent_team` (o webhook depende delas).

## Armadilhas conhecidas (já custaram tempo — não repetir)

- **Token em refresh**: `UPDATE` que filtra 0 linhas sem erro. Padrão: `getSession()` antes, `withTimeout`, `.select()`
  pra checar se alterou algo. Já reapareceu em TicketDetail (05/10).
- **Coluna de segredo**: nunca `SELECT` de senha, token ou api_key, nem com alias, nem pra "checar existência". Usar
  `is.null` / `not.is.null`. `vivaconnect_channels` guarda token em texto puro.
- **`UPDATE ... WHERE` em tabela grande** (widechat_messages, leads) faz full scan: sempre filtrar por índice.
- **Nome de FK**: embed no supabase-js quebra quando a FK muda de nome (cutover). Conferir o nome atual antes.
- **Protocolo do ticket**: usar `NEW.id` (sequência atômica), nunca `COUNT(*)+1`.
- **Storage**: bucket público só cobre leitura. Upload precisa de policy de `storage.objects` (faltava no chat de tickets).
- **Selo de contagem do Kanban** vem da RPC `leads_stage_counts`, que NÃO recebe filtro de data. Com data ativa, o
  front usa o tamanho da lista filtrada (`hasDateFilter`). Desligar só via `enabled` não basta: o cache reaparece.
- **Ordenação do Kanban**: `stage_entry_date` ≠ `data_entrada`. Card e ordenação precisam usar o mesmo campo.
- **Sponte**: GetAlunos por CPF pode devolver nome errado (digitação na secretaria). CPF/RA/AlunoID costumam estar
  certos; conferir nome contra `sponte_matriculas`. Encoding do Sponte é instável: usar `decodeSponte`.
- **Edge function**: alterar `_shared/*.ts` exige redeploy de cada função que importa. Testar Deno-only em Node:
  remover a linha `npm:` e rodar `node --experimental-strip-types` dentro da pasta do projeto.
- **Testar login de aluno**: não gerar sessão/JWT real de outro usuário (`admin.generate_link` é bloqueado
  pelo classificador de segurança). Replicar a lógica por acesso de serviço direto, sem impersonar.
- **Z-PRO**: documentação de terceiros se contradisse (apagar/editar msg). Validar no painel real antes de implementar.
- **Variável `VITE_*` é pública**: vai pro JavaScript do navegador. Nunca colocar token, chave de serviço ou
  segredo nela. Chamadas privilegiadas passam por edge function com `identify()` + `isStaff()` (2026-10-21:
  `VITE_GITHUB_SYNC_TOKEN` expunha dispatch do GitHub; removido).
- **Entrada de workflow do GitHub**: nunca `${{ github.event.inputs.* }}` dentro de `run:`. Passar por `env:` e validar.
- **Mensagem do bot lida como do cliente** já apagou lead de verdade (DELETE). Filtrar por `origin`, nunca por texto.
- **Auth lock do supabase-js** travava `getSession`: usar o `boundedLock` e `useAuth` já existentes.
- **tsc incremental** trava no Google Drive: se houver cópia lá, não editar. Projeto oficial: `/Users/juliocesar/dev/ficv-sales-1`.

## Convenções de trabalho

- **Commit + push logo após cada mudança**, no `main`. Mensagem em português no formato `tipo(escopo): resumo`, com
  corpo explicando o porquê. Terminar com `Co-Authored-By: <modelo em uso> <noreply@anthropic.com>`.
  Adicionar só os arquivos alterados (nunca `git add -A`: há muito arquivo solto na raiz).
- **Antes de commitar**: `npx tsc --noEmit -p tsconfig.json` e `npx vite build`. Depois restaurar os
  `tsconfig*.tsbuildinfo` com `git checkout -q` (não entram no commit).
- **Testar antes de pedir pro usuário testar**: endpoints via curl com a service role, consulta SQL/REST real.
  Frontend não dá pra testar no navegador daqui: dizer isso explicitamente no relato.
- **Não criar documentos (.md) de análise** sem pedido. Respostas ao usuário curtas, em português.
- Código: sem comentários óbvios; comentário só pra motivo não-óbvio. Referência de data no comentário só se for
  essencial ao porquê.

## Pendências abertas (atualizado em 2026-10-21)

- **Josenaldo Mendes De Oliveira** (CPF 675.594.095-04): nome corrigido localmente e função reimplantada; usuário ainda
  não confirmou que o Portal mostra o nome certo. Corrigir também o nome no Sponte.
- **Outras 3 contas com nome divergente** (Ana Raquel Tavares Batista Rolim, Roberto Ferle, Irene Avelar Ferreira de
  Puertas): corrigidas localmente. Secretaria precisa corrigir o nome no Sponte.
- **78 contas do Portal sem matrícula sincronizada** não foram verificadas contra o Sponte.
- **Apagar/editar mensagem já enviada no WhatsApp**: sem implementação. Aguardando conferir no painel real do Z-PRO.
- **VivaConnect Igreja e Fundação**: número placeholder `83999999999`, falta o número real.
- **Teste em navegador pendente**: som de lead novo / resposta, seletor de nível, selo de contagem com filtro de data.
- **Migration `20261021120000_security_hardening_rls.sql`**: commitada, AINDA NÃO aplicada em produção (bloqueio de
  permissão na execução automática). Aplicar com `supabase db push --linked` e validar com as consultas de `information_schema` do run-1. Testada
  antes em Postgres local com esquema mínimo: 13 casos de ataque bloqueados, operações legítimas preservadas.
- **Segurança (auditoria run-1, 2026-10-21)**: ver `~/security-audit-skill/ficv-sales-1/run-1/`. Pendentes: NV-1 (`profiles.role` autoeditável), NV-2 (`alunos.sponte_aluno_id`), `delete_stage_and_leads` concedida a `authenticated`, `tmsg_insert` sem checar ticket, webhooks sem assinatura.
- **Segurança**: `.claude/settings.json` (não versionado) tem chaves Supabase escritas nas permissões, incluindo de
  outro project ref (`znypfroagfwohqeyxyqv`). Remover essas linhas e manter `.claude/settings.local.json` fora do git.
- **Limpeza**: scripts soltos na raiz e `src/utils/*.sql` antigos podem ser movidos ou removidos.
- **Status a confirmar**: MX de `email.ficv.edu.br` e resposta por e-mail de chamados (planejado para 28/09).
