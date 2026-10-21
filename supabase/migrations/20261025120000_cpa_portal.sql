-- Avaliação CPA no Portal do Aluno.
--   portal_ativo: liga a pesquisa no Portal. Começa DESLIGADA (nada aparece pro aluno até a equipe ligar).
--   contexto: o que está sendo avaliado. Vazio = avaliação geral; "<turma>~<disciplina>" = disciplina.
--             Só [a-z0-9~-], assim não quebra a canonização do hash.
--   cpa_participacoes: quem já respondeu o quê. Guarda só um HMAC do aluno (não reversível sem a chave),
--             então a participação não revela o conteúdo das respostas, e as respostas não revelam o aluno.
--   docentes: professor titular (Moodle, papel editingteacher) por período + disciplina.

ALTER TABLE public.cpa_formularios ADD COLUMN IF NOT EXISTS portal_ativo boolean NOT NULL DEFAULT false;

ALTER TABLE public.cpa_respostas ADD COLUMN IF NOT EXISTS contexto text NOT NULL DEFAULT '';
ALTER TABLE public.cpa_respostas DROP CONSTRAINT IF EXISTS cpa_respostas_contexto_chk;
ALTER TABLE public.cpa_respostas ADD CONSTRAINT cpa_respostas_contexto_chk CHECK (contexto ~ '^[a-z0-9~-]*$');

CREATE TABLE IF NOT EXISTS public.cpa_participacoes (
    formulario_id bigint NOT NULL REFERENCES public.cpa_formularios(id) ON DELETE CASCADE,
    contexto text NOT NULL DEFAULT '',
    respondente_hash text NOT NULL,
    teste boolean NOT NULL DEFAULT false,
    respondido_em timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (formulario_id, contexto, respondente_hash)
);
ALTER TABLE public.cpa_participacoes ENABLE ROW LEVEL SECURITY;
-- sem policies: só a service role (edge function cpa-portal) acessa

CREATE TABLE IF NOT EXISTS public.cpa_docentes (
    periodo text NOT NULL,
    disciplina text NOT NULL,
    docente text NOT NULL,
    moodle_course_id bigint NOT NULL,
    sincronizado_em timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (periodo, disciplina)
);
ALTER TABLE public.cpa_docentes ENABLE ROW LEVEL SECURITY;
CREATE POLICY cpa_docentes_staff ON public.cpa_docentes FOR SELECT TO authenticated USING (public.is_staff());

-- Mesma cadeia de antes, agora com o contexto dentro do hash.
DROP FUNCTION IF EXISTS public.cpa_registrar_resposta(bigint, jsonb, text);
CREATE OR REPLACE FUNCTION public.cpa_registrar_resposta(p_formulario bigint, p_respostas jsonb, p_curso text DEFAULT NULL, p_contexto text DEFAULT '')
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
        PERFORM pg_advisory_xact_lock(7301, f.id::int);
        SELECT r.seq, r.hash INTO n, prev
        FROM public.cpa_respostas r
        WHERE r.formulario_id = f.id AND NOT r.teste
        ORDER BY r.seq DESC LIMIT 1;
        n := coalesce(n, 0) + 1;
    END IF;

    canon := n::text || '|' || to_char(agora AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          || '|' || f.id::text || '|' || oficial::text || '|' || coalesce(p_contexto, '') || '|' || p_respostas::text;
    h := encode(sha256(convert_to(coalesce(prev, '') || '|' || canon, 'UTF8')), 'hex');

    INSERT INTO public.cpa_respostas (formulario_id, teste, seq, respondido_em, respostas, curso, contexto, canonico, hash_anterior, hash)
    VALUES (f.id, NOT oficial, CASE WHEN oficial THEN n END, agora, p_respostas, p_curso, coalesce(p_contexto, ''), canon,
            CASE WHEN oficial THEN prev END, h)
    RETURNING cpa_respostas.id INTO nid;

    RETURN QUERY SELECT nid, CASE WHEN oficial THEN n END, h, NOT oficial;
END $$;

REVOKE ALL ON FUNCTION public.cpa_registrar_resposta(bigint, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cpa_registrar_resposta(bigint, jsonb, text, text) TO service_role;

-- Formulários de disciplina (um por nível), mesma escala do modelo usado no Prime/Mannesoft.
DO $$
DECLARE
    fg bigint;
    fp bigint;
    b bigint;
    nivel_txt text;
    f bigint;
    niveis text[] := ARRAY['graduacao', 'pos'];
    cinco text[] := ARRAY['Muito alto', 'Alto', 'Médio', 'Baixo', 'Muito baixo'];
BEGIN
    FOREACH nivel_txt IN ARRAY niveis LOOP
        INSERT INTO public.cpa_formularios (nivel, tipo, titulo, ano, status, intro)
        VALUES (nivel_txt, 'disciplina', 'Avaliação da Disciplina', 2026, 'teste',
                'Avalie a disciplina que você cursou neste período. Leva menos de um minuto por disciplina. As respostas são anônimas.')
        RETURNING id INTO f;

        INSERT INTO public.cpa_blocos (formulario_id, ordem, titulo, incentivo)
        VALUES (f, 1, 'Sobre a disciplina', NULL)
        RETURNING id INTO b;
        INSERT INTO public.cpa_perguntas (formulario_id, bloco_id, ordem, texto, tipo, escala_min, escala_max, rotulo_min, rotulo_max, opcoes) VALUES
        (f, b, 1, 'Dê uma nota de 0 a 5 para SEU próprio desempenho na disciplina, em termos de dedicação, comprometimento e motivação.', 'escala', 0, 5, 'Baixo', 'Alto', '[]'::jsonb);
        INSERT INTO public.cpa_perguntas (formulario_id, bloco_id, ordem, texto, tipo, opcoes) VALUES
        (f, b, 2, 'Na sua percepção, qual o nível de importância da disciplina para o contexto do curso?', 'escolha', to_jsonb(cinco)),
        (f, b, 3, 'Qual o nível de dificuldade DOS CONTEÚDOS da disciplina?', 'escolha', to_jsonb(cinco)),
        (f, b, 4, 'Aponte sua satisfação geral com o desempenho do professor.', 'escolha', to_jsonb(cinco)),
        (f, b, 5, 'Considerando a experiência com essa disciplina, qual a probabilidade de você recomendar o curso para um amigo ou parente próximo?', 'escolha', to_jsonb(cinco)),
        (f, b, 6, 'Clareza na exposição dos conteúdos.', 'escolha', to_jsonb(cinco));

        INSERT INTO public.cpa_blocos (formulario_id, ordem, titulo, incentivo)
        VALUES (f, 2, 'Comentários', NULL)
        RETURNING id INTO b;
        INSERT INTO public.cpa_perguntas (formulario_id, bloco_id, ordem, texto, tipo, obrigatoria) VALUES
        (f, b, 7, 'Comentários sobre a disciplina (opcional).', 'texto', false);
    END LOOP;
END $$;
