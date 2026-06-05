import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  console.log('🔍 Analisando amostras de conversas para debug...\n');

  const { data: samples } = await supabase
    .from('messages_logs')
    .select('protocol, agent_name, contact, message_content')
    .eq('agent_name', 'Karina Pimentel')
    .limit(5);

  samples?.forEach((s, idx) => {
    console.log(`\n━━━ AMOSTRA ${idx + 1}: ${s.protocol} ━━━`);
    console.log(`Agente: ${s.agent_name}`);
    console.log(`Contato: ${s.contact}`);

    try {
      const transcript = JSON.parse(s.message_content || '[]');
      console.log(`Total de mensagens: ${transcript.length}`);

      transcript.forEach((msg, i) => {
        console.log(`  [${i}] ${msg.role?.toUpperCase()}: "${msg.text.substring(0, 80)}..."`);
      });

      // Check for welcome message
      const hasWelcome = transcript.some(m =>
        m.text?.toLowerCase().includes('bem-vindo') &&
        m.text?.toLowerCase().includes('cidade viva')
      );
      console.log(`\n  ✓ Tem 'bem-vindo'? ${hasWelcome}`);

      // Check for client response
      const clientMessages = transcript.filter(m => m.role === 'client');
      console.log(`  ✓ Mensagens do cliente: ${clientMessages.length}`);

    } catch (e) {
      console.log(`  ⚠️ Erro ao parsear: ${e.message}`);
    }
  });
})();
