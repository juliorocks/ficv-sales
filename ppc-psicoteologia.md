# Plano de Alimentação da Base de Conhecimento - PPC Psicoteologia

Este plano descreve como processar e inserir as informações do Projeto Pedagógico do Curso (PPC) de Psicoteologia na Base de Conhecimento do SalesPulse.

## Visão Geral
- **Objetivo**: Formatar o texto bruto do PPC em documentos estruturados para a Base de Conhecimento.
- **Projeto**: WEB (React + Supabase)
- **Tabela Alvo**: `public.knowledge_base`
- **Categoria**: `PPC - Pós-Graduação`

## Estratégia de Segmentação
Para otimizar a recuperação de informações pela IA, o PPC será dividido nos seguintes documentos:
1. **PPC Psicoteologia: Apresentação e Identificação**: Introdução, dados institucionais e características do curso.
2. **PPC Psicoteologia: Perfil e Objetivos**: Justificativa, objetivos, público-alvo e perfil do egresso.
3. **PPC Psicoteologia: Metodologia e Avaliação**: Funcionamento, cronograma, metodologia de ensino e sistema de avaliação.
4. **PPC Psicoteologia: Ementário Completo**: Detalhamento de todas as disciplinas e bibliografia.

## Tarefas

### Fase 1: Análise e Limpeza
- [ ] **T1**: Extrair e limpar o texto fornecido, removendo quebras de linha desnecessárias e corrigindo formatação manual.
  - **Agente**: `documentation-writer`
  - **Input**: Texto bruto do usuário.
  - **Output**: Markdown limpo e estruturado.

### Fase 2: Geração de Conteúdo
- [ ] **T2**: Estruturar o conteúdo em 4 arquivos Markdown correspondentes às seções sugeridas.
  - **Agente**: `documentation-writer`
  - **Output**: Arquivos `.md` temporários.

### Fase 3: Preparação da Migração
- [ ] **T3**: Gerar um arquivo SQL (`src/utils/ppc_psicoteologia.sql`) com os comandos de `INSERT` para a tabela `knowledge_base`.
  - **Agente**: `database-architect`
  - **Input**: Markdown da T2.
  - **Output**: Script SQL pronto para execução via Dashboard do Supabase.

## Fase X: Verificação
- [ ] Validar se os textos estão legíveis no formato Markdown.
- [ ] Garantir que o Ementário inclua todos os professores e bibliografias básicas.
- [ ] Verificar se as IDs de UUID geradas no SQL (se necessário) ou se os campos batem com o `KnowledgeBase.tsx`.

