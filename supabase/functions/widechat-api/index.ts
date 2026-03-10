import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Authenticate user calling the function
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            throw new Error('Nenhum token de autorização fornecido.');
        }

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // Get user from token
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
        if (userError || !user) {
            throw new Error('Usuário não autenticado.');
        }

        const { action, payload } = await req.json();

        // Fetch User Integration for Widechat
        const { data: integration, error: intError } = await supabaseClient
            .from('user_integrations')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (intError || !integration || !integration.widechat_email || !integration.widechat_password) {
            throw new Error('Credenciais do Widechat não configuradas para este usuário.');
        }

        let sessionToken = integration.widechat_session_token;
        const now = new Date();
        const expiresAt = integration.widechat_token_expires_at ? new Date(integration.widechat_token_expires_at) : null;

        // Check if token needs to be refreshed (assuming 24h expiration, we refresh if empty or expired)
        if (!sessionToken || !expiresAt || now > expiresAt) {
            console.log("Renovando token do Widechat para", integration.widechat_email);

            const loginRes = await fetch("https://igrejabatista.widechat.com.br/api/v4/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: integration.widechat_email,
                    password: integration.widechat_password
                })
            });

            if (!loginRes.ok) {
                const errData = await loginRes.text();
                throw new Error(`Falha ao logar no Widechat: ${errData}`);
            }

            const loginData = await loginRes.json();
            sessionToken = loginData.token;

            // Set expiration to 23 hours from now to be safe
            const newExpires = new Date();
            newExpires.setHours(newExpires.getHours() + 23);

            // Save new token to DB
            await supabaseClient.from('user_integrations').update({
                widechat_session_token: sessionToken,
                widechat_token_expires_at: newExpires.toISOString()
            }).eq('user_id', user.id);
        }

        // Action Router
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${sessionToken}`
        };

        if (action === "send_message") {
            // Sends a standard text or media message via the /message/send endpoint
            const sendRes = await fetch("https://igrejabatista.widechat.com.br/api/v4/message/send", {
                method: "POST",
                headers,
                body: JSON.stringify(payload)
            });

            const sendData = await sendRes.json();

            if (!sendRes.ok) {
                return new Response(JSON.stringify({ error: sendData }), {
                    status: sendRes.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            return new Response(JSON.stringify({ success: true, data: sendData }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }
        else if (action === "init_session") {
            const initRes = await fetch("https://igrejabatista.widechat.com.br/api/v4/session/init", {
                method: "POST",
                headers,
                body: JSON.stringify(payload)
            });

            const initData = await initRes.json();

            if (!initRes.ok) {
                return new Response(JSON.stringify({ error: initData }), {
                    status: initRes.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            return new Response(JSON.stringify({ success: true, data: initData }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }
        else {
            throw new Error(`Ação não suportada: ${action}`);
        }

    } catch (error: any) {
        console.error("Erro na função widechat-api:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        });
    }
});
