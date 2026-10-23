// Private, per-launch desktop bridge. Discord credentials stay in memory and
// worker stdin; this service has no arbitrary command, URL or filesystem API.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {diagnostics} from './desktop-worker.mjs';
import {CATEGORIES,ROLES} from './design.mjs';
import {P,bits} from './permissions.mjs';
import {CONFIRMATION} from './safety.mjs';
import {plan,renderPreview} from './plan.mjs';
import {prepareEdit,editSummary} from './editor.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const ACTIONS=new Set(['check','inventory','online','stop','preview','rebuild','edit-preview','edit-apply','shutdown','client-closed']);
const REPORTS=new Set(['preview.md','plan.json','approval.json','snapshot.json','result.json','execution-log.txt','failure.json','edit-preview.txt','edit-plan.json','edit-snapshot.json','edit-result.json','edit-conflict.json']);
const STATIC=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/styles.css','styles.css'],['/favicon.svg','favicon.svg']]);
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const MAX_BODY=256*1024;

export function desktopDemoSnapshot() {
  const guildId='111111111111111111',botId='222222222222222222',botRole='333333333333333333';
  let next=800000000000000000n;
  const s={captured_at:new Date().toISOString(),guild:{id:guildId,name:'Real Friends • عرض توضيحي',owner_id:'444444444444444444'},
    bot:{id:botId,username:'Cortex Manager'},botMember:{roles:[botRole]},members:[],membersComplete:true,
    roles:[{id:guildId,name:'@everyone',color:0x99aab5,position:0,permissions:String(P.ViewChannel|P.SendMessages),managed:false},
      {id:botRole,name:'Cortex Manager',color:0x5865f2,position:20,permissions:String(P.Administrator),managed:true},
      {id:'999999999999999991',name:'★ OWNER ★',color:0xf3be58,position:30,permissions:String(P.Administrator),managed:false},
      {id:'999999999999999992',name:'★ CO_OWNER ★',color:0xe09e54,position:29,permissions:String(P.ManageRoles),managed:false}],channels:[]};
  for(const [index,r] of ROLES.entries())s.roles.push({id:String(next++),name:r.name,color:r.color,position:15-index,permissions:String(bits(r.permissions)),managed:false,hoist:index<5,mentionable:false});
  for(const category of CATEGORIES) {
    const parent=String(next++),privateArea=category.access==='staff';
    const overwrites=privateArea?[{id:guildId,type:0,allow:'0',deny:String(P.ViewChannel)}]:[];
    s.channels.push({id:parent,name:category.name,type:4,position:s.channels.length,permission_overwrites:overwrites});
    for(const channel of category.channels) {
      const id=String(next++);s.channels.push({id,name:channel.name,type:channel.type==='voice'?2:0,parent_id:parent,position:s.channels.length,topic:channel.topic??'',rate_limit_per_user:channel.slowmode??0,user_limit:channel.userLimit??0,permission_overwrites:structuredClone(overwrites)});
      if(channel.key==='rules')s.guild.rules_channel_id=id;
      if(channel.key==='audit')s.guild.public_updates_channel_id=id;
    }
  }
  return s;
}

/** Injectable only by in-process tests; the HTTP surface cannot choose a runner. */
export function spawnDesktopWorker(mode,config,{cwd,root=ROOT,onOutput,onError}) {
  const env={...process.env,DISCORD_BOT_TOKEN:'',DISCORD_GUILD_ID:'',CONFIRM_DELETE:'',CONFIRM_GUILD_ID:'',GITHUB_ACTIONS:'false'};
  const child=spawn(process.execPath,[path.join(root,'src','desktop-worker.mjs'),mode],{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let settled=false;
  const out=readline.createInterface({input:child.stdout}),err=readline.createInterface({input:child.stderr});
  out.on('line',onOutput);err.on('line',onError);
  const completion=new Promise(resolve=>{
    child.once('error',error=>{onError(error.message);if(!settled){settled=true;resolve({code:1});}});
    child.once('close',code=>{out.close();err.close();if(!settled){settled=true;resolve({code:code??1});}});
  });
  child.stdin.on('error',()=>{});
  child.stdin.write(JSON.stringify(config)+'\n','utf8');
  if(mode!=='online')child.stdin.end();
  return {completion,async stop(){
    if(settled)return;
    if(mode==='online')child.stdin.end('{"action":"stop"}\n');else child.kill();
    let timer;await Promise.race([completion,new Promise(resolve=>{timer=setTimeout(()=>{child.kill();resolve();},2500);timer.unref?.();})]);clearTimeout(timer);
  }};
}

export async function createDesktopServer({root=ROOT,sessionDir,runWorker=spawnDesktopWorker,demo=false,idleTimeoutMs=300000,startupTimeoutMs=120000,port=0}={}) {
  root=path.resolve(root);
  if(!sessionDir){const base=path.join(root,'out','desktop-modern','sessions');fs.mkdirSync(base,{recursive:true});sessionDir=fs.mkdtempSync(path.join(base,'session-'));}
  sessionDir=path.resolve(sessionDir);fs.mkdirSync(path.join(sessionDir,'out'),{recursive:true});
  const key=randomBytes(32).toString('hex'),secrets=new Set();
  let credentials={token:'',guildId:''},job=null,presenceWorker=null,presenceStopping=null,closed=false,lastSeen=0,activeOperation=null,clientClosedTimer=null;
  const startedAt=Date.now();
  let resolveDone;const done=new Promise(resolve=>{resolveDone=resolve;});
  const demoSnapshot=demo?desktopDemoSnapshot():null;
  const state={version:'6.0',demo:!!demo,busy:false,status:demo?'demo':'disconnected',online:false,connected:false,presence:{status:demo?'demo':'offline'},diagnostics:demo?diagnostics(demoSnapshot):null,
    preview:null,editPreview:null,logs:[],operation:null,result:null,error:null};
  const redact=value=>{let result=String(value??'');for(const secret of secrets)if(secret)result=result.split(secret).join('[محجوب]');return result;};
  const scrub=value=>typeof value==='string'?redact(value):Array.isArray(value)?value.map(scrub):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([name,item])=>[name,scrub(item)])):value;
  const log=(message,level='info')=>{const clean=redact(message).trim().slice(0,16000);if(clean)state.logs.push({time:new Date().toISOString(),level,message:clean});if(state.logs.length>400)state.logs.splice(0,state.logs.length-400);};
  const readReport=name=>{if(!REPORTS.has(name))return null;try{return fs.readFileSync(path.join(sessionDir,'out',name),'utf8');}catch{return null;}};
  const jsonReport=name=>{try{return JSON.parse(readReport(name));}catch{return null;}};
  const files=()=>[...REPORTS].flatMap(name=>{try{const stat=fs.statSync(path.join(sessionDir,'out',name));return stat.isFile()?[{name,size:stat.size}]:[];}catch{return [];}});
  const publicState=()=>scrub({...state,hasCredentials:Boolean(credentials.token),inventory:state.diagnostics?.inventory??null,guildId:credentials.guildId||state.diagnostics?.guildId||'',
    reports:{files:files(),preview:state.preview?.summary??null,editPreview:state.editPreview?.summary??null}});
  const invalidate=()=>{state.preview=null;state.editPreview=null;};
  function acceptCredentials(config) {
    const token=String(config.token??credentials.token).trim(),guildId=String(config.guildId??credentials.guildId).trim();
    if(!token||token.length>2048||!/^\d{16,22}$/.test(guildId))throw new Error('أدخل توكن البوت ورقم السيرفر الصحيح أولاً.');
    if((presenceWorker||presenceStopping)&&token!==credentials.token)throw new Error('أوقف اتصال البوت قبل تغيير التوكن.');
    secrets.add(token);
    if(guildId!==credentials.guildId||token!==credentials.token){invalidate();state.diagnostics=null;state.connected=false;}
    credentials={token,guildId};return credentials;
  }
  const output=(line,mode)=>{
    let event;try{event=JSON.parse(line);}catch{if(mode!=='preview')log(line);return;}
    if(event.event==='diagnostics'){state.diagnostics=event.data;state.connected=true;if(!presenceWorker)state.status='connected';log('تم تحديث قنوات السيرفر والرتب والصلاحيات.');}
    else if(event.event==='presence'){state.presence=event;state.online=event.status==='online';state.status=state.online?'online':event.status;log(event.message??event.status,event.status==='error'?'error':'info');}
    else if(event.event==='edit-preview'){state.editPreview=event.data;log('معاينة التعديل جاهزة للمراجعة.');}
    else if(event.event==='edit-applied'){state.result=event.data;invalidate();state.diagnostics=null;state.connected=false;log('اكتمل حفظ التعديل. حدّث السيرفر لرؤية النتيجة.');}
  };
  function launch(mode,config,online=false) {
    const options={cwd:sessionDir,root,onOutput:line=>output(line,mode),onError:line=>{state.error??=redact(line);log(line,'error');}};
    const handle=runWorker(mode,config,options);
    if(online){presenceWorker=handle;state.presence={status:'connecting'};state.status='connecting';
      handle.completion.then(result=>{if(presenceWorker===handle){presenceWorker=null;state.online=false;state.presence={status:result.code?'error':'offline'};state.status=state.connected?'connected':'disconnected';} }).catch(error=>log(error.message,'error'));
      return;
    }
    job=handle;state.busy=true;state.operation=mode;activeOperation=mode;
    handle.completion.then(result=>{
      if(mode==='preview') {
        const summary=readReport('preview.md'),p=jsonReport('plan.json');
        state.preview=summary?{summary,approvalHash:p?.approvalHash,plan:p,guildId:config.guildId,ready:result.code===0}:null;
      }
      if(mode==='rebuild'){state.result=jsonReport('result.json');invalidate();state.diagnostics=null;state.connected=false;}
      if(mode==='edit-apply')invalidate();
      if(result.code!==0){state.error=state.error??'تعذّرت العملية. راجع سجل التشغيل.';log('انتهت العملية دون تطبيق الخطوات المتبقية.','error');}
      else {state.error=null;log(mode==='preview'?'خطة إعادة البناء جاهزة للمراجعة؛ لم يتغير السيرفر.':'اكتملت العملية.','success');}
    }).catch(error=>{state.error=redact(error.message);log(error.message,'error');}).finally(()=>{if(job===handle){job=null;state.busy=false;state.operation=null;activeOperation=null;}});
  }
  async function action(body) {
    if(!body||Array.isArray(body)||typeof body!=='object'||!ACTIONS.has(body.action))throw Object.assign(new Error('عملية غير مسموح بها.'),{status:400});
    const {action:name}=body,config=body.config??{};
    if(!config||Array.isArray(config)||typeof config!=='object')throw Object.assign(new Error('إعدادات غير صالحة.'),{status:400});
    if(name==='client-closed'){clearTimeout(clientClosedTimer);clientClosedTimer=setTimeout(()=>{if(!state.busy)close();},8000);clientClosedTimer.unref();return;}
    if(name==='shutdown'){if(job)throw Object.assign(new Error('انتظر اكتمال العملية قبل إغلاق البرنامج.'),{status:409});setTimeout(()=>close(),25).unref();return;}
    if(name==='stop'){
      if(!presenceStopping){const own=presenceWorker;presenceWorker=null;state.presence={status:'disconnecting'};state.status='disconnecting';
        presenceStopping=Promise.resolve().then(()=>own?.stop()).finally(()=>{presenceStopping=null;state.online=false;state.presence={status:'offline'};state.status=state.connected?'connected':'disconnected';});}
      await presenceStopping;return;
    }
    if(job)throw Object.assign(new Error('انتظر اكتمال العملية الحالية.'),{status:409});
    if(demo){
      if(['rebuild','edit-apply','online'].includes(name))throw Object.assign(new Error('هذه نسخة عرض توضيحي؛ الاتصال والتعديلات الحقيقية معطّلة.'),{status:403});
      state.error=null;
      if(['check','inventory'].includes(name)){state.diagnostics=diagnostics(demoSnapshot);log('تم عرض بيانات توضيحية فقط.');return;}
      if(name==='preview'){const p=plan(demoSnapshot);state.preview={summary:renderPreview(demoSnapshot,p),approvalHash:p.approvalHash,plan:p,guildId:demoSnapshot.guild.id,ready:false};log('معاينة توضيحية؛ لا يمكن تنفيذ إعادة بناء في وضع العرض.');return;}
      if(name==='edit-preview'){const p=prepareEdit(demoSnapshot,config.editRequest);state.editPreview={approvalHash:p.approvalHash,summary:editSummary(p),changes:p.changes};return;}
    }
    const auth=acceptCredentials(config);
    if(name==='online'){if(presenceWorker||presenceStopping)throw Object.assign(new Error('البوت متصل أو يجري تغيير الاتصال؛ انتظر اكتمال العملية.'),{status:409});state.error=null;launch(name,auth,true);return;}
    if(name==='rebuild'){
      if(config.confirmGuildId!==auth.guildId||config.confirmDelete!==CONFIRMATION)throw Object.assign(new Error('يتطلب التنفيذ كتابة رقم السيرفر وعبارة الحذف المطابقة.'),{status:400});
      if(!state.preview?.ready||state.preview.guildId!==auth.guildId)throw Object.assign(new Error('أنشئ معاينة ناجحة لهذا السيرفر وراجعها أولاً.'),{status:409});
    }
    if(name==='edit-apply') {
      const confirmation=config.editConfirmation;
      if(confirmation?.confirmed!==true||confirmation.guildId!==auth.guildId||!state.editPreview||confirmation.approvalHash!==state.editPreview.approvalHash)throw Object.assign(new Error('راجع التعديل أولاً ثم أكّد حفظ الخطة نفسها.'),{status:400});
    }
    if(['check','inventory','preview','edit-preview'].includes(name)){state.editPreview=null;state.preview=null;}
    if(name==='edit-apply'||name==='rebuild')state.preview=null;
    state.error=null;state.result=null;
    launch(name,{...auth,...(name==='rebuild'?{confirmGuildId:config.confirmGuildId,confirmDelete:config.confirmDelete}:{}),
      ...(name==='edit-preview'?{editRequest:config.editRequest}:{}),...(name==='edit-apply'?{editConfirmation:config.editConfirmation}:{})});
  }
  const server=http.createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
    const send=(status,data,type='application/json; charset=utf-8')=>{res.writeHead(status,{...headers,'Content-Type':type});res.end(type.startsWith('application/json')&&typeof data==='object'&&!Buffer.isBuffer(data)?JSON.stringify(data):data);};
    try {
      const host=`127.0.0.1:${server.address().port}`,origin=`http://${host}`;
      if(req.headers.host!==host||req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'مصدر الطلب غير مسموح به.'});
      const url=new URL(req.url,origin);
      if(url.pathname.startsWith('/api/')){
        const supplied=String(req.headers['x-cortex-key']??'');
        if(!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(key)))return send(401,{error:'جلسة محلية غير صالحة.'});
        lastSeen=Date.now();
        if(req.method==='GET'&&url.pathname==='/api/state'){clearTimeout(clientClosedTimer);return send(200,publicState());}
        if(req.method==='GET'&&url.pathname.startsWith('/api/report/')){
          const name=url.pathname.slice('/api/report/'.length);if(!REPORTS.has(name))return send(404,{error:'التقرير غير موجود.'});
          const report=readReport(name);if(report===null)return send(404,{error:'التقرير غير موجود.'});
          res.setHeader('Content-Disposition',`attachment; filename="${name}"`);return send(200,redact(report),TYPES[path.extname(name)]);
        }
        if(req.method==='POST'&&url.pathname==='/api/action'){
          if(!/^application\/json(?:;|$)/i.test(String(req.headers['content-type']??'')))return send(415,{error:'يلزم طلب JSON.'});
          let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>MAX_BODY){send(413,{error:'الطلب كبير جداً.'});req.resume();return;}parts.push(part);}
          let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return send(400,{error:'JSON غير صالح.'});}
          await action(body);return send(202,{ok:true});
        }
        return send(404,{error:'المسار غير موجود.'});
      }
      if(req.method!=='GET')return send(405,{error:'الطريقة غير مسموح بها.'});
      const asset=STATIC.get(url.pathname);if(!asset)return send(404,{error:'الملف غير موجود.'});
      try{return send(200,fs.readFileSync(path.join(root,'desktop','web',asset)),TYPES[path.extname(asset)]);}catch{return send(404,{error:'ملفات الواجهة غير موجودة.'});}
    } catch(error){if(!res.headersSent)send(error.status??400,{error:redact(error.message)});}
  });
  const timer=setInterval(()=>{if((!lastSeen&&Date.now()-startedAt>startupTimeoutMs)||(lastSeen&&Date.now()-lastSeen>idleTimeoutMs&&!state.busy))close();},Math.min(5000,Math.max(20,Math.min(idleTimeoutMs,startupTimeoutMs)/2)));timer.unref();
  async function close(){
    if(closed)return done;closed=true;clearInterval(timer);clearTimeout(clientClosedTimer);
    await Promise.allSettled([job?.stop(),presenceWorker?.stop(),presenceStopping]);job=null;presenceWorker=null;credentials={token:'',guildId:''};secrets.clear();
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));resolveDone();
  }
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port},resolve);});
  const actualPort=server.address().port,url=`http://127.0.0.1:${actualPort}/#${key}`;
  return {server,key,url,port:actualPort,sessionDir,close,done,get activeOperation(){return activeOperation;}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);let root=ROOT,demo=false;
  for(let i=0;i<args.length;i++){if(args[i]==='--root'&&args[i+1])root=args[++i];else if(args[i]==='--demo')demo=true;else throw new Error('Unknown desktop server option');}
  createDesktopServer({root,demo}).then(bridge=>{
    process.stdout.write(JSON.stringify({event:'ready',url:bridge.url,port:bridge.port,demo})+'\n');
    const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
    input.on('line',line=>{try{if(JSON.parse(line).action==='shutdown')bridge.close();}catch{}});
    input.on('close',()=>bridge.close());
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>bridge.close());
    bridge.done.then(()=>input.close());
  }).catch(error=>{process.stderr.write('Unable to open Cortex Manager: '+error.message+'\n');process.exitCode=1;});
}
