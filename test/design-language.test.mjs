import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {defaultDesign,designTemplate,validateCustomDesign} from '../src/custom-design.mjs';

const context={window:{},location:{hash:''},structuredClone,URLSearchParams};
vm.runInNewContext(fs.readFileSync(new URL('../desktop/web/designer.js',import.meta.url),'utf8'),context);
const translate=context.window.CortexDesigner.translateLanguage;
const templates={ar:designTemplate('ar'),en:designTemplate('en'),legacy:defaultDesign()};
const channels=d=>d.categories.flatMap(c=>c.channels);

test('template language translates legacy and current default names and text without changing the source',()=>{
 for(const source of [defaultDesign(),designTemplate('ar')]){
  const original=structuredClone(source),en=translate(source,templates,'en');
  assert.deepEqual(source,original);assert.equal(en.language,'en');validateCustomDesign(en);
  for(const role of en.roles)assert.equal(role.name,templates.en.roles.find(r=>r.key===role.key).name);
  for(const c of en.categories){assert.equal(c.name,templates.en.categories.find(row=>row.key===c.key).name);for(const ch of c.channels){const target=channels(templates.en).find(row=>row.key===ch.key);assert.equal(ch.name,target.name);if(ch.message)assert.equal(ch.message,target.message);}}
  const ar=translate(en,templates,'ar');validateCustomDesign(ar);assert.equal(ar.language,'ar');
  for(const c of ar.categories){assert.equal(c.name,templates.ar.categories.find(row=>row.key===c.key).name);for(const ch of c.channels){const target=channels(templates.ar).find(row=>row.key===ch.key);assert.equal(ch.name,target.name);if(ch.message)assert.equal(ch.message,target.message);}}
 }
});

test('translation preserves custom content, deletions, reparenting, permissions, ordering and migration targets',()=>{
 const d=designTemplate('ar');d.roles.reverse();d.roles[0].name='رتبتي الخاصة';d.roles[0].color=12345;d.roles[0].permissions=['ViewChannel'];
 d.categories[0].name='قسمي الخاص';const moved=d.categories[0].channels.shift();moved.topic='My custom topic';moved.message='My custom welcome';d.categories[2].channels.push(moved);
 d.categories[1].channels.splice(0,1);d.migrations={'111111111111111111':d.roles[0].key};
 d.categories[1].channels.push({key:'customroom',name:'غرفتي-الخاصة',type:'voice',private:true,accessKeys:['vip'],userLimit:3});
 const en=translate(d,templates,'en');validateCustomDesign(en);
 assert.equal(en.roles[0].name,'رتبتي الخاصة');assert.equal(en.roles[0].color,12345);assert.deepEqual(en.roles[0].permissions,['ViewChannel']);assert.equal(en.categories[0].name,'قسمي الخاص');
 assert.equal(en.categories[2].channels.at(-1).key,moved.key);assert.equal(en.categories[2].channels.at(-1).name,channels(templates.en).find(ch=>ch.key===moved.key).name);assert.equal(en.categories[2].channels.at(-1).topic,'My custom topic');assert.equal(en.categories[2].channels.at(-1).message,'My custom welcome');
 assert.deepEqual(en.categories[1].channels.at(-1),d.categories[1].channels.at(-1));assert.deepEqual(en.migrations,d.migrations);assert.deepEqual(channels(en).map(ch=>ch.key),channels(d).map(ch=>ch.key));
 assert.deepEqual(en.roles.map(r=>r.key),d.roles.map(r=>r.key));
});

test('translation repairs mislabeled drafts and rejects name collisions without losing the draft',()=>{
 const broken=designTemplate('ar');broken.language='en';const fixed=translate(broken,templates,'en');assert.match(fixed.categories[0].name,/Welcome/);
 const d=designTemplate('ar');d.roles.push({...structuredClone(d.roles[0]),key:'custom',name:templates.en.roles[0].name});const before=structuredClone(d);
 assert.throws(()=>translate(d,templates,'en'),/اسم مكرر/);assert.deepEqual(d,before);assert.throws(()=>translate(d,templates,'fr'),/غير متاحة/);
});
