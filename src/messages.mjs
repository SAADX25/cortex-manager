import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {snapshot} from './api.mjs';
import {digest} from './safety.mjs';
import {P,has,effectiveChannelPermissions} from './permissions.mjs';
import {validateMessageImage} from './message-image.mjs';

export function messageProtection(s,c){
  if(![0,2,5].includes(c.type))return 'اختر قناة نصية أو صوتية موجودة لإرسال الرسالة؛ لا يمكن النشر داخل قسم.';
  const b=effectiveChannelPermissions(s,c);
  if(!has(b,P.ViewChannel)||!has(b,P.SendMessages))return 'يحتاج البوت صلاحيتَي عرض القناة وإرسال الرسائل داخل هذه الغرفة.';
  if(c.type===2&&!has(b,P.Connect))return 'يحتاج البوت صلاحية الاتصال بهذه الغرفة الصوتية.';
  return null;
}
const sourceHash=()=>digest(fs.readdirSync(new URL('.',import.meta.url)).filter(f=>f.endsWith('.mjs')).sort().map(f=>[f,fs.readFileSync(new URL(f,import.meta.url),'utf8')]));
function validateEmbeds(embeds){
  if(!Array.isArray(embeds)||!embeds.length||embeds.length>10)throw new Error('استخدم من 1 إلى 10 بطاقات Embed.');
  let total=0;
  const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`نص البطاقة مطلوب وحدّه ${max} حرف.`);total+=v.length;};
  const keys=(v,allowed)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw new Error('حقول تصميم البطاقة غير مسموح بها.');};
  for(const e of embeds){
    keys(e,['title','description','color','fields','footer']);
    if(!e.title&&!e.description&&!e.fields?.length)throw new Error('البطاقة فارغة.');
    if(e.title!==undefined)text(e.title,256);if(e.description!==undefined)text(e.description,4096);
    if(e.color!==undefined&&(!Number.isInteger(e.color)||e.color<0||e.color>0xffffff))throw new Error('لون البطاقة يجب أن يكون رقمًا من 0 إلى 16777215.');
    if(e.fields!==undefined){if(!Array.isArray(e.fields)||e.fields.length>25)throw new Error('الحد الأقصى 25 فقرة لكل بطاقة.');for(const f of e.fields){keys(f,['name','value','inline']);text(f.name,256);text(f.value,1024);if(f.inline!==undefined&&typeof f.inline!=='boolean')throw new Error('inline يجب أن تكون true أو false.');}}
    if(e.footer!==undefined){keys(e.footer,['text']);text(e.footer.text,2048);}
  }
  if(total>6000)throw new Error('مجموع نصوص البطاقات يتجاوز 6000 حرف.');
}
export function prepareMessage(s,request,nonce){
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['channelId','content','embeds','image'].includes(k)))throw new Error('حقول الرسالة غير مسموح بها.');
  if(typeof request.channelId!=='string'||!/^\d{16,22}$/.test(request.channelId))throw new Error('اختر الغرفة المراد النشر فيها.');
  if(typeof request.content!=='string'||request.content.length>2000||(!request.content.trim()&&request.embeds===undefined))throw new Error('اكتب رسالة من 1 إلى 2000 حرف أو أضف بطاقة Embed.');
  if(request.embeds!==undefined)validateEmbeds(request.embeds);
  const image=request.image!==undefined?validateMessageImage(request.image):null;
  const channel=s.channels.find(c=>c.id===request.channelId);
  if(!channel)throw new Error('الغرفة غير موجودة في السيرفر المحدد؛ حدّث بيانات السيرفر.');
  const protection=messageProtection(s,channel);if(protection)throw new Error(protection);
  if(image&&!has(effectiveChannelPermissions(s,channel),P.AttachFiles))throw new Error('يحتاج البوت صلاحية إرفاق الملفات (Attach Files) لإرسال الصورة في هذه الغرفة.');
  if(request.embeds&&!has(effectiveChannelPermissions(s,channel),P.EmbedLinks))throw new Error('يحتاج البوت صلاحية تضمين الروابط (Embed Links) لنشر البطاقات في هذه الغرفة.');
  if(typeof nonce!=='string'||!/^[a-f0-9]{24}$/.test(nonce))throw new Error('معرّف مراجعة الرسالة غير صالح.');
  const plan={guildId:s.guild.id,guildName:s.guild.name,botId:s.bot.id,channelId:channel.id,channelName:channel.name,channelType:channel.type,sourceHash:sourceHash(),request,
    body:{content:request.content,...(request.embeds?{embeds:request.embeds}:{}),...(image?{attachments:[{id:0,filename:image.info.name}]}:{}),allowed_mentions:{parse:[],replied_user:false},nonce,enforce_nonce:true}};
  return {...plan,approvalHash:digest(plan)};
}
export const messageSummary=p=>`السيرفر: ${p.guildName}\nالغرفة: ${p.channelName}\n\n${p.body.content}${p.request.image?'\n\nالصورة المرفقة: '+validateMessageImage(p.request.image).info.name+' · SHA256: '+p.request.image.sha256:''}${(p.body.embeds??[]).map(e=>`\n\n${e.title??''}\n${e.description??''}\n${(e.fields??[]).map(f=>`${f.name}\n${f.value}`).join('\n\n')}\n${e.footer?.text??''}`).join('')}\n\nالمرسل: البوت. الإشارات التلقائية للأعضاء والرتب و@everyone معطّلة.`;
export const messagePreview=p=>({approvalHash:p.approvalHash,channelId:p.channelId,channelName:p.channelName,content:p.body.content,...(p.request.image?{image:validateMessageImage(p.request.image).info}:{}),...(p.body.embeds?{embeds:p.body.embeds}:{}),summary:messageSummary(p)});
export async function previewMessage(api,guildId,request,directory){
  const s=await snapshot(api,guildId,{includeMembers:false}),plan=prepareMessage(s,request,randomBytes(12).toString('hex'));
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'message-plan.json'),JSON.stringify(plan,null,2));
  fs.rmSync(path.join(directory,'message-result.json'),{force:true});
  fs.writeFileSync(path.join(directory,'message-preview.txt'),messageSummary(plan));return plan;
}
export async function sendMessage(api,guildId,confirmation,directory){
  if(confirmation?.confirmed!==true||confirmation.guildId!==guildId)throw new Error('راجع الرسالة وأكّد إرسالها إلى السيرفر المحدد أولًا.');
  const reviewed=JSON.parse(fs.readFileSync(path.join(directory,'message-plan.json'),'utf8'));
  if(reviewed.guildId!==guildId||reviewed.channelId!==confirmation.channelId||reviewed.approvalHash!==confirmation.approvalHash)throw new Error('الغرفة أو الرسالة لا تطابق المعاينة.');
  const current=await snapshot(api,guildId,{includeMembers:false}),fresh=prepareMessage(current,reviewed.request,reviewed.body.nonce);
  if(fresh.approvalHash!==reviewed.approvalHash)throw new Error('تغيّر اسم الغرفة أو البوت أو الكود منذ المعاينة؛ راجع الرسالة مجددًا.');
  const attempt=path.join(directory,'message-history',fresh.approvalHash);fs.mkdirSync(path.dirname(attempt),{recursive:true});
  try{fs.mkdirSync(attempt);}catch(error){if(error.code==='EEXIST')throw new Error('سبق بدء إرسال هذه المعاينة؛ راجع نتيجة الإرسال قبل إعداد رسالة أخرى.');throw error;}
  fs.writeFileSync(path.join(attempt,'plan.json'),JSON.stringify(fresh,null,2));
  const result={success:false,status:'sending',guildId,channelId:fresh.channelId,approvalHash:fresh.approvalHash};
  const record=()=>{fs.writeFileSync(path.join(attempt,'result.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(directory,'message-result.json'),JSON.stringify(result,null,2));};record();
  try{const image=fresh.request.image?validateMessageImage(fresh.request.image):null;const response=await api.call('POST',`/channels/${fresh.channelId}/messages`,fresh.body,image?{files:[{name:image.info.name,type:image.info.type,bytes:image.bytes}]}:undefined);result.success=true;result.status='sent';result.messageId=response.id;return result;}
  catch(error){result.status='failed-or-unknown';result.error=error.message;throw error;}
  finally{record();}
}
