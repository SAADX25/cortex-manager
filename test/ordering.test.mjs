import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareEdit,previewEdit,applyEdit,revision,editSummary} from '../src/editor.mjs';
import {sample,fakeServer,ID,LEGACY,BOT_ROLE} from './helpers/fake.mjs';
const SECOND='555555555555555556',THIRD='555555555555555557',CAT='666666666666666667',CHAT='777777777777777778';
function fixture(){const s=sample();s.roles.push({...s.roles.find(r=>r.id===LEGACY),id:SECOND,name:'second',position:2},{...s.roles.find(r=>r.id===LEGACY),id:THIRD,name:'third',position:3});s.channels[0].position=0;s.channels[1].position=0;s.channels.push({id:CAT,name:'new-category',type:4,position:1,permission_overwrites:[]},{id:CHAT,name:'another-chat',type:0,parent_id:CAT,position:0,permission_overwrites:[]});return s;}
const request=(s,kind,id,target_id,placement='before')=>({kind,action:'move',id,revision:revision(kind,(kind==='role'?s.roles:s.channels).find(x=>x.id===id)),values:{target_id,placement}});
function temp(t){const root=path.resolve(os.tmpdir()),directory=fs.mkdtempSync(path.join(root,'cortex-order-'));t.after(()=>{if(path.dirname(path.resolve(directory))!==root||!path.basename(directory).startsWith('cortex-order-'))throw new Error('Bad cleanup');fs.rmSync(directory,{recursive:true,force:true});});return directory;}
test('role movement contains positions only and cannot cross or include protected roles',()=>{
 const s=fixture(),p=prepareEdit(s,request(s,'role',LEGACY,THIRD));assert.deepEqual(p.body,[{id:LEGACY,position:3},{id:THIRD,position:2},{id:SECOND,position:1}]);assert.match(editSummary(p),/نقل/);
 for(const id of [BOT_ROLE,ID,'999999999999999991','999999999999999992'])assert.throws(()=>prepareEdit(s,request(s,'role',id,LEGACY)),/محمي/);
 s.roles.find(r=>r.id===SECOND).managed=true;assert.throws(()=>prepareEdit(s,request(s,'role',LEGACY,THIRD)),/محمي/);
});
test('channel movement reorders within a category and moves to another without sending overwrites or sync',()=>{
 const s=fixture(),p=prepareEdit(s,request(s,'channel',s.channels[1].id,CHAT));assert.equal(p.body.find(c=>c.id===s.channels[1].id).parent_id,CAT);assert.deepEqual(p.body,[{id:s.channels[1].id,position:0,parent_id:CAT},{id:CHAT,position:1}]);
 assert.ok(p.body.every(c=>Object.keys(c).every(k=>['id','position','parent_id'].includes(k))));
 const same=structuredClone(s);same.channels.find(c=>c.id===CHAT).parent_id=same.channels[0].id;same.channels.find(c=>c.id===CHAT).position=1;assert.deepEqual(prepareEdit(same,request(same,'channel',CHAT,same.channels[1].id)).body,[{id:CHAT,position:0},{id:same.channels[1].id,position:1}]);
});
test('movement rejects protected parents, type mismatches, full destinations, duplicate names and permission payloads',()=>{
 const s=fixture(),r=request(s,'channel',s.channels[1].id,CAT,'inside');
 for(const mutate of [s=>s.guild.rules_channel_id=s.channels[1].id,s=>s.guild.rules_channel_id=CHAT,s=>s.channels.find(c=>c.id===CHAT).name=s.channels[1].name,s=>{for(let i=0;i<49;i++)s.channels.push({id:String(800000000000000000n+BigInt(i)),name:'x'+i,type:0,parent_id:CAT});},s=>s.roles.find(r=>r.id===BOT_ROLE).permissions='0']){const current=structuredClone(s);mutate(current);assert.throws(()=>prepareEdit(current,r));}
 assert.throws(()=>prepareEdit(s,{...r,values:{...r.values,permission_overwrites:[]}}));assert.throws(()=>prepareEdit(s,{...r,permissionChanges:{Administrator:true}}));
 const voice=structuredClone(s);voice.channels.find(c=>c.id===CHAT).type=2;assert.throws(()=>prepareEdit(voice,request(voice,'channel',voice.channels[1].id,CHAT)),/النصية/);
});
test('category moves preserve protected categories and reject attempts to pass one',()=>{
 const s=fixture(),p=prepareEdit(s,request(s,'channel',CAT,s.channels[0].id));assert.deepEqual(p.body,[{id:CAT,position:0},{id:s.channels[0].id,position:1}]);
 s.guild.rules_channel_id=s.channels[1].id;assert.throws(()=>prepareEdit(s,request(s,'channel',CAT,s.channels[0].id)),/محمي/);
});
test('movement preview only reads; confirmed save performs one bounded PATCH and preserves permissions and memberships',async t=>{
 const s=fixture(),server=fakeServer(s),dir=temp(t),p=await previewEdit(server.api,ID,request(s,'channel',s.channels[1].id,CAT,'inside'),dir);assert.equal(server.calls.length,0);
 await assert.rejects(applyEdit(server.api,ID,{confirmed:false,guildId:ID,approvalHash:p.approvalHash},dir));
 const result=await applyEdit(server.api,ID,{confirmed:true,guildId:ID,approvalHash:p.approvalHash},dir);assert.equal(result.success,true);assert.equal(server.calls.length,1);assert.equal(server.calls[0].path,`/guilds/${ID}/channels`);
 assert.deepEqual(server.state.roles,s.roles);assert.deepEqual(server.state.members,s.members);assert.deepEqual(server.state.channels[1].permission_overwrites,s.channels[1].permission_overwrites);
 await assert.rejects(applyEdit(server.api,ID,{confirmed:true,guildId:ID,approvalHash:p.approvalHash},dir));assert.equal(server.calls.length,1);
});
test('role reorder uses the same confirmed flow and intervening hierarchy changes abort before writes',async t=>{
 const s=fixture(),server=fakeServer(s),dir=temp(t),p=await previewEdit(server.api,ID,request(s,'role',LEGACY,THIRD),dir);
 server.state.roles.find(r=>r.id===SECOND).managed=true;await assert.rejects(applyEdit(server.api,ID,{confirmed:true,guildId:ID,approvalHash:p.approvalHash},dir));assert.equal(server.calls.length,0);
 server.state.roles.find(r=>r.id===SECOND).managed=false;await applyEdit(server.api,ID,{confirmed:true,guildId:ID,approvalHash:p.approvalHash},dir);assert.deepEqual(server.state.members,s.members);assert.deepEqual(server.state.roles.filter(r=>r.name.includes('OWNER')),s.roles.filter(r=>r.name.includes('OWNER')));
});
