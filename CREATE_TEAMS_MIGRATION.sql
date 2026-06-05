-- Create teams table
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT DEFAULT '#5551FF',
    icon TEXT DEFAULT '👥',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- Add team_id to agent_profiles if it doesn't exist
ALTER TABLE agent_profiles
ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- Create some default teams
INSERT INTO teams (name, description, icon, color) VALUES
    ('Comercial', 'Equipe de vendas e prospecção', '💼', '#5551FF'),
    ('Secretaria', 'Equipe administrativo e secretariao', '📋', '#00D4AA'),
    ('Tutoria', 'Equipe de tutoria e suporte acadêmico', '🎓', '#FFB347'),
    ('Financeiro', 'Equipe de gestão financeira', '💰', '#FF6B9D'),
    ('Suporte Técnico', 'Equipe de suporte técnico', '🔧', '#A78BFA'),
    ('Sem equipe', 'Agentes sem equipe designada', '❓', '#8B949E')
ON CONFLICT (name) DO NOTHING;

-- Add RLS policies for teams
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- Policy for SELECT (view teams)
CREATE POLICY "Teams are viewable by authenticated users" ON teams
    FOR SELECT USING (auth.role() = 'authenticated_user');

-- Policy for INSERT (create teams - admin only)
CREATE POLICY "Admins can create teams" ON teams
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Policy for UPDATE (edit teams - admin only)
CREATE POLICY "Admins can update teams" ON teams
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Policy for DELETE (delete teams - admin only)
CREATE POLICY "Admins can delete teams" ON teams
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_agent_profiles_team_id ON agent_profiles(team_id);
