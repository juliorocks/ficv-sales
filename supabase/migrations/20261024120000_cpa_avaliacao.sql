-- Avaliação Institucional da CPA (graduação e pós). Um formulário "geral" por nível e ano.
-- Respostas são anônimas. As oficiais formam uma cadeia de hash (cada linha guarda o hash da
-- anterior), e um trigger impede UPDATE/DELETE nelas: é isso que sustenta a comprovação ao MEC.
-- Respostas de teste (status 'teste') ficam fora da cadeia e podem ser apagadas.

CREATE TABLE IF NOT EXISTS public.cpa_formularios (
    id bigserial PRIMARY KEY,
    nivel text NOT NULL CHECK (nivel IN ('graduacao', 'pos')),
    tipo text NOT NULL DEFAULT 'geral',
    titulo text NOT NULL,
    ano int NOT NULL,
    -- teste: aceita respostas marcadas como teste (fora do relatório oficial)
    -- aberto: aceita respostas oficiais (encadeadas)
    -- encerrado: não aceita mais nada
    status text NOT NULL DEFAULT 'teste' CHECK (status IN ('teste', 'aberto', 'encerrado')),
    -- link de aplicação: /avaliacao/<token>. Não aparece no Portal do Aluno.
    token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
    -- total de alunos que receberam o convite: base da porcentagem de respondentes
    populacao_alvo int,
    intro text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (nivel, tipo, ano)
);

CREATE TABLE IF NOT EXISTS public.cpa_blocos (
    id bigserial PRIMARY KEY,
    formulario_id bigint NOT NULL REFERENCES public.cpa_formularios(id) ON DELETE CASCADE,
    ordem int NOT NULL,
    titulo text NOT NULL,
    -- frase mostrada na pausa entre este bloco e o próximo (não aparece no último)
    incentivo text,
    UNIQUE (formulario_id, ordem)
);

CREATE TABLE IF NOT EXISTS public.cpa_perguntas (
    id bigserial PRIMARY KEY,
    formulario_id bigint NOT NULL REFERENCES public.cpa_formularios(id) ON DELETE CASCADE,
    bloco_id bigint NOT NULL REFERENCES public.cpa_blocos(id) ON DELETE CASCADE,
    ordem int NOT NULL,
    texto text NOT NULL,
    tipo text NOT NULL CHECK (tipo IN ('escala', 'escolha', 'texto')),
    escala_min int,
    escala_max int,
    rotulo_min text,
    rotulo_max text,
    opcoes jsonb NOT NULL DEFAULT '[]'::jsonb,
    obrigatoria boolean NOT NULL DEFAULT true,
    -- 'curso': a resposta grava cpa_respostas.curso (filtro dos relatórios)
    chave text,
    CHECK (tipo <> 'escala' OR (escala_min IS NOT NULL AND escala_max IS NOT NULL AND escala_min < escala_max)),
    UNIQUE (formulario_id, ordem)
);

CREATE TABLE IF NOT EXISTS public.cpa_respostas (
    id bigserial PRIMARY KEY,
    formulario_id bigint NOT NULL REFERENCES public.cpa_formularios(id) ON DELETE RESTRICT,
    teste boolean NOT NULL DEFAULT false,
    -- número sequencial da resposta oficial (protocolo). Nulo nas de teste.
    seq bigint,
    respondido_em timestamptz NOT NULL,
    -- {"<pergunta_id>": valor}: escala = número, escolha/texto = string
    respostas jsonb NOT NULL,
    curso text,
    -- texto exato que entra no hash: é guardado para a verificação recalcular sem depender de formatação
    canonico text NOT NULL,
    hash_anterior text,
    hash text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS cpa_respostas_seq_uk ON public.cpa_respostas (formulario_id, seq) WHERE seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS cpa_respostas_form_idx ON public.cpa_respostas (formulario_id, respondido_em);

-- Oficial = imutável. Teste pode ser apagada à vontade.
CREATE OR REPLACE FUNCTION public.cpa_bloquear_oficial() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Resposta oficial da CPA é imutável (cadeia de integridade).';
END $$;

DROP TRIGGER IF EXISTS cpa_respostas_oficiais_imutaveis ON public.cpa_respostas;
CREATE TRIGGER cpa_respostas_oficiais_imutaveis
    BEFORE UPDATE OR DELETE ON public.cpa_respostas
    FOR EACH ROW WHEN (OLD.teste = false)
    EXECUTE FUNCTION public.cpa_bloquear_oficial();

-- Grava uma resposta. Só a service role chama (a edge function cpa-form valida antes).
-- Hash = sha256(hash_anterior || '|' || canonico). A cadeia só existe nas oficiais.
CREATE OR REPLACE FUNCTION public.cpa_registrar_resposta(p_formulario bigint, p_respostas jsonb, p_curso text DEFAULT NULL)
RETURNS TABLE (out_id bigint, out_seq bigint, out_hash text, out_teste boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    f public.cpa_formularios%ROWTYPE;
    oficial boolean;
    n bigint := 0;
    prev text := NULL;
    agora timestamptz := now();
    canon text;
    h text;
    nid bigint;
BEGIN
    SELECT * INTO f FROM public.cpa_formularios WHERE cpa_formularios.id = p_formulario;
    IF NOT FOUND OR f.status = 'encerrado' THEN
        RAISE EXCEPTION 'formulario_fechado';
    END IF;
    oficial := f.status = 'aberto';

    IF oficial THEN
        -- serializa a cadeia: duas respostas simultâneas não podem pegar o mesmo seq/hash anterior
        PERFORM pg_advisory_xact_lock(7301, f.id::int);
        SELECT r.seq, r.hash INTO n, prev
        FROM public.cpa_respostas r
        WHERE r.formulario_id = f.id AND NOT r.teste
        ORDER BY r.seq DESC LIMIT 1;
        n := coalesce(n, 0) + 1;
    END IF;

    canon := n::text || '|' || to_char(agora AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          || '|' || f.id::text || '|' || oficial::text || '|' || p_respostas::text;
    h := encode(sha256(convert_to(coalesce(prev, '') || '|' || canon, 'UTF8')), 'hex');

    INSERT INTO public.cpa_respostas (formulario_id, teste, seq, respondido_em, respostas, curso, canonico, hash_anterior, hash)
    VALUES (f.id, NOT oficial, CASE WHEN oficial THEN n END, agora, p_respostas, p_curso, canon,
            CASE WHEN oficial THEN prev END, h)
    RETURNING cpa_respostas.id INTO nid;

    RETURN QUERY SELECT nid, CASE WHEN oficial THEN n END, h, NOT oficial;
END $$;

REVOKE ALL ON FUNCTION public.cpa_registrar_resposta(bigint, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cpa_registrar_resposta(bigint, jsonb, text) TO service_role;

ALTER TABLE public.cpa_formularios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cpa_blocos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cpa_perguntas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cpa_respostas ENABLE ROW LEVEL SECURITY;

-- leitura direta só para a equipe; escrita e acesso público passam pelas edge functions (service role)
CREATE POLICY cpa_formularios_staff ON public.cpa_formularios FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY cpa_blocos_staff ON public.cpa_blocos FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY cpa_perguntas_staff ON public.cpa_perguntas FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY cpa_respostas_staff ON public.cpa_respostas FOR SELECT TO authenticated USING (public.is_staff());

-- ── Seed: modelos "geral" de 2026 (texto das perguntas vindo dos modelos de 2024/2025) ──
DO $$
DECLARE
    fg bigint;
    fp bigint;
    b bigint;
    cursos jsonb := '["Pós-Graduação em Educação Cristã Clássica", "Pós-Graduação em Formação Política", "Pós-Graduação em Gestão Escolar", "Pós-Graduação em História do Cristianismo", "Pós-Graduação em Liderança Cristã", "Pós-Graduação em Missiologia Urbana", "Pós-Graduação em Psicopedagogia", "Pós-Graduação em Psicoteologia", "Pós-Graduação em Teologia Bíblica e Exegética do Novo Testamento", "Pós-Graduação em Teologia Sistemática"]';
    intro text := 'A Comissão Própria de Avaliação (CPA) quer ouvir você. As respostas são anônimas e ajudam a FICV a melhorar. Leva poucos minutos.';
BEGIN
    -- ── Graduação (escala 0–10) ──
    INSERT INTO public.cpa_formularios (nivel, tipo, titulo, ano, status, intro)
    VALUES ('graduacao', 'geral', 'Avaliação Institucional da Graduação', 2026, 'teste', intro)
    RETURNING id INTO fg;

    INSERT INTO public.cpa_blocos (formulario_id, ordem, titulo, incentivo)
    VALUES (fg, 1, 'Setor administrativo, organizacional, missão e valores', 'Você está indo bem! Próximo bloco: ensino, pesquisa e extensão.')
    RETURNING id INTO b;
    INSERT INTO public.cpa_perguntas (formulario_id, bloco_id, ordem, texto, tipo, escala_min, escala_max, rotulo_min, rotulo_max) VALUES
    (fg, b, 1, 'Compromisso e envolvimento da Direção Acadêmica.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 2, 'Proatividade, resolução de problemas e acolhimento da equipe de coordenação.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 3, 'Funcionamento administrativo da equipe de secretaria e biblioteca.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 4, 'Qualidade do acervo da biblioteca.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 5, 'Quantidade do acervo da biblioteca.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 6, 'Atuação da Comissão Própria de Avaliação.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 7, 'Organização, limpeza e manutenção das salas.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 8, 'Disponibilidade de estacionamento.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 9, 'Organização, limpeza e manutenção dos banheiros.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 10, 'Formas de comunicação dos informes da FICV (quadro de avisos, portal do aluno, e-mail).', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 11, 'Envolvimento da FICV com as preocupações e demandas sociais no âmbito regional.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 12, 'Imagem da FICV para a comunidade.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 13, 'Excelência no papel de formar líderes que impactarão e transformarão em seu território existencial.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito');

    INSERT INTO public.cpa_blocos (formulario_id, ordem, titulo, incentivo)
    VALUES (fg, 2, 'Ensino, pesquisa e extensão', 'Metade do caminho, continue assim!')
    RETURNING id INTO b;
    INSERT INTO public.cpa_perguntas (formulario_id, bloco_id, ordem, texto, tipo, escala_min, escala_max, rotulo_min, rotulo_max) VALUES
    (fg, b, 14, 'Qualidade do curso de graduação que realiza.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 15, 'Estrutura curricular do curso.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 16, 'Inovação, criatividade e metodologia atualizada utilizadas pelo professor na construção do conhecimento em sala.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 17, 'Qualidade dos planos de ensino apresentados pelos professores.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 18, 'Formas de avaliação utilizadas pelos professores para "medir" níveis de conhecimento do aluno.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 19, 'Conhecimento demonstrado pelos docentes nas disciplinas que lecionam.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 20, 'Adequação dos componentes curriculares para o perfil de cada aluno (Seminário Vocacional).', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 21, 'Oferta de congressos, palestras e outros desenvolvidos pela FICV que auxiliem na composição de horas complementares dos alunos.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 22, 'Condições existentes para o desenvolvimento de monitoria.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 23, 'Condições existentes para o desenvolvimento da pesquisa na FICV.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 24, 'Relação entre a pesquisa e o ensino na FICV.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 25, 'Condições existentes para o desenvolvimento da extensão na FICV.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 26, 'Relação entre a extensão e o ensino na FICV.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito');

    INSERT INTO public.cpa_blocos (formulario_id, ordem, titulo, incentivo)
    VALUES (fg, 3, 'Autoavaliação, ambiente e relações humanas', 'Última parte. Falta pouco, estamos quase lá!')
    RETURNING id INTO b;
    INSERT INTO public.cpa_perguntas (formulario_id, bloco_id, ordem, texto, tipo, escala_min, escala_max, rotulo_min, rotulo_max) VALUES
    (fg, b, 27, 'Compromisso pessoal com o estudo, leituras dos textos indicados pelos professores e participação em sala.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 28, 'Minhas condições e prioridades para dedicação ao curso.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 29, 'Amizade e convivência entre os alunos de outras turmas da FICV.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 30, 'Ética nas discussões e nas relações internas da FICV.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 31, 'Adequação do ambiente de ensino que favoreça a aprendizagem e as relações interpessoais.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 32, 'Me sinto satisfeito e orgulhoso de fazer parte como discente da FICV.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fg, b, 33, 'Eu me sinto realizado(a) em fazer a graduação na FICV, e indicaria a um familiar ou amigo.', 'escala', 0, 10, 'Muito insatisfeito', 'Muito satisfeito');

    INSERT INTO public.cpa_blocos (formulario_id, ordem, titulo, incentivo)
    VALUES (fg, 4, 'Comentários', NULL)
    RETURNING id INTO b;
    INSERT INTO public.cpa_perguntas (formulario_id, bloco_id, ordem, texto, tipo, obrigatoria) VALUES
    (fg, b, 34, 'Sinta-se à vontade para comentários, sugestões, elogios e críticas.', 'texto', false);

    -- ── Pós-graduação (escala 1–10, como nos resultados de 2025) ──
    INSERT INTO public.cpa_formularios (nivel, tipo, titulo, ano, status, intro)
    VALUES ('pos', 'geral', 'Avaliação Institucional da Pós-Graduação', 2026, 'teste', intro)
    RETURNING id INTO fp;

    INSERT INTO public.cpa_blocos (formulario_id, ordem, titulo, incentivo)
    VALUES (fp, 1, 'Sobre o curso', 'Obrigado! Agora são algumas perguntas rápidas sobre a instituição.')
    RETURNING id INTO b;
    INSERT INTO public.cpa_perguntas (formulario_id, bloco_id, ordem, texto, tipo, opcoes, chave) VALUES
    (fp, b, 1, 'Qual o curso de Pós-Graduação avaliado?', 'escolha', cursos, 'curso');

    INSERT INTO public.cpa_blocos (formulario_id, ordem, titulo, incentivo)
    VALUES (fp, 2, 'Setor administrativo, organizacional, missão e valores', 'Ótimo ritmo! Próximo bloco: ensino.')
    RETURNING id INTO b;
    INSERT INTO public.cpa_perguntas (formulario_id, bloco_id, ordem, texto, tipo, escala_min, escala_max, rotulo_min, rotulo_max) VALUES
    (fp, b, 2, 'Proatividade, resolução de problemas e acolhimento da equipe de coordenação.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 3, 'Proatividade, resolução de problemas e acolhimento da equipe de tutoria.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 4, 'Funcionamento administrativo da equipe da Secretaria Acadêmica.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 5, 'Clareza sobre as competências e responsabilidades de cada setor.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 6, 'Atuação da Comissão Própria de Avaliação (CPA).', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 7, 'Formas de comunicação dos informes da FICV (Portal do Aluno, fórum, e-mail, WhatsApp, site, Instagram).', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 8, 'Nível de satisfação com o Ambiente Virtual de Aprendizagem (Moodle).', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 9, 'Facilidade de uso do Portal do Aluno.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 10, 'Imagem da FICV para a comunidade.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 11, 'Excelência no papel de formar líderes que impactarão e transformarão em seu território existencial.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito');

    INSERT INTO public.cpa_blocos (formulario_id, ordem, titulo, incentivo)
    VALUES (fp, 3, 'Ensino', 'Já passou da metade. Estamos quase lá!')
    RETURNING id INTO b;
    INSERT INTO public.cpa_perguntas (formulario_id, bloco_id, ordem, texto, tipo, escala_min, escala_max, rotulo_min, rotulo_max) VALUES
    (fp, b, 12, 'Qualidade do curso de Pós-Graduação que realiza.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 13, 'Estrutura curricular do curso.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 14, 'Inovação, criatividade e metodologia atualizada utilizadas pelo professor na construção do conhecimento nas aulas gravadas.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 15, 'Qualidade das apostilas/material disponibilizado no Ambiente Virtual.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 16, 'Formas de avaliação utilizadas pelos professores para "medir" níveis de conhecimento do aluno.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 17, 'Conhecimento demonstrado pelos docentes nas disciplinas que lecionam.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito');

    INSERT INTO public.cpa_blocos (formulario_id, ordem, titulo, incentivo)
    VALUES (fp, 4, 'Autoavaliação, ambiente e relações humanas', 'Última parte. Falta pouquinho!')
    RETURNING id INTO b;
    INSERT INTO public.cpa_perguntas (formulario_id, bloco_id, ordem, texto, tipo, escala_min, escala_max, rotulo_min, rotulo_max) VALUES
    (fp, b, 18, 'Compromisso pessoal com o estudo, leituras dos textos indicados pelos professores, leitura da apostila e participação nos fóruns e nos encontros síncronos.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 19, 'Minhas condições e prioridades para dedicação ao curso.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 20, 'Sinto-me satisfeito e orgulhoso de fazer parte como discente da FICV.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito'),
    (fp, b, 21, 'Sinto-me realizado(a) em fazer o curso de Pós-Graduação na FICV, e indicaria a um parente ou amigo.', 'escala', 1, 10, 'Muito insatisfeito', 'Muito satisfeito');

    INSERT INTO public.cpa_blocos (formulario_id, ordem, titulo, incentivo)
    VALUES (fp, 5, 'Comentários', NULL)
    RETURNING id INTO b;
    INSERT INTO public.cpa_perguntas (formulario_id, bloco_id, ordem, texto, tipo, obrigatoria) VALUES
    (fp, b, 22, 'Sinta-se à vontade para comentários, sugestões, elogios e críticas.', 'texto', false);
END $$;
