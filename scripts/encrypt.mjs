// dist/report.json → dist/data.enc.json (AES-GCM 256, PBKDF2-SHA256 키 유도). 웹앱이 비밀번호로 푼다.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const pass = process.env.APP_PASSPHRASE;
if (!pass || pass.length < 6) { console.error('APP_PASSPHRASE(6자 이상) 필요'); process.exit(1); }
const ITER = 210000;
const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const plain = readFileSync('dist/report.json');
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
const b64 = u => Buffer.from(u).toString('base64');
writeFileSync('dist/site/data.enc.json', JSON.stringify({ v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
unlinkSync('dist/report.json'); // 평문은 배포하지 않는다
console.log(`암호화 완료: ${(ct.length / 1024).toFixed(0)}KB`);
