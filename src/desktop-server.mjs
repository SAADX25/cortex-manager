import {createWorkspaceStore} from './workspace-store.mjs';
import {createSocialStore,manualSocialMessage,validateSocial} from './social-config.mjs';
import {hostedPackage} from './social-package.mjs';
import {createInstagramThumbnailResolver} from './instagram-thumbnail.mjs';
import {createSocialLinkReader} from './social-links.mjs';
import {prepareBatch,batchPublic,batchSummary} from './batch-editor.mjs';
import {simulatePermissions} from './permission-simulator.mjs';
import {defaultDesign,designTemplate,validateCustomDesign} from './custom-design.mjs';
import {digest} from './safety.mjs';
import {prepareRoleGrant,roleGrantPublic} from './role-grants.mjs';
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
import {createServerProfileStore} from './server-profiles.mjs';
import {createCredentialStore} from './credentials.mjs';
import {prepareMessage,messagePreview} from './messages.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const ACTIONS=new Set(['batch-preview','batch-apply','permission-simulate','role-grant-preview','role-grant-apply','message-preview','message-send','server-save','server-select','server-remove','credentials-save','credentials-forget','connect','check','inventory','online','stop','preview','rebuild','edit-preview','edit-apply','shutdown','client-closed']);
const REPORTS=new Set(['batch-plan.json','batch-snapshot.json','batch-preview.txt','batch-result.json','design.json','role-grant-plan.json','role-grant-preview.txt','role-grant-result.json','preview.md','plan.json','approval.json','snapshot.json','result.json','execution-log.txt','failure.json','edit-preview.txt','edit-plan.json','edit-snapshot.json','edit-result.json','edit-conflict.json','message-plan.json','message-preview.txt','message-result.json']);
const STATIC=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/i18n.js','i18n.js'],['/designer.js','designer.js'],['/arrange.js','arrange.js'],['/workspace-drafts.js','workspace-drafts.js'],['/workbench-ui.js','workbench-ui.js'],['/social-ui.js','social-ui.js'],['/styles.css','styles.css'],['/favicon.svg','favicon.svg']]);
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
  const roleId=name=>s.roles.find(r=>r.name.endsWith('・'+name))?.id;
  s.members=[{id:botId,bot:true,roles:[botRole]},...Array.from({length:12},(_,i)=>({id:String(900000000000001000n+BigInt(i)),bot:false,roles:[roleId('Member'),...(i%2===0?[roleId('Gamer')]:[]),...(i<3?[roleId('VIP')]:[]),...(i===0?['999999999999999991']:i===1?['999999999999999992']:[])].filter(Boolean)}))];
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

export async function createDesktopServer({root=ROOT,sessionDir,runWorker=spawnDesktopWorker,demo=false,credentialStore,idleTimeoutMs=300000,startupTimeoutMs=120000,port=0}={}) {
  root=path.resolve(root);
  const preferencesFile=path.join(root,'out','desktop-modern',demo?'demo-preferences.json':'preferences.json');
  let uiLanguage='ar';try{const p=JSON.parse(fs.readFileSync(preferencesFile,'utf8'));if(p.language==='en')uiLanguage='en';}catch{}
  if(!sessionDir){const base=path.join(root,'out','desktop-modern','sessions');fs.mkdirSync(base,{recursive:true});sessionDir=fs.mkdtempSync(path.join(base,'session-'));}
  sessionDir=path.resolve(sessionDir);fs.mkdirSync(path.join(sessionDir,'out'),{recursive:true});
  const key=randomBytes(32).toString('hex'),secrets=new Set();
  let credentials={token:'',guildId:''},job=null,presenceWorker=null,presenceStopping=null,closed=false,lastSeen=0,activeOperation=null,clientClosedTimer=null;
  const workspaceStore=createWorkspaceStore({root,demo});
  const socialStore=createSocialStore({root,demo});
  const socialLinks=createSocialLinkReader({root,demo,socialStore});
  const resolveInstagramThumbnail=createInstagramThumbnailResolver();
  const vault=credentialStore??createCredentialStore({root});let credentialsSaved=false,credentialLoadError=null;
  if(!demo)try{const saved=await vault.load();if(saved){credentials=saved;secrets.add(saved.token);credentialsSaved=true;}}catch{credentialLoadError='تعذّرت قراءة البيانات المحفوظة. أدخل بيانات البوت مجددًا أو احذف البيانات المحفوظة.';}
  let profiles=null,profileLoadError=null;
  try{
    profiles=createServerProfileStore({root,demo});
    const saved=profiles.list();
    if(saved.selectedId)credentials.guildId=saved.selectedId;
    else if(profiles.isNew&&credentials.guildId){profiles.save({id:credentials.guildId},{select:true});}
    else credentials.guildId='';
  }catch{profileLoadError='تعذّرت قراءة قائمة السيرفرات المحفوظة. لم يتم استبدال الملف.';}
  const startedAt=Date.now();let presenceEpoch=0,credentialTask=null;
  let resolveDone;const done=new Promise(resolve=>{resolveDone=resolve;});
  const demoSnapshot=demo?desktopDemoSnapshot():null;
  const state={version:'6.0',demo:!!demo,busy:false,status:demo?'demo':'disconnected',online:false,connected:false,presenceStartedAt:null,presence:{status:demo?'demo':'offline'},diagnostics:demo?diagnostics(demoSnapshot):null,
    batchPreview:null,batchResult:null,simulation:null,roleGrantPreview:null,preview:null,editPreview:null,messagePreview:null,messageResult:null,logs:[],operation:null,result:null,error:credentialLoadError??profileLoadError};
  const redact=value=>{let result=String(value??'');for(const secret of secrets)if(secret)result=result.split(secret).join('[محجوب]');return result;};
  const scrub=value=>typeof value==='string'?redact(value):Array.isArray(value)?value.map(scrub):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([name,item])=>[name,scrub(item)])):value;
  const log=(message,level='info')=>{const clean=redact(message).trim().slice(0,16000);if(clean)state.logs.push({time:new Date().toISOString(),level,message:clean});if(state.logs.length>400)state.logs.splice(0,state.logs.length-400);};
  const readReport=name=>{if(!REPORTS.has(name))return null;try{return fs.readFileSync(path.join(sessionDir,'out',name),'utf8');}catch{return null;}};
  const jsonReport=name=>{try{return JSON.parse(readReport(name));}catch{return null;}};
  const files=()=>[...REPORTS].flatMap(name=>{try{const stat=fs.statSync(path.join(sessionDir,'out',name));return stat.isFile()?[{name,size:stat.size}]:[];}catch{return [];}});
  const publicState=()=>scrub({...state,serverProfiles:profiles?.list().servers??[],profileStorageAvailable:!!profiles,credentialsSaved,presenceActive:Boolean(presenceWorker||presenceStopping),hasCredentials:Boolean(credentials.token),inventory:state.diagnostics?.inventory??null,guildId:credentials.guildId||state.diagnostics?.guildId||'',
    reports:{files:files(),preview:state.preview?.summary??null,editPreview:state.editPreview?.summary??null}});
  const invalidate=()=>{state.batchPreview=null;state.roleGrantPreview=null;state.preview=null;state.editPreview=null;state.messagePreview=null;};
  function acceptCredentials(config) {
    const token=String(config.token??credentials.token).trim(),guildId=String(config.guildId??credentials.guildId).trim();
    if(!token||token.length>2048||!/^\d{16,22}$/.test(guildId))throw new Error('أدخل توكن البوت ورقم السيرفر الصحيح أولاً.');
    if((presenceWorker||presenceStopping)&&token!==credentials.token)throw new Error('أوقف اتصال البوت قبل تغيير التوكن.');
    secrets.add(token);
    if(guildId!==credentials.guildId||token!==credentials.token){invalidate();state.diagnostics=null;state.simulation=null;state.batchResult=null;state.connected=false;}
    credentials={token,guildId};return credentials;
  }
  const output=(line,mode)=>{
    let event;try{event=JSON.parse(line);}catch{if(mode!=='preview')log(line);return;}
    if(event.event==='diagnostics'){
      const inv=event.data.inventory;
      if(profiles&&inv?.guildId===credentials.guildId)try{profiles.save({id:inv.guildId,name:inv.guildName,iconURL:inv.guildProfile?.iconURL??''},{select:true});}catch(error){log(error.message,'error');}
      state.diagnostics=event.data;state.connected=true;if(!presenceWorker)state.status='connected';log('تم تحديث قنوات السيرفر والرتب والصلاحيات.');}
    else if(event.event==='batch-preview'){state.batchPreview=event.data;log('مساحة التغييرات جاهزة للمراجعة.');}
    else if(event.event==='batch-applied'){state.batchResult=event.data;invalidate();state.diagnostics=null;state.connected=false;}
    else if(event.event==='permission-simulation'){state.simulation=event.data;log('اكتملت محاكاة الصلاحيات للقراءة فقط.');}
    else if(event.event==='presence'){state.presence=event;state.online=event.status==='online';if(state.online&&state.presenceStartedAt===null)state.presenceStartedAt=Date.now();state.status=state.online?'online':event.status;log(event.message??event.status,event.status==='error'?'error':'info');}
    else if(event.event==='role-grant-preview'){state.roleGrantPreview=event.data;log('معاينة منح الرتبة جاهزة؛ لم تتغير رتب العضو.');}
    else if(event.event==='role-granted'){state.roleGrantPreview=null;state.result=event.data;log('تم منح الرتبة للعضو المحدد.','success');}
    else if(event.event==='edit-preview'){state.editPreview=event.data;log('معاينة التعديل جاهزة للمراجعة.');}
    else if(event.event==='message-preview'){state.messagePreview=event.data;log('معاينة الرسالة جاهزة؛ لم تُرسل إلى Discord.');}
    else if(event.event==='message-sent'){state.messageResult=event.data;state.messagePreview=null;log('تم إرسال الرسالة باسم البوت.','success');}
    else if(event.event==='edit-applied'){state.result=event.data;invalidate();state.diagnostics=null;state.connected=false;log('اكتمل حفظ التعديل. حدّث السيرفر لرؤية النتيجة.');}
  };
  function launch(mode,config,online=false,connectAfter=false) {
    const epoch=presenceEpoch;
    const options={cwd:sessionDir,root,onOutput:line=>{if(!online||epoch===presenceEpoch)output(line,mode);},onError:line=>{state.error??=redact(line);log(line,'error');}};
    const handle=runWorker(mode,config,options);
    if(online){presenceWorker=handle;state.presenceStartedAt=null;state.presence={status:'connecting'};state.status='connecting';
      handle.completion.then(result=>{if(presenceWorker===handle){presenceWorker=null;state.online=false;state.presenceStartedAt=null;state.presence={status:result.code?'error':'offline'};state.status=state.connected?'connected':'disconnected';} }).catch(error=>log(error.message,'error'));
      return;
    }
    job=handle;state.busy=true;state.operation=mode;activeOperation=mode;
    handle.completion.then(result=>{
      if(mode==='preview') {
        const summary=readReport('preview.md'),p=jsonReport('plan.json');
        state.preview=summary?{summary,approvalHash:p?.approvalHash,plan:p,guildId:config.guildId,ready:result.code===0}:null;
      }
      if(mode==='rebuild'){state.result=jsonReport('result.json');invalidate();state.diagnostics=null;state.connected=false;}
      if(mode==='batch-apply'){state.batchResult=jsonReport('batch-result.json')??state.batchResult;invalidate();state.diagnostics=null;state.connected=false;}
      if(mode==='edit-apply')invalidate();
      if(mode==='message-send'){state.messagePreview=null;state.messageResult=jsonReport('message-result.json')??state.messageResult;}
      if(result.code!==0){state.error=state.error??'تعذّرت العملية. راجع سجل التشغيل.';log('انتهت العملية دون تطبيق الخطوات المتبقية.','error');}
      else {state.error=null;log(mode==='preview'?'خطة إعادة البناء جاهزة للمراجعة؛ لم يتغير السيرفر.':mode==='message-preview'?'اكتملت المعاينة فقط؛ اضغط إرسال ثم أكّد لنشر الرسالة في Discord.':'اكتملت العملية.','success');
        if(connectAfter&&state.connected&&epoch===presenceEpoch&&!closed&&!presenceWorker&&!presenceStopping)launch('online',config,true);
      }
    }).catch(error=>{state.error=redact(error.message);log(error.message,'error');}).finally(()=>{if(job===handle){job=null;state.busy=false;state.operation=null;activeOperation=null;}});
  }
  async function action(body) {
    if(!body||Array.isArray(body)||typeof body!=='object'||!ACTIONS.has(body.action))throw Object.assign(new Error('عملية غير مسموح بها.'),{status:400});
    const {action:name}=body,config=body.config??{};
    if(!config||Array.isArray(config)||typeof config!=='object')throw Object.assign(new Error('إعدادات غير صالحة.'),{status:400});
    if(name==='client-closed'){clearTimeout(clientClosedTimer);clientClosedTimer=setTimeout(()=>{if(!state.busy)close();},8000);clientClosedTimer.unref();return;}
    if(name==='shutdown'){if(state.busy)throw Object.assign(new Error('انتظر اكتمال العملية قبل إغلاق البرنامج.'),{status:409});setTimeout(()=>close(),25).unref();return;}
    if(name==='stop'){
      presenceEpoch++;
      state.presenceStartedAt=null;
      if(!presenceStopping){const own=presenceWorker;presenceWorker=null;state.presence={status:'disconnecting'};state.status='disconnecting';
        presenceStopping=Promise.resolve().then(()=>own?.stop()).finally(()=>{presenceStopping=null;state.online=false;state.presence={status:'offline'};state.status=state.connected?'connected':'disconnected';});}
      await presenceStopping;return;
    }
    if(state.busy)throw Object.assign(new Error('انتظر اكتمال العملية الحالية.'),{status:409});
    if(['server-save','server-select','server-remove'].includes(name)){
      if(!profiles)throw new Error(profileLoadError);
      if(Object.keys(config).some(k=>!['guildId'].includes(k))||!/^\d{16,22}$/.test(config.guildId??''))throw new Error('أدخل رقم السيرفر الصحيح أولًا.');
      const id=config.guildId;
      if(name==='server-save'){
        const inv=state.diagnostics?.inventory;
        profiles.save({id,...(inv?.guildId===id?{name:inv.guildName,iconURL:inv.guildProfile?.iconURL??''}:{})},{select:true});
      }else if(name==='server-remove'){
        profiles.remove(id);
      }else{
        profiles.select(id);
      }
      if(name!=='server-remove'&&credentials.guildId!==id){invalidate();state.diagnostics=null;state.result=null;state.messageResult=null;state.simulation=null;state.batchResult=null;state.connected=false;credentials={...credentials,guildId:id};state.status=state.online?'online':'disconnected';}
      state.error=null;return;
    }
    if(['credentials-save','credentials-forget'].includes(name)){
      if(demo)throw Object.assign(new Error('حفظ البيانات الحقيقية معطّل في العرض التوضيحي.'),{status:403});
      const value=name==='credentials-save'?acceptCredentials(config):null;
      state.busy=true;state.operation=name;
      credentialTask=Promise.resolve().then(async()=>{
        if(value){await vault.save(value);credentialsSaved=true;if(profiles)try{profiles.save({id:value.guildId},{select:true});}catch(error){log(error.message,'error');}log('تم حفظ بيانات الاتصال بتشفير ويندوز.','success');}
        else {await vault.forget();credentialsSaved=false;log('تم حذف البيانات المحفوظة من الجهاز.','success');}
        state.error=null;
      });
      try{await credentialTask;}finally{credentialTask=null;state.busy=false;state.operation=null;}
      return;
    }
    if(demo){
      if(['role-grant-apply','message-send','connect','rebuild','edit-apply','batch-apply','online'].includes(name))throw Object.assign(new Error('هذه نسخة عرض توضيحي؛ الاتصال والتعديلات الحقيقية معطّلة.'),{status:403});
      state.error=null;
      if(['check','inventory'].includes(name)){state.diagnostics=diagnostics(demoSnapshot);log('تم عرض بيانات توضيحية فقط.');return;}
      if(name==='batch-preview'){invalidate();const p=prepareBatch(demoSnapshot,config.batchRequests,randomBytes(12).toString('hex'));state.batchPreview=batchPublic(p);fs.writeFileSync(path.join(sessionDir,'out','batch-preview.txt'),batchSummary(p));return;}
      if(name==='permission-simulate'){const member=demoSnapshot.members.find(m=>m.id===config.simulationRequest?.memberId);state.simulation=simulatePermissions(demoSnapshot,config.simulationRequest,member?{...member,nick:'عضو تجريبي'}:null);return;}
      if(name==='preview'){const p=plan(demoSnapshot,undefined,config.design??null);state.preview={summary:renderPreview(demoSnapshot,p),approvalHash:p.approvalHash,plan:p,guildId:demoSnapshot.guild.id,ready:false};log('معاينة توضيحية؛ لا يمكن تنفيذ إعادة بناء في وضع العرض.');return;}
      if(name==='role-grant-preview'){invalidate();const member=demoSnapshot.members.find(m=>m.id===config.roleGrantRequest?.memberId);state.roleGrantPreview=roleGrantPublic(prepareRoleGrant(demoSnapshot,config.roleGrantRequest,member?{...member,nick:'عضو تجريبي'}:null,randomBytes(12).toString('hex')));return;}
      if(name==='edit-preview'){const p=prepareEdit(demoSnapshot,config.editRequest);state.editPreview={approvalHash:p.approvalHash,summary:editSummary(p),changes:p.changes,...(p.move?{move:p.move}:{})};return;}
      if(name==='message-preview'){const p=prepareMessage(demoSnapshot,config.messageRequest,randomBytes(12).toString('hex'));state.messagePreview=messagePreview(p);return;}
    }
    const auth=acceptCredentials(config);
    if(name==='connect'){
      if(presenceStopping)throw Object.assign(new Error('انتظر اكتمال إيقاف الاتصال ثم حاول مجددًا.'),{status:409});
      invalidate();state.error=null;state.result=null;log('جارٍ تحميل السيرفر وتجهيز اتصال البوت…');
      launch('inventory',auth,false,true);return;
    }
    if(name==='online'){if(presenceWorker||presenceStopping)throw Object.assign(new Error('البوت متصل أو يجري تغيير الاتصال؛ انتظر اكتمال العملية.'),{status:409});state.error=null;launch(name,auth,true);return;}
    if(name==='batch-preview'){invalidate();state.batchResult=null;}
    if(name==='permission-simulate')state.simulation=null;
    if(name==='batch-apply'){const c=config.batchConfirmation,p=state.batchPreview;if(c?.confirmed!==true||c.guildId!==auth.guildId||!p||c.approvalHash!==p.approvalHash)throw new Error('راجع مساحة التغييرات وأكّد المعاينة نفسها.');fs.rmSync(path.join(sessionDir,'out','batch-result.json'),{force:true});invalidate();state.batchResult=null;}
    if(name==='rebuild'){
      if(state.preview?.plan?.design&&digest(validateCustomDesign(config.design))!==digest(state.preview.plan.design))throw new Error('تغيّر القالب منذ المعاينة؛ أنشئ معاينة جديدة.');
      if(config.confirmGuildId!==auth.guildId||config.confirmDelete!==CONFIRMATION)throw Object.assign(new Error('يتطلب التنفيذ كتابة رقم السيرفر وعبارة الحذف المطابقة.'),{status:400});
      if(!state.preview?.ready||state.preview.guildId!==auth.guildId)throw Object.assign(new Error('أنشئ معاينة ناجحة لهذا السيرفر وراجعها أولاً.'),{status:409});
    }
    if(name==='role-grant-apply'){const c=config.roleGrantConfirmation,p=state.roleGrantPreview;if(c?.confirmed!==true||c.guildId!==auth.guildId||!p||c.approvalHash!==p.approvalHash||c.memberId!==p.memberId||c.roleId!==p.roleId||p.administrator&&c.acknowledgeAdmin!==true)throw new Error('راجع العضو والرتبة وأكّد المعاينة نفسها.');state.roleGrantPreview=null;}
    if(name==='role-grant-preview'){invalidate();}
    if(name==='edit-apply') {
      const confirmation=config.editConfirmation;
      if(confirmation?.confirmed!==true||confirmation.guildId!==auth.guildId||!state.editPreview||confirmation.approvalHash!==state.editPreview.approvalHash)throw Object.assign(new Error('راجع التعديل أولاً ثم أكّد حفظ الخطة نفسها.'),{status:400});
    }
    if(name==='message-send'){
      const c=config.messageConfirmation,p=state.messagePreview;
      if(c?.confirmed!==true||c.guildId!==auth.guildId||!p||c.approvalHash!==p.approvalHash||c.channelId!==p.channelId)throw Object.assign(new Error('راجع الرسالة والغرفة ثم أكّد إرسال المعاينة نفسها.'),{status:400});
      state.messagePreview=null;
    }
    if(name==='message-preview'){invalidate();state.messageResult=null;}
    if(['check','inventory','preview','edit-preview'].includes(name)){state.roleGrantPreview=null;state.editPreview=null;state.preview=null;}
    if(name==='edit-apply'||name==='rebuild')state.preview=null;
    state.error=null;state.result=null;
    launch(name,{...auth,...(name==='preview'?{design:config.design?validateCustomDesign(config.design):null}:{}),...(name==='rebuild'?{confirmGuildId:config.confirmGuildId,confirmDelete:config.confirmDelete}:{}),
      ...(name==='batch-preview'?{batchRequests:config.batchRequests}:{}),...(name==='batch-apply'?{batchConfirmation:config.batchConfirmation}:{}),...(name==='permission-simulate'?{simulationRequest:config.simulationRequest}:{}),
      ...(name==='role-grant-preview'?{roleGrantRequest:config.roleGrantRequest}:{}),...(name==='role-grant-apply'?{roleGrantConfirmation:config.roleGrantConfirmation}:{}),
      ...(name==='edit-preview'?{editRequest:config.editRequest}:{}),...(name==='edit-apply'?{editConfirmation:config.editConfirmation}:{}),
      ...(name==='message-preview'?{messageRequest:config.messageRequest}:{}),...(name==='message-send'?{messageConfirmation:config.messageConfirmation}:{})});
  }
  const server=http.createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.discordapp.com; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
    const send=(status,data,type='application/json; charset=utf-8')=>{res.writeHead(status,{...headers,'Content-Type':type});res.end(type.startsWith('application/json')&&typeof data==='object'&&!Buffer.isBuffer(data)?JSON.stringify(data):data);};
    try {
      const host=`127.0.0.1:${server.address().port}`,origin=`http://${host}`;
      if(req.headers.host!==host||req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'مصدر الطلب غير مسموح به.'});
      const url=new URL(req.url,origin);
      if(url.pathname.startsWith('/api/')){
        const supplied=String(req.headers['x-cortex-key']??'');
        if(!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(key)))return send(401,{error:'جلسة محلية غير صالحة.'});
        lastSeen=Date.now();
        if(url.pathname==='/api/social/package'&&req.method==='GET'){
          if(demo)return send(403,{error:'Deployment export is unavailable in demo mode.'});
          res.setHeader('Content-Disposition','attachment; filename="Cortex-Social-Discloud.zip"');
          return send(200,hostedPackage(root,socialStore.read().config),'application/zip');
        }
        if(url.pathname==='/api/social/links'&&req.method==='GET')return send(200,socialLinks.read());
        if(['/api/social','/api/social/manual','/api/social/validate'].includes(url.pathname)){
          if(url.pathname==='/api/social'&&req.method==='GET')return send(200,socialStore.read());
          if(req.method!=='POST')return send(405,{error:'Method not allowed.'});
          if(!/^application\/json(?:;|$)/i.test(String(req.headers['content-type']??'')))return send(415,{error:'JSON required.'});
          let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>(url.pathname==='/api/social/manual'?3*1024*1024:64000)){send(413,{error:'Social settings too large.'});req.resume();return;}parts.push(part);}
          let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return send(400,{error:'Invalid JSON.'});}
          if(url.pathname==='/api/social/manual'){
            const request=manualSocialMessage(body??{});
            if(body?.captureThumbnail!==undefined&&typeof body.captureThumbnail!=='boolean')return send(400,{error:'Invalid thumbnail option.'});
            const thumbnail=body?.captureThumbnail?(demo?{status:'unavailable',reason:'demo'}:await resolveInstagramThumbnail(body.url)):{status:'not-requested'};
            if(thumbnail.image)request.image=thumbnail.image;
            return send(200,{request,thumbnail:{status:thumbnail.status,...(thumbnail.reason?{reason:thumbnail.reason}:{})}});
          }
          if(url.pathname==='/api/social/validate')return send(200,{config:validateSocial(body)});
          return send(200,socialStore.save(body));
        }
        if(url.pathname==='/api/workspace'){
          if(req.method==='GET')return send(200,workspaceStore.read(url.searchParams.get('guildId')));
          if(req.method!=='POST')return send(405,{error:'Method not allowed.'});
          if(!/^application\/json(?:;|$)/i.test(String(req.headers['content-type']??'')))return send(415,{error:'JSON required.'});
          let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>MAX_BODY*2){send(413,{error:'المسودات أكبر من الحد المسموح.'});req.resume();return;}parts.push(part);}
          let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return send(400,{error:'JSON غير صالح.'});}
          if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['guildId','baseRevision','entries'].includes(k)))return send(400,{error:'حقول المسودات غير صالحة.'});
          const before=workspaceStore.read(body.guildId),saved=workspaceStore.save(body.guildId,body);if(before.revision!==saved.revision)state.batchPreview=null;return send(200,saved);
        }
        if(url.pathname==='/api/design'){
          const designDir=path.join(root,'out','desktop-modern',demo?'demo-designs':'designs');
          const readDesign=id=>{const file=path.join(designDir,id+'.json');if(!fs.existsSync(file))return null;if(fs.statSync(file).size>300000)throw new Error('ملف القالب أكبر من الحد المسموح.');return validateCustomDesign(JSON.parse(fs.readFileSync(file,'utf8')));};
          if(req.method==='GET'){
            const id=url.searchParams.get('guildId')||'default';if(id!=='default'&&!/^\d{16,22}$/.test(id))return send(400,{error:'Invalid server ID.'});
            const saved=readDesign(id),design=saved??(id!=='default'?readDesign('default'):null)??defaultDesign();
            return send(200,{design,revision:digest(design),saved:!!saved,permissionNames:Object.keys(P),templates:{ar:designTemplate('ar'),en:designTemplate('en'),legacy:defaultDesign()}});
          }
          if(req.method==='POST'){
            if(state.busy)return send(409,{error:'انتظر اكتمال العملية الحالية.'});
            if(!/^application\/json(?:;|$)/i.test(String(req.headers['content-type']??'')))return send(415,{error:'JSON required.'});
            let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>MAX_BODY){send(413,{error:'القالب أكبر من الحد المسموح.'});req.resume();return;}parts.push(part);}
            let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return send(400,{error:'JSON غير صالح.'});}
            if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['guildId','design','baseRevision'].includes(k)))return send(400,{error:'حقول القالب غير صالحة.'});
            const id=body.guildId||'default';if(id!=='default'&&(typeof id!=='string'||!/^\d{16,22}$/.test(id)))return send(400,{error:'Invalid server ID.'});
            const current=readDesign(id)??(id!=='default'?readDesign('default'):null)??defaultDesign();if(Object.hasOwn(body,'baseRevision')&&body.baseRevision!==digest(current))return send(409,{error:'تغيّر قالب الهيكلة في نافذة أخرى. صدّر مسودتك قبل إعادة التحميل.'});
            const design=validateCustomDesign(body.design);fs.mkdirSync(designDir,{recursive:true});const file=path.join(designDir,id+'.json');fs.writeFileSync(file+'.tmp',JSON.stringify(design,null,2));fs.renameSync(file+'.tmp',file);
            invalidate();log('تم حفظ قالب الهيكلة محليًا؛ لم يتغير السيرفر.');return send(200,{design,revision:digest(design),saved:true});
          }
          return send(405,{error:'Method not allowed.'});
        }

        if(req.method==='GET'&&url.pathname==='/api/preferences')return send(200,{language:uiLanguage});
        if(req.method==='POST'&&url.pathname==='/api/preferences'){
          if(!/^application\/json(?:;|$)/i.test(String(req.headers['content-type']??'')))return send(415,{error:'JSON required.'});
          let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>128){send(413,{error:'Preference too large.'});req.resume();return;}parts.push(part);}
          let p;try{p=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return send(400,{error:'Invalid preference.'});}
          if(!p||Array.isArray(p)||Object.keys(p).length!==1||!['ar','en'].includes(p.language))return send(400,{error:'Invalid language preference.'});
          fs.mkdirSync(path.dirname(preferencesFile),{recursive:true});
          fs.writeFileSync(preferencesFile+'.tmp',JSON.stringify({language:p.language}));fs.renameSync(preferencesFile+'.tmp',preferencesFile);uiLanguage=p.language;
          return send(200,{language:uiLanguage});
        }
        if(req.method==='GET'&&url.pathname==='/api/state'){clearTimeout(clientClosedTimer);return send(200,publicState());}
        if(req.method==='GET'&&url.pathname.startsWith('/api/report/')){
          const name=url.pathname.slice('/api/report/'.length);if(!REPORTS.has(name))return send(404,{error:'التقرير غير موجود.'});
          const report=readReport(name);if(report===null)return send(404,{error:'التقرير غير موجود.'});
          res.setHeader('Content-Disposition',`attachment; filename="${name}"`);return send(200,redact(report),TYPES[path.extname(name)]);
        }
        if(req.method==='POST'&&url.pathname==='/api/action'){
          if(!/^application\/json(?:;|$)/i.test(String(req.headers['content-type']??'')))return send(415,{error:'يلزم طلب JSON.'});
          let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>3*1024*1024){send(413,{error:'الطلب كبير جداً.'});req.resume();return;}parts.push(part);}
          let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return send(size>MAX_BODY?413:400,{error:size>MAX_BODY?'الطلب كبير جداً.':'JSON غير صالح.'});}
          if(size>MAX_BODY&&body?.action!=='message-preview')return send(413,{error:'الطلب كبير جداً.'});
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
    await Promise.allSettled([job?.stop(),presenceWorker?.stop(),presenceStopping,credentialTask]);job=null;presenceWorker=null;credentials={token:'',guildId:''};secrets.clear();
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
