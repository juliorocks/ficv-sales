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
const SP_TZ_OFFSET     = Deno.env.get('SENDPULSE_TZ_OFFSET') ?? '-03:00'; // tz da conta SendPulse

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

        const nowSp = new Date(Date.now() - 1000).toISOString().slice(0, 19).replace('T', ' ');
        const backfillCutoff = new Date(Date.now() - BACKFILL_DAYS * 864e5).toISOString().slice(0, 19).replace('T', ' ');

        const summary: Record<string, number> = {};
        let totalNew = 0;

        for (const form of forms) {
            const watermark: string = form.last_add_date || backfillCutoff;
            let maxSeen = watermark;

            // páginas de 100, mais novo primeiro; para quando passa do watermark
            const fresh: any[] = [];
            for (let offset = 0; offset < 1000; offset += 100) {
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
                    fresh.push(sub);
                }
                if (stop || page.length < 100) break;
            }

            if (!fresh.length) continue;

            // dedup: 1 query com IN dos emails candidatos (usa idx_leads_email)
            const emails = [...new Set(fresh.map((s) => String(s.email || '').toLowerCase().trim()).filter(Boolean))];
            const existing = new Set<string>();
            if (emails.length && dedupEnabled) {
                try {
                    const rows = await surrealSQL(token,
                        `SELECT VALUE string::lowercase(email) FROM leads WHERE email IN [${emails.map(toS).join(', ')}];`
                    ) as string[];
                    rows.forEach((e) => existing.add(String(e)));
                } catch (e) {
                    console.warn(`dedup falhou (${form.form_name}), seguindo sem: ${(e as Error).message}`);
                }
            }

            const courseId = form.course_id != null ? Number(form.course_id) : null;
            const sourceId = form.source_id != null ? Number(form.source_id) : 1;
            const valor = courseId != null ? (courseVal.get(courseId) ?? 0) : 0;

            // inserir do mais antigo pro mais novo
            let novos = 0;
            for (const sub of fresh.reverse()) {
                const email = String(sub.email || '').toLowerCase().trim();
                if (email && existing.has(email)) continue;
                if (email) existing.add(email);

                const phone = sub.phone ? String(sub.phone).replace(/\D/g, '') : '';
                const nome = subName(sub);
                const v = sub.variables ?? {};
                const local = [v.autoCity, v.autoRegion].filter(Boolean).join(' / ');
                const obs = `SendPulse — formulário: ${form.form_name}` + (local ? `\nLocal: ${local}` : '');

                const newId = await nextLeadId(token);
                // ids de referência neste banco são STRING (stages:`1`, courses:`14`…)
                await surrealSQL(token, `INSERT INTO leads [{
                    id: ${newId},
                    nome_completo: ${toS(nome)},
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
                novos++;
            }

            if (maxSeen !== watermark || !form.last_add_date) {
                await surrealSQL(token,
                    `UPDATE sendpulse_forms SET last_add_date = ${toS(maxSeen)}, updated_at = time::now() WHERE book_id = ${Number(form.book_id)};`
                );
            }
            if (novos) { summary[form.form_name] = novos; totalNew += novos; }
        }

        return new Response(JSON.stringify({
            success: true,
            novos: totalNew,
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
