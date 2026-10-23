import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareEdit,serverInventory,revision,previewEdit,applyEdit} from '../src/editor.mjs';
import {P} from '../src/permissions.mjs';
import {ID,LEGACY,BOT_ROLE,sample,fakeServer} from './helpers/fake.mjs';
const roleRequest=(s,values={name:'updated role'})=>({kind:'role',action:'update',id:LEGACY,revision:revision('role',s.roles.find(r=>r.id===LEGACY)),values});
const channelRequest=(s,values={name:'updated-channel'})=>({kind:'channel',action:'update',id:s.channels[1].id,revision:revision('channel',s.channels[1]),values});
function temp(t) {
  const root=path.resolve(os.tmpdir()),directory=fs.mkdtempSync(path.join(root,'cortex-editor-'));
  t.after(()=>{if(path.dirname(path.resolve(directory))!==root||!path.basename(directory).startsWith('cortex-editor-'))throw new Error('Invalid cleanup target');fs.rmSync(directory,{recursive:true,force:true});});return directory;
}
test('inventory exposes current categories, channels, role colors, permission flags and revisions',()=>{
  const s=sample(),inventory=serverInventory(s);
  assert.equal(inventory.channels.length,2);assert.equal(inventory.roles.length,5);
  assert.ok(inventory.roles.every(r=>r.revision&&Array.isArray(r.flags)));
  assert.ok(inventory.roles.find(r=>r.name==='★ OWNER ★').readOnlyReason);
});
test('manual editor rejects leadership aliases, everyone, managed and high roles',()=>{
  for(const name of ['★ OWNER ★','★OWNER★','★ CO_OWNER ★','★ CO OWNER ★','★ CO_OWNER\u200b ★']) {
    const s=sample();s.roles.find(r=>r.id===LEGACY).name=name;
    assert.throws(()=>prepareEdit(s,roleRequest(s)),/محمية/);
  }
  const s=sample();for(const r of s.roles.filter(r=>r.id!==LEGACY))assert.throws(()=>prepareEdit(s,{...roleRequest(s),id:r.id,revision:revision('role',r)}));
});

test('raising only the bot role unlocks permission editing while leadership remains protected',()=>{
  const s=sample(),target=s.roles.find(r=>r.id===LEGACY),botRole=s.roles.find(r=>r.id===BOT_ROLE);
  target.position=21;
  const locked=serverInventory(s);assert.equal(locked.botRole.id,BOT_ROLE);
  assert.equal(locked.roles.find(r=>r.id===LEGACY).readOnlyReason,'role at or above the bot hierarchy');
  assert.throws(()=>prepareEdit(s,{...roleRequest(s,{}),permissionChanges:{ManageMessages:true}}),/محمية/);
  botRole.position=22;
  const unlocked=serverInventory(s),role=unlocked.roles.find(r=>r.id===LEGACY);
  assert.equal(role.revision,locked.roles.find(r=>r.id===LEGACY).revision);assert.equal(role.readOnlyReason,null);
  assert.ok(unlocked.roles.filter(r=>r.name.includes('OWNER')).every(r=>r.readOnlyReason));
  const edit=prepareEdit(s,{...roleRequest(s,{}),permissionChanges:{ManageMessages:true}});
  assert.equal(BigInt(edit.body.permissions)&P.ManageMessages,P.ManageMessages);
});
test('manual role edit preserves unknown permission bits and never changes hierarchy/members',()=>{
  const s=sample(),r=s.roles.find(r=>r.id===LEGACY);r.permissions=String(1n<<60n);
  const p=prepareEdit(s,{...roleRequest(s),permissionChanges:{SendMessages:true}});
  assert.equal(p.body.permissions,String((1n<<60n)|P.SendMessages));assert.ok(!('position' in p.body));assert.ok(!('roles' in p.body));
});
test('permission escalation beyond bot capabilities is rejected, not silently capped',()=>{
  const s=sample();s.roles.find(r=>r.id===BOT_ROLE).permissions=String(P.ManageRoles|P.ViewChannel);
  assert.throws(()=>prepareEdit(s,{...roleRequest(s),permissionChanges:{Administrator:true}}),/لا يستطيع/);
});
test('Community protected channels and parents cannot be edited',()=>{
  const s=sample();s.guild.rules_channel_id=s.channels[1].id;
  assert.throws(()=>prepareEdit(s,channelRequest(s)),/محمي/);
  assert.throws(()=>prepareEdit(s,{...channelRequest(s),id:s.channels[0].id,revision:revision('channel',s.channels[0])}),/محمي/);
});
test('channel overwrites preserve members, leadership and unknown bits while applying a selected role change',()=>{
  const s=sample(),unknown=String(1n<<59n);
  s.channels[1].permission_overwrites=[{id:'123456789012345678',type:1,allow:unknown,deny:'0'},{id:'999999999999999991',type:0,allow:'1024',deny:'0'},{id:LEGACY,type:0,allow:unknown,deny:'0'}];
  const p=prepareEdit(s,{...channelRequest(s),overwriteChanges:[{roleId:LEGACY,permissions:{ViewChannel:'deny'}}]});
  for(const original of s.channels[1].permission_overwrites.filter(w=>w.id!==LEGACY))assert.deepEqual(p.body.permission_overwrites.find(w=>w.id===original.id),original);
  const edited=p.body.permission_overwrites.find(w=>w.id===LEGACY);assert.equal(edited.allow,unknown);assert.equal(edited.deny,String(P.ViewChannel));
});
test('leadership and managed bot channel overwrites cannot be modified',()=>{
  const s=sample();for(const roleId of [BOT_ROLE,'999999999999999991'])assert.throws(()=>prepareEdit(s,{...channelRequest(s),overwriteChanges:[{roleId,permissions:{ViewChannel:'deny'}}]}),/محفوظة/);
});
test('duplicates, invalid IDs, type conversion, out-of-range fields and delete requests are rejected',()=>{
  const s=sample();assert.throws(()=>prepareEdit(s,{...roleRequest(s),action:'delete'}));
  assert.throws(()=>prepareEdit(s,channelRequest(s,{type:2})));assert.throws(()=>prepareEdit(s,channelRequest(s,{rate_limit_per_user:21601})));
  assert.throws(()=>prepareEdit(s,channelRequest(s,{parent_id:'123456789012345678'})));
  assert.throws(()=>prepareEdit(s,{kind:'role',action:'create',values:{name:'★ OWNER ★'}}));
  assert.throws(()=>prepareEdit(s,{kind:'role',action:'create',values:{name:'legacy'}}));
});
test('revision drift and attempts to lock the bot out are rejected',()=>{
  const s=sample(),request=channelRequest(s);s.channels[1].topic='changed elsewhere';assert.throws(()=>prepareEdit(s,request),/تغير العنصر/);
  s.roles.find(r=>r.id===BOT_ROLE).permissions=String(P.ManageChannels|P.ManageRoles|P.ViewChannel);
  assert.throws(()=>prepareEdit(s,{...channelRequest(s),overwriteChanges:[{roleId:ID,permissions:{ViewChannel:'deny'}}]}),/سيمنع البوت/);
});
test('new child channel inherits parent overwrites and creates no duplicate',()=>{
  const s=sample();s.channels[0].permission_overwrites=[{id:ID,type:0,allow:'0',deny:'1024'}];
  const p=prepareEdit(s,{kind:'channel',action:'create',values:{name:'new-room',type:0,parent_id:s.channels[0].id}});
  assert.deepEqual(p.body.permission_overwrites,s.channels[0].permission_overwrites);
});
test('edit preview performs only reads; apply requires exact approval and backs up before its single write',async t=>{
  const s=sample(),directory=temp(t),server=fakeServer(s,{beforeCall(){const backups=path.join(directory,'edit-backups');assert.ok(fs.readdirSync(backups).some(name=>fs.existsSync(path.join(backups,name,'snapshot.json'))));}}),p=await previewEdit(server.api,ID,roleRequest(s),directory);
  assert.equal(server.calls.length,0);
  await assert.rejects(applyEdit(server.api,ID,{confirmed:false,guildId:ID,approvalHash:p.approvalHash},directory));assert.equal(server.calls.length,0);
  const result=await applyEdit(server.api,ID,{confirmed:true,guildId:ID,approvalHash:p.approvalHash},directory);
  assert.ok(result.success);assert.equal(server.calls.length,1);assert.equal(server.calls[0].method,'PATCH');assert.equal(server.calls[0].path,`/guilds/${ID}/roles/${LEGACY}`);
  assert.ok(fs.readdirSync(path.join(directory,'edit-backups')).length);assert.equal(server.state.roles.find(r=>r.id===LEGACY).name,'updated role');
});
test('normalized duplicates and no-op overwrite additions are rejected',()=>{
  const s=sample();assert.throws(()=>prepareEdit(s,{kind:'role',action:'create',values:{name:'LEGACY'}}),/نفس الاسم/);
  assert.throws(()=>prepareEdit(s,{kind:'channel',action:'create',values:{name:'OLD CHAT',type:0,parent_id:s.channels[0].id}}),/نفس الاسم/);
  assert.throws(()=>prepareEdit(s,{...channelRequest(s,{}),overwriteChanges:[{roleId:LEGACY,permissions:{ViewChannel:'inherit'}}]}),/لا توجد تغييرات/);
});
test('changed server after edit preview aborts without any mutation',async t=>{
  const s=sample(),server=fakeServer(s),directory=temp(t),p=await previewEdit(server.api,ID,roleRequest(s),directory);
  server.state.roles.find(r=>r.id===LEGACY).name='renamed elsewhere';
  await assert.rejects(applyEdit(server.api,ID,{confirmed:true,guildId:ID,approvalHash:p.approvalHash},directory));assert.equal(server.calls.length,0);
});

test('edit conflicts distinguish code updates, entity drift and other configuration changes',async t=>{
  for(const reason of ['source_changed','entity_changed','configuration_changed']) {
    const s=sample(),server=fakeServer(s),directory=temp(t),p=await previewEdit(server.api,ID,roleRequest(s),directory);
    if(reason==='source_changed'){
      const file=path.join(directory,'edit-plan.json'),reviewed=JSON.parse(fs.readFileSync(file));reviewed.sourceHash='old-build';fs.writeFileSync(file,JSON.stringify(reviewed));
    }else if(reason==='entity_changed')server.state.roles.find(r=>r.id===LEGACY).name='another edit';
    else server.state.channels[1].name='another-channel-edit';
    await assert.rejects(applyEdit(server.api,ID,{confirmed:true,guildId:ID,approvalHash:p.approvalHash},directory),error=>error.code==='EDIT_CONFLICT');
    assert.equal(server.calls.length,0);const report=JSON.parse(fs.readFileSync(path.join(directory,'edit-conflict.json')));assert.equal(report.reason,reason);
    if(reason==='configuration_changed')assert.deepEqual(report.changedSections,['channels']);
  }
});
