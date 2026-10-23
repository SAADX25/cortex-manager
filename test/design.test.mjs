import test from 'node:test';
import assert from 'node:assert/strict';
import {CATEGORIES,ROLES} from '../src/design.mjs';
import {P,bits,botPermissions,effectiveRolePermissions,createOverwrites} from '../src/permissions.mjs';
import {plan,renderPreview,validateDesign} from '../src/plan.mjs';
import {PROTECTED_ROLE_NAMES,guardedAPI,fingerprint,assertConfirmation,CONFIRMATION} from '../src/safety.mjs';
import {ID,BOT,BOT_ROLE,LEGACY,MEMBER,sample} from './helpers/fake.mjs';

test('professional design has unique roles and fully Arabic channel/category names',()=>{
  assert.doesNotThrow(validateDesign);assert.equal(ROLES.length,11);assert.equal(CATEGORIES.length,7);
  assert.equal(CATEGORIES.flatMap(c=>c.channels).length,31);
  assert.ok(CATEGORIES.every(c=>/\p{Script=Arabic}/u.test(c.name)&&c.channels.every(ch=>/\p{Script=Arabic}/u.test(ch.name))));
  assert.ok(ROLES.every(r=>!PROTECTED_ROLE_NAMES.includes(r.name)&&!['founder','coowner'].includes(r.key)));
  assert.equal(new Set(ROLES.map(r=>r.color)).size,ROLES.length);
});
test('OWNER and CO_OWNER above bot are preserved, never blockers or migration sources',()=>{
  const s=sample(),p=plan(s);assert.equal(p.blockers.length,0);assert.equal(p.oldRoles.length,1);
  assert.ok(PROTECTED_ROLE_NAMES.every(n=>p.keepRoles.some(r=>r.name===n)));
  const owner=s.roles.find(r=>r.name===PROTECTED_ROLE_NAMES[0]);
  assert.ok(plan(s,{[owner.id]:'admin'}).blockers.length);
});
test('everyone, integrations, bot-assigned, and unmanageable roles are retained',()=>{
  const s=sample();s.roles.find(r=>r.id===BOT_ROLE).managed=false;
  s.roles.push({id:'999999999999999993',name:'integration',tags:{integration_id:'123'},managed:false,permissions:'0',position:2});
  s.roles.find(r=>r.id===LEGACY).position=40;
  const p=plan(s);assert.equal(p.oldRoles.length,0);assert.equal(p.blockers.length,0);
  assert.ok(p.keepRoles.some(r=>r.id===BOT_ROLE));assert.ok(p.keepRoles.some(r=>r.id===ID));
});
test('Community rules, updates, other guild links and parents are untouched and not blockers',()=>{
  const s=sample();s.channels[1].name='rules';s.guild.rules_channel_id=s.channels[1].id;
  s.channels.push({id:'999999999999999994',name:'moderator-only',type:0,parent_id:s.channels[0].id});
  s.guild.public_updates_channel_id=s.channels[2].id;
  const p=plan(s);assert.equal(p.oldChannels.length,0);assert.equal(p.blockers.length,0);
  assert.equal(p.preservedSlots.rules,s.channels[1].id);assert.equal(p.preservedSlots.audit,s.channels[2].id);
  assert.equal(p.totals.createChannels,29);
});
test('inaccessible channel and its parent are retained',()=>{
  const s=sample();s.roles.find(r=>r.id===BOT_ROLE).permissions=String(P.ManageRoles|P.ManageChannels|P.ViewChannel);
  s.channels[1].permission_overwrites=[{id:BOT,type:1,allow:'0',deny:String(P.ManageChannels)}];
  assert.equal(plan(s).oldChannels.length,0);
});
test('assigned roles without explicit mapping retained and fully reported',()=>{
  const s=sample();s.members.find(m=>m.id===MEMBER).roles=[LEGACY];const p=plan(s);
  assert.equal(p.oldRoles.length,0);assert.deepEqual(p.unmigrated[0].memberIds,[MEMBER]);
  const mapped=plan(s,{[LEGACY]:'member'});assert.equal(mapped.oldRoles.length,1);assert.equal(mapped.migrations[0].targetKey,'member');
});
test('missing member inventory retains every obsolete role',()=>{
  const s=sample();s.membersComplete=false;s.members=[];const p=plan(s);
  assert.equal(p.oldRoles.length,0);assert.ok(p.unmigrated.length);assert.equal(p.blockers.length,0);
});
test('roles referenced by preserved channels are retained even with a mapping',()=>{
  const s=sample();s.guild.rules_channel_id=s.channels[1].id;
  s.channels[1].permission_overwrites=[{id:LEGACY,type:0,allow:String(P.ViewChannel),deny:'0'}];
  assert.equal(plan(s,{[LEGACY]:'member'}).oldRoles.length,0);
});
test('ambiguous names block creation instead of duplicating',()=>{
  const s=sample();s.roles.push({...s.roles[2],id:'999999999999999995',name:ROLES[0].name});
  s.roles.push({...s.roles[2],id:'999999999999999996',name:ROLES[0].name});
  assert.ok(plan(s).blockers.some(b=>b.includes('duplicate')));
});
test('report contains full creation, deletion, preservation, migration and permission lists',()=>{
  const s=sample(),p=plan(s),report=renderPreview(s,p);
  assert.ok(report.includes('PERMANENTLY DELETE 2 previous channels'));assert.ok(report.includes(p.approvalHash));
  for(const r of ROLES)assert.ok(report.includes(r.name));
  for(const c of s.channels)assert.ok(report.includes(c.id));
});
test('role privileges and overwrite permissions capped by bot capabilities',()=>{
  const s=sample();s.roles.find(r=>r.id===BOT_ROLE).permissions=String(P.ManageRoles|P.ManageChannels|P.ViewChannel|P.SendMessages);
  assert.ok(plan(s).missingRights.some(m=>m.role.includes('Administrator')));
  assert.deepEqual(effectiveRolePermissions(['ManageRoles','KickMembers'],botPermissions(s)),{granted:P.ManageRoles,missing:['KickMembers']});
  const ws=createOverwrites(CATEGORIES.find(c=>c.key==='staff'),{admin:LEGACY},ID,BOT,{},botPermissions(s));
  assert.ok(ws.every(w=>((BigInt(w.allow)|BigInt(w.deny))&~botPermissions(s))===0n));
  assert.ok(BigInt(ws.find(w=>w.id===ID).deny)&P.ViewChannel);
});
test('private staff and VIP areas allow preserved leadership with no role edits',()=>{
  const roleIds={muted:LEGACY,admin:'999999999999999997',vip:'999999999999999998',leadership:['999999999999999991','999999999999999992']};
  for(const [cat,ch] of [[CATEGORIES.find(c=>c.key==='staff'),{}],[CATEGORIES.find(c=>c.key==='voice'),{vipOnly:true}]]) {
    const ws=createOverwrites(cat,roleIds,ID,BOT,ch);
    assert.ok(BigInt(ws.find(w=>w.id===ID).deny)&P.ViewChannel);
    for(const id of roleIds.leadership)assert.ok(BigInt(ws.find(w=>w.id===id).allow)&P.ViewChannel);
    assert.ok(ws.some(w=>w.id===BOT&&w.type===1));
  }
});
test('every category restricts the muted role, read-only rooms deny thread creation',()=>{
  for(const c of CATEGORIES)assert.ok(createOverwrites(c,{muted:LEGACY},ID,BOT).some(w=>w.id===LEGACY&&(BigInt(w.deny)&P.SendMessages)));
  const ws=createOverwrites(CATEGORIES[0],{},ID,BOT,{readonly:true});
  assert.ok(BigInt(ws.find(w=>w.id===ID).deny)&bits(['SendMessages','CreatePublicThreads','CreatePrivateThreads','SendMessagesInThreads']));
});
test('fingerprint catches configuration and member drift but ignores chat activity and array order',()=>{
  const s=sample(),copy=structuredClone(s);copy.roles.reverse();copy.channels[1].last_message_id='new';copy.captured_at='later';
  assert.equal(fingerprint(s),fingerprint(copy));copy.roles[0].permissions='123';assert.notEqual(fingerprint(s),fingerprint(copy));
  const changed=structuredClone(s);changed.members[1].roles=[LEGACY];assert.notEqual(fingerprint(s),fingerprint(changed));
});
test('confirmation needs exact phrase and guild ID',()=>{
  assert.throws(()=>assertConfirmation({},ID));assert.throws(()=>assertConfirmation({CONFIRM_DELETE:CONFIRMATION,CONFIRM_GUILD_ID:'wrong'},ID));
  assert.doesNotThrow(()=>assertConfirmation({CONFIRM_DELETE:CONFIRMATION,CONFIRM_GUILD_ID:ID},ID));
});
test('write allowlist rejects protected roles, full member updates, kicks, bans and guild deletion',async()=>{
  const s=sample(),p=plan(s),writes=[];const api=guardedAPI({call:async(...a)=>writes.push(a)},s,p);
  for(const [method,path] of [
    ['DELETE',`/guilds/${ID}`],['DELETE',`/guilds/${ID}/members/${MEMBER}`],['PUT',`/guilds/${ID}/bans/${MEMBER}`],
    ['PATCH',`/guilds/${ID}/members/${MEMBER}`],['PATCH',`/guilds/${ID}/roles`],
    ...s.roles.filter(r=>r.id!==LEGACY).flatMap(r=>[['DELETE',`/guilds/${ID}/roles/${r.id}`],['PATCH',`/guilds/${ID}/roles/${r.id}`],['DELETE',`/guilds/${ID}/members/${MEMBER}/roles/${r.id}`]]),
  ])await assert.rejects(api.call(method,path,{}),/Safety guard rejected/);
  assert.equal(writes.length,0);
});
