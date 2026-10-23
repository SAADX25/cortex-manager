import {ROLES,CATEGORIES} from './design.mjs';
import {P,botPermissions,botTopPosition,has,canManageChannel,effectiveRolePermissions} from './permissions.mjs';

export function validateDesign(){
 const roleKeys=new Set(),roleNames=new Set(),channelKeys=new Set(),catNames=new Set();
 for(const r of ROLES){
  if(roleKeys.has(r.key)||roleNames.has(r.name))throw new Error('Duplicate role '+r.name);
  roleKeys.add(r.key);roleNames.add(r.name);
 }
 for(const c of CATEGORIES){
  if(catNames.has(c.name))throw new Error('Duplicate category '+c.name);
  catNames.add(c.name);
  for(const ch of c.channels){
   if(channelKeys.has(ch.key))throw new Error('Duplicate channel key '+ch.key);
   channelKeys.add(ch.key);
   if(ch.name.length>100)throw new Error('Channel name too long');
  }
 }
}
export function plan(s){
 validateDesign();
 const guildPerm=botPermissions(s),top=botTopPosition(s);
 const reusedRoles={},reusedCategories={},reusedChannels={};
 const occupiedRoles=new Set(),occupiedChannels=new Set();
 for(const spec of ROLES){
  const r=s.roles.find(x=>x.name===spec.name&&!x.managed&&!occupiedRoles.has(x.id));
  if(r){reusedRoles[spec.key]=r.id;occupiedRoles.add(r.id);}
 }
 for(const cat of CATEGORIES){
  const c=s.channels.find(x=>x.type===4&&x.name===cat.name&&!occupiedChannels.has(x.id));
  if(c){reusedCategories[cat.key]=c.id;occupiedChannels.add(c.id);}
  for(const ch of cat.channels){
   if(!c)continue;
   const type=ch.type==='voice'?2:0;
   const old=s.channels.find(x=>x.type===type&&x.name===ch.name&&x.parent_id===c.id&&!occupiedChannels.has(x.id));
   if(old){reusedChannels[ch.key]=old.id;occupiedChannels.add(old.id);}
  }
 }
 const botAssigned=new Set(s.botMember.roles);
 const oldRoles=s.roles.filter(r=>r.id!==s.guild.id&&!r.managed&&!botAssigned.has(r.id)&&!occupiedRoles.has(r.id));
 const oldChannels=s.channels.filter(c=>!occupiedChannels.has(c.id));
 const keepManaged=s.roles.filter(r=>r.managed||r.id===s.guild.id||botAssigned.has(r.id));
 const blockers=[];
 if(!has(guildPerm,P.ManageChannels))blockers.push('Bot lacks Manage Channels.');
 if(!has(guildPerm,P.ManageRoles))blockers.push('Bot lacks Manage Roles.');
 const high=[...oldRoles,...s.roles.filter(r=>occupiedRoles.has(r.id))].filter(r=>r.position>=top);
 if(high.length)blockers.push(`Roles not below bot (${high.length}): ${high.map(r=>r.name).join(' | ')}. Move Cortex Manager role ABOVE them in Server Settings > Roles.`);
 const protectedIds=new Set([s.guild.rules_channel_id,s.guild.public_updates_channel_id].filter(Boolean));
 const special=oldChannels.filter(c=>protectedIds.has(c.id));
 if(special.length)blockers.push(`Discord Community protected channels: ${special.map(x=>x.name).join(', ')}. Change Rules and Community Updates channels in Server Settings before rebuild.`);
 const inaccessible=oldChannels.filter(c=>!canManageChannel(s,c));
 if(inaccessible.length)blockers.push(`Bot may not manage these channels: ${inaccessible.map(c=>c.name).join(', ')}. Check category/channel permissions.`);
 const channelRights=['Connect','Speak','AddReactions','CreatePublicThreads','CreatePrivateThreads','SendMessagesInThreads'];
 const missingChannelRights=channelRights.filter(name=>!has(guildPerm,P[name]));
 const missingRights=ROLES.flatMap(spec=>{
  const {missing}=effectiveRolePermissions(spec.permissions,guildPerm);
  return missing.length?[{role:spec.name,missing}]:[];
 });
 return {reusedRoles,reusedCategories,reusedChannels,oldRoles,oldChannels,keepManaged,blockers,missingRights,missingChannelRights,
  totals:{createRoles:ROLES.length-Object.keys(reusedRoles).length,createCategories:CATEGORIES.length-Object.keys(reusedCategories).length,
    createChannels:CATEGORIES.reduce((n,c)=>n+c.channels.length,0)-Object.keys(reusedChannels).length,
    deleteRoles:oldRoles.length,deleteChannels:oldChannels.length}};
}
export function renderPreview(s,p){
 const lines=[
 `# Cortex Manager PRO — PREVIEW ONLY`,
 ``, `**Server:** ${s.guild.name} (\`${s.guild.id}\`)`,
 `**Snapshot:** ${s.captured_at}`,``,
 `## Planned changes`,
 `- Create ${p.totals.createRoles} roles (reuse ${Object.keys(p.reusedRoles).length}).`,
 `- Create ${p.totals.createCategories} categories (reuse ${Object.keys(p.reusedCategories).length}).`,
 `- Create ${p.totals.createChannels} channels (reuse ${Object.keys(p.reusedChannels).length}).`,
 `- **PERMANENTLY DELETE ${p.totals.deleteChannels} previous channels and ${p.totals.deleteRoles} previous roles.**`,
 `- Discord-managed/integration roles, roles held by Cortex Manager, and @everyone are preserved (${p.keepManaged.length}).`,``,
 `## New layout`,
 ...CATEGORIES.flatMap(c=>[`### ${c.name}`,...c.channels.map(ch=>`- ${ch.type==='voice'?'🔊':'#'} ${ch.name}${ch.readonly?' (read-only)':''}${ch.vipOnly?' (VIP-only)':''}`)]),
 ``,`## New roles`,...ROLES.map(r=>`- ${r.name}: ${r.permissions.length?r.permissions.join(', '):'decorative / channel overwrites'}`),
 ``,`## Old channels planned for deletion`,...(p.oldChannels.length?p.oldChannels.map(c=>`- ${c.name} — ${c.id}`):['- None']),
 ``,`## Old roles planned for deletion`,...(p.oldRoles.length?p.oldRoles.map(r=>`- ${r.name} — ${r.id}`):['- None']),
 ``,`## Blocking conditions`,...(p.blockers.length?p.blockers.map(x=>`- ⛔ ${x}`):['- ✅ No identified blockers']),
 ``,`## Permissions the bot cannot delegate at present`,
 ...(p.missingRights.length?p.missingRights.map(x=>`- ${x.role}: ${x.missing.join(', ')}`):['- All configured role permissions can be assigned']),
 ``,`**WARNING:** Snapshot includes configuration only, NOT chat history, attachments, or member-role assignment backups. Channel deletion is irreversible.`,
 `**Channel-level permission gap:** ${p.missingChannelRights.length?p.missingChannelRights.join(', '):'None'}. Unsupported channel overwrites will be omitted.`,``,
 `**TIP:** To grant all professional staff powers, authorize the bot for the missing moderation and voice permissions and rerun before rebuilding.`,``,
 ];
 return lines.join('\n');
}
