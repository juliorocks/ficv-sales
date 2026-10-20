-- WABA (conta da Meta) de cada número do VivaConnect: os templates são aprovados por WABA, então
-- a lista do seletor precisa vir do WABA do canal que o lead usa (e não sempre do oficial).
ALTER TABLE vivaconnect_channels ADD COLUMN IF NOT EXISTS waba_id text;
UPDATE vivaconnect_channels SET waba_id = '1653396729814045' WHERE id = 8;
UPDATE vivaconnect_channels SET waba_id = '1337830955092662' WHERE id = 5;
