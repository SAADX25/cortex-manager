import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServerProfileStore} from '../src/server-profiles.mjs';

function temp(t){const base=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'cortex-profiles-'));t.after(()=>{assert.equal(path.dirname(path.resolve(root)),base);assert.match(path.basename(root),/^cortex-profiles-/);fs.rmSync(root,{recursive:true,force:true});});return root;}
const id='111111111111111111',other='222222222222222222';
const iconURL=`https://cdn.discordapp.com/icons/${id}/${'a'.repeat(32)}.png?size=128`;

test('server bookmarks persist identity and selection, deduplicate, retain known metadata and isolate demo data',t=>{
 const root=temp(t),store=createServerProfileStore({root});
 store.save({id,name:'Real Friends',iconURL},{select:true});store.save({id});store.save({id:other,name:'Other'});
 assert.equal(store.list().servers.length,2);assert.deepEqual(store.list().servers[0],{id,name:'Real Friends',iconURL});
 store.select(other);const copy=store.list();copy.servers[0].name='tampered';
 const restored=createServerProfileStore({root});assert.equal(restored.isNew,false);assert.equal(restored.list().selectedId,other);assert.equal(restored.list().servers[0].name,'Real Friends');
 restored.remove(other);assert.equal(createServerProfileStore({root}).list().selectedId,'');assert.equal(restored.list().servers.length,1);
 assert.equal(createServerProfileStore({root,demo:true}).list().servers.length,0);
});

test('bookmarks reject secrets, unsafe icon URLs, duplicate/corrupt files and unsupported IDs',t=>{
 const root=temp(t),store=createServerProfileStore({root});
 for(const value of [{id:'../escape'},{id,token:'never store'},{id,name:'x'.repeat(101)},{id,iconURL:'https://example.com/image.png'},{id,iconURL:iconURL.replace(id,other)},{id,iconURL:iconURL+'&secret=bad'}])assert.throws(()=>store.save(value));
 assert.throws(()=>store.select(id));assert.equal(store.list().servers.length,0);
 store.save({id,iconURL});const file=path.join(root,'out','desktop-modern','servers.json'),raw=JSON.parse(fs.readFileSync(file,'utf8'));raw.servers.push(raw.servers[0]);fs.writeFileSync(file,JSON.stringify(raw));
 assert.throws(()=>createServerProfileStore({root}));assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).servers.length,2);
});
