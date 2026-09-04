import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { pg, mirror, sv } from "../_shared/db.ts";

// ============================================================================
// sync-sendpulse-forms — polling (pg_cron ~3 min) dos formulários SendPulse.
// Allowlist em `sendpulse_forms`. Cada inscrito novo vira lead; inscrito
// recorrente vira nota + contact_count++. Postgres primário, espelho SurrealDB.
// ============================================================================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: s });

const SENDPULSE_API_KEY = Deno.env.get('SENDPULSE_API_KEY') ?? '';
const SP_CLIENT_ID = Deno.env.get('SENDPULSE_CLIENT_ID') ?? '';
const SP_CLIENT_SECRET = Deno.env.get('SENDPULSE_CLIENT_SECRET') ?? '';
const BACKFILL_DAYS = Number(Deno.env.get('SENDPULSE_BACKFILL_DAYS') ?? '14');
const SP_TZ_OFFSET = Deno.env.get('SENDPULSE_TZ_OFFSET') ?? 'Z';

let _spToken = '';
async function spAuthHeader(): Promise<string> {
    if (SENDPULSE_API_KEY) return `Bearer ${SENDPULSE_API_KEY}`;
    if (_spToken) return `Bearer ${_spToken}`;
    const r = await fetch('https://api.sendpulse.com/oauth/access_token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: SP_CLIENT_ID, client_secret: SP_CLIENT_SECRET }),
    });
    _spToken = (await r.json()).access_token;
    if (!_spToken) throw new Error('SendPulse: falha na autenticação');
    return `Bearer ${_spToken}`;
}
async function spGet(path: string): Promise<any> {
    const res = await fetch(`https://api.sendpulse.com${path}`, { headers: { Authorization: await spAuthHeader() } });
    if (!res.ok) throw new Error(`SendPulse GET ${path} -> HTTP ${res.status}`);
    return res.json();
}

function spDateToISO(s: string): string {
    if (!s) return new Date().toISOString();
    const d = new Date(s.replace(' ', 'T') + SP_TZ_OFFSET);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
function subName(sub: any): string {
    const v = sub.variables ?? {};
    const cand = v.Nome ?? v.nome ?? v.name ?? v.Name
        ?? [v.first_name ?? v.FirstName, v.last_name ?? v.LastName].filter(Boolean).join(' ');
    const s = String(cand ?? '').trim();
    if (s) return s;
    const email = String(sub.email ?? '');
    return email ? email.split('@')[0] : 'Novo Lead (SendPulse)';
}
const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const normEmail = (v: unknown) => String(v ?? '').toLowerCase().trim();
const validPhone = (p: string) => p.length >= 8 && !/^0+$/.test(p);

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    const started = Date.now();
    try {
        const db = pg();
        const { data: forms } = await db.from('sendpulse_forms')
            .select('book_id, form_name, course_id, source_id, last_add_date').eq('ativo', true);
        if (!forms?.length) return j({ success: true, message: 'Nenhum formulário ativo.' });

        const { data: courses } = await db.from('courses').select('id, name, default_value');
        const courseVal = new Map<number, number>(), courseName = new Map<number, string>();
        for (const c of courses ?? []) { courseVal.set(c.id, Number(c.default_value) || 0); courseName.set(c.id, String(c.name || '')); }

        const backfillCutoff = new Date(Date.now() - BACKFILL_DAYS * 864e5).toISOString().slice(0, 19).replace('T', ' ');

        // 1. coleta candidatos
        type Cand = { form: any; sub: any; add: string };
        const candidates: Cand[] = [];
        const maxSeenByBook = new Map<number, string>();
        await Promise.all(forms.map(async (form) => {
            const watermark: string = form.last_add_date || backfillCutoff;
            let maxSeen = watermark;
            for (let offset = 0; offset < 2000; offset += 100) {
                let page: any[];
                try { page = await spGet(`/addressbooks/${form.book_id}/emails?limit=100&offset=${offset}`); }
                catch (e) { console.error(`book ${form.book_id}: ${(e as Error).message}`); break; }
                if (!Array.isArray(page) || !page.length) break;
                let stop = false;
                for (const sub of page) {
                    const add = String(sub.add_date || '');
                    if (add && add <= watermark) { stop = true; break; }
                    if (add && add > maxSeen) maxSeen = add;
                    candidates.push({ form, sub, add });
                }
                if (stop || page.length < 100) break;
            }
            maxSeenByBook.set(Number(form.book_id), maxSeen);
        }));

        // 2. dedup contra Postgres (email/telefone indexados)
        const emails = [...new Set(candidates.map(c => normEmail(c.sub.email)).filter(Boolean))];
        const phones = [...new Set(candidates.map(c => onlyDigits(c.sub.phone)).filter(validPhone))];
        const byEmail = new Map<string, { id: number; email: string | null; curso: number | null; cc: number }>();
        const byPhone = new Map<string, { id: number; email: string | null; curso: number | null; cc: number }>();
        for (let i = 0; i < emails.length; i += 300) {
            const { data } = await db.from('leads').select('id, email, telefone, curso_interesse, contact_count')
                .in('email', emails.slice(i, i + 300));
            for (const r of data ?? []) if (r.email) byEmail.set(String(r.email).toLowerCase(), { id: r.id, email: r.email, curso: r.curso_interesse, cc: r.contact_count ?? 0 });
        }
        for (let i = 0; i < phones.length; i += 300) {
            const { data } = await db.from('leads').select('id, telefone, email, curso_interesse, contact_count')
                .in('telefone', phones.slice(i, i + 300));
            for (const r of data ?? []) byPhone.set(onlyDigits(r.telefone), { id: r.id, email: r.email, curso: r.curso_interesse, cc: r.contact_count ?? 0 });
        }

        // 3. processa (antigo -> novo)
        candidates.sort((a, b) => a.add.localeCompare(b.add));
        const createdByEmail = new Map<string, number>(), createdByPhone = new Map<string, number>();
        const summary: Record<string, number> = {};
        let totalNew = 0, reentradas = 0;
        const dataBR = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR'); };

        for (const { form, sub } of candidates) {
            const email = normEmail(sub.email), phone = onlyDigits(sub.phone);
            const courseId: number | null = form.course_id != null ? Number(form.course_id) : null;
            const cName = courseId != null ? (courseName.get(courseId) ?? '') : '';

            const hit = (email && byEmail.get(email)) || (validPhone(phone) && byPhone.get(phone))
                || (email && createdByEmail.has(email) && { id: createdByEmail.get(email)!, email, curso: courseId, cc: 1 })
                || (validPhone(phone) && createdByPhone.has(phone) && { id: createdByPhone.get(phone)!, email: null, curso: courseId, cc: 1 }) || null;

            if (hit) {
                const nota = `📋 Novo formulário: ${form.form_name}` + (cName ? ` — interesse em ${cName}` : '')
                    + ` (${dataBR(spDateToISO(String(sub.add_date || '')))})`;
                const noteAt = spDateToISO(String(sub.add_date || ''));
                const fillEmail = !hit.email && !!email;
                await db.from('leads').update({
                    contact_count: (hit.cc ?? 0) + 1,
                    updated_at: new Date().toISOString(),
                    ...(hit.curso == null && courseId != null ? { curso_interesse: courseId } : {}),
                    ...(fillEmail ? { email } : {}),
                }).eq('id', hit.id);
                await db.from('lead_notes').insert({ lead_id: hit.id, note: nota, created_at: noteAt });
                await mirror(
                    `UPDATE leads:⟨${hit.id}⟩ SET contact_count = (contact_count ?? 0) + 1, updated_at = time::now()` +
                    (hit.curso == null && courseId != null ? `, curso_interesse = courses:⟨${courseId}⟩` : '') +
                    (fillEmail ? `, email = ${sv(email)}` : '') + `;\n` +
                    `INSERT INTO lead_notes [{ lead_id: leads:⟨${hit.id}⟩, note: ${sv(nota)}, created_at: d${sv(noteAt)} }] RETURN NONE;`
                );
                reentradas++;
                continue;
            }

            const sourceId = form.source_id != null ? Number(form.source_id) : 1;
            const valor = courseId != null ? (courseVal.get(courseId) ?? 0) : 0;
            const v = sub.variables ?? {};
            const local = [v.autoCity, v.autoRegion].filter(Boolean).join(' / ');
            const obs = `SendPulse — formulário: ${form.form_name}` + (local ? `\nLocal: ${local}` : '');
            const dataEntrada = spDateToISO(String(sub.add_date || ''));
            const nowIso = new Date().toISOString();

            const newLead = {
                nome_completo: subName(sub), email: email || null, telefone: phone || '00000000000',
                stage_id: 1, source_id: sourceId, curso_interesse: courseId, valor_oportunidade: valor,
                fonte_lead: form.form_name, observacoes: obs, temperatura: 'frio', contact_count: 1,
                data_entrada: dataEntrada, stage_entry_date: nowIso,
            };
            const { data: created, error } = await db.from('leads').insert(newLead).select('id').single();
            if (error) { console.error('insert lead:', error.message); continue; }
            const leadId = created.id;
            if (email) createdByEmail.set(email, leadId);
            if (validPhone(phone)) createdByPhone.set(phone, leadId);

            await mirror(
                `UPDATE seq:leads SET val = math::max([val, ${leadId}]);\n` +
                `INSERT INTO leads [{ id:"${leadId}", nome_completo:${sv(newLead.nome_completo)}, email:${sv(newLead.email)}, ` +
                `telefone:${sv(newLead.telefone)}, stage_id:stages:⟨1⟩, source_id:lead_sources:⟨${sourceId}⟩, ` +
                `curso_interesse:${courseId != null ? `courses:⟨${courseId}⟩` : 'NONE'}, valor_oportunidade:${valor}, ` +
                `fonte_lead:${sv(form.form_name)}, observacoes:${sv(obs)}, temperatura:"frio", contact_count:1, ` +
                `data_entrada:d${sv(dataEntrada)}, stage_entry_date:d${sv(nowIso)} }] RETURN NONE;`
            );
            summary[form.form_name] = (summary[form.form_name] ?? 0) + 1;
            totalNew++;
        }

        // 4. watermark
        for (const form of forms) {
            const maxSeen = maxSeenByBook.get(Number(form.book_id));
            if (maxSeen && maxSeen !== form.last_add_date) {
                await db.from('sendpulse_forms').update({ last_add_date: maxSeen, updated_at: new Date().toISOString() })
                    .eq('book_id', form.book_id);
                await mirror(`UPDATE sendpulse_forms SET last_add_date = ${sv(maxSeen)}, updated_at = time::now() WHERE book_id = ${Number(form.book_id)};`);
            }
        }

        return j({ success: true, novos: totalNew, reentradas, porFormulario: summary, elapsedMs: Date.now() - started });
    } catch (error) {
        console.error('sync-sendpulse-forms:', error);
        return j({ error: (error as Error).message }, 500);
    }
});
