import {ROLES,CATEGORIES,ROLE_MIGRATIONS} from './design.mjs';
import {P} from './permissions.mjs';
import {isLeadershipRole} from './safety.mjs';
export const defaultDesign=()=>({version:1,language:'ar',roles:structuredClone(ROLES),categories:structuredClone(CATEGORIES),migrations:{...ROLE_MIGRATIONS}});
export function validateCustomDesign(input){
  if(!input||JSON.stringify(input).length>200000)throw new Error('القالب غير صالح أو يتجاوز 200 ألف حرف.');
  const keys=(v,list)=>{if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).some(k=>!list.includes(k)))throw new Error('حقول القالب غير صالحة.');};
  const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/u.test(v))throw new Error('اسم غير صالح في القالب.');return v.trim();};
  const key=v=>{if(typeof v!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(v)||Object.hasOwn(Object.prototype,v)||['prototype','leadership'].includes(v))throw new Error('معرّف عنصر غير صالح.');};
  const names=new Set(),roleKeys=new Set(),catKeys=new Set(),channelKeys=new Set(),catNames=new Set(),channelNames=new Set();
  const unique=(set,v)=>{if(set.has(v))throw new Error('يوجد اسم أو معرّف مكرر في القالب: '+v);set.add(v);};
  const norm=v=>v.normalize('NFKC').toLowerCase();
  const integer=(n,min,max)=>{if(!Number.isInteger(n)||n<min||n>max)throw new Error('قيمة رقمية غير صالحة في القالب.');};
  const bool=(v)=>{if(v!==undefined&&typeof v!=='boolean')throw new Error('قيمة خيار غير صالحة في القالب.');};
  keys(input,['version','language','roles','categories','migrations']);
  if(input.version!==1||!['ar','en'].includes(input.language)||!Array.isArray(input.roles)||input.roles.length<1||input.roles.length>50||!Array.isArray(input.categories)||input.categories.length<1||input.categories.length>40)throw new Error('يحتاج القالب رتبًا وأقسامًا صالحة. الحد 50 رتبة و40 قسمًا.');
  const d=structuredClone(input);
  for(const r of d.roles){keys(r,['key','name','color','permissions','hoist','mentionable']);key(r.key);unique(roleKeys,r.key);r.name=text(r.name,100);unique(names,norm(r.name));if(isLeadershipRole(r)||r.name==='@everyone')throw new Error('لا يمكن إدراج رتب القيادة أو everyone في القالب.');integer(r.color,0,0xffffff);bool(r.hoist);bool(r.mentionable);if(!Array.isArray(r.permissions)||new Set(r.permissions).size!==r.permissions.length||r.permissions.some(n=>!Object.hasOwn(P,n)))throw new Error('صلاحيات رتبة غير صالحة.');}
  const access=values=>{if(!Array.isArray(values)||new Set(values).size!==values.length||values.some(k=>!roleKeys.has(k)||k==='muted'))throw new Error('اختر رتب وصول موجودة في القالب.');};
  let channels=0;
  for(const c of d.categories){keys(c,['key','name','access','staffKeys','channels']);key(c.key);unique(catKeys,c.key);c.name=text(c.name,100);unique(catNames,norm(c.name));if(!['public','staff'].includes(c.access)||!Array.isArray(c.channels)||c.channels.length>50)throw new Error('قسم أو وصول غير صالح.');if(c.staffKeys!==undefined)access(c.staffKeys);if(c.access==='staff'&&!c.staffKeys?.length)throw new Error('القسم الخاص يحتاج رتبة وصول واحدة على الأقل.');
    for(const ch of c.channels){keys(ch,['key','name','type','readonly','topic','message','slowmode','userLimit','vipOnly','private','accessKeys','readonlyWriters']);key(ch.key);unique(channelKeys,ch.key);if(!['text','voice'].includes(ch.type))throw new Error('نوع غرفة غير صالح.');ch.name=text(ch.name,100);if(ch.type==='text')ch.name=ch.name.toLowerCase().replace(/\s+/gu,'-');unique(channelNames,norm(ch.name));bool(ch.readonly);bool(ch.vipOnly);bool(ch.private);if(ch.private&&!ch.accessKeys?.length)throw new Error('الغرفة الخاصة تحتاج رتبة وصول واحدة على الأقل.');if(ch.vipOnly&&!roleKeys.has('vip'))throw new Error('غرفة VIP تحتاج رتبة vip في القالب.');if(ch.accessKeys!==undefined)access(ch.accessKeys);if(ch.readonlyWriters!==undefined)access(ch.readonlyWriters);if(ch.slowmode!==undefined)integer(ch.slowmode,0,21600);if(ch.userLimit!==undefined)integer(ch.userLimit,0,99);for(const [field,max]of [['topic',1024],['message',2000]])if(ch[field]!==undefined&&(typeof ch[field]!=='string'||ch[field].length>max))throw new Error('وصف أو رسالة افتتاحية أطول من الحد المسموح.');channels++;}
  }
  if(channels<1||channels>200)throw new Error('القالب يحتاج من غرفة واحدة إلى 200 غرفة.');
  keys(d.migrations??{},Object.keys(d.migrations??{}));d.migrations??={};
  for(const [id,target]of Object.entries(d.migrations))if(!/^\d{16,22}$/.test(id)||!roleKeys.has(target))throw new Error('ربط نقل أعضاء غير صالح.');
  return d;
}
export function designTemplate(language){
  const d=defaultDesign();d.language=language;
  const arabic=['الإدارة','كبير المشرفين','مشرف','فريق الدعم','منظّم فعاليات','صانع محتوى','مميز','لاعب','موثّق','عضو','مقيّد'];
  if(language==='ar'){d.roles.forEach((r,i)=>r.name=r.name.split('・')[0]+'・'+arabic[i]);for(const c of d.categories)for(const ch of c.channels)for(const field of ['topic','message'])if(ch[field])ch[field]=ch[field].replaceAll('Real Friends','مجتمعنا');d.categories[0].channels.find(ch=>ch.key==='roles').message='**دليل الرتب**\n'+d.roles.map(r=>r.name).join('\n')+'\nتوزيع الرتب يتم من إدارة السيرفر.';return d;}
  const categories=['Welcome','Community','Gaming Hub','Voice Lounges','Support Center','Staff HQ','Staff Logs'];
  const channels=['welcome','rules','announcements','role-guide','faq','general-chat','introductions','media','memes','suggestions','polls','gaming-chat','counter-strike','pubg-mobile','fortnite','find-a-squad','highlights','General Lounge','Gaming Team 01','Gaming Team 02','Chill Lounge','VIP Lounge','AFK','support','report-guide','server-help','staff-chat','staff-tasks','Staff Meeting','moderation-notes','security-notes'];
  let i=0;d.categories.forEach((c,j)=>{c.name=c.name.slice(0,c.name.indexOf('•')+1)+' '+categories[j];c.channels.forEach(ch=>{const label=channels[i++];ch.name=ch.name.split('・')[0]+'・'+label;ch.topic=ch.type==='text'?label.replaceAll('-',' ')+' · Community space':'';delete ch.message;});});
  d.categories[0].channels[0].message='**Welcome to our community!** 🎮\nRead the rules, introduce yourself and enjoy your stay.';
  d.categories[0].channels[1].message='**Community Rules** 📜\n1. Respect everyone. No harassment or hate speech.\n2. No spam, scams or malicious links.\n3. Respect privacy and use the right channels.\n4. Follow staff guidance and Discord Community Guidelines.';
  return validateCustomDesign(d);
}
