# Recalcular Scores de Atendentes

Script para recalcular os scores de qualidade (empatia, clareza, profundidade, comercial, agilidade) das atendentes.

## Pré-requisitos

1. **Node.js** instalado (v16+)
2. **Variáveis de ambiente** configuradas:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

## Setup

### 1. Configurar as variáveis de ambiente

Crie um arquivo `.env` ou `.env.local` na raiz do projeto com:

```env
VITE_SUPABASE_URL=https://seu-project.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anonima
```

Você encontra essas credenciais em:
- Supabase Dashboard → Seu Projeto → Settings → API
- `VITE_SUPABASE_URL`: URL do projeto
- `VITE_SUPABASE_ANON_KEY`: Chave anon/public key

### 2. Instalar dependências (se ainda não instaladas)

```bash
npm install
```

## Uso

### Recalcular para as 3 atendentes padrão (Katina, Izabelly, Thayanne)

```bash
node recalculate-scores.js
```

### Recalcular para atendentes específicas

```bash
node recalculate-scores.js "Katina" "Izabelly" "Thayanne"
node recalculate-scores.js "Maria" "João"
```

## O que o script faz

1. **Conecta ao Supabase** usando as credenciais do `.env`
2. **Busca todos os atendimentos** de cada atendente na tabela `messages_logs`
3. **Analisa cada conversa** aplicando regras de scoring:
   - **Empatia** (0-10): presença de palavras-chave como "bom dia", "entendo", "obrigado"
   - **Clareza** (0-10): quantidade de mensagens bem estruturadas (>60 caracteres)
   - **Profundidade** (0-10): quantidade de perguntas feitas ao cliente
   - **Comercial** (0-10): tentativas de fechamento (inscrição, matrícula)
   - **Agilidade** (0-10): quantidade e velocidade de trocas de mensagens
4. **Recalcula o score final** como:
   - Atendimento comercial: média de (empatia + clareza + profundidade + comercial + agilidade)
   - Atendimento de suporte: média de (empatia + clareza + profundidade + agilidade) — ignora comercial
5. **Atualiza o banco de dados** com os novos scores

## Output

O script exibe um resumo com:
- ✅ Quantos atendimentos foram processados
- 📊 Quantos scores foram atualizados
- ⚠️ Quantos erros ocorreram

Exemplo:
```
📊 Recalculando scores para Katina...
✓ Encontrados 42 atendimentos para Katina
✅ Katina: 42 processados, 38 atualizados, 0 erros

📊 Recalculando scores para Izabelly...
✓ Encontrados 35 atendimentos para Izabelly
✅ Izabelly: 35 processados, 33 atualizados, 0 erros

📈 RESUMO FINAL
Katina        | 42 processados | 38 atualizados | 0 erros
Izabelly      | 35 processados | 33 atualizados | 0 erros
Thayanne      | 28 processados | 25 atualizados | 0 erros
Total: 105 processados, 96 atualizados, 0 erros
✅ Recalculação concluída!
```

## Validações do Script

- ❌ Atendimentos sem mensagens reais são invalidados (status: 'invalidated', score: 0)
- ❌ Conversas onde o cliente nunca respondeu não são contabilizadas
- ✅ Mensagens do sistema (transferências, expiração de sessão) são ignoradas
- ✅ Suporta tanto atendimentos comerciais quanto de suporte a alunos

## Dúvidas?

Se o script falhar:
1. Verifique se as credenciais do `.env` estão corretas
2. Verifique se a tabela `messages_logs` existe no Supabase
3. Verifique se há conexão com a internet

## Após a execução

Os novos scores estarão visíveis:
- Dashboard → Gráficos de agentes atualizados
- Central de Atendimento → Scores dos relatórios individuais
- Auditoria de Qualidade → Histórico com novos scores
