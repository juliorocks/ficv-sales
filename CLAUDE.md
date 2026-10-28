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
- `vivaconnect/` (zips e binários do Z-PRO), `_migration-backups/`,
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
- **Migrations**: arquivo `supabase/migrations/AAAAMMDDHHMMSS_nome.sql`. Antes de criar, `ls supabase/migrations | sort | tail` (outra sessão pode ter usado o mesmo prefixo de data: aconteceu em 2026-10-29). Timestamps repetidos já causaram
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
  SurrealDB foi removido do código em 2026-10-21 (não há mais espelho nem cliente).
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
- **Avaliação CPA** (`cpa/`, 2026-10-21; Portal em 2026-10-25): `CpaFormFlow` (em `CpaFormPage.tsx`) é o formulário gamificado (um passo por tela, pausas com frase de incentivo, rascunho no localStorage), usado pelo link público `/avaliacao/:token` (`CpaFormPage`) e pelo Portal (`CpaPortalAvaliacao.tsx`: `CpaPortalCard` aparece no Início do aluno só com `portal_ativo` ligado; sem nada ligado não renderiza e não chama o Sponte); `CpaAdmin.tsx` é o painel (aba "Avaliação CPA" no menu, admin e agente), UMA página por nível (Graduação/Pós) que junta a avaliação geral e a de disciplinas: link único, status/Portal/semestre/alunos de teste valendo para as duas, KPIs combinados, resultados das duas empilhados (`Resultados`: gráficos recharts, tabela por pergunta, comentários), exportação (2 CSV + 1 verificação) e verificação da cadeia das duas. Não aparece no Portal do Aluno. Aba "Perguntas" = `CpaEditor.tsx` (blocos e perguntas: criar, editar, excluir, reordenar com setas; trava tipo/escala/opções/papel e exclusão de pergunta que já tem resposta). `cpaApi.ts` = chamada compartilhada ao `cpa-admin`.
- **Banners do Portal** (2026-10-23): `admin/PortalBannersAdmin.tsx` (menu Gestão > "Banners do Portal", só admin): uma arte só, 4:1 (1600×400), vale para celular e desktop (2026-11-02; as colunas `imagem_mobile`/`imagem_desktop` seguem no banco, a tela usa `imagem_desktop ?? imagem_mobile`), link opcional, janela de exibição, ordem, pausar. `portal/PortalDestaques.tsx` mostra no topo do Início do aluno, logo abaixo da saudação: primeiro a Avaliação da CPA (banner escuro com dourado, quando ativa) e depois o carrossel de banners (`<img>` 4:1, troca a cada 6,5 s). Tabela `portal_banners` (RLS: aluno lê só ativos dentro da janela; só admin escreve), bucket público `portal-banners` (escrita só admin, até 3 MB, PNG/JPG/WebP). Escrita direta pelo cliente com `getSession()` antes e `.select()` depois (armadilha do token em refresh).
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
| `cpa-form` | Avaliação CPA pública (sem JWT): `get` e `submit`. Valida no servidor e grava via `cpa_registrar_resposta` |
| `cpa-admin` | Avaliação CPA (JWT admin/agente): `forms` (com população ativa do Sponte), `form`, `stats` (inclui por disciplina com professor), `export` (CSV + SHA-256), `verify` (cadeia), `update_form` (admin: status e `portal_ativo`), `estrutura` (blocos, perguntas e quais já têm resposta), `bloco_salvar`/`bloco_excluir`, `pergunta_salvar`/`pergunta_excluir`, `reordenar` (admin, as ações de escrita), `testadores` (alunos de teste do formulário), `docentes` (professores e se têm foto), `disciplinas_docentes`/`docente_definir` (professor por disciplina, preenchido à mão onde o Moodle não tem), `docente_foto` (admin: envia foto, até 1 MB), `delete_tests` (admin) e `sync_docentes` (admin: professor titular pelo Moodle, em lotes) |
| `cpa-portal` | Avaliação CPA no Portal (JWT do aluno, só o próprio): `pendencias`, `form`, `submit`. Geral pelo nível da matrícula Vigente (Sponte); disciplinas pelos cursos do Moodle em que o aluno está inscrito e ativos no semestre (`_shared/cpaMoodle.ts`), com o professor do mesmo curso |

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
- `cpa.ts`: `slug`, `contextoDisciplina`, `participacaoHash` (HMAC com a service role), `validarRespostas` (usada por cpa-form e cpa-portal).
- `cpaMoodle.ts` (2026-10-23): `partirCurso` (nome do curso do Moodle → período + disciplina; cobre "P3", "Modular", "CICLO X" e pós "PÓS EAD - POSMU/T3 - 03 ..."), `disciplinasAtivas`, `semestreAtual`, `moodleUserIdPorEmail`, `cursosDoUsuario`, `professoresDoCurso`. Usado por cpa-portal e cpa-admin.
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
- **Banners do Portal**: `portal_banners` (titulo, imagem_mobile/imagem_desktop = caminhos no bucket `portal-banners`, link_url https:// ou /, ordem, ativo, inicio_em/fim_em).
- **Avaliação CPA**: `cpa_docente_fotos` (nome do professor → caminho da foto no bucket público `cpa-docentes`; a foto é enviada pelo painel, pela ação `docente_foto` do `cpa-admin`), `cpa_participacoes` (quem já respondeu cada contexto, só HMAC do aluno; sem policy, só service role), `cpa_docentes` (período + disciplina → professor titular, do Moodle), `cpa_formularios` (nivel graduacao/pos, tipo geral/disciplina, status teste/aberto/encerrado, `token` do link, `portal_ativo` desligado por padrão, `semestre` (da CPA; nulo = automático), `alunos_teste` (sponte_aluno_id de quem vê a avaliação em status teste mesmo com o Portal desligado), `populacao_alvo` não é mais usado), `cpa_blocos`, `cpa_perguntas` (escala/escolha/texto; `chave='curso'` alimenta o filtro), `cpa_respostas` (`teste`, `seq`, `respostas` jsonb, `canonico`, `hash_anterior`, `hash`). Oficiais são imutáveis por trigger (`cpa_respostas_oficiais_imutaveis`). Só a service role escreve; leitura direta só staff.
- **Usar `ai_lead_sessions`, `vivaconnect_*` e `widechat_*` com cuidado**: são tabelas quentes; ver armadilhas.

## Fluxos principais (o que cada parte faz de fato)

- **Dois canais de WhatsApp**: WideChat (legado, `widechat-*`) e VivaConnect (Z-PRO, `vivaconnect-*`). Os dois
  gravam em `widechat_messages`, diferenciados pela coluna `provider`. A aba Conversas do lead mostra os dois.
- **E-mail como alternativa ao WhatsApp (2026-10-19)**: `provider='email'`. Envio manual pelo botão "Enviar por e-mail"
  (sempre disponível ao lado de "Nota interna" quando o lead tem `leads.email`, 2026-10-28; o aviso amarelo continua aparecendo quando o WhatsApp recusou ou a janela de 24h fechou) →
  `vivaconnect-api` action `send_email` (Resend, `sendEmail`). Resposta do cliente chega em `email-inbound`
  pelo endereço assinado `lead-<id>-<sig>@<RESEND_INBOUND_DOMAIN>` (`leadReplyAddress`) e vira mensagem `origin='channel'`.
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
- **Avaliação CPA no Portal (2026-10-23)**: o aluno tem UM link, `/avaliacao` (pede o login do Portal e abre a fila: geral + cada disciplina, uma após a outra, cada parte gravada à parte). Aluno ativo = matrícula `situacao_id = 1` (Vigente) em `sponte_matriculas` ("Pré Matrícula", situação 6, fica de fora). Principal = graduação se houver, senão pós; a avaliação geral é só do nível principal. **Disciplinas ativas = cursos do Moodle** em que o aluno está inscrito (achado por `alunos.email`; 25/25 na amostra), não ocultos, sem `enddate` passado, e: graduação = o semestre do nome do curso é o atual (`cpa_formularios.semestre` da CPA, senão julho em diante = .2); pós = `startdate` já passou. Só entram níveis em que o aluno tem matrícula Vigente. Contexto: `<slug(período)>~<slug(disciplina)>`. Uma resposta por aluno por (formulário, contexto); a participação guarda só o HMAC. **Professor** = papel `editingteacher` do MESMO curso (`edteacher` = tutor/mediador). Nas pós o Moodle não tem professor titular: a equipe preenche no painel ("Professores por disciplina", origem `manual`, a sincronização não sobrescreve). Foto: não vem do Moodle (a API só entrega a imagem padrão); a equipe envia no painel. **Teste com o mesmo link**: em status `teste`, o aluno cadastrado em "Alunos de teste" (CPF, no painel) vê a avaliação no Início e em `/avaliacao` mesmo com o Portal desligado; os demais não veem nada. Em status `aberto` a lista de teste não vale.
- **Avaliação CPA (2026-10-21)**: respostas são ANÔNIMAS (nada identifica o respondente). Só respostas com status `aberto` entram na cadeia de hash (`seq` contínuo, `hash = sha256(hash_anterior||'|'||canonico)`) e nos relatórios oficiais. Teste (`status='teste'`) fica fora da cadeia e pode ser apagada. Para alterar um formulário ou apagar teste: admin. Verificação `verify`: recalcula a cadeia e confere `respostas` e `respondido_em` contra o `canonico` gravado. Escala: graduação 0–10, pós 1–10 (como nos resultados de 2025).

## Armadilhas conhecidas (já custaram tempo — não repetir)
- **Layout do formulário da CPA (2026-10-23)**: `CpaFormFlow` não é uma página que rola: é `h-dvh` (ou `h-full` com `embutido`, dentro da janela do Portal) em 3 faixas: topo fixo (logo, progresso, aviso de teste e cartão do professor), miolo `flex-1 overflow-y-auto` com o cartão da pergunta centralizado (`min-h-full justify-center`) e nada embaixo. As prévias (pergunta anterior/próxima) só aparecem quando sobra ≥ 220 px no miolo (medido com ResizeObserver); no celular com cartão alto elas somem para o cartão nunca precisar rolar. Não voltar a usar `min-h-dvh` ali.
- **Janela/modal `fixed` dentro de tela do admin sai cortada (2026-10-23)**: as telas ficam num wrapper `.animate-fade-in`, cuja animação termina com `transform` e prende o `position: fixed` ao tamanho do wrapper. Renderizar modal com `createPortal(..., document.body)` (a classe `dark` fica no `<html>`, então as cores seguem). Já aplicado em `PortalBannersAdmin`, `CpaEditor` e na fila da CPA no Portal.
- **Sonda do Sponte**: não publicar função temporária pra inspecionar a API (o classificador de segurança bloqueia, e fica exposta). Consultar local, só leitura, com o token lido do Vault via `integ_get_secret` e imprimindo só nomes de tags. `GetAulasProfessores` aceita no máximo 60 dias por chamada.
- **Sponte — disciplina por turma NÃO é confiável**: `GetBoletim` com `nDisciplinaID` devolve a disciplina para turmas diferentes do mesmo aluno (testado 2026-10-25). Não usar pra descobrir quais disciplinas uma turma tem.
- **Sponte — notas (2026-10-22)**: `GetBoletim` só lista disciplina que já tem nota consolidada. Turma Modular com AV1 lançada em várias disciplinas (ex.: aluno 9740, turma 1406) aparecia com uma só. O boletim agora soma as disciplinas que só existem em `GetNotaParcial`.
- **Sponte — professor (2026-10-23)**: `GetQuadroHorarios` (TurmaID) traz `DisciplinaID`+`ProfessorID`+nome, mas só existe para turmas presenciais com quadro cadastrado (15 de 26); EAD e pós não têm quadro. `GetTurmas.ProfessorRegente` vem vazio. A tela "Habilitações Docentes" do Sponte não tem método na API. Por isso o professor vem do Moodle.
- **Moodle — nomes de curso**: o semestre aparece no nome ("TEOLOGIA EAD - 2026.2 - P1 - ..."), mas as turmas do Sponte nem sempre acompanham (Direito aparece como "2026.1 - P9" enquanto o aluno cursa "2026.2 - P10"). Por isso a lista de disciplinas vem do Moodle, não do boletim do Sponte. Pós: "PÓS EAD - POSMU/T3 - 03 NOME"; o aluno só fica inscrito no termo atual.
- **Notas EAD faltando no Portal (2026-10-23)**: o Sponte só lista disciplina com nota consolidada, então o aluno via 2 de 5 (caso Adriano Fabio, POSECC/T7). `completarTurmasComMoodle` (`alunoPortalCore.ts`) agora acrescenta as disciplinas do período que só existem no Moodle, em turma com "EAD" no nome, ignorando as sem nota e o prefixo numérico ("02 "). Nome do curso no Moodle da pós: `PÓS EAD - POSECC/T7 - 02 DISCIPLINA`.
- **Moodle (fotos)**: `core_user_get_users_by_field` devolve `profileimageurl`, mas para os professores testados (2026-10-22) é sempre a mesma imagem padrão de 1.128 bytes. Fotos vêm do painel da CPA, não do Moodle.
- **Moodle**: `core_enrol_get_enrolled_users` traz o papel em `roles[].shortname`. Professor = `editingteacher`. `edteacher` é tutor.

- **Janela de 24h do WhatsApp**: qualquer lugar que calcula se texto livre é permitido precisa ignorar `provider='email'`
  (resposta por e-mail tem `origin='channel'` e não pode abrir a janela do WhatsApp). Já existe em WideChatHistory e vivaconnect-api.

- **Leads duplicados por telefone (2026-10-23)**: o webhook criava 2 leads quando 2 mensagens do mesmo número chegavam juntas (ids consecutivos); o `findLeadByPhone` pega o de maior id, então a conversa se dividia. Agora o lead recém-criado se desfaz se existir outro com o mesmo final de telefone e id menor. A trava de 24h no `send` do `vivaconnect-api` olha todos os leads com o mesmo final de telefone (a tela já juntava). Existem ~70 grupos de duplicados antigos ainda não unificados.

- **Lead puxado pra Em Contato voltava pra Aluno (2026-10-23)**: dois caminhos moviam de novo — (1) `vivaconnect-webhook` (bloco `isStudent`/`aluno_atual`) a cada mensagem do cliente com telefone de aluno; (2) cron `sync_leads_matriculado_from_sponte` depois de 24h parado. Agora lead em Em Contato é ignorado nos dois (o cron ainda converte pra Matriculado). Qualquer automação nova que mande pra Aluno precisa respeitar Em Contato.
- **Trava de nome do Portal (2026-10-27)**: `nomeDivergeDoHistorico` comparava nome por igualdade exata e barrava aluna legítima (matrícula "Bruna Martins" x cadastro "Bruna Aparecida Martins Silva", mesmo AlunoID). Agora aceita quando as palavras de um nome estão todas no outro (`mesmoNome`); nome de outra pessoa segue bloqueado.
- **Resposta por e-mail não chegava (2026-10-28)**: o MX estava certo, mas a Resend não tinha NENHUM webhook `email.received` cadastrado, então `email-inbound` nunca era chamada (respostas de chamados e de leads ficaram paradas desde 05/10; 17 foram reenviadas à função em 28/10). Webhook criado via API (endpoint com `?key=<app_internal.inbound_key>`, só evento `email.received`). Se as respostas pararem de entrar, conferir `GET /webhooks` na Resend antes de olhar código. Gmail quebra o cabeçalho "Em … escreveu:" em duas linhas; `onlyNewText` já trata.
- **Tela do Portal quebrava para aluno de Direito (2026-10-29)**: `agruparCursos` esconde períodos de Direito anteriores a 2026.1; aluno só com períodos antigos ficava com curso de `turmas` vazio e `turmas[0].situacao` derrubava a tela ("Algo quebrou nesta tela"). Grupo vazio agora é removido. Ao filtrar listas no Portal, não deixar grupo vazio.
- **Aluno de teste da CPA (2026-10-30)**: `cpa_formularios.alunos_teste` é POR FORMULÁRIO (4 formulários = graduação/pós × geral/disciplina); aluno de pós precisa estar nos de pós. Quem não está no espelho `sponte_matriculas` (equipe, ex.: Victor Grisi, AlunoID 4383) não tinha "principal" e nada aparecia; agora, em formulário de teste, vale o `alunos.nivel` do cadastro.
- **Turma Modular EAD sem todas as disciplinas (2026-10-31)**: o Sponte só devolve disciplina com nota; a lista completa ("Módulos do contrato") não está na API (`GetMatriculas` traz só uma `DisciplinaID`). A fonte é o Moodle: cursos `<curso> EAD - <semestre> - P<módulo> - <disciplina>` do aluno. Turma "... - Modular" usa o módulo das disciplinas pra montar o prefixo `P<n>`; no semestre mais novo do aluno a disciplina entra mesmo sem nota (exceto "00 ..."), nos antigos só com nota. Caso Tyago (AlunoID 5612): 6 de 7 no Moodle; "Filosofia das Religiões" não está matriculada no módulo 4/2026.2.
- **Editor de perguntas da CPA travado por resposta de teste (2026-11-01)**: `perguntasRespondidas` (`cpa-admin`) contava respostas de teste, então a equipe não conseguia excluir/editar perguntas antes de abrir o formulário. Agora só resposta OFICIAL (`teste=false`) trava tipo/escala/opções/exclusão. Ao ter resposta oficial a trava continua de propósito (as respostas ficam presas ao id da pergunta e à cadeia de hash).
- **Popup da CPA no Portal (2026-11-01)**: com formulário em status `aberto` e avaliação pendente, `CpaPortalCard` abre a fila sozinho UMA vez por carregamento da página (flag de módulo `abriuNestaPagina`; atualizar a página abre de novo), sem opção de "não mostrar mais". `cpa-portal` `pendencias` devolve `oficial` (algum formulário `aberto`); em `teste` não abre sozinho. Sem pendência (tudo respondido, vindo da tabela `cpa_participacoes` no servidor) o cartão/banner e o popup somem; só o link `/avaliacao` mostra "Você já respondeu".
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
- **Avaliação CPA no Portal**: (0) pós sem professor no Moodle: preencher à mão no painel. (0b) Disciplina de pós/graduação inscrita no Moodle mas fora da matriz (ex.: "Atividades complementares") é ignorada por não ter período no nome. (0c) Rodar "Atualizar professores (Moodle)" e conferir a lista "sem professor". (0d) Chave HMAC = service role: trocar a chave muda o "já respondeu" de todo mundo. (0e) Teste visual no celular e fluxo com conta de aluno de teste pendentes.
- **Avaliação CPA**: (a) conteúdo das perguntas transcrito dos modelos 2024/2025: revisar com a CPA antes de abrir. Opções de curso da pós vieram da tabela `courses` (10 pós). (b) Identidade do respondente: nada é gravado hoje, e não há trava de uma resposta por aluno. Quando entrar no Portal, gravar `respondente_hash` (HMAC de aluno + formulário) em vez do aluno. (c) Sem rate limit no `cpa-form`. (d) Carimbo de tempo ICP-Brasil se o MEC exigir validade jurídica. (e) Teste visual no navegador pendente (formulário mobile e dashboard).

- **Josenaldo Mendes De Oliveira** (CPF 675.594.095-04): nome corrigido localmente e função reimplantada; usuário ainda
  não confirmou que o Portal mostra o nome certo. Corrigir também o nome no Sponte.
- **Outras 3 contas com nome divergente** (Ana Raquel Tavares Batista Rolim, Roberto Ferle, Irene Avelar Ferreira de
  Puertas): corrigidas localmente. Secretaria precisa corrigir o nome no Sponte.
- **78 contas do Portal sem matrícula sincronizada** não foram verificadas contra o Sponte.
- **Apagar/editar mensagem já enviada no WhatsApp**: sem implementação. Aguardando conferir no painel real do Z-PRO.
- **VivaConnect Igreja e Fundação**: número placeholder `83999999999`, falta o número real.
- **Teste em navegador pendente**: som de lead novo / resposta, seletor de nível, selo de contagem com filtro de data.
- **Migration `20261021120000_security_hardening_rls.sql`**: APLICADA em produção em 2026-10-21 (verificada por
  catálogo: triggers `trg_guard_profile_role`/`trg_guard_aluno_identity`, policies `profiles_ins`/`tmsg_insert`,
  `delete_stage_and_leads` com `is_admin()`). Testada antes em Postgres local (13 casos de ataque).
- **Segurança (auditoria run-1, 2026-10-21)**: ver `~/security-audit-skill/ficv-sales-1/run-1/`. Corrigidos em 2026-10-21: NV-1, NV-2, `delete_stage_and_leads`, `tmsg_insert`. Pendentes: webhooks sem assinatura, `matriculas_por_agente` sem checagem, `vivaconnect-api` (fetch de `zUrl`), `kb-fetch-url` (SSRF, só admin).
- **Segurança**: `.claude/settings.json` (não versionado) tem chaves Supabase escritas nas permissões, incluindo de
  outro project ref (`znypfroagfwohqeyxyqv`). Remover essas linhas e manter `.claude/settings.local.json` fora do git.
- **Limpeza**: scripts soltos na raiz e `src/utils/*.sql` antigos podem ser movidos ou removidos.
- **Status a confirmar**: MX de `email.ficv.edu.br` e resposta por e-mail de chamados (planejado para 28/09).
