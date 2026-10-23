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
- **Avaliação CPA** (`cpa/`, 2026-10-21; Portal em 2026-10-25): `CpaFormFlow` (em `CpaFormPage.tsx`) é o formulário gamificado (um passo por tela, pausas com frase de incentivo, rascunho no localStorage), usado pelo link público `/avaliacao/:token` (`CpaFormPage`) e pelo Portal (`CpaPortalAvaliacao.tsx`: `CpaPortalCard` aparece no Início do aluno só com `portal_ativo` ligado; sem nada ligado não renderiza e não chama o Sponte); `CpaAdmin.tsx` é o painel (aba "Avaliação CPA" no menu, admin e agente): KPIs, gráficos (recharts), tabela por pergunta, comentários, CSV + verificação da cadeia. Não aparece no Portal do Aluno. Aba "Perguntas" = `CpaEditor.tsx` (blocos e perguntas: criar, editar, excluir, reordenar com setas; trava tipo/escala/opções/papel e exclusão de pergunta que já tem resposta). `cpaApi.ts` = chamada compartilhada ao `cpa-admin`.
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
| `cpa-admin` | Avaliação CPA (JWT admin/agente): `forms` (com população ativa do Sponte), `form`, `stats` (inclui por disciplina com professor), `export` (CSV + SHA-256), `verify` (cadeia), `update_form` (admin: status e `portal_ativo`), `estrutura` (blocos, perguntas e quais já têm resposta), `bloco_salvar`/`bloco_excluir`, `pergunta_salvar`/`pergunta_excluir`, `reordenar` (admin, as ações de escrita), `docentes` (professores e se têm foto), `docente_foto` (admin: envia foto, até 1 MB), `delete_tests` (admin) e `sync_docentes` (admin: professor titular pelo Moodle, em lotes) |
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
- **Avaliação CPA**: `cpa_docente_fotos` (nome do professor → caminho da foto no bucket público `cpa-docentes`; a foto é enviada pelo painel, pela ação `docente_foto` do `cpa-admin`), `cpa_participacoes` (quem já respondeu cada contexto, só HMAC do aluno; sem policy, só service role), `cpa_docentes` (período + disciplina → professor titular, do Moodle), `cpa_formularios` (nivel graduacao/pos, tipo geral/disciplina, status teste/aberto/encerrado, `token` do link, `portal_ativo` desligado por padrão, `populacao_alvo` não é mais usado), `cpa_blocos`, `cpa_perguntas` (escala/escolha/texto; `chave='curso'` alimenta o filtro), `cpa_respostas` (`teste`, `seq`, `respostas` jsonb, `canonico`, `hash_anterior`, `hash`). Oficiais são imutáveis por trigger (`cpa_respostas_oficiais_imutaveis`). Só a service role escreve; leitura direta só staff.
- **Usar `ai_lead_sessions`, `vivaconnect_*` e `widechat_*` com cuidado**: são tabelas quentes; ver armadilhas.

## Fluxos principais (o que cada parte faz de fato)

- **Dois canais de WhatsApp**: WideChat (legado, `widechat-*`) e VivaConnect (Z-PRO, `vivaconnect-*`). Os dois
  gravam em `widechat_messages`, diferenciados pela coluna `provider`. A aba Conversas do lead mostra os dois.
- **E-mail como alternativa ao WhatsApp (2026-10-19)**: `provider='email'`. Envio manual pelo botão "Enviar por e-mail"
  (aparece quando o WhatsApp recusou a última mensagem ou a janela de 24h fechou; só com `leads.email`) →
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
- **Avaliação CPA no Portal (2026-10-23)**: o aluno tem UM link, `/avaliacao` (pede o login do Portal e abre a fila: geral + cada disciplina, uma após a outra, cada parte gravada à parte). Aluno ativo = matrícula `situacao_id = 1` (Vigente) em `sponte_matriculas` ("Pré Matrícula", situação 6, fica de fora). Principal = graduação se houver, senão pós; a avaliação geral é só do nível principal. **Disciplinas ativas = cursos do Moodle** em que o aluno está inscrito (achado por `alunos.email`; 25/25 na amostra), não ocultos, sem `enddate` passado, e: graduação = o semestre do nome do curso é o atual (`cpa_formularios.semestre` da CPA, senão julho em diante = .2); pós = `startdate` já passou. Só entram níveis em que o aluno tem matrícula Vigente. Contexto: `<slug(período)>~<slug(disciplina)>`. Uma resposta por aluno por (formulário, contexto); a participação guarda só o HMAC. **Professor** = papel `editingteacher` do MESMO curso (`edteacher` = tutor/mediador). Nas pós o Moodle não tem professor titular: a equipe preenche no painel ("Professores por disciplina", origem `manual`, a sincronização não sobrescreve). Foto: não vem do Moodle (a API só entrega a imagem padrão); a equipe envia no painel.
- **Avaliação CPA (2026-10-21)**: respostas são ANÔNIMAS (nada identifica o respondente). Só respostas com status `aberto` entram na cadeia de hash (`seq` contínuo, `hash = sha256(hash_anterior||'|'||canonico)`) e nos relatórios oficiais. Teste (`status='teste'`) fica fora da cadeia e pode ser apagada. Para alterar um formulário ou apagar teste: admin. Verificação `verify`: recalcula a cadeia e confere `respostas` e `respondido_em` contra o `canonico` gravado. Escala: graduação 0–10, pós 1–10 (como nos resultados de 2025).

## Armadilhas conhecidas (já custaram tempo — não repetir)
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
