import {ROLES,CATEGORIES,ROLE_MIGRATIONS} from './design.mjs';
import {P,botPermissions,has,canManageChannel,effectiveRolePermissions} from './permissions.mjs';
import {PROTECTED_ROLE_NAMES,roleProtection,protectedChannelIds,digest,fingerprint} from './safety.mjs';

export function validateDesign(migrations=ROLE_MIGRATIONS) {
  const roleKeys=new Set(),roleNames=new Set(),keys=new Set(),catKeys=new Set(),catNames=new Set();
  for(const r of ROLES) {
    if(roleKeys.has(r.key)||roleNames.has(r.name)||PROTECTED_ROLE_NAMES.includes(r.name))throw new Error('Invalid/duplicate role '+r.name);
    roleKeys.add(r.key);roleNames.add(r.name);
  }
  for(const c of CATEGORIES) {
    if(catKeys.has(c.key)||catNames.has(c.name))throw new Error('Duplicate category '+c.name);
    catKeys.add(c.key);catNames.add(c.name);
    const names=new Set();
    for(const ch of c.channels) {
      if(keys.has(ch.key)||names.has(ch.name)||ch.name.length>100)throw new Error('Invalid/duplicate channel '+ch.name);
      keys.add(ch.key);names.add(ch.name);
    }
  }
  for(const [id,key] of Object.entries(migrations))if(!/^\d{16,22}$/.test(id)||!roleKeys.has(key))throw new Error(`Invalid migration ${id} -> ${key}`);
}

export function plan(s,mappings=ROLE_MIGRATIONS) {
  validateDesign(mappings);
  const guildPerm=botPermissions(s),blockers=[],warnings=[];
  const reusedRoles={},preservedRoles={},reusedCategories={},reusedChannels={},preservedSlots={};
  const occupiedRoles=new Set(),occupiedChannels=new Set();
  const keepRoles=s.roles.flatMap(r=>{const reason=roleProtection(s,r);return reason?[{...r,reason}]:[];});
  const keepChannels=new Map();
  const preserve=(c,reason)=>{
    if(!c||keepChannels.has(c.id))return;
    keepChannels.set(c.id,{...c,reason});
    if(c.parent_id)preserve(s.channels.find(x=>x.id===c.parent_id),'parent of a preserved channel');
  };
  const protectedIds=protectedChannelIds(s);
  for(const c of s.channels) {
    if(protectedIds.has(c.id))preserve(c,'Community / guild-linked protected channel');
    else if(!canManageChannel(s,c))preserve(c,'channel permissions prevent management');
    else if(![0,2,4,5,13,15,16].includes(c.type))preserve(c,'unsupported channel type');
  }
  // Keep Community functions and parents unchanged; reuse their design slots.
  const rules=s.channels.find(c=>c.id===s.guild.rules_channel_id)??s.channels.find(c=>c.name==='rules');
  const updates=s.channels.find(c=>c.id===s.guild.public_updates_channel_id)??s.channels.find(c=>c.name==='moderator-only');
  if(rules)preservedSlots.rules=rules.id;
  if(updates)preservedSlots.audit=updates.id;
  for(const spec of ROLES) {
    const candidates=s.roles.filter(r=>r.name===spec.name);
    if(candidates.length>1)blockers.push(`Ambiguous duplicate role ${spec.name}; resolve duplicates before rebuilding.`);
    const r=candidates[0];
    if(r) {
      if(roleProtection(s,r)) {preservedRoles[spec.key]=r.id;occupiedRoles.add(r.id);warnings.push(`${spec.name} matches a protected role: preserved unchanged, with no role update or assignment.`);}
      else {reusedRoles[spec.key]=r.id;occupiedRoles.add(r.id);}
    }
  }
  for(const cat of CATEGORIES) {
    const candidates=s.channels.filter(c=>c.type===4&&c.name===cat.name);
    if(candidates.length>1)blockers.push(`Ambiguous duplicate category ${cat.name}.`);
    const c=candidates[0];
    if(c) {reusedCategories[cat.key]=c.id;occupiedChannels.add(c.id);}
    for(const ch of cat.channels) {
      if(preservedSlots[ch.key])continue;
      const type=ch.type==='voice'?2:0;
      const preserved=s.channels.find(x=>x.type===type&&x.name===ch.name&&keepChannels.has(x.id));
      if(preserved) {preservedSlots[ch.key]=preserved.id;continue;}
      const candidates=s.channels.filter(x=>x.type===type&&x.name===ch.name&&!occupiedChannels.has(x.id)&&!keepChannels.has(x.id));
      if(candidates.length>1)blockers.push(`Ambiguous duplicate channel ${ch.name}.`);
      if(candidates[0]) {reusedChannels[ch.key]=candidates[0].id;occupiedChannels.add(candidates[0].id);}
    }
  }
  const migrations=[],unmigrated=[],oldRoles=[];
  for(const r of s.roles.filter(r=>!roleProtection(s,r)&&!occupiedRoles.has(r.id))) {
    const members=(s.members??[]).filter(m=>m.roles.includes(r.id));
    const target=mappings[r.id];
    if(target&&preservedRoles[target]) {
      keepRoles.push({...r,reason:'migration target is protected and cannot be assigned by this workflow'});
      unmigrated.push({roleId:r.id,roleName:r.name,memberIds:members.map(m=>m.id),reason:'Migration target protected; source role retained'});
    } else if([...keepChannels.values()].some(c=>(c.permission_overwrites??[]).some(w=>w.type===0&&w.id===r.id))) {
      keepRoles.push({...r,reason:'role controls permissions in a preserved channel'});
      unmigrated.push({roleId:r.id,roleName:r.name,memberIds:members.map(m=>m.id),reason:'Retained to preserve existing channel access'});
    } else if(s.membersComplete!==true) {
      keepRoles.push({...r,reason:'member inventory unavailable; assignments cannot be safely migrated'});
      unmigrated.push({roleId:r.id,roleName:r.name,memberIds:null,reason:'Complete member inventory unavailable'});
    } else if(members.length&&!target) {
      keepRoles.push({...r,reason:'assigned role has no reviewed migration mapping'});
      unmigrated.push({roleId:r.id,roleName:r.name,memberIds:members.map(m=>m.id),reason:'Add an explicit ROLE_MIGRATIONS entry; original role retained'});
    } else {
      oldRoles.push(r);
      if(target)migrations.push({sourceId:r.id,sourceName:r.name,targetKey:target,memberIds:members.map(m=>m.id)});
    }
  }
  for(const [id] of Object.entries(mappings)) {
    const r=s.roles.find(r=>r.id===id);
    if(r&&(roleProtection(s,r)||occupiedRoles.has(id)))blockers.push(`Migration source ${r.name} is preserved/reused and cannot be removed.`);
  }
  const oldChannels=s.channels.filter(c=>!occupiedChannels.has(c.id)&&!keepChannels.has(c.id));
  if(!has(guildPerm,P.ManageChannels))blockers.push('Bot lacks Manage Channels.');
  if(!has(guildPerm,P.ManageRoles))blockers.push('Bot lacks Manage Roles.');
  if(!has(guildPerm,P.ViewChannel))blockers.push('Bot needs View Channel to guarantee private-area visibility denies.');
  const missingRights=ROLES.flatMap(r=>{const {missing}=effectiveRolePermissions(r.permissions,guildPerm);return missing.length?[{role:r.name,missing}]:[];});
  const missingChannelRights=['Connect','Speak','AddReactions','CreatePublicThreads','CreatePrivateThreads','SendMessagesInThreads'].filter(n=>!has(guildPerm,P[n]));
  if(s.membersComplete!==true)warnings.push(s.membersError??'Enable the Server Members Intent for complete assignment backups. All obsolete roles are retained until inventory is available.');
  if(keepRoles.some(r=>(BigInt(r.permissions)&P.Administrator)!==0n))warnings.push('Existing Administrator roles bypass channel privacy; their permissions remain unchanged.');
  const totals={createRoles:ROLES.length-Object.keys(reusedRoles).length-Object.keys(preservedRoles).length,
    createCategories:CATEGORIES.length-Object.keys(reusedCategories).length,
    createChannels:CATEGORIES.reduce((n,c)=>n+c.channels.length,0)-Object.keys(reusedChannels).length-Object.keys(preservedSlots).length,
    deleteRoles:oldRoles.length,deleteChannels:oldChannels.length};
  if(s.channels.length+totals.createCategories+totals.createChannels>500)blockers.push('Insufficient channel capacity to create the new structure before deletion.');
  if(s.roles.length+totals.createRoles>250)blockers.push('Insufficient role capacity to create before deletion.');
  const result={reusedRoles,preservedRoles,reusedCategories,reusedChannels,preservedSlots,oldRoles,oldChannels,keepRoles,
    keepChannels:[...keepChannels.values()],migrations,unmigrated,blockers,warnings,missingRights,missingChannelRights,totals};
  return {...result,approvalHash:digest({snapshot:fingerprint(s),design:{ROLES,CATEGORIES,mappings},plan:result})};
}

export function renderPreview(s,p) {
  const items=(xs,fn)=>xs.length?xs.map(x=>`- ${fn(x)}`):['- None'];
  return [
    '# Cortex Manager — PREVIEW ONLY','',`**Server:** ${s.guild.name} (\`${s.guild.id}\`)`,
    `**Snapshot:** ${s.captured_at}`,`**Plan SHA-256:** \`${p.approvalHash}\``,
    '', '## Planned changes',
    `- Create ${p.totals.createRoles} roles, ${p.totals.createCategories} categories and ${p.totals.createChannels} channels.`,
    `- Reuse/update ${Object.keys(p.reusedRoles).length} roles, ${Object.keys(p.reusedCategories).length} categories and ${Object.keys(p.reusedChannels).length} channels.`,
    `- **PERMANENTLY DELETE ${p.totals.deleteChannels} previous channels and ${p.totals.deleteRoles} previous roles.**`,
    '- Create all replacements and verify assignment migrations before any deletion.',
    '- OWNER, CO_OWNER, @everyone, managed/integration and unmanageable roles are preserved.',
    '', '## Roles to create, update or preserve',...ROLES.map(r=>`- ${p.preservedRoles[r.key]?'PRESERVE '+p.preservedRoles[r.key]:p.reusedRoles[r.key]?'UPDATE '+p.reusedRoles[r.key]:'CREATE'} ${r.name} — desired #${r.color.toString(16).padStart(6,'0')} — desired ${r.permissions.join(', ')||'channel overwrites only'}${p.preservedRoles[r.key]?' (existing color and permissions unchanged)':''}`),
    '', '## Categories and channels to create, update or preserve',
    ...CATEGORIES.flatMap(c=>[`### ${c.name} (${p.keepChannels.some(x=>x.id===p.reusedCategories[c.key])?'preserve unchanged':p.reusedCategories[c.key]?'reuse '+p.reusedCategories[c.key]:'create'}; ${c.access})`,
      ...c.channels.map(ch=>`- ${p.preservedSlots[ch.key]?'PRESERVE '+p.preservedSlots[ch.key]:p.reusedChannels[ch.key]?'UPDATE '+p.reusedChannels[ch.key]:'CREATE'} ${ch.type==='voice'?'🔊':'#'} ${ch.name}${ch.readonly?' (read-only)':''}${ch.vipOnly?' (VIP private)':''}`)]),
    '', '## Preserved roles',...items(p.keepRoles,r=>`${r.name} — ${r.id}: ${r.reason}`),
    '', '## Preserved channels and categories (unchanged)',...items(p.keepChannels,c=>`${c.name} — ${c.id}: ${c.reason}`),
    '', '## Old channels planned for deletion',...items(p.oldChannels,c=>`${c.name} — ${c.id}`),
    '', '## Old roles planned for deletion',...items(p.oldRoles,r=>`${r.name} — ${r.id}`),
    '', '## Reviewed role assignment migrations',...items(p.migrations,m=>`${m.sourceName} (${m.sourceId}) → ${m.targetKey}; member IDs: ${m.memberIds.join(', ')||'none'}`),
    '', '## Assignments that cannot be migrated (original roles retained)',...items(p.unmigrated,m=>`${m.roleName} (${m.roleId}); members: ${m.memberIds?.join(', ')??'unknown'}; ${m.reason}`),
    '', '## Blocking conditions',...items(p.blockers,x=>`⛔ ${x}`),
    '', '## Warnings',...items(p.warnings,x=>x),
    '', '## Permissions the bot cannot delegate',...items(p.missingRights,x=>`${x.role}: ${x.missing.join(', ')}`),
    `Channel overwrite permission gaps: ${p.missingChannelRights.join(', ')||'None'}. Unsupported bits are omitted; review capabilities before approval.`,
    '', '**Deletion is irreversible.** Configuration and member-role assignments are backed up when inventory is available; messages and attachments are not. Backups contain member IDs; restrict artifact access.',
    'Preview performs no Discord writes. Rebuild must reference this successful preview run and the same code revision, plus the exact guild ID and deletion phrase.',
    'No members are kicked or banned. The server cannot be deleted by the rebuild write allowlist.',
    '',
  ].join('\n');
}
