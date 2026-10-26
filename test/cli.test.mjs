import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ID} from './helpers/fake.mjs';
import {CONFIRMATION} from '../src/safety.mjs';

test('CLI preview is GET-only and rebuild rejects missing confirmation, tampered approval and changed server before writes',t=>{
  const tempRoot=path.resolve(os.tmpdir());
  const cwd=fs.mkdtempSync(path.join(tempRoot,'cortex-cli-test-'));
  t.after(()=>{
    const target=path.resolve(cwd);
    if(path.dirname(target)!==tempRoot||!path.basename(target).startsWith('cortex-cli-test-'))throw new Error('Invalid test cleanup path');
    fs.rmSync(target,{recursive:true,force:true});
  });
  const mock=path.join(cwd,'mock-fetch.mjs'),requestLog=path.join(cwd,'requests.jsonl');
  const fixtureURL=new URL('./helpers/fake.mjs',import.meta.url).href;
  const cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url));
  const writeMock=changed=>fs.writeFileSync(mock,`
    import fs from 'node:fs';
    import {fakeServer,sample,LEGACY} from ${JSON.stringify(fixtureURL)};
    const s=sample();
    ${changed?"s.roles.find(r=>r.id===LEGACY).permissions='1024';":''}
    const server=fakeServer(s);
    globalThis.fetch=async(url,options)=>{
      fs.appendFileSync(${JSON.stringify(requestLog)},JSON.stringify({method:options.method,url})+'\\n');
      if(options.method!=='GET')throw new Error('Test forbids Discord writes');
      const u=new URL(url);return new Response(JSON.stringify(await server.api.get(u.pathname.replace('/api/v10','')+u.search)));
    };
  `);
  const env={...process.env,DISCORD_BOT_TOKEN:'test-placeholder',DISCORD_GUILD_ID:ID,CONFIRM_DELETE:'',CONFIRM_GUILD_ID:'',GITHUB_ACTIONS:'false'};
  const run=(mode,extra={})=>spawnSync(process.execPath,['--import',pathToFileURL(mock).href,cli,mode],{cwd,env:{...env,...extra},encoding:'utf8'});
  const requests=()=>fs.existsSync(requestLog)?fs.readFileSync(requestLog,'utf8').trim().split('\n').map(JSON.parse):[];
  writeMock(false);
  const preview=run('preview');assert.equal(preview.status,0,preview.stderr);
  const worker=fileURLToPath(new URL('../src/desktop-worker.mjs',import.meta.url));
  for(const operation of ['check','preview']) {
    const desktop=spawnSync(process.execPath,['--import',pathToFileURL(mock).href,worker,operation],{
      cwd,env,encoding:'utf8',input:JSON.stringify({token:'test-placeholder',guildId:ID})+'\n',
    });
    assert.equal(desktop.status,0,desktop.stderr);
    assert.ok(!desktop.stdout.includes('test-placeholder'));
    if(operation==='check')assert.equal(JSON.parse(desktop.stdout).event,'diagnostics');
  }
  const output=path.join(cwd,'out');
  for(const file of ['preview.md','plan.json','approval.json','snapshot.json'])assert.ok(fs.existsSync(path.join(output,file)));
  const before=requests().length;assert.ok(before>0);assert.ok(requests().every(r=>r.method==='GET'));
  const denied=run('rebuild');assert.equal(denied.status,1);assert.match(denied.stderr,/requires the exact guild ID/);assert.equal(requests().length,before);
  const approvalPath=path.join(output,'approval.json'),approval=JSON.parse(fs.readFileSync(approvalPath,'utf8'));
  fs.writeFileSync(approvalPath,JSON.stringify({...approval,sourceDigest:'tampered'}));
  const confirmed={CONFIRM_DELETE:CONFIRMATION,CONFIRM_GUILD_ID:ID};
  const tampered=run('rebuild',confirmed);assert.equal(tampered.status,1);assert.match(tampered.stderr,/does not match/);assert.equal(requests().length,before);
  fs.writeFileSync(approvalPath,JSON.stringify(approval));
  const designPath=path.join(output,'design.json'),design=JSON.parse(fs.readFileSync(designPath,'utf8'));
  fs.writeFileSync(designPath,JSON.stringify({...design,roles:design.roles.map((r,i)=>i===0?{...r,color:r.color+1}:r)}));
  const changedDesign=run('rebuild',confirmed);assert.equal(changedDesign.status,1);assert.match(changedDesign.stderr,/does not match/);assert.equal(requests().length,before);
  fs.writeFileSync(designPath,JSON.stringify(design));writeMock(true);
  const drift=run('rebuild',confirmed);assert.equal(drift.status,1);assert.match(drift.stderr,/changed since preview/);
  assert.ok(requests().every(r=>r.method==='GET'));
  const result=JSON.parse(fs.readFileSync(path.join(output,'result.json'),'utf8'));
  assert.equal(result.success,false);assert.equal(result.phase,'preflight');assert.equal(result.deleted.length,0);
});
