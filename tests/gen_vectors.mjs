import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
import fs from 'fs';
const out = { events: [], npubs: [] };
const contents = ['', 'hello', 'ünïcödé ✓ 日本語 🎵', 'quote " backslash \\ slash / tab \t nl \n cr \r', 'ctrl \u0001\u001f del \u007f ls   ps  ', '<script>&amp;</script>'];
for (let i = 0; i < 24; i++) {
  const sk = generateSecretKey(); const pk = getPublicKey(sk);
  out.npubs.push({ hex: pk, npub: nip19.npubEncode(pk) });
  const ev = finalizeEvent({
    kind: i % 3 === 0 ? 27235 : 1,
    created_at: 1700000000 + i * 977,
    tags: i % 2 ? [['u', 'https://example.com/wp-json/mspf/v1/auth/login?x=1&y=é'], ['method', 'POST'], ['nonce', 'ab'.repeat(16)]] : [],
    content: contents[i % contents.length],
  }, sk);
  out.events.push({ event: ev, valid: true });
  const t = JSON.parse(JSON.stringify(ev)); t.content += 'x'; out.events.push({ event: t, valid: false, why: 'tampered content' });
  const t2 = JSON.parse(JSON.stringify(ev)); t2.sig = t2.sig.slice(0, 127) + (t2.sig.endsWith('0') ? '1' : '0'); out.events.push({ event: t2, valid: false, why: 'sig bit flip' });
  const t3 = JSON.parse(JSON.stringify(ev)); t3.pubkey = out.npubs[Math.max(0,i-1)].hex === pk ? pk.replace(/.$/, 'f') : out.npubs[Math.max(0,i-1)].hex; out.events.push({ event: t3, valid: false, why: 'pubkey swapped' });
}
// official BIP-340 vector 0 (signature check only)
out.bip340 = [{ pk: 'F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9'.toLowerCase(), msg: '00'.repeat(32), sig: 'E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0'.toLowerCase(), ok: true }];
fs.writeFileSync('vectors.json', JSON.stringify(out));
console.log('events', out.events.length, 'npubs', out.npubs.length);
