import {defaultDesign,validateCustomDesign} from './custom-design.mjs';
import {ROLES,CATEGORIES} from './design.mjs';
import {botPermissions,effectiveRolePermissions,createOverwrites,canManageChannel} from './permissions.mjs';
import {isLeadershipRole,roleProtection,protectedChannelIds,guardedAPI,fingerprint,digest} from './safety.mjs';
import {snapshot,memberInventory} from './api.mjs';

function verifyLeadership(original,current) {
  for(const r of original.roles.filter(isLeadershipRole)) {
    const now=current.roles.find(x=>x.id===r.id);
    // Numeric positions change naturally as other roles are inserted/deleted.
    // Verify role data and relative order; never issue role reorder requests.
    const fields=x=>{const {position,...rest}=x;return rest;};
    if(!now||digest(fields(now))!==digest(fields(r)))throw new Error(`Protected leadership role changed: ${r.id}`);
    for(const other of original.roles.filter(x=>x.id!==r.id)) {
      const latest=current.roles.find(x=>x.id===other.id);
      if(latest&&Math.sign(r.position-other.position)!==Math.sign(now.position-latest.position))throw new Error('Protected leadership hierarchy changed; stop and preview again.');
    }
  }
}

export async function rebuild(api,s,p,{record=()=>{},save=()=>{},capture=snapshot,inventory=memberInventory}={}) {
  const {roles:ROLES,categories:CATEGORIES}=validateCustomDesign(p.design??defaultDesign());
  const result={success:false,phase:'preflight',created:[],updated:[],deleted:[],migrated:[],unmigrated:[...p.unmigrated],
    retainedRoles:p.keepRoles.map(r=>({id:r.id,name:r.name,reason:r.reason})),retainedChannels:p.keepChannels.map(c=>({id:c.id,name:c.name,reason:c.reason})),
    permissionGaps:p.missingRights,approvalHash:p.approvalHash};
  const persist=()=>save('result.json',result);
  const log=(kind,type,id,name)=>{result[kind].push({type,id,name});record(`${kind.toUpperCase()} ${type}: ${name} (${id})`);persist();};
  const safe=guardedAPI(api,s,p),call=(m,path,b)=>safe.call(m,path,b),prefix=`/guilds/${s.guild.id}`;
  try {
    persist();
    if(p.blockers.length)throw new Error(p.blockers.join(' | '));
    if(fingerprint(await capture(api,s.guild.id))!==fingerprint(s))throw new Error('Server configuration or member assignments changed since preview. Run a fresh preview.');
    const roleIds={...p.reusedRoles,...p.preservedRoles,leadership:s.roles.filter(isLeadershipRole).map(r=>r.id)};
    const botBits=botPermissions(s),keptChannels=new Set(p.keepChannels.map(c=>c.id));
    result.phase='creation';persist();
    // Discord inserts each new role at the bottom. Create staff first, then
    // community roles below them, without issuing any role reorder request.
    for(const r of ROLES) {
      if(p.preservedRoles[r.key])continue;
      const body={name:r.name,color:r.color,hoist:r.hoist??['admin','headmod','mod','vip'].includes(r.key),mentionable:r.mentionable??false,
        permissions:String(effectiveRolePermissions(r.permissions,botBits).granted)};
      if(roleIds[r.key]) {
        const live=await api.get(`${prefix}/roles`),role=live.find(x=>x.id===roleIds[r.key]);
        if(!role||roleProtection({...s,roles:live},role))throw new Error('Reused role became protected; run a new preview.');
        await call('PATCH',`${prefix}/roles/${role.id}`,body);log('updated','role',role.id,r.name);
      } else {
        const created=await call('POST',`${prefix}/roles`,body);roleIds[r.key]=created.id;log('created','role',created.id,r.name);
      }
    }
    const categoryIds={...p.reusedCategories};
    for(const category of CATEGORIES) {
      let parentId=categoryIds[category.key];
      const body={name:category.name,permission_overwrites:createOverwrites(category,roleIds,s.guild.id,s.bot.id,{},botBits)};
      if(parentId) {
        if(!keptChannels.has(parentId)) {await call('PATCH',`/channels/${parentId}`,body);log('updated','category',parentId,category.name);}
      } else {
        const created=await call('POST',`${prefix}/channels`,{...body,type:4});parentId=created.id;categoryIds[category.key]=parentId;
        log('created','category',parentId,category.name);
      }
      for(const ch of category.channels) {
        if(p.preservedSlots[ch.key])continue;
        const body={name:ch.name,type:ch.type==='voice'?2:0,parent_id:parentId,
          permission_overwrites:createOverwrites(category,roleIds,s.guild.id,s.bot.id,ch,botBits),
          ...(ch.type==='text'?{topic:ch.topic??'',rate_limit_per_user:ch.slowmode??0}:{user_limit:ch.userLimit??0})};
        const existing=p.reusedChannels[ch.key];
        if(existing) {
          const {type,...edit}=body;await call('PATCH',`/channels/${existing}`,edit);log('updated','channel',existing,ch.name);
        } else {
          const created=await call('POST',`${prefix}/channels`,body);log('created','channel',created.id,ch.name);
          if(ch.message) {
            try{await call('POST',`/channels/${created.id}/messages`,{content:ch.message,allowed_mentions:{parse:[]}});}
            catch(e){record(`WARNING introduction failed in ${ch.name}: ${e.message}`);}
          }
        }
      }
    }
    result.phase='migration';persist();
    for(const m of p.migrations) {
      for(const memberId of m.memberIds) {
        try {
          const member=await api.get(`${prefix}/members/${memberId}`);
          if(!member.roles.includes(m.sourceId))continue;
          if(!member.roles.includes(roleIds[m.targetKey]))await call('PUT',`${prefix}/members/${memberId}/roles/${roleIds[m.targetKey]}`);
          const verified=await api.get(`${prefix}/members/${memberId}`);
          if(!verified.roles.includes(roleIds[m.targetKey]))throw new Error('Replacement assignment verification failed');
          result.migrated.push({memberId,sourceId:m.sourceId,targetId:roleIds[m.targetKey]});persist();
        } catch(e) {
          result.unmigrated.push({roleId:m.sourceId,memberIds:[memberId],reason:e.message});persist();
          throw new Error(`Migration failed for ${memberId}; no old structure deleted. ${e.message}`);
        }
      }
    }
    const beforeDelete=await capture(api,s.guild.id);
    save('before-delete.json',beforeDelete);verifyLeadership(s,beforeDelete);
    for(const entity of [...result.created,...result.updated]) {
      const list=entity.type==='role'?beforeDelete.roles:beforeDelete.channels;
      if(!list.some(x=>x.id===entity.id))throw new Error(`Replacement disappeared before deletion: ${entity.name}. No old structure deleted.`);
    }
    result.phase='deletion';persist();
    for(const c of [...p.oldChannels.filter(c=>c.type!==4),...p.oldChannels.filter(c=>c.type===4)]) {
      const current=await capture(api,s.guild.id,{includeMembers:false});
      verifyLeadership(s,current);
      const live=current.channels.find(x=>x.id===c.id);
      if(!live)continue;
      const deletionFields=x=>Object.fromEntries(['name','type','parent_id','topic','nsfw','rate_limit_per_user','user_limit','bitrate','permission_overwrites'].map(k=>[k,x[k]??null]));
      if(protectedChannelIds(current).has(c.id)||!canManageChannel(current,live)||(c.type===4&&current.channels.some(x=>x.parent_id===c.id))||digest(deletionFields(c))!==digest(deletionFields(live))) {
        result.retainedChannels.push({id:c.id,name:live.name,reason:'became protected, inaccessible, changed, or still has children'});persist();continue;
      }
      await call('DELETE',`/channels/${c.id}`);log('deleted','channel',c.id,c.name);
    }
    for(const r of p.oldRoles) {
      const current=await capture(api,s.guild.id,{includeMembers:false});
      verifyLeadership(s,current);
      const live=current.roles.find(x=>x.id===r.id);
      if(!live)continue;
      const protectedIds=protectedChannelIds(current);
      for(const c of p.keepChannels)protectedIds.add(c.id);
      for(const c of current.channels.filter(c=>protectedIds.has(c.id)&&c.parent_id))protectedIds.add(c.parent_id);
      const controlsPreservedChannel=current.channels.some(c=>protectedIds.has(c.id)&&(c.permission_overwrites??[]).some(w=>w.type===0&&w.id===r.id));
      const {position:oldPosition,...originalFields}=r;
      const {position:newPosition,...liveFields}=live;
      const reason=roleProtection(current,live)??(controlsPreservedChannel?'role controls a preserved channel':null)??
        (digest(originalFields)!==digest(liveFields)?'role configuration changed during rebuild':null);
      if(reason) {result.retainedRoles.push({id:r.id,name:live.name,reason});persist();continue;}
      const members=await inventory(api,s.guild.id),migration=p.migrations.find(m=>m.sourceId===r.id);
      const holders=members.members.filter(m=>m.roles.includes(r.id));
      if(!members.membersComplete||holders.some(m=>!migration||!m.roles.includes(roleIds[migration.targetKey]))) {
        result.retainedRoles.push({id:r.id,name:live.name,reason:'new, unmigrated or unknown assignments'});
        result.unmigrated.push({roleId:r.id,memberIds:members.membersComplete?holders.map(m=>m.id):null,reason:'Original role retained at deletion recheck'});persist();continue;
      }
      await call('DELETE',`${prefix}/roles/${r.id}`);log('deleted','role',r.id,r.name);
    }
    verifyLeadership(s,await capture(api,s.guild.id,{includeMembers:false}));
    result.success=true;result.phase='complete';result.completed_at=new Date().toISOString();persist();return result;
  } catch(error) {result.error=error.message;persist();throw error;}
}
