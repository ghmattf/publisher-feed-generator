// Entry for the browser bundle: exposes what the generator needs as window.PFGNostr.
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { BunkerSigner, parseBunkerInput, createNostrConnectURI } from 'nostr-tools/nip46';
import { SimplePool } from 'nostr-tools/pool';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import qrcode from 'qrcode-generator';

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
function sha256Hex(str) {
  return bytesToHex(sha256(new TextEncoder().encode(str)));
}

window.PFGNostr = {
  generateSecretKey, getPublicKey, nip19,
  BunkerSigner, parseBunkerInput, createNostrConnectURI, SimplePool,
  bytesToHex, hexToBytes, sha256Hex, qrSvg,
};
