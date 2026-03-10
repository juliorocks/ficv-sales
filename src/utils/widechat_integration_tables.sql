-- Criação da tabela de integrações de usuário para armazenar credenciais do Widechat
CREATE TABLE IF NOT EXISTS public.user_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    widechat_email TEXT,
    widechat_password TEXT,
    widechat_session_token TEXT,
    widechat_token_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Ativar RLS para user_integrations
ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

-- Politica para permitir que usuarios leiam e editem apenas as proprias integracoes
CREATE POLICY "Users can view own integrations" ON public.user_integrations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own integrations" ON public.user_integrations
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own integrations" ON public.user_integrations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Criação da tabela de mensagens do Widechat
CREATE TABLE IF NOT EXISTS public.widechat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id INTEGER REFERENCES public.leads(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    message_id TEXT,
    type TEXT NOT NULL DEFAULT 'text',
    message TEXT,
    origin TEXT NOT NULL, -- agent, auto, channel
    sender_name TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    raw_data JSONB,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Criação de índice para acelerar a busca de mensagens por lead
CREATE INDEX IF NOT EXISTS widechat_messages_lead_id_idx ON public.widechat_messages(lead_id);
CREATE INDEX IF NOT EXISTS widechat_messages_session_id_idx ON public.widechat_messages(session_id);

-- Ativar RLS para widechat_messages
ALTER TABLE public.widechat_messages ENABLE ROW LEVEL SECURITY;

-- Políticas temporariamente abertas para leitura autenticada
CREATE POLICY "Authenticated users can view widechat messages" ON public.widechat_messages
    FOR SELECT TO authenticated USING (true);
