// Dispara um workflow do GitHub Actions (workflow_dispatch).
// Usado pelas edge functions de "Sincronizar agora" — o trabalho real roda na
// Action (scripts/sync-*.mjs, que já fazem dual-write SurrealDB + Postgres).

const REPO = "juliorocks/ficv-sales";
const TOKEN = () => Deno.env.get("GITHUB_DISPATCH_TOKEN") ?? "";

export async function dispatchWorkflow(
    workflow: string,
    inputs: Record<string, string> = {},
    ref = "main",
): Promise<{ ok: boolean; status: number; error?: string }> {
    const token = TOKEN();
    if (!token) return { ok: false, status: 500, error: "GITHUB_DISPATCH_TOKEN não configurado" };
    const res = await fetch(
        `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
                "User-Agent": "ficv-sales-edge",
            },
            body: JSON.stringify({ ref, inputs }),
        },
    );
    if (res.status === 204) return { ok: true, status: 204 };
    return { ok: false, status: res.status, error: (await res.text()).slice(0, 300) };
}
