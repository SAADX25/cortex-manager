import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareMessage,previewMessage,sendMessage,messageProtection} from '../src/messages.mjs';
import {P} from '../src/permissions.mjs';
import {sample,fakeServer,ID,BOT_ROLE} from './helpers/fake.mjs';

function temp(t){const base=path.resolve(os.tmpdir()),dir=fs.mkdtempSync(path.join(base,'cortex-message-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),base);assert.match(path.basename(dir),/^cortex-message-/);fs.rmSync(dir,{recursive:true,force:true});});return dir;}
const request=s=>({channelId:s.channels[1].id,content:'أهلًا بالجميع 🎮 @everyone <@123456789012345678>'});
const confirmation=p=>({confirmed:true,guildId:p.guildId,channelId:p.channelId,approvalHash:p.approvalHash});

test('messages validate destination, size and fields and disable every automatic mention',()=>{
  const s=sample(),nonce='a'.repeat(24),p=prepareMessage(s,request(s),nonce);
  assert.deepEqual(p.body.allowed_mentions,{parse:[],replied_user:false});assert.equal(p.body.enforce_nonce,true);assert.equal(p.body.nonce,nonce);
  for(const bad of [{...request(s),channelId:s.channels[0].id},{...request(s),channelId:'999999999999999999'},{...request(s),content:' '},{...request(s),content:'x'.repeat(2001)},{...request(s),allowed_mentions:{parse:['everyone']}}])assert.throws(()=>prepareMessage(s,bad,nonce));
});

test('message permissions use channel and member overwrites without requiring Manage Channels',()=>{
  const s=sample();s.roles.find(r=>r.id===BOT_ROLE).permissions=String(P.ViewChannel|P.SendMessages|P.Connect);
  assert.equal(messageProtection(s,s.channels[1]),null);s.channels[1].type=2;assert.equal(messageProtection(s,s.channels[1]),null);
  s.channels[1].permission_overwrites=[{id:s.bot.id,type:1,allow:'0',deny:String(P.SendMessages)}];assert.match(messageProtection(s,s.channels[1]),/إرسال الرسائل/);
  s.channels[1].permission_overwrites=[];s.roles.find(r=>r.id===BOT_ROLE).permissions=String(P.ViewChannel|P.SendMessages);assert.match(messageProtection(s,s.channels[1]),/الاتصال/);
});

test('preview performs reads only and sending needs exact confirmation, writes one message and prevents replay',async t=>{
  const s=sample(),server=fakeServer(s),directory=temp(t),p=await previewMessage(server.api,ID,request(s),directory);
  assert.equal(server.calls.length,0);
  for(const bad of [{...confirmation(p),confirmed:false},{...confirmation(p),channelId:s.channels[0].id},{...confirmation(p),approvalHash:'wrong'}])await assert.rejects(sendMessage(server.api,ID,bad,directory));
  assert.equal(server.calls.length,0);const result=await sendMessage(server.api,ID,confirmation(p),directory);assert.equal(result.success,true);
  assert.deepEqual(server.calls.map(c=>[c.method,c.path]),[['POST',`/channels/${p.channelId}/messages`]]);
  assert.equal(server.calls[0].body.content,request(s).content);assert.deepEqual(server.calls[0].body.allowed_mentions.parse,[]);
  await assert.rejects(sendMessage(server.api,ID,confirmation(p),directory),/سبق بدء/);assert.equal(server.calls.length,1);
});

test('live permission loss and tampered content block sending, while unrelated chat activity does not',async t=>{
  const s=sample(),server=fakeServer(s),directory=temp(t),p=await previewMessage(server.api,ID,request(s),directory);
  server.state.roles.find(r=>r.id===BOT_ROLE).permissions='0';server.state.roles[0].permissions='0';
  await assert.rejects(sendMessage(server.api,ID,confirmation(p),directory));assert.equal(server.calls.length,0);
  server.state.roles.find(r=>r.id===BOT_ROLE).permissions=String(P.Administrator);
  const file=path.join(directory,'message-plan.json'),original=fs.readFileSync(file,'utf8'),changed=JSON.parse(original);changed.request.content='tampered';fs.writeFileSync(file,JSON.stringify(changed));
  await assert.rejects(sendMessage(server.api,ID,confirmation(p),directory));assert.equal(server.calls.length,0);fs.writeFileSync(file,original);
  server.state.channels[1].last_message_id='999999999999999999';const result=await sendMessage(server.api,ID,confirmation(p),directory);assert.equal(result.success,true);
});

test('ambiguous send failure is recorded and cannot be retried with the same approval',async t=>{
  const s=sample(),server=fakeServer(s,{beforeCall(){throw new Error('Simulated transport loss');}}),directory=temp(t),p=await previewMessage(server.api,ID,request(s),directory);
  await assert.rejects(sendMessage(server.api,ID,confirmation(p),directory),/transport/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'message-result.json'))).status,'failed-or-unknown');
  await assert.rejects(sendMessage(server.api,ID,confirmation(p),directory),/سبق بدء/);assert.equal(server.calls.length,1);
});

test('embed cards validate Discord limits and require effective EmbedLinks permission',()=>{
  const s=sample(),nonce='a'.repeat(24),embeds=[{title:'📜 قوانين',description:'أهلًا بالجميع',color:9274367,fields:[{name:'🤝 الاحترام',value:'Respect everyone',inline:false}],footer:{text:'Gaming community'}}],req={channelId:s.channels[1].id,content:'',embeds};
  assert.deepEqual(prepareMessage(s,req,nonce).body.embeds,embeds);
  const bad=[[],Array(11).fill(embeds[0]),[{title:'x'.repeat(257)}],[{description:'x'.repeat(4097)}],[{fields:[{name:'a',value:'x'.repeat(1025)}]}],[{title:'x',color:'#123456'}],[{title:'x',url:'https://example.com'}],[{title:'x',footer:{text:'x',icon_url:'file:///x'}}],[{title:'x',fields:[{name:'a',value:'b',inline:'yes'}]}],[{description:'a'.repeat(3100)},{description:'b'.repeat(3100)}],[{}]];
  for(const value of bad)assert.throws(()=>prepareMessage(s,{...req,embeds:value},nonce));
  s.roles[0].permissions='0';s.roles.find(r=>r.id===BOT_ROLE).permissions=String(P.ViewChannel|P.SendMessages);
  assert.throws(()=>prepareMessage(s,req,nonce),/Embed Links/);
  s.roles.find(r=>r.id===BOT_ROLE).permissions=String(P.ViewChannel|P.SendMessages|P.EmbedLinks);
  assert.doesNotThrow(()=>prepareMessage(s,req,nonce));
  s.channels[1].permission_overwrites=[{id:s.bot.id,type:1,allow:'0',deny:String(P.EmbedLinks)}];assert.throws(()=>prepareMessage(s,req,nonce),/Embed Links/);
});

test('reviewed bilingual embeds send once, preserve exact design and reject changed cards',async t=>{
  const s=sample(),server=fakeServer(s),directory=temp(t),req={channelId:s.channels[1].id,content:'',embeds:[{title:'قوانين',description:'احترم الجميع',color:9274367},{title:'Rules',description:'Respect everyone',color:5025616}]};
  const p=await previewMessage(server.api,ID,req,directory);assert.equal(server.calls.length,0);
  const file=path.join(directory,'message-plan.json'),original=fs.readFileSync(file,'utf8'),changed=JSON.parse(original);changed.request.embeds[0].description='changed';fs.writeFileSync(file,JSON.stringify(changed));
  await assert.rejects(sendMessage(server.api,ID,confirmation(p),directory));assert.equal(server.calls.length,0);fs.writeFileSync(file,original);
  await sendMessage(server.api,ID,confirmation(p),directory);assert.equal(server.calls.length,1);assert.deepEqual(server.calls[0].body.embeds,req.embeds);assert.deepEqual(server.calls[0].body.allowed_mentions.parse,[]);
  await assert.rejects(sendMessage(server.api,ID,confirmation(p),directory),/سبق بدء/);
});
