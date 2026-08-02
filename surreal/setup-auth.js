#!/usr/bin/env node
// Etapa 2 — Auth migration setup
// 1. Re-seed profiles with emails + initial passwords
// 2. DEFINE ACCESS staff (profiles table, record auth)

const ENDPOINT = process.env.SURREAL_ENDPOINT
    || 'https://heroic-quelea-06frhjc9ott4l61s0fs8nn630s.aws-use2.surreal.cloud';
const NS = 'ficv';
const DB = 'salespulse';

// Profiles with emails pulled from Supabase auth.users
const PROFILES = [
    { id: 'e25edc59-af68-4334-beaf-57ae67d5287e', email: 'ojuliodomkt@gmail.com',          full_name: 'Julio',           role: 'admin' },
    { id: '3bd0374d-b2a2-4ea3-a5ff-22a0cb2a9920', email: 'marketing@ficv.edu.br',           full_name: 'Marketing',       role: 'admin' },
    { id: '5de41e1e-5ab4-4e5c-85a3-cf61c899e1bd', email: 'victor@cidadeviva.org',           full_name: 'Victor Grisi',    role: 'admin' },
    { id: 'd4018cc3-f789-4eb2-aac9-a5acab8fa245', email: 'relacionamento@ficv.edu.br',      full_name: 'Isabelly Souza',  role: 'agent' },
    { id: 'ca1df226-a453-4ea6-85a5-45b310e1324c', email: 'karina.pimentel@cidadeviva.org',  full_name: 'Karina Pimentel', role: 'agent' },
    { id: '767f8a41-c0f3-4247-9347-3204d651a303', email: 'thayanne.nobre@cidadeviva.org',   full_name: 'Thayanne Sales',  role: 'agent' },
    { id: 'f4a73ab3-c6b1-48d7-9e43-237d20bc90c4', email: '36284400845@aluno.ficv.br',       full_name: '',                role: 'agent' },
];

const INITIAL_PASSWORD = process.argv[2] || 'Ficv@2026!';

async function surrealSQL(token, sql) {
    const res = await fetch(`${ENDPOINT}/sql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'surreal-ns': NS,
            'surreal-db': DB,
        },
        body: sql,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const j = await res.json();
    const first = Array.isArray(j) ? j[0] : j;
    if (first?.status === 'ERR') throw new Error(`SurrealDB: ${first.result}`);
    return j;
}

async function getAdminToken() {
    const res = await fetch(`${ENDPOINT}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': NS },
        body: JSON.stringify({ ns: NS, user: 'ficv_admin', pass: 'Ficv@Surreal2026!' }),
    });
    if (!res.ok) throw new Error(`Signin failed: HTTP ${res.status}`);
    const body = await res.json();
    return body.token;
}

async function main() {
    const token = await getAdminToken();
    console.log('✓ Authenticated as ficv_admin\n');

    // 1. Define DEFINE ACCESS staff (profiles table)
    console.log('── Definindo DEFINE ACCESS staff...');
    await surrealSQL(token, 'REMOVE ACCESS IF EXISTS staff ON DATABASE;').catch(() => {});
    await surrealSQL(token, `
        DEFINE ACCESS staff ON DATABASE TYPE RECORD
            SIGNIN (
                SELECT * FROM profiles
                WHERE email = $email
                AND crypto::argon2::compare(password, $pass)
            )
            DURATION FOR SESSION 12h, FOR TOKEN 12h;
    `);
    console.log('   ✓ DEFINE ACCESS staff criado\n');

    // 3. Create profiles with email + hashed password
    console.log(`── Inserindo ${PROFILES.length} perfis com senha inicial "${INITIAL_PASSWORD}"...`);
    for (const p of PROFILES) {
        const e = p.email.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const n = p.full_name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const result = await surrealSQL(token, `
            CREATE profiles:\`${p.id}\` CONTENT {
                email:    "${e}",
                full_name: "${n}",
                role:     "${p.role}",
                password: crypto::argon2::generate("${INITIAL_PASSWORD}")
            };
        `);
        const ok = result[0]?.status === 'OK';
        console.log(`   ${ok ? '✓' : '✗'} ${p.email} [${p.role}]`);
    }

    // 4. Verify
    console.log('\n── Verificação final...');
    const result = await surrealSQL(token, `SELECT type::string(id) AS sid, full_name, email, role FROM profiles ORDER BY full_name;`);
    const profiles = result[0]?.result ?? [];
    console.log(`\n${profiles.length} perfis no SurrealDB:`);
    for (const p of profiles) {
        console.log(`  • ${p.email} | ${p.full_name} | ${p.role}`);
    }

    // 5. Test signin
    console.log('\n── Testando login com ojuliodomkt@gmail.com...');
    const signinRes = await fetch(`${ENDPOINT}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'surreal-ns': NS },
        body: JSON.stringify({ ns: NS, db: DB, ac: 'staff', email: 'ojuliodomkt@gmail.com', pass: INITIAL_PASSWORD }),
    });
    const signinBody = await signinRes.json();
    if (signinBody.token) {
        console.log('   ✓ Login OK — token recebido');
        // Decode JWT payload (middle segment)
        const payload = JSON.parse(Buffer.from(signinBody.token.split('.')[1], 'base64').toString());
        console.log(`   ID no JWT: ${payload.ID}`);
    } else {
        console.log('   ✗ Login falhou:', JSON.stringify(signinBody));
    }

    console.log(`\n✅ Setup concluído.`);
    console.log(`   Senha inicial: ${INITIAL_PASSWORD}`);
    console.log('   Após o deploy, todos os usuários farão login com esta senha.');
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
