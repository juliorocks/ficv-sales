
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function debugProtocol(protocol) {
    console.log(`\n--- DEBUGGING PROTOCOL: ${protocol} ---\n`);

    const { data: logEntry, error } = await supabase
        .from('messages_logs')
        .select('*')
        .eq('protocol', protocol)
        .single();

    if (error || !logEntry) {
        console.error('Protocol not found in DB:', error);
        return;
    }

    let transcript = JSON.parse(logEntry.message_content);
    console.log(`Transcript length: ${transcript.length} messages`);

    const aiMessages = transcript.map(m => `[${m.role.toUpperCase()}]: ${m.text}`).join('\n');

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Você é o Auditor Master da FICV. 
    CLASSIFICAÇÃO: 
    - isCommercial: false se for suporte/acadêmico/aluno.
    - isCommercial: true se for venda.
    
    Analise esta conversa e retorne APENAS o JSON:
    {
      "isCommercial": boolean,
      "globalScores": { "empathy": number, "clarity": number, "depth": number, "commercial": number, "agility": number },
      "overallConclusion": "string"
    }

    CONVERSA:
    ${aiMessages}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log('--- AI RAW RESPONSE ---');
    console.log(text);
    console.log('------------------------');

    try {
        const json = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
        console.log('Extracted JSON:', json);

        const scores = json.globalScores;
        let final;
        if (json.isCommercial === false) {
            final = (scores.empathy + scores.clarity + scores.depth + scores.agility) / 4;
            console.log('Calculation: (Emp+Cla+Dep+Agi) / 4');
        } else {
            final = (scores.empathy + scores.clarity + scores.depth + scores.commercial + scores.agility) / 5;
            console.log('Calculation: (All 5) / 5');
        }
        console.log('Final Score Candidate:', final.toFixed(1));
        console.log('Current DB Score:', logEntry.final_score);
    } catch (e) {
        console.error('Failed to parse AI response as JSON');
    }
}

debugProtocol('2026020200047');
