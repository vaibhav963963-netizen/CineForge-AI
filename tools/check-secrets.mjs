#!/usr/bin/env node
// Refuse to commit secrets. Checks what is STAGED (git diff --cached):
//   · forbidden files: .env / .env.* (except .env.example), youtube/client_secret*.json, tokens / *.dpapi, keys, credentials
//   · forbidden content in any staged text file: Google access/refresh tokens, OAuth client secrets, private keys,
//     cloud access keys, "client_secret"/"refresh_token" values
//   node tools/check-secrets.mjs            exit 0 = clean, 1 = blocked (prints what and why; never prints the secret)
//   node tools/check-secrets.mjs --all      scan every tracked file instead of the staged ones
// Install as a pre-commit hook (optional):  git config core.hooksPath tools/git-hooks
import { execFileSync } from 'node:child_process';

const FILES = [
  [/(^|\/)\.env$/, 'local .env file'],
  [/(^|\/)\.env\.(?!example$)[^/]+$/, '.env.* file (only .env.example may be committed)'],
  [/(^|\/)client_secret[^/]*\.json$/i, 'OAuth client secret'],
  [/(^|\/)(tokens?|credentials?)(\.[^/]*)?\.(json|dpapi|txt)$/i, 'token / credentials file'],
  [/\.dpapi$/i, 'DPAPI-encrypted secret'],
  [/\.(pem|key|pfx|p12)$/i, 'private key / certificate'],
  [/(^|\/)(secrets?|credentials)\//i, 'secrets folder'],
];
const CONTENT = [
  [/ya29\.[\w-]{20,}/, 'Google access token'],
  [/\b1\/\/0[\w-]{30,}/, 'Google refresh token'],
  [/GOCSPX-[\w-]{20,}/, 'Google OAuth client secret'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/"(client_secret|refresh_token)"\s*:\s*"[^"]{8,}"/, 'client_secret / refresh_token value'],
];

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64e6, stdio: ['ignore', 'pipe', 'ignore'] });
const all = process.argv.includes('--all');
const files = (all ? git('ls-files') : git('diff', '--cached', '--name-only', '--diff-filter=ACMR')).split('\n').filter(Boolean);
const problems = [];
for (const f of files) {
  const p = f.replace(/\\/g, '/');
  const hit = FILES.find(([re]) => re.test(p));
  if (hit) { problems.push(`${f}: ${hit[1]} must not be committed`); continue; }
  let text = '';
  try { text = all ? git('show', `HEAD:${f}`) : git('show', `:${f}`); } catch { continue; }
  if (text.includes('\u0000') || text.length > 5e6) continue;   // binary / very large
  for (const [re, what] of CONTENT) if (re.test(text)) problems.push(`${f}: contains a ${what}`);
}
if (problems.length) {
  console.error(`\nSecret check FAILED — ${problems.length} problem(s):\n${problems.map((x) => `  · ${x}`).join('\n')}\n\nUnstage with: git restore --staged <file>   (and keep it in .gitignore)\n`);
  process.exit(1);
}
console.log(`Secret check passed (${files.length} ${all ? 'tracked' : 'staged'} file${files.length === 1 ? '' : 's'} scanned).`);
