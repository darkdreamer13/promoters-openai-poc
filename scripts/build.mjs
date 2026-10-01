import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const required = ['public/index.html','public/promoters-logo.svg','api/health.mjs','api/session.mjs','lib/assistant-instructions.mjs','vercel.json'];
for (const file of required) await access(new URL(`../${file}`, import.meta.url), constants.R_OK);
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
if (!html.includes('<html lang="el">') || !html.includes('gpt-realtime-2.1') || !html.includes('POC_ACCESS_CODE')) throw new Error('Η σελίδα δεν περιλαμβάνει τα αναμενόμενα στοιχεία της δοκιμής.');
const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
if (config.outputDirectory !== 'public') throw new Error('Μη αναμενόμενος φάκελος εξόδου Vercel.');
console.log(`Build checks passed: ${required.length} required files, Greek UI, OpenAI Realtime config, Vercel output directory.`);
