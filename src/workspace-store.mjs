import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {P} from './permissions.mjs';
import {CHANNEL_PERMISSIONS} from './editor.mjs';
import {digest} from './safety.mjs';

const bad=()=>{throw new Error('بيانات المسودات غير صالحة.');};
const id=value=>typeof value==='string'&&/^\d{16,22}$/.test(value);
const object=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))bad();};
export function validateWorkspace(entries){
  if(!Array.isArray(entries)||entries.length>100||JSON.stringify(entries).length>180000)bad();
  const keys=new Set();
  for(const e of entries){
    object(e,['key','request','tab','overwriteRole','staged']);const r=e.request;
    object(r,['kind','action','id','revision','values','permissionChanges','overwriteChanges']);
    if(!['role','channel','guild'].includes(r.kind)||!['create','update'].includes(r.action)||r.kind==='guild'&&r.action!=='update')bad();
    if(r.action==='update'&&(!id(r.id)||typeof r.revision!=='string'||!/^[a-f0-9]{64}$/.test(r.revision)))bad();
    if(r.action==='create'&&(r.id!==undefined||r.revision!==undefined))bad();
    const fields=r.kind==='guild'?['name']:r.kind==='role'?['name','color','hoist','mentionable']:['name','type','parent_id','topic','rate_limit_per_user','user_limit'];object(r.values,fields);
    for(const [key,value]of Object.entries(r.values)){
      if(['name','topic'].includes(key)){if(typeof value!=='string'||value.length>(key==='name'?100:1024))bad();}
      else if(key==='parent_id'){if(value!==null&&!id(value))bad();}
      else if(['hoist','mentionable'].includes(key)){if(typeof value!=='boolean')bad();}
      else if(value!==null&&(!Number.isFinite(value)||Math.abs(value)>0xffffff))bad();
    }
    if(r.permissionChanges!==undefined){object(r.permissionChanges,Object.keys(P));if(r.kind!=='role'||Object.values(r.permissionChanges).some(v=>typeof v!=='boolean'))bad();}
    if(r.overwriteChanges!==undefined){if(r.kind!=='channel'||!Array.isArray(r.overwriteChanges)||r.overwriteChanges.length>30)bad();const seen=new Set();for(const change of r.overwriteChanges){object(change,['roleId','permissions']);if(!id(change.roleId)||seen.has(change.roleId))bad();seen.add(change.roleId);object(change.permissions,CHANNEL_PERMISSIONS);if(Object.values(change.permissions).some(v=>!['inherit','allow','deny'].includes(v)))bad();}}
    const expected=r.kind+':'+(r.id??'new-'+(r.values.type??0));
    if(e.key!==expected||keys.has(e.key)||typeof e.staged!=='boolean'||e.staged&&r.action!=='update'||!['general','permissions'].includes(e.tab)||e.overwriteRole!==''&&!id(e.overwriteRole))bad();keys.add(e.key);
  }
  return structuredClone(entries);
}
export function createWorkspaceStore({root,demo=false}){
  const fileFor=guildId=>{if(!id(guildId))bad();return path.join(root,'out','desktop-modern',demo?'demo-workspaces':'workspaces',guildId+'.json');};
  const read=guildId=>{const file=fileFor(guildId);let data={version:1,entries:[],updatedAt:null};if(fs.existsSync(file)){if(fs.statSync(file).size>800000)bad();data=JSON.parse(fs.readFileSync(file,'utf8'));object(data,['version','entries','updatedAt']);if(data.version!==1||typeof data.updatedAt!=='string'||!Number.isFinite(Date.parse(data.updatedAt)))bad();data.entries=validateWorkspace(data.entries);}
    return {...data,revision:digest(data.entries)};
  };
  return {read,save(guildId,{baseRevision,entries}){
    const current=read(guildId);if(current.revision!==baseRevision)throw Object.assign(new Error('تغيّرت المسودات في نافذة أخرى. احتفظ بنسختك قبل إعادة التحميل.'),{status:409});
    const clean=validateWorkspace(entries);if(digest(clean)===current.revision)return current;
    const data={version:1,entries:clean,updatedAt:new Date().toISOString()},file=fileFor(guildId),tmp=file+'.'+randomBytes(8).toString('hex')+'.tmp';fs.mkdirSync(path.dirname(file),{recursive:true});
    try{fs.writeFileSync(tmp,JSON.stringify(data),{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
    return {...data,revision:digest(clean)};
  }};
}
