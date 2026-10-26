import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {snapshot} from './api.mjs';
import {digest,roleProtection} from './safety.mjs';
import {P,has,botPermissions} from './permissions.mjs';
const sourceHash=()=>digest(fs.readdirSync(new URL('.',import.meta.url)).filter(f=>f.endsWith('.mjs')).sort().map(f=>[f,fs.readFileSync(new URL(f,import.meta.url),'utf8')]));
export function prepareRoleGrant(s,request,member,nonce){
  if(!request||Array.isArray(request)||Object.keys(request).sort().join(',')!=='memberId,roleId'||![request.memberId,request.roleId].every(id=>typeof id==='string'&&/^\d{16,22}$/.test(id)))throw new Error('أدخل معرّف العضو والرتبة الصحيحين.');
  if(!has(botPermissions(s),P.ManageRoles))throw new Error('يحتاج البوت صلاحية Manage Roles لمنح الرتبة.');
  const role=s.roles.find(r=>r.id===request.roleId);if(!role||roleProtection(s,role))throw new Error('هذه الرتبة محمية أو أعلى من البوت ولا يمكن منحها من البرنامج.');
  if((member?.user?.id??member?.id)!==request.memberId||!Array.isArray(member.roles))throw new Error('العضو غير موجود في السيرفر المحدد.');
  if(request.memberId===s.bot.id||member.user?.bot||member.bot)throw new Error('هذا الخيار مخصص للأعضاء؛ لا يغيّر رتب البوتات.');
  if(member.roles.includes(role.id))throw new Error('هذا العضو يمتلك الرتبة بالفعل.');
  if(typeof nonce!=='string'||!/^[a-f0-9]{24}$/.test(nonce))throw new Error('معاينة منح الرتبة غير صالحة.');
  const p={guildId:s.guild.id,guildName:s.guild.name,botId:s.bot.id,request,roleId:role.id,roleName:role.name,rolePermissions:role.permissions,rolePosition:role.position,memberId:request.memberId,
    memberName:member.nick??member.user?.global_name??member.user?.username??request.memberId,memberRoles:[...member.roles].sort(),administrator:(BigInt(role.permissions)&P.Administrator)!==0n,nonce,sourceHash:sourceHash()};
  return {...p,approvalHash:digest(p)};
}
export const roleGrantSummary=p=>`السيرفر: ${p.guildName} (${p.guildId})\nالعضو: ${p.memberName} (${p.memberId})\nمنح الرتبة: ${p.roleName} (${p.roleId})\n${p.administrator?'تنبيه: هذه الرتبة تمنح صلاحية Administrator الكاملة.\n':''}تُضاف هذه الرتبة فقط. تبقى رتب العضو الحالية محفوظة.`;
export const roleGrantPublic=p=>({guildId:p.guildId,guildName:p.guildName,roleId:p.roleId,roleName:p.roleName,memberId:p.memberId,memberName:p.memberName,administrator:p.administrator,approvalHash:p.approvalHash,summary:roleGrantSummary(p)});
async function load(api,guildId,request,nonce){
  if(!request||typeof request.memberId!=='string'||!/^\d{16,22}$/.test(request.memberId))throw new Error('أدخل معرّف عضو من السيرفر.');
  const s=await snapshot(api,guildId,{includeMembers:false});
  let member;try{member=await api.get(`/guilds/${guildId}/members/${request.memberId}`);}catch(error){if(error.status===404)throw new Error('العضو غير موجود في السيرفر المحدد.');throw error;}
  return prepareRoleGrant(s,request,member,nonce);
}
export async function previewRoleGrant(api,guildId,request,directory){
  const p=await load(api,guildId,request,randomBytes(12).toString('hex'));fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'role-grant-plan.json'),JSON.stringify(p,null,2));fs.writeFileSync(path.join(directory,'role-grant-preview.txt'),roleGrantSummary(p));return p;
}
export async function applyRoleGrant(api,guildId,c,directory){
  if(c?.confirmed!==true||c.guildId!==guildId)throw new Error('راجع العضو والرتبة ثم أكّد المنح.');
  const reviewed=JSON.parse(fs.readFileSync(path.join(directory,'role-grant-plan.json'),'utf8'));
  if(reviewed.guildId!==guildId||reviewed.roleId!==c.roleId||reviewed.memberId!==c.memberId||reviewed.approvalHash!==c.approvalHash)throw new Error('العضو أو الرتبة لا يطابق المعاينة.');
  const fresh=await load(api,guildId,reviewed.request,reviewed.nonce);
  if(fresh.approvalHash!==reviewed.approvalHash)throw new Error('تغيّرت بيانات العضو أو الرتبة منذ المعاينة؛ راجع العملية مجددًا.');
  if(fresh.administrator&&c.acknowledgeAdmin!==true)throw new Error('يجب تأكيد منح صلاحية Administrator لهذا العضو.');
  const history=path.join(directory,'role-grant-history',fresh.approvalHash);fs.mkdirSync(path.dirname(history),{recursive:true});
  try{fs.mkdirSync(history);}catch(e){if(e.code==='EEXIST')throw new Error('سبق بدء تنفيذ هذه المعاينة؛ راجع النتيجة قبل المحاولة مجددًا.');throw e;}
  fs.writeFileSync(path.join(history,'plan.json'),JSON.stringify(fresh,null,2));
  const result={success:false,status:'applying',guildId,roleId:fresh.roleId,memberId:fresh.memberId,approvalHash:fresh.approvalHash};
  const record=()=>{const json=JSON.stringify(result,null,2);fs.writeFileSync(path.join(directory,'role-grant-result.json'),json);fs.writeFileSync(path.join(history,'result.json'),json);};record();
  try{await api.call('PUT',`/guilds/${guildId}/members/${fresh.memberId}/roles/${fresh.roleId}`);result.success=true;result.status='granted';return result;}
  catch(e){result.status='failed-or-unknown';result.error=e.message;throw e;}finally{record();}
}
