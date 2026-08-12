import { serve } from "https://deno.land/std@0.177.1/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── SurrealDB ────────────────────────────────────────────────────────────────
const SURREAL_ENDPOINT = Deno.env.get('SURREAL_ENDPOINT')
    ?? 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const SURREAL_NS = 'ficv';
const SURREAL_DB = 'salespulse';

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
    const entry = Array.isArray(json) ? json[0] : json;
    if (entry?.status === 'ERR') throw new Error(entry.result);
    return Array.isArray(entry?.result) ? entry.result : [];
}

function toS(v: unknown): string {
    if (v === null || v === undefined) return 'NONE';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    return JSON.stringify(v);
}

function parseId(v: unknown): number | string | null {
    if (v === null || v === undefined) return null;
    const s = String(v);
    const m = s.match(/^[a-z_]+:⟨(.+)⟩$/) ?? s.match(/^[a-z_]+:`(.+)`$/);
    if (m) {
        const inner = m[1];
        const asNum = Number(inner);
        return Number.isFinite(asNum) && String(asNum) === inner ? asNum : inner;
    }
    if (typeof v === 'number') return v;
    return s;
}

function ref(table: string, id: unknown): string {
    return `${table}:⟨${id}⟩`;
}

async function nextLeadId(token: string): Promise<number> {
    const rows = await surrealSQL(token, 'UPDATE ONLY seq:leads SET val += 1 RETURN val;');
    return (rows[0] as any)?.val ?? 0;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const url = new URL(req.url);
        let payload: any;
        const bodyText = await req.text();
        try {
            payload = bodyText ? JSON.parse(bodyText) : {};
        } catch {
            payload = { rawBody: bodyText };
        }

        console.log("Payload recebido do SendPulse:", JSON.stringify(payload, null, 2));

        const token = await getSurrealToken();
        const contact = Array.isArray(payload) ? payload[0] : payload;

        let emailStr = "";
        let phoneStr = "";
        let nameStr = "Novo Contato (SendPulse)";

        if (contact?.email) emailStr = String(contact.email);
        else if (contact?.emails?.length) emailStr = String(contact.emails[0]?.email);
        else emailStr = "sem_email@sendpulse.com";

        if (contact?.phone) phoneStr = String(contact.phone);
        else if (contact?.phones?.length) phoneStr = String(contact.phones[0]?.phone);

        if (contact?.name || contact?.first_name) {
            nameStr = String(contact.name || contact.first_name);
            if (contact.last_name) nameStr += " " + String(contact.last_name);
        } else if (contact?.title) {
            nameStr = "Contato: " + String(contact.title);
        }

        const origin = String(
            contact?.form_name || contact?.book_name || contact?.list_name || contact?.source ||
            url.searchParams.get('form') || "Integração SendPulse"
        );
        const observations = `Origem SendPulse: ${origin}\n\n=== Status Payload ===\n${JSON.stringify(contact, null, 2)}`;

        // Find first stage
        const stageRows = await surrealSQL(token, `SELECT id FROM stages ORDER BY order ASC LIMIT 1;`);
        const firstStageId = stageRows[0] ? parseId((stageRows[0] as any).id) : 1;

        // Find "Site" source
        const srcRows = await surrealSQL(token, `SELECT id FROM lead_sources WHERE string::contains(string::lowercase(name), "site") LIMIT 1;`);
        const sourceId = srcRows[0] ? parseId((srcRows[0] as any).id) : 1;

        // Find matching course by form name
        let courseId: number | string | null = null;
        let courseDefaultVal = 0;
        const courseRows = await surrealSQL(token, `SELECT id, name, default_value FROM courses;`) as any[];
        if (courseRows.length) {
            const formNameUpper = origin.toUpperCase();
            const matchedCourse = courseRows.find((c: any) => formNameUpper.includes(String(c.name).toUpperCase()));
            if (matchedCourse) {
                courseId = parseId(matchedCourse.id);
                courseDefaultVal = matchedCourse.default_value || 0;
            }
        }

        const newId = await nextLeadId(token);
        const inserted = await surrealSQL(token, `INSERT INTO leads [{
            id: ${newId},
            nome_completo: ${toS(nameStr)},
            email: ${toS(emailStr)},
            telefone: ${toS(phoneStr || "00000000000")},
            stage_id: ${ref('stages', firstStageId)},
            source_id: ${ref('lead_sources', sourceId)},
            fonte_lead: "Site",
            observacoes: ${toS(observations)},
            valor_oportunidade: ${courseDefaultVal},
            data_entrada: ${toS(new Date().toISOString())},
            curso_interesse: ${courseId ? ref('courses', courseId) : 'NONE'},
            temperatura: "frio"
        }] RETURN *;`);

        const newLead = inserted[0] ?? null;
        console.log("Lead criado com sucesso:", newLead);

        return new Response(JSON.stringify({ success: true, lead: newLead }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error: any) {
        console.error("Error processing Sendpulse webhook:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }
});
