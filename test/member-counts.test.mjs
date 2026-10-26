import test from 'node:test';
import assert from 'node:assert/strict';
import {readMemberCounts} from '../src/member-counts.mjs';
import {serverInventory} from '../src/editor.mjs';
import {sample,fakeServer,ID,LEGACY} from './helpers/fake.mjs';

test('member statistics use only two GETs, validate values and never infer missing roles as zero',async()=>{
  const calls=[],api={async get(route){calls.push(route);return route.endsWith('member-counts')?{[LEGACY]:0,[ID]:999,'999999999999999991':2,'999999999999999992':-1,bad:3}:{approximate_member_count:17};}};
  const s=sample();s.memberStatistics=await readMemberCounts(api,ID);const inv=serverInventory(s);
  assert.deepEqual(calls,[`/guilds/${ID}/roles/member-counts`,`/guilds/${ID}?with_counts=true`]);
  assert.equal(inv.memberStatistics.total,17);assert.equal(inv.memberStatistics.totalApproximate,true);
  assert.equal(inv.roles.find(r=>r.id===LEGACY).memberCount,0);
  assert.equal(inv.roles.find(r=>r.name==='★ OWNER ★').memberCount,2);
  assert.equal(inv.roles.find(r=>r.name==='★ CO_OWNER ★').memberCount,null);
  assert.equal(inv.roles.find(r=>r.id===ID).memberCount,17);assert.equal(inv.roles.find(r=>r.id===ID).memberCountApproximate,true);assert.ok(!('members' in inv));
});

test('member statistics failures remain unavailable without blocking inventory or modifying approvals',async()=>{
  const s=sample(),original=serverInventory(s),api={async get(){throw new Error('Missing access');}};
  s.memberStatistics=await readMemberCounts(api,ID);const inv=serverInventory(s);
  assert.deepEqual(inv.memberStatistics,{total:null,totalApproximate:true,roleCountsAvailable:false});
  assert.ok(inv.roles.every(r=>r.memberCount===null));assert.deepEqual(inv.roles.map(r=>r.revision),original.roles.map(r=>r.revision));
  s.memberStatistics=await readMemberCounts({async get(route){return route.endsWith('member-counts')?[]:{approximate_member_count:-1};}},ID);
  assert.equal(s.memberStatistics.roles,null);assert.equal(s.memberStatistics.total,null);
});

test('complete member snapshots count everyone once and include overlapping and protected assignments',async()=>{
  const s=sample();s.members[0].roles.push(LEGACY);s.members[1].roles.push(LEGACY);
  const inv=serverInventory(s);assert.equal(inv.memberStatistics.total,3);assert.equal(inv.memberStatistics.totalApproximate,false);
  assert.equal(inv.roles.find(r=>r.id===ID).memberCount,3);assert.equal(inv.roles.find(r=>r.id===LEGACY).memberCount,2);
  const stats=await readMemberCounts(fakeServer(s).api,ID);assert.equal(stats.roles[LEGACY],2);
  s.membersComplete=false;delete s.memberStatistics;assert.equal(serverInventory(s).memberStatistics.total,null);
});
