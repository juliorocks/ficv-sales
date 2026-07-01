#!/usr/bin/env node
/**
 * Importar matrículas para o Supabase
 *
 * Uso:
 *   node import-matriculas.js <arquivo.csv>
 *   node import-matriculas.js <arquivo.csv> --data 2026-06-01
 *
 * O CSV pode ser:
 *   - Exportação do Moodle com "Data da inclusão" (detectado automaticamente)
 *   - Exportação do Moodle sem data (use --data para definir a data de matrícula)
 *
 * Deduplicação: por CPF. Se o aluno já existe no banco, não substitui.
 */

import { createClient } from '@supabase/supabase-js';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import dotenv from 'dotenv';
import { existsSync } from 'fs';

dotenv.config();
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ Credenciais Supabase não encontradas (.env.local)');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Parseia linha de CSV respeitando aspas
function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

// Converte data BR (dd/mm/yyyy) ou ISO (yyyy-mm-dd) para ISO
function parseDate(str) {
    if (!str) return null;
    str = str.trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
        const [d, m, y] = str.split('/');
        return `${y}-${m}-${d}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    return null;
}

async function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        const lines = [];
        const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
        rl.on('line', line => lines.push(line));
        rl.on('close', () => resolve(lines));
        rl.on('error', reject);
    });
}

async function main() {
    const args = process.argv.slice(2);
    const csvFile = args.find(a => !a.startsWith('--'));
    const dataArg = (() => {
        const idx = args.indexOf('--data');
        return idx !== -1 ? args[idx + 1] : null;
    })();

    if (!csvFile) {
        console.error('❌ Informe o arquivo CSV:\n   node import-matriculas.js <arquivo.csv> [--data YYYY-MM-DD]');
        process.exit(1);
    }

    if (!existsSync(csvFile)) {
        console.error(`❌ Arquivo não encontrado: ${csvFile}`);
        process.exit(1);
    }

    if (dataArg && !/^\d{4}-\d{2}-\d{2}$/.test(dataArg)) {
        console.error('❌ Formato de data inválido. Use YYYY-MM-DD (ex: 2026-06-01)');
        process.exit(1);
    }

    const lines = await readCsv(csvFile);
    if (lines.length < 2) {
        console.error('❌ Arquivo CSV vazio ou sem dados');
        process.exit(1);
    }

    const header = parseCsvLine(lines[0]);
    console.log(`\n📋 Colunas detectadas: ${header.join(', ')}`);

    // Detectar índices das colunas
    const normalize = s => s?.toLowerCase().replace(/[^a-z]/g, '');
    const col = name => header.findIndex(h => normalize(h).includes(normalize(name)));

    const COL = {
        nome:     col('nome') !== -1 ? col('nome') : col('nome completo'),
        cpf:      col('cpf'),
        email:    col('mail') !== -1 ? col('mail') : col('email'),
        telefone: col('telefone'),
        data:     col('data') !== -1 ? col('data') : col('inclus'),
        turma:    col('turma'),
    };

    // Fallback: find CPF by content (3rd col usually)
    if (COL.cpf === -1) COL.cpf = 2;
    if (COL.nome === -1) COL.nome = 0;

    console.log('\nMapeamento de colunas:');
    Object.entries(COL).forEach(([k, v]) => {
        if (v !== -1) console.log(`  ${k}: coluna ${v} ("${header[v]}")`);
    });

    if (COL.data !== -1) {
        console.log('\n✅ Coluna de data detectada — usando datas do arquivo');
    } else if (dataArg) {
        console.log(`\n✅ Sem coluna de data no arquivo — usando --data ${dataArg} para todos`);
    } else {
        console.log('\n⚠️  Sem coluna de data e sem --data. Importando sem data de matrícula.');
        console.log('   Estes alunos não aparecerão nos filtros mensais de conversão.');
    }

    // Parse rows
    const students = [];
    const seen = new Set();

    for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        if (row.length < 2) continue;

        const nome = row[COL.nome]?.trim() || '';
        const cpf = row[COL.cpf]?.trim() || '';
        const email = COL.email !== -1 ? row[COL.email]?.trim() : '';
        const telefone = COL.telefone !== -1 ? row[COL.telefone]?.trim() : '';
        const turma = COL.turma !== -1 ? row[COL.turma]?.trim() : '';

        // Valida CPF mínimo (tem dígitos suficientes)
        const cpfDigits = cpf.replace(/\D/g, '');
        if (!cpf || cpfDigits.length < 11) continue;
        if (!nome || nome.toLowerCase().includes('nome') ) continue;

        // Deduplicação local por CPF
        if (seen.has(cpf)) continue;
        seen.add(cpf);

        let data_matricula = null;
        if (COL.data !== -1 && row[COL.data]) {
            data_matricula = parseDate(row[COL.data]);
        } else if (dataArg) {
            data_matricula = dataArg;
        }

        students.push({ nome, cpf, email, telefone, turma, data_matricula });
    }

    console.log(`\n📊 ${students.length} alunos únicos (por CPF) para importar`);

    if (students.length === 0) {
        console.log('Nenhum aluno encontrado. Verifique o formato do CSV.');
        process.exit(0);
    }

    // Mostrar preview
    console.log('\nPrimeiros 3 registros:');
    students.slice(0, 3).forEach(s => {
        console.log(`  ${s.nome} | ${s.cpf} | ${s.data_matricula || 'sem data'}`);
    });

    // Importar em lotes de 50 (upsert — CPF já existente é ignorado)
    let inserted = 0;
    let skipped = 0;
    const BATCH = 50;

    for (let i = 0; i < students.length; i += BATCH) {
        const batch = students.slice(i, i + BATCH);
        const { data, error } = await supabase
            .from('matriculas')
            .upsert(batch, { onConflict: 'cpf', ignoreDuplicates: true })
            .select('id');

        if (error) {
            console.error(`❌ Erro no lote ${i / BATCH + 1}:`, error.message);
        } else {
            inserted += data?.length || 0;
            skipped += batch.length - (data?.length || 0);
        }

        process.stdout.write(`\r  Progresso: ${Math.min(i + BATCH, students.length)}/${students.length}`);
    }

    console.log(`\n\n✅ Importação concluída!`);
    console.log(`   Inseridos: ${inserted}`);
    console.log(`   Já existiam (ignorados): ${skipped}`);

    // Mostrar contagem por mês
    const withDate = students.filter(s => s.data_matricula);
    if (withDate.length > 0) {
        const byMonth = {};
        withDate.forEach(s => {
            const m = s.data_matricula.slice(0, 7);
            byMonth[m] = (byMonth[m] || 0) + 1;
        });
        console.log('\nMatrículas por mês (neste arquivo):');
        Object.entries(byMonth).sort().forEach(([m, n]) => {
            console.log(`  ${m}: ${n} alunos`);
        });
    }
}

main().catch(err => {
    console.error('❌ Erro:', err.message);
    process.exit(1);
});
