-- última resposta do Z-PRO (listChannels + getAllSessionApis) de cada número —
-- cadastro automático pela URL de integração e diagnóstico do formato real.
ALTER TABLE vivaconnect_channels ADD COLUMN IF NOT EXISTS zpro_info jsonb;
GRANT SELECT (zpro_info) ON vivaconnect_channels TO authenticated;
