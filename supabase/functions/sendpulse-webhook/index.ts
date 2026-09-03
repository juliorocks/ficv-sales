import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { pg, mirror, sv } from "../_shared/db.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status });

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const url = new URL(req.url);
        const bodyText = await req.text();
        let payload: any;
        try { payload = bodyText ? JSON.parse(bodyText) : {}; } catch { payload = { rawBody: bodyText }; }
        console.log("SendPulse payload:", JSON.stringify(payload).slice(0, 2000));

        const db = pg();
        const contact = Array.isArray(payload) ? payload[0] : payload;

        let email = "sem_email@sendpulse.com";
        if (contact?.email) email = String(contact.email);
        else if (contact?.emails?.length) email = String(contact.emails[0]?.email);

        let phone = "";
        if (contact?.phone) phone = String(contact.phone);
        else if (contact?.phones?.length) phone = String(contact.phones[0]?.phone);

        let name = "Novo Contato (SendPulse)";
        if (contact?.name || contact?.first_name) {
            name = String(contact.name || contact.first_name);
            if (contact.last_name) name += " " + String(contact.last_name);
        } else if (contact?.title) name = "Contato: " + String(contact.title);

        const origin = String(
            contact?.form_name || contact?.book_name || contact?.list_name || contact?.source ||
            url.searchParams.get('form') || "Integração SendPulse"
        );
        const observations = `Origem SendPulse: ${origin}\n\n=== Status Payload ===\n${JSON.stringify(contact, null, 2)}`;

        const [{ data: stage }, { data: src }, { data: courses }] = await Promise.all([
            db.from('stages').select('id').order('order', { ascending: true }).limit(1).maybeSingle(),
            db.from('lead_sources').select('id').ilike('name', '%site%').limit(1).maybeSingle(),
            db.from('courses').select('id, name, default_value'),
        ]);
        const firstStageId = stage?.id ?? 1;
        const sourceId = src?.id ?? 1;

        let courseId: number | null = null, courseDefaultVal = 0;
        const up = origin.toUpperCase();
        const matched = (courses ?? []).find((c: any) => up.includes(String(c.name).toUpperCase()));
        if (matched) { courseId = matched.id; courseDefaultVal = matched.default_value || 0; }

        const now = new Date().toISOString();
        const newLead = {
            nome_completo: name, email, telefone: phone || "00000000000",
            stage_id: firstStageId, source_id: sourceId, fonte_lead: "Site",
            observacoes: observations, valor_oportunidade: courseDefaultVal,
            data_entrada: now, curso_interesse: courseId, temperatura: "frio",
        };
        const { data: created, error } = await db.from('leads').insert(newLead).select('id').single();
        if (error) throw error;
        const leadId = created.id;

        await mirror(
            `UPDATE seq:leads SET val = math::max([val, ${leadId}]);\n` +
            `INSERT INTO leads [{ id:"${leadId}", nome_completo:${sv(name)}, email:${sv(email)}, telefone:${sv(phone || "00000000000")}, ` +
            `stage_id:stages:⟨${firstStageId}⟩, source_id:lead_sources:⟨${sourceId}⟩, fonte_lead:"Site", ` +
            `observacoes:${sv(observations)}, valor_oportunidade:${courseDefaultVal}, data_entrada:d${sv(now)}, ` +
            `curso_interesse:${courseId ? `courses:⟨${courseId}⟩` : 'NONE'}, temperatura:"frio" }] RETURN NONE;`
        );

        console.log("Lead criado:", leadId);
        return j({ success: true, lead: { id: leadId, email } });
    } catch (error) {
        console.error("Erro SendPulse webhook:", error);
        return j({ error: (error as Error).message }, 200);
    }
});
