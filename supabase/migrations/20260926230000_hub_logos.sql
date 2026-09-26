-- Hub do Grupo: logo de cada empresa no lugar do emoji (arquivos em public/hub/ ou upload
-- pela tela em agent-photos/hub-logos/).
ALTER TABLE vivaconnect_hub_destinations ADD COLUMN IF NOT EXISTS logo_url text;
UPDATE vivaconnect_hub_destinations SET logo_url = '/hub/faculdade.jpg' WHERE is_self AND logo_url IS NULL;
UPDATE vivaconnect_hub_destinations SET logo_url = '/hub/igreja.jpg'    WHERE nome = 'Igreja Cidade Viva'    AND logo_url IS NULL;
UPDATE vivaconnect_hub_destinations SET logo_url = '/hub/escola.png'    WHERE nome = 'Escola Cidade Viva'    AND logo_url IS NULL;
UPDATE vivaconnect_hub_destinations SET logo_url = '/hub/education.png' WHERE nome = 'Cidade Viva Education' AND logo_url IS NULL;
UPDATE vivaconnect_hub_destinations SET logo_url = '/hub/fundacao.png'  WHERE nome = 'Fundação Cidade Viva'  AND logo_url IS NULL;
