import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscordAPI,memberInventory} from '../src/api.mjs';
import {ID} from './helpers/fake.mjs';

test('global 429 and exhausted route headers delay serialized requests',async()=>{
  const sleeps=[],requests=[];let i=0;
  const responses=[
    new Response(JSON.stringify({retry_after:1.2,global:true}),{status:429,headers:{'retry-after':'2'}}),
    new Response('{}',{headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset-after':'0.7'}}),new Response('{}'),
  ];
  const api=new DiscordAPI('fake-token',{sleep:async ms=>sleeps.push(ms),fetchImpl:async(url,options)=>{requests.push([url,options.method]);return responses[i++];}});
  await Promise.all([api.get('/first'),api.get('/second')]);
  assert.deepEqual(requests.map(x=>x[0].split('/').at(-1)),['first','first','second']);
  assert.deepEqual(sleeps,[2250,950,180]);
});
test('ambiguous POST failure is not retried to avoid duplicate channels or roles',async()=>{
  let requests=0;
  const api=new DiscordAPI('fake-token',{sleep:async()=>{},fetchImpl:async()=>{requests++;return new Response('upstream error',{status:502});}});
  await assert.rejects(api.post('/guilds/123/channels',{}),/HTTP 502/);assert.equal(requests,1);
});
test('image uploads use multipart payload_json and binary files without overriding the multipart boundary',async()=>{
 const bytes=Buffer.from('image-bytes'),payload={content:'caption',attachments:[{id:0,filename:'cortex-image.png'}],allowed_mentions:{parse:[]}};let calls=0;
 const api=new DiscordAPI('fake-token',{sleep:async()=>{},fetchImpl:async(url,options)=>{calls++;assert.equal(options.headers['Content-Type'],undefined);assert.equal(options.headers.Authorization,'Bot fake-token');assert.ok(options.body instanceof FormData);assert.deepEqual(JSON.parse(options.body.get('payload_json')),payload);const file=options.body.get('files[0]');assert.equal(file.name,'cortex-image.png');assert.equal(file.type,'image/png');assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes);return new Response('{"id":"123456789012345678"}');}});
 await api.call('POST','/channels/123/messages',payload,{files:[{name:'cortex-image.png',type:'image/png',bytes}]});assert.equal(calls,1);
});
test('transient GET failure retries and non-JSON errors retain status',async()=>{
  let requests=0;const sleeps=[];
  const api=new DiscordAPI('fake-token',{sleep:async ms=>sleeps.push(ms),fetchImpl:async()=>++requests===1?new Response('',{status:503}):new Response('{}')});
  await api.get('/safe');assert.equal(requests,2);assert.equal(sleeps[0],650);
});
test('member pagination saves only IDs and roles, including page after 1000 members',async()=>{
  const paths=[];const first=Array.from({length:1000},(_,i)=>({user:{id:String(100000000000000000n+BigInt(i)),username:'excluded'},roles:['role']}));
  const inventory=await memberInventory({get:async path=>{paths.push(path);return paths.length===1?first:[{user:{id:'200000000000000000'},roles:[]}];}},ID);
  assert.equal(inventory.members.length,1001);assert.equal(inventory.membersComplete,true);
  assert.ok(paths[1].endsWith(first.at(-1).user.id));assert.equal(inventory.members[0].username,undefined);
});
test('missing privileged member intent is reported without destructive role fallback',async()=>{
  const inventory=await memberInventory({get:async()=>{throw new Error('HTTP 403');}},ID);
  assert.equal(inventory.membersComplete,false);assert.deepEqual(inventory.members,[]);assert.match(inventory.membersError,/Server Members Intent/);
});
