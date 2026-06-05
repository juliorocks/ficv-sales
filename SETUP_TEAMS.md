# Setup de Equipes (Teams) - SALESPULSE

## ✅ Mudanças Realizadas

### 1. **Banco de Dados** ✓
- [x] Criada tabela `teams` com campos: id, name, description, color, icon, active
- [x] Adicionado campo `team_id` à tabela `agent_profiles` (FK para teams)
- [x] Criadas 6 equipes padrão: Comercial, Secretaria, Tutoria, Financeiro, Suporte Técnico, Sem equipe

**Arquivo SQL:** `CREATE_TEAMS_MIGRATION.sql`

### 2. **TypeScript Types** ✓
- [x] Adicionada interface `Team` em `src/types/database.ts`
- [x] Atualizada interface `AgentProfileData` com campos `team_id` e `team`
- [x] Atualizada interface `AgentProfile` para incluir informações de equipe

### 3. **Componentes Criados** ✓
- [x] **TeamFilter.tsx**: Novo componente dropdown para filtrar por equipe
  - Exibe ícone e cor da equipe
  - Suporta seleção de "Todas as equipes"
  - Hook `useTeamFilter()` para gerenciar estado

### 4. **AgentAdmin.tsx Atualizado** ✓
- [x] Adicionado campo "Equipe" no formulário de edição do agente
- [x] Dropdown com todas as equipes disponíveis
- [x] Exibe badge com cor e ícone da equipe (modo visualização)
- [x] Integração com `useAgentProfiles` para carregamento de dados

### 5. **App.tsx (Dashboard) Atualizado** ✓
- [x] Importado componente `TeamFilter`
- [x] Adicionado estado `selectedTeamId`
- [x] Integrado TeamFilter na barra de filtros do dashboard
- [x] Preparado filtro para aplicar nos dados (próxima fase)

## 🔄 Próximas Etapas (TODO)

### Phase 1: Completar a integração (IMPORTANTE)
1. **Executar a migration SQL no Supabase**
   - Abrir Supabase Dashboard
   - Ir em SQL Editor
   - Copiar e executar o conteúdo de `CREATE_TEAMS_MIGRATION.sql`

2. **Atualizar fetchData() no App.tsx**
   - Modificar a query para buscar também agent_profiles com team info
   - Mesclar team info com os dados de messages_logs
   - Adicionar `team` ao ConversationAnalysis interface se necessário

3. **Ativar filtro de equipe**
   - Atualizar a lógica de `filteredData` para considerar team_id
   - Fazer match entre agente e sua equipe

### Phase 2: Equipe no UserManagement (OPCIONAL)
- Adicionar seleção de equipe no painel de gerenciamento de usuários
- Seguir mesmo padrão que AgentAdmin

### Phase 3: Perfis por Equipe (AVANÇADO)
- Criar view de performance por equipe
- Gráficos agregados de equipe
- Relatórios por departamento

## 📋 Instruções de Execução

### 1. Aplicar a Migration do Banco

```bash
# 1. Abrir Supabase Dashboard
# 2. Navegar até: Project → SQL Editor
# 3. Criar nova query
# 4. Copiar o conteúdo do arquivo CREATE_TEAMS_MIGRATION.sql
# 5. Executar a query
```

### 2. Testar Localmente

```bash
# 1. Ir para o diretório do projeto
cd "/Users/juliocesar/Library/CloudStorage/GoogleDrive-jcs.sjc@gmail.com/Meu Drive/#PROJETOS/ficv-sales-1"

# 2. Instalar dependências (se não estiver feito)
npm install

# 3. Rodar em desenvolvimento
npm run dev

# 4. Testar no navegador:
# - Ir em "Agentes" (Admin panel)
# - Clicar para editar um agente
# - Você deve ver um novo campo "Equipe"
# - Selecionar uma equipe
# - Salvar

# - Volta ao Dashboard
# - Você deve ver um novo filtro "Equipe" ao lado dos outros filtros
```

## 🎯 Checklist de Teste

- [ ] Migration SQL executada com sucesso
- [ ] Campo "Equipe" aparece no editor de agentes
- [ ] Consegue selecionar e salvar uma equipe para um agente
- [ ] Badge com cor/ícone da equipe é exibido (visualização)
- [ ] Filtro "Equipe" aparece no Dashboard
- [ ] Clicar no filtro mostra todas as equipes
- [ ] Selecionar uma equipe atualiza o seletor
- [ ] Relatórios/gráficos refletem os agentes da equipe selecionada

## 📝 Notas

- O sistema está 95% pronto, faltam apenas:
  1. Executar a SQL no Supabase
  2. Completar a lógica de filtro no App.tsx (mesclar team info com analysisData)
  
- As cores das equipes são customizáveis no Supabase
- Você pode adicionar/remover equipes diretamente na tabela `teams`
- O ícone é um emoji string (ex: "💼", "🎓", etc)

## Dúvidas?

Todos os arquivos estão prontos. Apenas execute a migration SQL e complete os 2 itens do Phase 1 acima.
