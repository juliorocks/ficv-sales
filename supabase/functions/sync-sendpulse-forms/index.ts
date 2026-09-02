import { serve } from "https://deno.land/std@0.177.1/http/server.ts";

// ============================================================================
// sync-sendpulse-forms
// Polling (pg_cron a cada ~3 min) dos formulários de inscrição do SendPulse.
// Só as addressbooks cadastradas em `sendpulse_forms` (allowlist) — nunca puxa
// "todas as addressbooks" como fazia o sync-sendpulse-api.
// Cada inscrito novo vira um lead no estágio inicial, já com curso e fonte.
// ============================================================================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SENDPULSE_API_KEY = Deno.env.get('SENDPULSE_API_KEY') ?? '';
// fallback OAuth (conta antiga) — só usado se a API key não estiver setada
const SP_CLIENT_ID     = Deno.env.get('SENDPULSE_CLIENT_ID') ?? '';
const SP_CLIENT_SECRET = Deno.env.get('SENDPULSE_CLIENT_SECRET') ?? '';
const BACKFILL_DAYS    = Number(Deno.env.get('SENDPULSE_BACKFILL_DAYS') ?? '14');
// A API do SendPulse devolve add_date em UTC (o time_zone da conta é só p/ o painel).
const SP_TZ_OFFSET     = Deno.env.get('SENDPULSE_TZ_OFFSET') ?? 'Z';

const SURREAL_ENDPOINT = Deno.env.get('SURREAL_ENDPOINT')
    ?? 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS = 'ficv';
const SURREAL_DB = 'salespulse';

// ── SendPulse ────────────────────────────────────────────────────────────────
let _spToken = '';
async function spAuthHeader(): Promise<string> {
    if (SENDPULSE_API_KEY) return `Bearer ${SENDPULSE_API_KEY}`;
    if (_spToken) return `Bearer ${_spToken}`;
    const r = await fetch('https://api.sendpulse.com/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: SP_CLIENT_ID, client_secret: SP_CLIENT_SECRET }),
    });
    _spToken = (await r.json()).access_token;
    if (!_spToken) throw new Error('SendPulse: falha na autenticação (sem API key nem OAuth válido)');
    return `Bearer ${_spToken}`;
}

async function spGet(path: string): Promise<any> {
    const res = await fetch(`https://api.sendpulse.com${path}`, {
        headers: { Authorization: await spAuthHeader() },
    });
    if (!res.ok) throw new Error(`SendPulse GET ${path} -> HTTP ${res.status}`);
    return res.json();
}

// ── SurrealDB ────────────────────────────────────────────────────────────────
async function getSurrealToken(): Promise<string> {
    const res = await fetch(`${SURREAL_ENDPOINT}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': SURREAL_NS },
        body: JSON.stringify({ ns: SURREAL_NS, user: 'ficv_admin', pass: 'Ficv@Surreal2026!' }),
    });
    if (!res.ok) throw new Error(`SurrealDB signin failed: ${res.status}`);
    const { token } = await res.json() as { token?: string };
    if (!token) throw new Error('SurrealDB: no token');
    return token;
}

async function surrealSQL(token: string, sql: string): Promise<unknown[]> {
    const res = await fetch(`${SURREAL_ENDPOINT}/sql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain', 'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'surreal-ns': SURREAL_NS, 'surreal-db': SURREAL_DB,
        },
        body: sql,
    });
    if (!res.ok) throw new Error(`SurrealDB HTTP ${res.status}`);
    const json = await res.json();
    const entry = Array.isArray(json) ? json[json.length - 1] : json;
    if (entry?.status === 'ERR') throw new Error(entry.result);
    return Array.isArray(entry?.result) ? entry.result : [];
}

function toS(v: unknown): string {
    if (v === null || v === undefined) return 'NONE';
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    return JSON.stringify(v);
}

// record id -> número/string simples (mesma lógica do front)
function stripId(v: unknown): number | string | null {
    if (v === null || v === undefined) return null;
    const s = String(v);
    const m = s.match(/^[a-z_]+:⟨(.+)⟩$/) ?? s.match(/^[a-z_]+:`(.+)`$/);
    const inner = m ? m[1] : s;
    const n = Number(inner);
    return Number.isFinite(n) && String(n) === inner ? n : inner;
}

async function nextLeadId(token: string): Promise<number> {
    // sem ONLY -> resultado é array [{val}]; com ONLY o parser devolve [] e o id sai 0
    const rows = await surrealSQL(token, 'UPDATE seq:leads SET val += 1 RETURN val;');
    const val = (rows[0] as any)?.val;
    if (!val) throw new Error('seq:leads não retornou val');
    return val;
}

// "2026-08-29 18:30:14" (tz da conta) -> ISO
function spDateToISO(s: string): string {
    if (!s) return new Date().toISOString();
    const iso = s.replace(' ', 'T') + SP_TZ_OFFSET;
    const d = new Date(iso);
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

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const started = Date.now();
    try {
        const token = await getSurrealToken();

        const forms = await surrealSQL(token,
            'SELECT id, book_id, form_name, course_id, source_id, last_add_date FROM sendpulse_forms WHERE ativo = true;'
        ) as any[];
        if (!forms.length) {
            return new Response(JSON.stringify({ success: true, message: 'Nenhum formulário ativo em sendpulse_forms.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // dedup por email só compensa se idx_leads_email já estiver pronto —
        // senão cada WHERE email = X vira full scan de ~800k linhas
        let dedupEnabled = false;
        try {
            const ix = await surrealSQL(token, 'INFO FOR INDEX idx_leads_email ON TABLE leads;') as any[];
            dedupEnabled = !((ix[0] as any)?.building);
        } catch { /* índice ainda não existe */ }

        // default_value por curso (courses tem ids inconsistentes — casa pelo número)
        const courseRows = await surrealSQL(token, 'SELECT id, default_value FROM courses;') as any[];
        const courseVal = new Map<number, number>();
        for (const c of courseRows) {
            const cid = stripId(c.id);
            if (typeof cid === 'number') courseVal.set(cid, Number(c.default_value) || 0);
        }

        const backfillCutoff = new Date(Date.now() - BACKFILL_DAYS * 864e5).toISOString().slice(0, 19).replace('T', ' ');

        const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
        const normEmail = (v: unknown) => String(v ?? '').toLowerCase().trim();

        // ── 1. coleta candidatos de TODOS os forms ──────────────────────────────
        type Cand = { form: any; sub: any; add: string };
        const candidates: Cand[] = [];
        const maxSeenByBook = new Map<number, string>();

        for (const form of forms) {
            const watermark: string = form.last_add_date || backfillCutoff;
            let maxSeen = watermark;
            for (let offset = 0; offset < 2000; offset += 100) {
                let page: any[];
                try {
                    page = await spGet(`/addressbooks/${form.book_id}/emails?limit=100&offset=${offset}`);
                } catch (e) {
                    console.error(`book ${form.book_id} (${form.form_name}): ${(e as Error).message}`);
                    break;
                }
                if (!Array.isArray(page) || page.length === 0) break;
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
        }

        // ── 2. dedup contra o banco. Match REAL (atribuído / widechat / de um
        //    formulário) -> pula. Match só com LIXO (dump antigo do sync-sendpulse-api,
        //    ninguém trabalhando) -> apaga o lixo e cria o lead certo (limpeza gradual).
        const formNameSet = new Set<string>(forms.map((f: any) => String(f.form_name)));
        const REAL_FONTES = new Set(['Widechat', 'Wide Chat', 'Brevo Form']);
        const isReal = (r: any) =>
            r.assigned_to_id != null || r.widechat_contact_id != null
            || formNameSet.has(String(r.fonte_lead)) || REAL_FONTES.has(String(r.fonte_lead));

        const emails = [...new Set(candidates.map((c) => normEmail(c.sub.email)).filter(Boolean))];
        const phones = [...new Set(candidates.map((c) => onlyDigits(c.sub.phone)).filter((p) => p.length >= 8))];
        const realEmail = new Set<string>();
        const realPhone = new Set<string>();
        const junkByEmail = new Map<string, string[]>();
        const junkByPhone = new Map<string, string[]>();
        const FIELDS = 'id, string::lowercase(email ?? "") AS email, telefone, assigned_to_id, widechat_contact_id, fonte_lead';
        if (dedupEnabled) {
            try {
                for (let i = 0; i < emails.length; i += 200) {
                    const rows = await surrealSQL(token,
                        `SELECT ${FIELDS} FROM leads WHERE email IN [${emails.slice(i, i + 200).map(toS).join(', ')}];`) as any[];
                    for (const r of rows) {
                        const e = String(r.email || '');
                        if (isReal(r)) realEmail.add(e);
                        else (junkByEmail.get(e) ?? junkByEmail.set(e, []).get(e)!).push(String(r.id));
                    }
                }
                for (let i = 0; i < phones.length; i += 200) {
                    const rows = await surrealSQL(token,
                        `SELECT ${FIELDS} FROM leads WHERE telefone IN [${phones.slice(i, i + 200).map(toS).join(', ')}];`) as any[];
                    for (const r of rows) {
                        const p = onlyDigits(r.telefone);
                        if (isReal(r)) realPhone.add(p);
                        else (junkByPhone.get(p) ?? junkByPhone.set(p, []).get(p)!).push(String(r.id));
                    }
                }
            } catch (e) {
                console.warn(`dedup parcial: ${(e as Error).message}`);
            }
        }

        // ── 3. insere (mais antigo -> mais novo) ───────────────────────────────
        candidates.sort((a, b) => a.add.localeCompare(b.add));
        const seenEmail = new Set<string>();
        const seenPhone = new Set<string>();
        const summary: Record<string, number> = {};
        let totalNew = 0;
        let junkRemoved = 0;

        for (const { form, sub } of candidates) {
            const email = normEmail(sub.email);
            const phone = onlyDigits(sub.phone);
            // já é um lead real, ou já inserido nesta rodada -> pula
            if (email && (realEmail.has(email) || seenEmail.has(email))) continue;
            if (phone.length >= 8 && (realPhone.has(phone) || seenPhone.has(phone))) continue;
            if (email) seenEmail.add(email);
            if (phone.length >= 8) seenPhone.add(phone);

            // só bateu com lixo -> apaga o lixo antes de criar o certo
            const junk = [...(junkByEmail.get(email) ?? []), ...(phone.length >= 8 ? junkByPhone.get(phone) ?? [] : [])];
            if (junk.length && junkRemoved < 1000) {
                const uniq = [...new Set(junk)]; // ids já vêm no formato leads:`x`
                for (let i = 0; i < uniq.length; i += 100) {
                    try { await surrealSQL(token, `DELETE ${uniq.slice(i, i + 100).join(', ')} RETURN NONE;`); } catch { /* segue */ }
                }
                junkRemoved += uniq.length;
            }

            const courseId = form.course_id != null ? Number(form.course_id) : null;
            const sourceId = form.source_id != null ? Number(form.source_id) : 1;
            const valor = courseId != null ? (courseVal.get(courseId) ?? 0) : 0;
            const v = sub.variables ?? {};
            const local = [v.autoCity, v.autoRegion].filter(Boolean).join(' / ');
            const obs = `SendPulse — formulário: ${form.form_name}` + (local ? `\nLocal: ${local}` : '');

            const newId = await nextLeadId(token);
            // id STRING (leads:`123`) — id inteiro cru vira record id numérico que
            // o update direto tbl:⟨id⟩ não alcança.
            await surrealSQL(token, `INSERT INTO leads [{
                id: "${newId}",
                nome_completo: ${toS(subName(sub))},
                email: ${toS(email || null)},
                telefone: ${toS(phone || '00000000000')},
                stage_id: stages:\`1\`,
                source_id: lead_sources:\`${sourceId}\`,
                curso_interesse: ${courseId != null ? `courses:\`${courseId}\`` : 'NONE'},
                valor_oportunidade: ${valor},
                fonte_lead: ${toS(form.form_name)},
                observacoes: ${toS(obs)},
                temperatura: "frio",
                contact_count: 1,
                data_entrada: d${toS(spDateToISO(String(sub.add_date || '')))},
                stage_entry_date: d${toS(new Date().toISOString())}
            }] RETURN NONE;`);
            summary[form.form_name] = (summary[form.form_name] ?? 0) + 1;
            totalNew++;
        }

        // ── 4. watermark por form (mesmo com novos=0, p/ não re-varrer o backfill) ─
        for (const form of forms) {
            const maxSeen = maxSeenByBook.get(Number(form.book_id));
            if (maxSeen && (maxSeen !== form.last_add_date || !form.last_add_date)) {
                await surrealSQL(token,
                    `UPDATE sendpulse_forms SET last_add_date = ${toS(maxSeen)}, updated_at = time::now() WHERE book_id = ${Number(form.book_id)};`);
            }
        }

        return new Response(JSON.stringify({
            success: true,
            novos: totalNew,
            lixoRemovido: junkRemoved,
            porFormulario: summary,
            elapsedMs: Date.now() - started,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (error: any) {
        console.error('sync-sendpulse-forms:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
