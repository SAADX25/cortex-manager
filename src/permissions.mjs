// Discord API v10 permission bits.
export const P = Object.freeze({
  KickMembers:1n<<1n,BanMembers:1n<<2n,Administrator:1n<<3n,
  ManageChannels:1n<<4n,ManageGuild:1n<<5n,AddReactions:1n<<6n,
  ViewAuditLog:1n<<7n,ViewChannel:1n<<10n,SendMessages:1n<<11n,
  ManageMessages:1n<<13n,EmbedLinks:1n<<14n,AttachFiles:1n<<15n,
  ReadMessageHistory:1n<<16n,Connect:1n<<20n,Speak:1n<<21n,
  MoveMembers:1n<<24n,ManageNicknames:1n<<27n,ManageRoles:1n<<28n,
  ManageEvents:1n<<33n,ManageThreads:1n<<34n,
  CreatePublicThreads:1n<<35n,CreatePrivateThreads:1n<<36n,
  SendMessagesInThreads:1n<<38n,ModerateMembers:1n<<40n,
});
export const bits = names => names.reduce((p,n)=>{
  if (!(n in P)) throw new Error(`Unknown permission ${n}`);
  return p | P[n];
},0n);
export const has = (value, flag) => ((value & P.Administrator) !== 0n) || ((value & flag) === flag);
export function botPermissions(snapshot){
  const roles = snapshot.roles;
  const ids = new Set([snapshot.guild.id,...snapshot.botMember.roles]);
  return roles.filter(r=>ids.has(r.id)).reduce((p,r)=>p|BigInt(r.permissions),0n);
}
export function botTopPosition(snapshot){
  const ids = new Set(snapshot.botMember.roles);
  return Math.max(0,...snapshot.roles.filter(r=>ids.has(r.id)).map(r=>r.position));
}
export function canManageChannel(snapshot, channel){
  let b = botPermissions(snapshot);
  if (has(b,P.Administrator)) return true;
  const ws = channel.permission_overwrites ?? [];
  const everyone = ws.find(w=>w.id === snapshot.guild.id && w.type === 0);
  if (everyone) b = (b & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  const ownRoles = new Set(snapshot.botMember.roles);
  const roleWs=ws.filter(w=>w.type===0 && ownRoles.has(w.id));
  const deny=roleWs.reduce((a,w)=>a|BigInt(w.deny),0n);
  const allow=roleWs.reduce((a,w)=>a|BigInt(w.allow),0n);
  b=(b & ~deny)|allow;
  const self=ws.find(w=>w.type===1 && w.id===snapshot.bot.id);
  if(self) b=(b & ~BigInt(self.deny))|BigInt(self.allow);
  return has(b,P.ManageChannels);
}
const bitstr = v=>String(v);
export function overwrite(id,type,allow=0n,deny=0n){return {id,type,allow:bitstr(allow),deny:bitstr(deny)};}
export function createOverwrites(category, roleIds, guildId, botId, channel={}, botBits=null){
  const everyoneId=guildId;
  const mute=roleIds.muted;
  const muteDeny=bits(['SendMessages','Speak','AddReactions','CreatePublicThreads','CreatePrivateThreads','SendMessagesInThreads']);
  const rw=bits(['ViewChannel','SendMessages','ReadMessageHistory','Connect','Speak']);
  const list=[];
  let everyoneDeny=0n;
  if(category.access==='staff') everyoneDeny |= P.ViewChannel;
  if(channel.readonly) everyoneDeny |= bits(['SendMessages','AddReactions','CreatePublicThreads','CreatePrivateThreads','SendMessagesInThreads']);
  if(channel.vipOnly) everyoneDeny |= bits(['ViewChannel','Connect']);
  list.push(overwrite(everyoneId,0,0n,everyoneDeny));
  if(mute) list.push(overwrite(mute,0,0n,muteDeny));
  const accessKeys=category.access==='staff' ? category.staffKeys : (channel.vipOnly?['founder','coowner','admin','headmod','mod','vip']:[]);
  for(const key of accessKeys ?? []) if(roleIds[key])list.push(overwrite(roleIds[key],0,rw,0n));
  if(channel.readonly) for(const key of ['founder','coowner','admin','headmod','mod']){
    const id=roleIds[key];
    if(id){
      const item=list.find(w=>w.id===id&&w.type===0);
      if(item)item.allow=String(BigInt(item.allow)|P.SendMessages);
      else list.push(overwrite(id,0,P.SendMessages,0n));
    }
  }
  // Member-level override for bot so it can build private areas and seed welcome/rules messages.
  list.push(overwrite(botId,1,rw|P.ManageChannels,0n));
  // Discord does not allow bots to set overwrites beyond their own effective permissions.
  // Omit unsupported allow/deny bits instead of submitting invalid Discord API requests.
  if(botBits===null || has(botBits,P.Administrator))return list;
  return list.map(w=>({...w,allow:String(BigInt(w.allow)&botBits),deny:String(BigInt(w.deny)&botBits)}));
}
export function effectiveRolePermissions(desiredNames,botBits){
  const requested=bits(desiredNames);
  if(has(botBits,P.Administrator)) return {granted:requested,missing:[]};
  return {granted:requested & botBits,missing:desiredNames.filter(n=>!has(botBits,P[n]))};
}
