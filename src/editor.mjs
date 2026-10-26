import fs from 'node:fs';
import path from 'node:path';
import {snapshot} from './api.mjs';
import {P,has,botPermissions,botTopPosition,canManageChannel} from './permissions.mjs';
import {digest,fingerprint,configuration,roleProtection,protectedChannelIds,isLeadershipRole} from './safety.mjs';
import {messageProtection} from './messages.mjs';

export const CHANNEL_PERMISSIONS=['ViewChannel','SendMessages','ReadMessageHistory','AddReactions','EmbedLinks','AttachFiles','Connect','Speak','MoveMembers','ManageMessages','ManageChannels','ManageThreads','CreatePublicThreads','CreatePrivateThreads','SendMessagesInThreads'];
const roleFields=r=>({id:r.id,name:r.name,color:r.colors?.primary_color??r.color??0,permissions:r.permissions,position:r.position,hoist:!!r.hoist,mentionable:!!r.mentionable,managed:!!r.managed,tags:r.tags??{}});
const guildFields=g=>({id:g.id,name:g.name,icon:g.icon??null});
export const guildIconURL=g=>/^\d{16,22}$/.test(g.id)&&/^(?:a_)?[a-f0-9]{32}$/.test(g.icon??'')?`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128`:null;
const channelFields=c=>({id:c.id,name:c.name,type:c.type,position:c.position??0,parent_id:c.parent_id??null,topic:c.topic??'',rate_limit_per_user:c.rate_limit_per_user??0,user_limit:c.user_limit??0,permission_overwrites:[...(c.permission_overwrites??[])].sort((a,b)=>a.id.localeCompare(b.id))});
const normalizedName=(name,type)=>{const value=String(name).normalize('NFKC').trim().toLowerCase();return type===0?value.replace(/\s+/g,'-'):value;};
export const revision=(kind,item)=>digest(kind==='guild'?guildFields(item):kind==='role'?roleFields(item):channelFields(item));
export function channelProtection(s,c) {
  const protectedIds=protectedChannelIds(s);
  for(const child of s.channels.filter(x=>protectedIds.has(x.id)&&x.parent_id))protectedIds.add(child.parent_id);
  if(protectedIds.has(c.id))return 'قناة محمية أو قسم تابع لقناة محمية';
  if(![0,2,4].includes(c.type))return 'هذا النوع متاح للعرض فقط';
  if(!canManageChannel(s,c))return 'صلاحيات البوت لا تسمح بإدارة هذه القناة';
  return null;
}
export function serverInventory(s) {
  const botBits=botPermissions(s);
  const topRole=s.roles.find(r=>s.botMember.roles.includes(r.id)&&r.position===botTopPosition(s));
  const statistics=s.memberStatistics??(s.membersComplete?{total:s.members.length,totalApproximate:false,roles:Object.fromEntries(s.roles.filter(r=>r.id!==s.guild.id).map(r=>[r.id,s.members.filter(m=>m.roles.includes(r.id)).length]))}:{total:null,totalApproximate:false,roles:null});
  return {guildId:s.guild.id,guildName:s.guild.name,capturedAt:s.captured_at,
    guildProfile:{...guildFields(s.guild),iconURL:guildIconURL(s.guild),revision:revision('guild',s.guild),readOnlyReason:has(botBits,P.ManageGuild)?null:'تغيير اسم السيرفر يحتاج صلاحية Manage Server للبوت.'},
    memberStatistics:{total:statistics.total,totalApproximate:statistics.totalApproximate,roleCountsAvailable:statistics.roles!==null},
    botRole:topRole?{id:topRole.id,name:topRole.name,position:topRole.position}:null,
    permissions:Object.entries(P).map(([name,flag])=>({name,granted:has(botBits,flag)})),
    channelPermissionNames:CHANNEL_PERMISSIONS,
    roles:[...s.roles].sort((a,b)=>b.position-a.position).map(r=>({...roleFields(r),memberCount:r.id===s.guild.id?statistics.total:statistics.roles?.[r.id]??null,memberCountApproximate:r.id===s.guild.id&&statistics.totalApproximate,revision:revision('role',r),readOnlyReason:roleProtection(s,r),
      flags:Object.entries(P).map(([name,flag])=>({name,granted:(BigInt(r.permissions)&flag)!==0n,canGrant:has(botBits,flag)}))})),
    channels:[...s.channels].sort((a,b)=>(a.position??0)-(b.position??0)).map(c=>({...channelFields(c),revision:revision('channel',c),readOnlyReason:channelProtection(s,c),moveReadOnlyReason:channelProtection(s,c)||(c.parent_id&&channelProtection(s,s.channels.find(parent=>parent.id===c.parent_id)??c)?'القسم محمي؛ النقل معطّل':null),messageReadOnlyReason:messageProtection(s,c),
      overwrites:(c.permission_overwrites??[]).map(w=>({...w,flags:CHANNEL_PERMISSIONS.map(name=>({name,state:(BigInt(w.allow)&P[name])!==0n?'allow':(BigInt(w.deny)&P[name])!==0n?'deny':'inherit'}))}))})),
  };
}
function text(value,max,label) {if(typeof value!=='string'||value.length>max||!value.trim())throw new Error(`قيمة غير صالحة: ${label}`);return value.trim();}
function integer(value,min,max,label) {if(!Number.isInteger(value)||value<min||value>max)throw new Error(`قيمة غير صالحة: ${label}`);return value;}
function knownKeys(value,allowed) {if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!allowed.includes(k)))throw new Error('حقول تعديل غير مسموح بها');}
const sourceDigest=()=>digest(fs.readdirSync(new URL('.',import.meta.url)).filter(f=>f.endsWith('.mjs')).sort().map(f=>[f,fs.readFileSync(new URL(f,import.meta.url),'utf8')]));

const snowflakeOrder=(a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0;
const channelBucket=c=>c.type===4?'category':[2,13].includes(c.type)?'voice':'text';
function prepareMove(s,request){
  const {kind,id,values}=request;if(!['role','channel'].includes(kind))throw new Error('نوع نقل غير مسموح');
  knownKeys(values,['target_id','placement']);
  if(Object.keys(request.permissionChanges??{}).length||Object.keys(request.overwriteChanges??{}).length)throw new Error('النقل لا يعدّل الصلاحيات');
  if(!['before','after','inside'].includes(values.placement)||typeof values.target_id!=='string'||id===values.target_id)throw new Error('وجهة نقل غير صالحة');
  const items=kind==='role'?s.roles:s.channels,source=items.find(x=>x.id===id),target=items.find(x=>x.id===values.target_id);
  if(!source||!target)throw new Error('العنصر أو وجهة النقل غير موجودة؛ حدّث السيرفر');
  if(revision(kind,source)!==request.revision)throw new Error('تغير العنصر منذ تحميله؛ حدّث السيرفر قبل التعديل');
  const protect=x=>kind==='role'?roleProtection(s,x):channelProtection(s,x),bits=botPermissions(s);
  if(!has(bits,kind==='role'?P.ManageRoles:P.ManageChannels))throw new Error('البوت لا يملك صلاحية ترتيب العناصر');
  if(protect(source)||protect(target))throw new Error('العنصر أو الوجهة محمية ولا يمكن نقلها');
  let siblings,parentId=source.parent_id??null;
  if(kind==='role'){
    if(values.placement==='inside')throw new Error('لا يمكن وضع رتبة داخل رتبة');
    siblings=[...items].sort((a,b)=>b.position-a.position||snowflakeOrder(a,b));
  }else{
    if(values.placement==='inside'){
      if(source.type===4||target.type!==4)throw new Error('اختر قسمًا لنقل الغرفة إليه');parentId=target.id;
    }else{
      if(channelBucket(source)!==channelBucket(target))throw new Error('رتّب الغرف النصية مع النصية والصوتية مع الصوتية');parentId=target.parent_id??null;
    }
    for(const parent of [source.parent_id,parentId].filter(Boolean)){
      const category=s.channels.find(c=>c.id===parent);if(!category||protect(category))throw new Error('القسم محمي أو غير متاح للنقل');
    }
    if(parentId!==source.parent_id&&parentId&&s.channels.filter(c=>c.parent_id===parentId).length>=50)throw new Error('القسم المحدد ممتلئ');
    if(items.some(c=>c.id!==source.id&&c.type===source.type&&(c.parent_id??null)===parentId&&normalizedName(c.name,c.type)===normalizedName(source.name,source.type)))throw new Error('توجد قناة بنفس الاسم في القسم المحدد');
    siblings=items.filter(c=>channelBucket(c)===channelBucket(source)&&(source.type===4||(c.parent_id??null)===parentId)).sort((a,b)=>(a.position??0)-(b.position??0)||snowflakeOrder(a,b));
  }
  const ordered=siblings.filter(x=>x.id!==id);let index=values.placement==='inside'?ordered.length:ordered.findIndex(x=>x.id===target.id)+(values.placement==='after'?1:0);
  if(index<0)throw new Error('وجهة نقل غير صالحة');ordered.splice(index,0,source);
  const sameParent=kind==='role'||parentId===(source.parent_id??null),slots=siblings.map(x=>x.position??0);
  // Keep protected positions and relative hierarchy fixed. Moving across a
  // protected role/category would otherwise change it indirectly.
  const useSlots=sameParent&&new Set(slots).size===slots.length;
  const body=ordered.flatMap((item,i)=>{
    const position=useSlots?slots[i]:kind==='role'?ordered.length-1-i:i;
    const parentChanged=item.id===id&&kind==='channel'&&parentId!==(source.parent_id??null);
    if((item.position??0)===position&&!parentChanged&&siblings[i]?.id===item.id)return [];
    if(protect(item))throw new Error('لا يمكن عبور رتبة أو عنصر محمي أثناء الترتيب');
    if(!Number.isInteger(position)||position<0||kind==='role'&&position>=botTopPosition(s))throw new Error('الموضع المطلوب أعلى من صلاحيات البوت');
    return [{id:item.id,position,...(parentChanged?{parent_id:parentId}: {})}];
  });
  if(!body.length)throw new Error('العنصر موجود في هذا الموضع بالفعل');
  const before=kind==='role'?roleFields(source):channelFields(source),nameOf=id=>s.channels.find(c=>c.id===id)?.name??'بدون قسم';
  const move={kind,items:body,targetName:target.name,placement:values.placement,oldParentName:nameOf(source.parent_id),parentName:nameOf(parentId)};
  const p={guildId:s.guild.id,guildName:s.guild.name,kind,action:'move',id,request,before,body,move,changes:body.map(item=>({field:'position',id:item.id,before:items.find(x=>x.id===item.id)?.position??0,after:item.position})),snapshotHash:fingerprint(s),sourceHash:sourceDigest()};
  return {...p,approvalHash:digest(p)};
}

export function prepareEdit(s,request) {
  knownKeys(request,['kind','action','id','revision','values','permissionChanges','overwriteChanges']);
  if(request.action==='move')return prepareMove(s,request);
  const {kind,action}=request;
  if(!['role','channel','guild'].includes(kind)||!['create','update'].includes(action)||kind==='guild'&&action!=='update')throw new Error('عملية تعديل غير مسموح بها');
  const existing=action==='update'?(kind==='guild'?[s.guild]:kind==='role'?s.roles:s.channels).find(x=>x.id===request.id):null;
  if(action==='update'&&!existing)throw new Error('العنصر غير موجود؛ حدّث السيرفر');
  if(existing&&revision(kind,existing)!==request.revision)throw new Error('تغير العنصر منذ تحميله؛ حدّث السيرفر قبل التعديل');
  const botBits=botPermissions(s),values=request.values??{},body={};
  let permissions=0n;
  if(kind==='guild'){
    if(!has(botBits,P.ManageGuild))throw new Error('تغيير اسم السيرفر يحتاج صلاحية Manage Server للبوت.');
    knownKeys(values,['name']);body.name=text(values.name,100,'اسم السيرفر');
    if(body.name.length<2)throw new Error('اسم السيرفر يجب أن يكون من حرفين إلى 100 حرف.');
    if(Object.keys(request.permissionChanges??{}).length||Object.keys(request.overwriteChanges??{}).length)throw new Error('تخصيص السيرفر يقتصر على الاسم.');
  } else if(kind==='role') {
    if(!has(botBits,P.ManageRoles))throw new Error('البوت لا يملك Manage Roles');
    if(existing&&roleProtection(s,existing))throw new Error('هذه الرتبة محمية ولا يمكن تعديلها');
    knownKeys(values,['name','color','hoist','mentionable']);
    if('name' in values)body.name=text(values.name,100,'اسم الرتبة');
    if(!existing&&!body.name)throw new Error('اسم الرتبة مطلوب');
    if(body.name&&isLeadershipRole({name:body.name}))throw new Error('لا يمكن إنشاء أو إعادة تسمية رتبة قيادة محمية');
    if(s.roles.some(r=>r.id!==existing?.id&&normalizedName(r.name)===normalizedName(body.name??existing?.name)))throw new Error('توجد رتبة بنفس الاسم');
    if(!existing&&s.roles.length>=250)throw new Error('وصل السيرفر إلى حد الرتب');
    if('color' in values)body.color=integer(values.color,0,0xffffff,'لون الرتبة');
    for(const key of ['hoist','mentionable'])if(key in values){if(typeof values[key]!=='boolean')throw new Error('قيمة غير صالحة');body[key]=values[key];}
    permissions=BigInt(existing?.permissions??'0');
    const changes=request.permissionChanges??{};knownKeys(changes,Object.keys(P));
    for(const [name,value] of Object.entries(changes)) {
      if(typeof value!=='boolean')throw new Error('قيمة صلاحية غير صالحة');
      if(value&&!has(botBits,P[name]))throw new Error(`لا يستطيع البوت منح ${name}`);
      permissions=value?permissions|P[name]:permissions&~P[name];
    }
    if(!existing||Object.keys(changes).length)body.permissions=String(permissions);
    if(request.overwriteChanges?.length)throw new Error('أذونات القناة لا تستخدم في تعديل الرتب');
  } else {
    if(!has(botBits,P.ManageChannels))throw new Error('البوت لا يملك Manage Channels');
    if(existing&&channelProtection(s,existing))throw new Error('هذه القناة أو القسم محمي ولا يمكن تعديله');
    knownKeys(values,['name','type','parent_id','topic','rate_limit_per_user','user_limit']);
    const type=existing?.type??values.type;
    if(![0,2,4].includes(type)||existing&&'type' in values&&values.type!==existing.type)throw new Error('لا يمكن تغيير نوع قناة موجودة');
    if(!existing)body.type=type;
    if('name' in values)body.name=text(values.name,100,'اسم القناة');
    if(!existing&&!body.name)throw new Error('اسم القناة مطلوب');
    let parent=existing?.parent_id??null;
    if('parent_id' in values) {
      parent=values.parent_id||null;
      if(type===4&&parent!==null)throw new Error('لا يمكن وضع قسم داخل قسم');
      if(parent&&!s.channels.some(c=>c.id===parent&&c.type===4&&canManageChannel(s,c)))throw new Error('القسم المحدد غير متاح للبوت');
      body.parent_id=parent;
    }
    if(s.channels.some(c=>c.id!==existing?.id&&c.type===type&&normalizedName(c.name,type)===normalizedName(body.name??existing?.name,type)&&(c.parent_id??null)===parent))throw new Error('توجد قناة بنفس الاسم في هذا القسم');
    if(!existing&&s.channels.length>=500)throw new Error('وصل السيرفر إلى حد القنوات');
    if(parent&&parent!==existing?.parent_id&&s.channels.filter(c=>c.parent_id===parent).length>=50)throw new Error('القسم المحدد ممتلئ');
    if('topic' in values) {if(type!==0||typeof values.topic!=='string'||values.topic.length>1024)throw new Error('وصف غير صالح');body.topic=values.topic;}
    if('rate_limit_per_user' in values) {if(type!==0)throw new Error('Slowmode للقنوات النصية فقط');body.rate_limit_per_user=integer(values.rate_limit_per_user,0,21600,'Slowmode');}
    if('user_limit' in values) {if(type!==2)throw new Error('حد الأعضاء للقنوات الصوتية فقط');body.user_limit=integer(values.user_limit,0,99,'حد الأعضاء');}
    if(Object.keys(request.permissionChanges??{}).length)throw new Error('استخدم أذونات القناة بدلاً من صلاحيات الرتبة');
    const changes=request.overwriteChanges??[];
    if(!Array.isArray(changes))throw new Error('أذونات قناة غير صالحة');
    if(changes.length&&!has(botBits,P.ManageRoles))throw new Error('تعديل أذونات القناة يحتاج Manage Roles');
    const base=existing?.permission_overwrites??s.channels.find(c=>c.id===parent)?.permission_overwrites??[];
    const overwrites=structuredClone(base);
    const seen=new Set();
    for(const change of changes) {
      knownKeys(change,['roleId','permissions']);
      if(seen.has(change.roleId))throw new Error('تكرار رتبة في أذونات القناة');seen.add(change.roleId);
      const role=s.roles.find(r=>r.id===change.roleId);
      if(!role||isLeadershipRole(role)||role.managed||s.botMember.roles.includes(role.id))throw new Error('أذونات القيادة والبوت والتكاملات محفوظة ولا تعدّل من هذا المحرر');
      knownKeys(change.permissions,CHANNEL_PERMISSIONS);
      let overwrite=overwrites.find(w=>w.id===role.id&&w.type===0);
      const existed=!!overwrite;
      if(!overwrite)overwrite={id:role.id,type:0,allow:'0',deny:'0'};
      let allow=BigInt(overwrite.allow),deny=BigInt(overwrite.deny);
      for(const [name,state] of Object.entries(change.permissions)) {
        if(!['inherit','allow','deny'].includes(state))throw new Error('قيمة إذن قناة غير صالحة');
        if(!has(botBits,P[name]))throw new Error(`لا يستطيع البوت ضبط ${name}`);
        allow&=~P[name];deny&=~P[name];if(state==='allow')allow|=P[name];if(state==='deny')deny|=P[name];
      }
      overwrite.allow=String(allow);overwrite.deny=String(deny);
      if(!existed&&(allow!==0n||deny!==0n))overwrites.push(overwrite);
    }
    if(changes.length||!existing)body.permission_overwrites=overwrites.sort((a,b)=>a.id.localeCompare(b.id));
    const candidate={...existing,...body,type};
    if(!canManageChannel(s,candidate))throw new Error('التعديل سيمنع البوت من إدارة القناة؛ عدّل الأذونات أولاً');
  }
  const before=existing?(kind==='guild'?guildFields(existing):kind==='role'?roleFields(existing):channelFields(existing)):null;
  const fields=Object.entries(body).filter(([key,value])=>JSON.stringify(before?.[key])!==JSON.stringify(value));
  if(!fields.length)throw new Error('لا توجد تغييرات لحفظها');
  const plan={guildId:s.guild.id,guildName:s.guild.name,kind,action,id:existing?.id??null,request,before,body,
    overwriteRoleNames:Object.fromEntries((request.overwriteChanges??[]).map(change=>[change.roleId,s.roles.find(r=>r.id===change.roleId)?.name])),
    parentNames:Object.fromEntries(s.channels.filter(c=>c.type===4).map(c=>[c.id,c.name])),
    childChannels:kind==='channel'&&existing?.type===4?s.channels.filter(c=>c.parent_id===existing.id).map(c=>c.name):[],
    snapshotHash:fingerprint(s),sourceHash:sourceDigest(),changes:fields.map(([field,after])=>({field,before:before?.[field]??null,after}))};
  return {...plan,approvalHash:digest(plan)};
}
export function editSummary(p) {
  if(p.action==='move')return [`السيرفر: ${p.guildName} (${p.guildId})`,`نقل: ${p.before.name}`,`الوجهة: ${p.move.targetName}`,`الموضع: ${{before:'قبل العنصر',after:'بعد العنصر',inside:'داخل القسم'}[p.move.placement]}`,...(p.kind==='channel'?[`القسم الحالي: ${p.move.oldParentName}`,`القسم الجديد: ${p.move.parentName}`,'تبقى أذونات القناة الحالية محفوظة؛ لا تتم مزامنتها مع القسم.']:['تبقى صلاحيات الرتب وأعضاؤها ثابتة. لا تتغير رتب القيادة أو البوتات المحمية.']),`عناصر يتغير ترتيبها: ${p.body.length}`,'لا حذف أو إنشاء أو تغيير أعضاء ضمن هذه العملية.'].join('\n');
  const labels={name:'الاسم',color:'اللون',hoist:'عرض منفصل',mentionable:'قابلة للمنشن',type:'نوع القناة',parent_id:'القسم',topic:'الوصف',rate_limit_per_user:'التهدئة بالثواني',user_limit:'حد الأعضاء'};
  const display=value=>value===null?'بدون':typeof value==='boolean'?(value?'نعم':'لا'):String(value);
  const fieldValue=(field,value)=>field==='parent_id'&&value?(p.parentNames[value]??value):field==='color'&&value!==null?'#'+Number(value).toString(16).padStart(6,'0'):field==='type'&&value!==null?({0:'نصية',2:'صوتية',4:'قسم'}[value]??display(value)):display(value);
  return [`السيرفر: ${p.guildName} (${p.guildId})`,`${p.action==='create'?'إنشاء':'تعديل'} ${p.kind==='guild'?'اسم السيرفر':p.kind==='role'?'رتبة':'قناة / قسم'}: ${p.body.name??p.before.name}`,
    ...p.changes.filter(c=>!['permissions','permission_overwrites'].includes(c.field)).map(c=>`${labels[c.field]??c.field}: ${fieldValue(c.field,c.before)} → ${fieldValue(c.field,c.after)}`),
    ...Object.entries(p.request.permissionChanges??{}).map(([name,granted])=>`صلاحية ${name}: ${granted?'تفعيل':'إيقاف'}`),
    ...(p.request.overwriteChanges??[]).flatMap(change=>Object.entries(change.permissions).map(([name,state])=>`أذونات ${p.overwriteRoleNames[change.roleId]} / ${name}: ${{inherit:'وراثة',allow:'سماح',deny:'منع'}[state]}`)),
    ...(p.kind==='role'&&Object.keys(p.request.permissionChanges??{}).length?['تعديل صلاحيات الرتبة ينعكس على الأعضاء الحاملين لها؛ توزيع الرتب لا يتغير.']:[]),
    ...(p.kind==='channel'&&p.action==='update'&&p.changes.some(c=>c.field==='parent_id')?['نقل القناة يحافظ على أذوناتها الحالية؛ راجع أذونات القناة قبل الحفظ.']:[]),
    ...(p.childChannels.length&&p.request.overwriteChanges?.length?['قنوات داخل القسم؛ راجع أذوناتها المتزامنة بعد الحفظ: '+p.childChannels.join('، ')]:[]),
    'لا توجد عمليات حذف أو تعديل أعضاء ضمن هذه الخطة.'].join('\n');
}
export async function previewEdit(api,guildId,request,directory) {
  const s=await snapshot(api,guildId,{includeMembers:false}),p=prepareEdit(s,request);
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'edit-snapshot.json'),JSON.stringify(s,null,2));
  fs.writeFileSync(path.join(directory,'edit-plan.json'),JSON.stringify(p,null,2));
  fs.writeFileSync(path.join(directory,'edit-preview.txt'),editSummary(p));return p;
}
export async function applyEdit(api,guildId,confirmation,directory) {
  if(confirmation.confirmed!==true||confirmation.guildId!==guildId)throw new Error('يجب تأكيد حفظ التعديل للسيرفر المحدد');
  const reviewed=JSON.parse(fs.readFileSync(path.join(directory,'edit-plan.json'),'utf8'));
  if(reviewed.approvalHash!==confirmation.approvalHash||reviewed.guildId!==guildId)throw new Error('خطة التعديل لا تطابق التأكيد');
  const conflict=(reason,message,details={})=>{
    fs.writeFileSync(path.join(directory,'edit-conflict.json'),JSON.stringify({reason,message,...details},null,2));
    return Object.assign(new Error(message),{code:'EDIT_CONFLICT'});
  };
  if(reviewed.sourceHash!==sourceDigest())throw conflict('source_changed','تحدّث كود البرنامج بعد المعاينة. اضغط «معاينة التعديل» مجددًا ثم أكّد الحفظ.');
  const current=await snapshot(api,guildId,{includeMembers:false});
  let fresh;
  try {fresh=prepareEdit(current,reviewed.request);}
  catch(error) {
    if(/تغير العنصر/.test(error.message))throw conflict('entity_changed','تغيّرت بيانات العنصر المحدد في Discord. حدّث السيرفر ثم راجع تعديلك مجددًا.');
    throw error;
  }
  if(fresh.approvalHash!==reviewed.approvalHash) {
    let changedSections=[];
    try {const previous=configuration(JSON.parse(fs.readFileSync(path.join(directory,'edit-snapshot.json'),'utf8'))),now=configuration(current);changedSections=Object.keys(now).filter(key=>digest(previous[key])!==digest(now[key]));}catch{}
    const labels={guild:'إعدادات السيرفر',roles:'الرتب أو صلاحياتها',channels:'القنوات أو أذوناتها',botRoles:'رتب البوت',bot:'هوية البوت',members:'توزيع الأعضاء',membersComplete:'جرد الأعضاء'};
    const details=changedSections.map(key=>labels[key]??key).join('، ');
    throw conflict('configuration_changed',`تغيّرت ${details||'خطة التعديل'} منذ المعاينة. اضغط «معاينة التعديل» مجددًا وراجع الفرق قبل الحفظ.`,{changedSections});
  }
  const backup=path.join(directory,'edit-backups',new Date().toISOString().replaceAll(':','-')+'-'+fresh.approvalHash.slice(0,8));
  fs.mkdirSync(backup,{recursive:true});
  fs.writeFileSync(path.join(backup,'snapshot.json'),JSON.stringify(current,null,2));
  fs.writeFileSync(path.join(backup,'plan.json'),JSON.stringify(fresh,null,2));
  const route=fresh.action==='move'?`/guilds/${guildId}/${fresh.kind==='role'?'roles':'channels'}`:fresh.kind==='guild'?`/guilds/${guildId}`:fresh.kind==='role'?`/guilds/${guildId}/roles${fresh.action==='update'?'/'+fresh.id:''}`:fresh.action==='create'?`/guilds/${guildId}/channels`:`/channels/${fresh.id}`;
  const result={success:false,guildId,approvalHash:fresh.approvalHash,method:fresh.action==='create'?'POST':'PATCH',route};
  try {result.entity=await api.call(result.method,route,fresh.body);result.success=true;return result;}
  catch(error){result.error=error.message;throw error;}
  finally {fs.writeFileSync(path.join(directory,'edit-result.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(backup,'result.json'),JSON.stringify(result,null,2));}
}
