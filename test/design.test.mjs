import test from 'node:test';
import assert from 'node:assert/strict';
import {CATEGORIES,ROLES} from '../src/design.mjs';
import {P,bits,botPermissions,effectiveRolePermissions,createOverwrites} from '../src/permissions.mjs';
import {plan,renderPreview,validateDesign} from '../src/plan.mjs';
const ID='111111111111111111';
function sample(){return {
  captured_at:'2026-10-23T00:00:00Z',
  guild:{id:ID,name:'Real Friends',owner_id:'444444444444444444',rules_channel_id:null,public_updates_channel_id:null},
  bot:{id:'222222222222222222',username:'Cortex Manager'},
  botMember:{roles:['333333333333333333']},
  roles:[
    {id:ID,name:'@everyone',position:0,permissions:String(P.ViewChannel|P.SendMessages),managed:false},
    {id:'333333333333333333',name:'Cortex Manager',position:20,permissions:String(P.ManageChannels|P.ManageRoles|P.ViewChannel|P.SendMessages),managed:true},
    {id:'555555555555555555',name:'legacy',position:1,permissions:'0',managed:false},
  ],
  channels:[
    {id:'666666666666666666',name:'old-cat',type:4,permission_overwrites:[]},
    {id:'777777777777777777',name:'old-chat',type:0,parent_id:'666666666666666666',permission_overwrites:[]},
  ]
}}
test('unique design keys, human-oriented pro layout',()=>{
 assert.doesNotThrow(validateDesign);
 assert.equal(ROLES.length,13);
 assert.equal(CATEGORIES.length,7);
 assert.equal(CATEGORIES.reduce((n,c)=>n+c.channels.length,0),31);
});
test('plan includes deletion only of old non-managed structures',()=>{
 const s=sample(),p=plan(s);
 assert.equal(p.totals.createRoles,13);
 assert.equal(p.totals.createChannels,31);
 assert.equal(p.totals.deleteChannels,2);
 assert.equal(p.totals.deleteRoles,1);
 assert.equal(p.blockers.length,0);
 assert.ok(renderPreview(s,p).includes('PERMANENTLY DELETE 2 previous channels'));
});
test('bot assigned roles are always kept, not self-destructed',()=>{
 const s=sample();s.roles.find(r=>r.id===s.botMember.roles[0]).managed=false;
 const p=plan(s);
 assert.equal(p.oldRoles.length,1);
 assert.ok(p.keepManaged.some(r=>r.name==='Cortex Manager'));
});
test('protected Community channel blocks erase',()=>{
 const s=sample();s.guild.rules_channel_id='777777777777777777';
 const p=plan(s);
 assert.ok(p.blockers.some(x=>x.includes('Community protected channels')));
});
test('role above bot blocks erase',()=>{
 const s=sample();s.roles.find(r=>r.name==='legacy').position=30;
 assert.ok(plan(s).blockers.some(x=>x.includes('Roles not below bot')));
});
test('role permissions capped by bot privilege and reported',()=>{
 const s=sample(),p=plan(s);
 assert.ok(p.missingRights.some(m=>m.role.includes('Administrator')));
 const grant=effectiveRolePermissions(['ManageRoles','KickMembers'],botPermissions(s));
 assert.deepEqual(grant.missing,['KickMembers']);
 assert.equal(grant.granted,P.ManageRoles);
});
test('staff and VIP visibility deny everyone; bot receives explicit override',()=>{
 const roleIds={muted:'999999999999999999',admin:'888888888888888888',vip:'101010101010101010'};
 const staff=CATEGORIES.find(c=>c.key==='staff');
 const w=createOverwrites(staff,roleIds,ID,'222222222222222222');
 assert.ok((BigInt(w.find(x=>x.id===ID).deny)&P.ViewChannel)!==0n);
 assert.ok(w.some(x=>x.id==='222222222222222222'&&x.type===1));
 const voice=CATEGORIES.find(c=>c.key==='voice');
 const vip=createOverwrites(voice,roleIds,ID,'222222222222222222',{vipOnly:true});
 assert.ok((BigInt(vip.find(x=>x.id===ID).deny)&P.ViewChannel)!==0n);
 assert.ok(vip.some(x=>x.id===roleIds.vip));
});
test('muted role gets per-category SendMessages deny',()=>{
 const all=CATEGORIES.map(c=>createOverwrites(c,{muted:'999999999999999999'},ID,'222222222222222222'));
 assert.ok(all.every(list=>list.some(x=>x.id==='999999999999999999'&&(BigInt(x.deny)&P.SendMessages)!==0n)));
});
