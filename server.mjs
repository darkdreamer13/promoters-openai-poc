import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { assistantInstructions } from './lib/assistant-instructions.mjs';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.PORT || 3333);
const maxSdpBytes = 128_000;
function send(res, status, body, type='application/json; charset=utf-8') {
  res.writeHead(status, {'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(typeof body==='string'?body:JSON.stringify(body));
}
function sameSecret(candidate, expected) {
  if(typeof candidate!=='string'||!expected)return false;
  const a=Buffer.from(candidate),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
function isAllowedOrigin(originValue, requestHost) {
  let origin;
  try { origin = new URL(originValue || ''); } catch { return false; }
  if (process.env.NODE_ENV === 'production') {
    const allowedHosts = new Set([
      'promoters-openai-poc.vercel.app',
      process.env.VERCEL_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
      process.env.VERCEL_BRANCH_URL
    ].filter(Boolean).map(value => value.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase()));
    return origin.protocol === 'https:' && origin.port === '' && allowedHosts.has(origin.hostname.toLowerCase());
  }
  const originHost = origin.hostname.toLowerCase();
  const requestHostname = String(requestHost || '').split(':')[0].toLowerCase();
  return originHost === requestHostname ||
    (['localhost', '127.0.0.1'].includes(originHost) && ['localhost', '127.0.0.1'].includes(requestHostname));
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://${host}:${port}`);
  if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,model:'gpt-realtime-2.1',apiKeyConfigured:Boolean(process.env.OPENAI_API_KEY),accessCodeConfigured:Boolean(process.env.POC_ACCESS_CODE)});
  if(req.method==='POST'&&url.pathname==='/api/session'){
    if(!isAllowedOrigin(req.headers.origin,req.headers.host))return send(res,403,{error:'Το αίτημα πρέπει να ξεκινήσει από τη σελίδα της δοκιμής.'});
    if(!sameSecret(req.headers['x-poc-access-code'],process.env.POC_ACCESS_CODE))return send(res,401,{error:'Ο κωδικός δοκιμής δεν είναι σωστός.'});
    if(!process.env.OPENAI_API_KEY)return send(res,503,{error:'Το OPENAI_API_KEY δεν έχει ρυθμιστεί.'});
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/sdp'))return send(res,415,{error:'Αναμενόταν SDP προσφορά WebRTC.'});
    try{
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>maxSdpBytes)return send(res,413,{error:'Το αίτημα είναι μεγαλύτερο από το επιτρεπόμενο όριο.'});chunks.push(chunk);}
      const form=new FormData();form.set('sdp',Buffer.concat(chunks).toString('utf8'));
      form.set('session',JSON.stringify({type:'realtime',model:'gpt-realtime-2.1',instructions:assistantInstructions,output_modalities:['audio'],audio:{input:{turn_detection:{type:'server_vad',create_response:true,interrupt_response:true},transcription:{model:'gpt-4o-mini-transcribe'}},output:{voice:'marin'}}}));
      const upstream=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:form,signal:AbortSignal.timeout(45_000)});
      const answer=await upstream.text();
      if(!upstream.ok){let message='Το OpenAI API δεν δημιούργησε συνεδρία.';try{message=JSON.parse(answer).error?.message||message}catch{}return send(res,upstream.status,{error:message});}
      return send(res,200,answer,'application/sdp; charset=utf-8');
    }catch(error){return send(res,502,{error:error.name==='TimeoutError'?'Έληξε το χρονικό όριο σύνδεσης.':'Αποτυχία δημιουργίας συνεδρίας. Έλεγξε τη σύνδεση και ξαναδοκίμασε.'});}
  }
  if(req.method==='POST'&&url.pathname==='/api/live-session'){
    if(!isAllowedOrigin(req.headers.origin,req.headers.host))return send(res,403,{error:'Το αίτημα πρέπει να ξεκινήσει από τη σελίδα της δοκιμής.'});
    if(!sameSecret(req.headers['x-poc-access-code'],process.env.POC_ACCESS_CODE))return send(res,401,{error:'Ο κωδικός δοκιμής δεν είναι σωστός.'});
    if(!process.env.OPENAI_API_KEY)return send(res,503,{error:'Το OPENAI_API_KEY δεν έχει ρυθμιστεί.'});
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/sdp'))return send(res,415,{error:'Αναμενόταν SDP προσφορά WebRTC.'});
    try{
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>maxSdpBytes)return send(res,413,{error:'Το αίτημα είναι μεγαλύτερο από το επιτρεπόμενο όριο.'});chunks.push(chunk);}
      const sdp=Buffer.concat(chunks).toString('utf8');
      const upstream=await fetch('https://api.openai.com/v1/live/sessions',{
        method:'POST',
        headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
        body:JSON.stringify({session:{model:'gpt-live-1',instructions:assistantInstructions,delegation:{type:'client'},audio:{output:{voice:'marin'}}},transport:{type:'webrtc',sdp}}),
        signal:AbortSignal.timeout(45_000)
      });
      const body=await upstream.text();
      if(!upstream.ok){let message='Το OpenAI GPT-Live API δεν δημιούργησε συνεδρία.';try{message=JSON.parse(body).error?.message||message}catch{}return send(res,upstream.status,{error:message});}
      let session;try{session=JSON.parse(body)}catch{return send(res,502,{error:'Το GPT-Live επέστρεψε μη αναμενόμενη απάντηση.'});}
      if(!session?.session?.id||!session?.transport?.sdp)return send(res,502,{error:'Η απάντηση του GPT-Live δεν περιείχε τα στοιχεία σύνδεσης WebRTC.'});
      return send(res,201,session);
    }catch(error){return send(res,502,{error:error.name==='TimeoutError'?'Έληξε το χρονικό όριο σύνδεσης GPT-Live.':'Αποτυχία δημιουργίας συνεδρίας GPT-Live. Έλεγξε τη σύνδεση και ξαναδοκίμασε.'});}
  }
  if(req.method==='GET'){
    const requested=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    const safePath=normalize(requested).replace(/^([/\\]|\.\.(?:[/\\]|$))+/, '');
    if(safePath.includes('..'))return send(res,403,'Forbidden','text/plain; charset=utf-8');
    try{const filePath=join(root,safePath);const data=await readFile(filePath);const types={'.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};res.writeHead(200,{'content-type':types[extname(filePath)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','permissions-policy':'microphone=(self)'});res.end(data)}catch{send(res,404,'Δεν βρέθηκε η σελίδα.','text/plain; charset=utf-8')}return;
  }
  return send(res,405,{error:'Method not allowed'});
});
server.listen(port,host,()=>console.log(`Promoters Realtime PoC: http://${host}:${port}`));
