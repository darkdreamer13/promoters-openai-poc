import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const required = ['public/index.html','public/promoters-logo.svg','api/health.mjs','api/session.mjs','lib/assistant-instructions.mjs','vercel.json'];
for (const file of required) await access(new URL(`../${file}`, import.meta.url), constants.R_OK);
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
if (!html.includes('<html lang="el">') || !html.includes('gpt-realtime-2.1') || !html.includes('POC_ACCESS_CODE')) throw new Error('Η σελίδα δεν περιλαμβάνει τα αναμενόμενα στοιχεία της δοκιμής.');
if (!html.includes('id="modelSelect"') || !html.includes('gpt-live-1') || !html.includes('liveVoiceUsage')) throw new Error('Δεν βρέθηκε η επιλογή και η μέτρηση GPT-Live.');
const session = await readFile(new URL('../api/session.mjs', import.meta.url), 'utf8');
if (!session.includes("'gpt-live-1'") || !session.includes('/v1/live/sessions') || !session.includes("request.headers['x-poc-model']")) throw new Error('Το API δεν εφαρμόζει την εγκεκριμένη λειτουργία GPT-Live.');
const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
if (config.outputDirectory !== 'public') throw new Error('Μη αναμενόμενος φάκελος εξόδου Vercel.');
console.log(`Build checks passed: ${required.length} required files, Greek UI, Realtime/GPT-Live selector and session routes, Vercel output directory.`);
