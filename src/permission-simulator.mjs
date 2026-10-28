import {snapshot} from './api.mjs';
import {P} from './permissions.mjs';
import {CHANNEL_PERMISSIONS} from './editor.mjs';

export function simulatePermissions(s,request,member=null,{now=Date.now()}={}){
  const validId=id=>typeof id==='string'&&/^\d{16,22}$/.test(id);
  if(!request||Array.isArray(request)||Object.keys(request).some(k=>!['channelId','memberId','roleIds'].includes(k))||!validId(request.channelId))throw new Error('اختر غرفة وعضوًا أو رتبًا للمحاكاة.');
  const memberMode=Object.hasOwn(request,'memberId');
  if(memberMode===Object.hasOwn(request,'roleIds')||memberMode&&!validId(request.memberId))throw new Error('اختر محاكاة عضو أو محاكاة رتب فقط.');
  const channel=s.channels.find(c=>c.id===request.channelId);
  if(!channel||![0,2,5].includes(channel.type)||!channel.name||!Array.isArray(channel.permission_overwrites))throw new Error('المحاكاة متاحة للقنوات النصية والصوتية والإعلانات ذات البيانات المكتملة.');
  if(memberMode&&((member?.user?.id??member?.id)!==request.memberId||!Array.isArray(member.roles)))throw new Error('العضو غير موجود في السيرفر المحدد.');
  const roleIds=memberMode?member.roles:request.roleIds;
  if(!Array.isArray(roleIds)||roleIds.length>250||new Set(roleIds).size!==roleIds.length||roleIds.some(id=>!validId(id)||!s.roles.some(r=>r.id===id)))throw new Error('إحدى رتب المحاكاة غير موجودة؛ حدّث السيرفر.');
  const roles=s.roles.filter(r=>r.id===s.guild.id||roleIds.includes(r.id)),owner=memberMode&&request.memberId===s.guild.owner_id;
  const base=roles.reduce((b,r)=>b|BigInt(r.permissions),0n),admin=(base&P.Administrator)!==0n;
  const timedOut=memberMode&&Date.parse(member.communication_disabled_until)>now&&!owner&&!admin;
  const stages=[];let value=base;
  const apply=(stage,ws)=>{const before=value,deny=ws.reduce((b,w)=>b|BigInt(w.deny),0n),allow=ws.reduce((b,w)=>b|BigInt(w.allow),0n);value=(value&~deny)|allow;stages.push({stage,before,after:value,ws});};
  if(!owner&&!admin){
    const ws=channel.permission_overwrites;
    apply('everyone',ws.filter(w=>w.type===0&&w.id===s.guild.id));
    apply('roles',ws.filter(w=>w.type===0&&w.id!==s.guild.id&&roleIds.includes(w.id)));
    apply('member',memberMode?ws.filter(w=>w.type===1&&w.id===request.memberId):[]);
    if(timedOut)value&=P.ViewChannel|P.ReadMessageHistory;
  }
  const voice=channel.type===2,names=CHANNEL_PERMISSIONS.filter(n=>voice||!['Connect','Speak','MoveMembers'].includes(n));
  const results=names.map(name=>{
    const flag=P[name],sources=roles.filter(r=>(BigInt(r.permissions)&flag)!==0n).map(r=>({id:r.id,name:r.name}));
    const trace=[{stage:'base',allowed:(base&flag)!==0n,allow:sources,deny:[]}];
    if(owner||admin)trace.push({stage:owner?'owner':'administrator',allowed:true,allow:[],deny:[]});
    else for(const step of stages){const affected=step.ws.filter(w=>((BigInt(w.allow)|BigInt(w.deny))&flag)!==0n);if(!affected.length)continue;
      trace.push({stage:step.stage,allowed:(step.after&flag)!==0n,allow:affected.filter(w=>(BigInt(w.allow)&flag)!==0n).map(w=>({id:w.id,name:s.roles.find(r=>r.id===w.id)?.name??request.memberId})),deny:affected.filter(w=>(BigInt(w.deny)&flag)!==0n).map(w=>({id:w.id,name:s.roles.find(r=>r.id===w.id)?.name??request.memberId}))});}
    let allowed=owner||admin||(value&flag)!==0n;
    if(timedOut&&!['ViewChannel','ReadMessageHistory'].includes(name)){allowed=false;trace.push({stage:'timeout',allowed:false,allow:[],deny:[]});}
    if(!owner&&!admin){let dependency=null;
      if(name!=='ViewChannel'&&(value&P.ViewChannel)===0n)dependency='ViewChannel';
      else if(['EmbedLinks','AttachFiles'].includes(name)&&(value&P.SendMessages)===0n)dependency='SendMessages';
      else if(voice&&name!=='ViewChannel'&&name!=='Connect'&&['Speak','MoveMembers','ManageChannels'].includes(name)&&(value&P.Connect)===0n)dependency='Connect';
      if(dependency){allowed=false;trace.push({stage:'dependency',permission:dependency,allowed:false,allow:[],deny:[]});}
    }
    return {name,allowed,trace};
  });
  return {guildId:s.guild.id,guildName:s.guild.name,channelId:channel.id,channelName:channel.name,mode:memberMode?'member':'roles',memberId:request.memberId??null,memberName:memberMode?(member.nick??member.user?.global_name??member.user?.username??request.memberId):null,roles:roles.map(r=>({id:r.id,name:r.name})),owner,administrator:admin,timedOut,results,capturedAt:s.captured_at,scope:'channel-permissions'};
}
export async function readPermissionSimulation(api,guildId,request){
  if(request?.memberId!==undefined&&(typeof request.memberId!=='string'||!/^\d{16,22}$/.test(request.memberId)))throw new Error('أدخل معرّف عضو صحيحًا.');
  const s=await snapshot(api,guildId,{includeMembers:false}),member=request?.memberId?await api.get(`/guilds/${guildId}/members/${request.memberId}`):null;
  return simulatePermissions(s,request,member);
}
