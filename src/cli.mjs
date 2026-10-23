import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {DiscordAPI,snapshot} from './api.mjs';
import {ROLES,CATEGORIES,ROLE_ASSIGNMENT_NOTE} from './design.mjs';
import {P,botPermissions,has,effectiveRolePermissions,createOverwrites} from './permissions.mjs';
import {plan,renderPreview} from './plan.mjs';

const mode=process.argv[2]??'preview';
const guildId=process.env.DISCORD_GUILD_ID?.trim();
const api=new DiscordAPI(process.env.DISCORD_BOT_TOKEN);
const out=path.join(process.cwd(),'out');
fs.mkdirSync(out,{recursive:true});
const write=(file,data)=>fs.writeFileSync(path.join(out,file),typeof data==='string'?data:JSON.stringify(data,null,2));
const say=(line)=>console.log(line);

async function main(){
  if(!['snapshot','preview','rebuild'].includes(mode))throw new Error('Choose snapshot, preview, or rebuild.');
  // Check both confirmations BEFORE even considering mutations.
  if(mode==='rebuild'){
    if(process.env.CONFIRM_DELETE !== 'DELETE_ALL_OLD_CHANNELS_AND_ROLES'){
      throw new Error('Rebuild STOPPED. In Run workflow, type DELETE_ALL_OLD_CHANNELS_AND_ROLES exactly.');
    }
    if(process.env.CONFIRM_GUILD_ID !== guildId || !guildId){
      throw new Error('Rebuild STOPPED. Confirm the EXACT DISCORD_GUILD_ID in the confirmation field.');
    }
  }
  let s;
  if(mode==='snapshot'){
    s=await snapshot(api,guildId);
    write('snapshot.json',s);
    say(`Backup metadata saved to out/snapshot.json for ${s.guild.name} (${s.guild.id}).`);
    say('Messages, attachments, and complete member assignments are NOT included.');
    return;
  }
  // Require the same captured snapshot that workflow uploaded BEFORE running any destructive code.
  if(!fs.existsSync(path.join(out,'snapshot.json'))){
    throw new Error('Missing out/snapshot.json: run snapshot first and upload the backup artifact before rebuild.');
  }
  s=JSON.parse(fs.readFileSync(path.join(out,'snapshot.json'),'utf8'));
  if(s.guild.id!==guildId)throw new Error('Backup guild ID does not match DISCORD_GUILD_ID.');
  const p=plan(s);
  const report=renderPreview(s,p);
  write('preview.md',report);
  say(report);
  if(mode==='preview')return;
  if(p.blockers.length)throw new Error(`STOP: ${p.blockers.join(' | ')}`);
  // Freshness check: abort if entities were added/removed since backup capture.
  const latest=await snapshot(api,guildId);
  for(const kind of ['roles','channels']){
    const a=s[kind].map(e=>e.id).sort().join(',');
    const b=latest[kind].map(e=>e.id).sort().join(',');
    if(a!==b)throw new Error(`STOP: ${kind} changed since the backup; re-run Preview and start a fresh Rebuild.`);
  }
  const log=[];
  const record=line=>{say(line);log.push(line);write('execution-log.txt',log.join('\n')+'\n');};
  const roleIds={...p.reusedRoles};
  const botBits=botPermissions(s);
  record(`START rebuild of ${s.guild.name} (${guildId}).`);
  record('Creation happens BEFORE old channels/roles are deleted.');

  // 1. Roles: server-side roles are created below bot's highest role.
  for(const r of ROLES){
    const {granted,missing}=effectiveRolePermissions(r.permissions,botBits);
    if(missing.length)record(`WARNING ${r.name}: bot cannot grant ${missing.join(', ')}. Add missing permissions to bot and re-run to upgrade the role.`);
    const body={name:r.name,color:r.color,hoist:['founder','coowner','admin','headmod','mod','vip'].includes(r.key),mentionable:false,permissions:String(granted)};
    if(roleIds[r.key]){
      await api.patch(`/guilds/${guildId}/roles/${roleIds[r.key]}`,body);
      record(`UPDATED role ${r.name} (${roleIds[r.key]})`);
    }else{
      const obj=await api.post(`/guilds/${guildId}/roles`,body);
      roleIds[r.key]=obj.id;
      record(`CREATED role ${r.name} (${obj.id})`);
    }
  }

  // 2. Categories and channels, with per-role permissions.
  const newCategoryIds={...p.reusedCategories};
  for(const category of CATEGORIES){
    const overwrites=createOverwrites(category,roleIds,guildId,s.bot.id,{},botBits);
    let parentId=newCategoryIds[category.key];
    if(parentId){
      await api.patch(`/channels/${parentId}`,{name:category.name,permission_overwrites:overwrites});
      record(`UPDATED category ${category.name}`);
    }else{
      const created=await api.post(`/guilds/${guildId}/channels`,{name:category.name,type:4,permission_overwrites:overwrites});
      parentId=created.id;newCategoryIds[category.key]=parentId;
      record(`CREATED category ${category.name}`);
    }
    for(const ch of category.channels){
      const body={name:ch.name,type:ch.type==='voice'?2:0,parent_id:parentId,
        permission_overwrites:createOverwrites(category,roleIds,guildId,s.bot.id,ch,botBits)};
      if(ch.type==='text'){
        body.topic=ch.topic??'';
        body.rate_limit_per_user=ch.slowmode??0;
      }else body.user_limit=ch.userLimit??0;
      let id=p.reusedChannels[ch.key];
      if(id){
        const edit={...body};delete edit.type;
        await api.patch(`/channels/${id}`,edit);
        record(`UPDATED channel ${ch.name}`);
      }else{
        const created=await api.post(`/guilds/${guildId}/channels`,body);
        id=created.id;
        record(`CREATED channel ${ch.name}`);
        if(ch.message){
          try{await api.post(`/channels/${id}/messages`,{content:ch.message,allowed_mentions:{parse:[]}});record(`POSTED introduction in ${ch.name}`);}
          catch(e){record(`WARNING intro message failed in ${ch.name}: ${e.message}`);}
        }
      }
    }
  }

  // Assign decorative Founder label only to actual Discord owner (never to another member).
  try {
    await api.call('PUT',`/guilds/${guildId}/members/${s.guild.owner_id}/roles/${roleIds.founder}`);
    record('ASSIGNED decorative Founder role to actual server owner.');
  }catch(e){record(`WARNING Founder assignment skipped: ${e.message}`);}

  // 3. Irreversible deletions, only IDs from preapproved and snapshotted old structure.
  record('ABOUT TO DELETE OLD CHANNELS. No chat history is backed up.');
  const oldChildren=p.oldChannels.filter(c=>c.type!==4);
  const oldCategories=p.oldChannels.filter(c=>c.type===4);
  for(const c of [...oldChildren,...oldCategories]){
    await api.del(`/channels/${c.id}`);
    record(`DELETED old channel/category: ${c.name} (${c.id})`);
  }
  record('ABOUT TO DELETE OLD NON-MANAGED, NON-BOT-ASSIGNED ROLES. Members will lose these role assignments.');
  for(const r of p.oldRoles){
    await api.del(`/guilds/${guildId}/roles/${r.id}`);
    record(`DELETED old role: ${r.name} (${r.id})`);
  }
  write('result.json',{guild_id:guildId,success:true,completed_at:new Date().toISOString(),
    created_structure:{roles:ROLES.length,categories:CATEGORIES.length,channels:CATEGORIES.reduce((n,c)=>n+c.channels.length,0)},
    deleted_old:{channels:p.oldChannels.length,roles:p.oldRoles.length},
    kept_special_roles:p.keepManaged.map(r=>({id:r.id,name:r.name})),permission_gaps:p.missingRights});
  record('DONE — New layout created. No existing message history was backed up or restored.');
  record(ROLE_ASSIGNMENT_NOTE);
}

main().catch(err=>{console.error(`\n⛔ ${err.message}`);process.exitCode=1;});
