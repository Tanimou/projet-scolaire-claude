// One-off: align portal client redirect/web-origin URLs on the RUNNING Keycloak
// from the host-dev port (3100) to the containerised web port (3000).
// Run inside a container on the pilotage network: node kc-fix-redirects.mjs
const KC = process.env.KEYCLOAK_URL || 'http://keycloak:8080';
const REALM = process.env.KEYCLOAK_REALM || 'pilotage-scolaire';
const ADMIN = process.env.KEYCLOAK_ADMIN || 'admin';
const PASS = process.env.KEYCLOAK_ADMIN_PASS || 'admin';

const rep = (s) => (typeof s === 'string' ? s.split('3100').join('3000') : s);

const tokRes = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: ADMIN, password: PASS }),
});
const tok = await tokRes.json();
if (!tok.access_token) { console.error('No admin token:', tok); process.exit(1); }
const H = { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' };

for (const cid of ['portal-admin', 'portal-teacher', 'portal-parent']) {
  const list = await fetch(`${KC}/admin/realms/${REALM}/clients?clientId=${cid}`, { headers: H }).then((r) => r.json());
  const c = list[0];
  if (!c) { console.error('client not found:', cid); continue; }
  c.rootUrl = rep(c.rootUrl);
  c.redirectUris = (c.redirectUris || []).map(rep);
  c.webOrigins = (c.webOrigins || []).map(rep);
  if (c.attributes?.['post.logout.redirect.uris'])
    c.attributes['post.logout.redirect.uris'] = rep(c.attributes['post.logout.redirect.uris']);
  const put = await fetch(`${KC}/admin/realms/${REALM}/clients/${c.id}`, { method: 'PUT', headers: H, body: JSON.stringify(c) });
  console.log(`${cid}: HTTP ${put.status} → redirectUris=${JSON.stringify(c.redirectUris)}`);
}
console.log('done');
