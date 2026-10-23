// Explicitly invoked by desktop/Test.ps1; never run during Node's test discovery.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {diagnostics} from '../src/desktop-worker.mjs';
import {sample} from '../test/helpers/fake.mjs';
import {CATEGORIES,ROLES} from '../src/design.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'out','desktop');fs.mkdirSync(output,{recursive:true});
const helpers=pathToFileURL(path.join(root,'test','helpers','fake.mjs')).href;
const preview=sample();preview.guild.name='مجتمع الألعاب • معاينة توضيحية';preview.channels=[];
let next=800000000000000000n;
for(const category of CATEGORIES) {
  const parent=String(next++);preview.channels.push({id:parent,name:category.name,type:4,position:preview.channels.length,permission_overwrites:[]});
  for(const channel of category.channels) {
    const id=String(next++);preview.channels.push({id,name:channel.name,type:channel.type==='voice'?2:0,parent_id:parent,position:preview.channels.length,topic:channel.topic??'',user_limit:channel.userLimit??0,permission_overwrites:[]});
    if(channel.key==='rules')preview.guild.rules_channel_id=id;
  }
}
preview.roles.find(r=>r.name==='legacy').name='🎮・أعضاء المجتمع';preview.roles.find(r=>r.name==='🎮・أعضاء المجتمع').color=0x5865f2;
for(let i=0;i<4;i++)preview.roles.push({...ROLES[i],id:String(next++),position:10-i,permissions:'0',managed:false});
fs.writeFileSync(path.join(output,'diagnostics-fixture.json'),JSON.stringify({event:'diagnostics',data:diagnostics(preview)}));
fs.writeFileSync(path.join(output,'ui-mock-requests.jsonl'),'');
fs.writeFileSync(path.join(output,'ui-test-trace.txt'),'');
fs.writeFileSync(path.join(output,'ui-mock-fetch.mjs'),`
import fs from 'node:fs';
import {fakeServer,sample} from ${JSON.stringify(helpers)};
const server=fakeServer(sample());
globalThis.fetch=async(url,options)=>{
  if(options.method!=='GET')throw new Error('Desktop self-test forbids all Discord writes');
  fs.appendFileSync(new URL('./ui-mock-requests.jsonl',import.meta.url),JSON.stringify({method:options.method,url})+'\\n');
  const u=new URL(url);
  return new Response(JSON.stringify(await server.api.get(u.pathname.replace('/api/v10','')+u.search)));
};
`);
