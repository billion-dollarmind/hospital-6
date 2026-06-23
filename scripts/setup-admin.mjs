/**
 * One-time admin setup — creates or resets admin users in Supabase.
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env (Dashboard → Settings → API → secret key).
 *
 * Usage: npm run setup:admin
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv() {
    const env = {};
    try {
        const text = readFileSync(resolve(root, '.env'), 'utf8');
        for (const line of text.split('\n')) {
            const t = line.trim();
            if (!t || t.startsWith('#')) continue;
            const i = t.indexOf('=');
            if (i === -1) continue;
            env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
        }
    } catch {
        console.error('Missing .env file in project root.');
        process.exit(1);
    }
    return env;
}

const env = loadEnv();
const url = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const password = env.ADMIN_PASSWORD;
const emails = (env.ADMIN_EMAILS || env.ADMIN_EMAIL || 'caleborenge08@gmail.com')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

if (!url || url.includes('YOUR_PROJECT')) {
    console.error('Set SUPABASE_URL in .env');
    process.exit(1);
}
if (!serviceKey || serviceKey.includes('YOUR_')) {
    console.error('Set SUPABASE_SERVICE_ROLE_KEY in .env');
    console.error('Get it from: Supabase Dashboard → Project Settings → API → secret (sb_secret_...)');
    process.exit(1);
}
if (!password || password.length < 6) {
    console.error('Set ADMIN_PASSWORD in .env (min 6 characters)');
    process.exit(1);
}

const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const { data: list, error: listErr } = await admin.auth.admin.listUsers();
if (listErr) {
    console.error('Could not list users:', listErr.message);
    process.exit(1);
}

for (const email of emails) {
    const existing = list.users.find(u => u.email?.toLowerCase() === email);

    if (existing) {
        const { error } = await admin.auth.admin.updateUserById(existing.id, {
            password,
            email_confirm: true
        });
        if (error) {
            console.error(`Could not update ${email}:`, error.message);
            continue;
        }
        await admin.from('profiles').upsert({
            id: existing.id,
            email,
            status: 'approved',
            role: 'admin',
            approved_at: new Date().toISOString()
        }, { onConflict: 'id' });
        console.log('Updated admin:', email);
    } else {
        const { data, error } = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true
        });
        if (error) {
            console.error(`Could not create ${email}:`, error.message);
            continue;
        }
        await admin.from('profiles').upsert({
            id: data.user.id,
            email,
            status: 'approved',
            role: 'admin',
            approved_at: new Date().toISOString()
        }, { onConflict: 'id' });
        console.log('Created admin:', email);
    }
}

console.log('Done. Sign in with any admin email and ADMIN_PASSWORD from .env');
