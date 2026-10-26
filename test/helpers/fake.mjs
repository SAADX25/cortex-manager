import {P} from '../../src/permissions.mjs';
export const ID='111111111111111111';
export const BOT='222222222222222222';
export const BOT_ROLE='333333333333333333';
export const OWNER='444444444444444444';
export const LEGACY='555555555555555555';
export const MEMBER='888888888888888888';
export function sample() {return {
  captured_at:'2026-10-23T00:00:00Z',
  guild:{id:ID,name:'Real Friends',owner_id:OWNER,rules_channel_id:null,public_updates_channel_id:null},
  bot:{id:BOT,username:'Cortex Manager'},botMember:{roles:[BOT_ROLE]},
  roles:[
    {id:ID,name:'@everyone',position:0,permissions:String(P.ViewChannel|P.SendMessages),managed:false},
    {id:BOT_ROLE,name:'Cortex Manager',position:20,permissions:String(P.Administrator),managed:true},
    {id:LEGACY,name:'legacy',position:1,permissions:'0',managed:false},
    {id:'999999999999999991',name:'★ OWNER ★',position:30,permissions:String(P.Administrator),managed:false},
    {id:'999999999999999992',name:'★ CO_OWNER ★',position:29,permissions:String(P.ManageRoles),managed:false},
  ],
  channels:[
    {id:'666666666666666666',name:'old-cat',type:4,permission_overwrites:[]},
    {id:'777777777777777777',name:'old-chat',type:0,parent_id:'666666666666666666',permission_overwrites:[]},
  ],
  membersComplete:true,members:[{id:OWNER,roles:['999999999999999991']},{id:MEMBER,roles:[]},{id:BOT,roles:[BOT_ROLE]}],
};}
export function fakeServer(initial,{beforeCall=()=>{},onCapture=()=>{}}={}) {
  const state=structuredClone(initial),calls=[];let next=700000000000000000n,captures=0;
  const api={
    async get(path) {
      if(path==='/users/@me')return structuredClone(state.bot);
      if(path===`/guilds/${ID}`)return structuredClone(state.guild);
      if(path===`/guilds/${ID}?with_counts=true`)return {...structuredClone(state.guild),approximate_member_count:state.members.length};
      if(path===`/guilds/${ID}/roles/member-counts`)return Object.fromEntries(state.roles.filter(r=>r.id!==ID).map(r=>[r.id,state.members.filter(m=>m.roles.includes(r.id)).length]));
      if(path===`/guilds/${ID}/roles`)return structuredClone(state.roles);
      if(path===`/guilds/${ID}/channels`)return structuredClone(state.channels);
      if(path.startsWith(`/guilds/${ID}/members?`))return state.members.map(m=>({user:{id:m.id,bot:m.id===BOT},roles:[...m.roles]}));
      const id=path.match(/\/members\/(\d+)$/)?.[1];
      const m=state.members.find(m=>m.id===id);
      if(m)return structuredClone(m);
      throw new Error('Unexpected GET '+path);
    },
    async call(method,path,body) {
      calls.push({method,path,body:structuredClone(body)});await beforeCall(method,path,body,state);
      if(method==='POST'&&path.endsWith('/roles')) {
        for(const r of state.roles)if(r.position>0)r.position++;
        const r={...body,id:String(next++),position:1,managed:false};state.roles.push(r);return structuredClone(r);
      }
      if(method==='POST'&&path===`/guilds/${ID}/channels`) {
        const c={...body,id:String(next++)};state.channels.push(c);return structuredClone(c);
      }
      if(method==='POST'&&path.endsWith('/messages'))return {id:String(next++)};
      const assignment=path.match(/\/members\/(\d+)\/roles\/(\d+)$/);
      if(method==='PUT'&&assignment) {
        const member=state.members.find(m=>m.id===assignment[1]);member.roles.push(assignment[2]);return null;
      }
      const role=path.match(/\/roles\/(\d+)$/)?.[1];
      const channel=path.match(/^\/channels\/(\d+)$/)?.[1];
      if(method==='PATCH') {
        if(path===`/guilds/${ID}/roles`||path===`/guilds/${ID}/channels`){const list=path.endsWith('/roles')?state.roles:state.channels;for(const entry of body)Object.assign(list.find(item=>item.id===entry.id),entry);return path.endsWith('/roles')?structuredClone(state.roles):null;}
        if(path===`/guilds/${ID}`){Object.assign(state.guild,body);return structuredClone(state.guild);}
        const entity=role?state.roles.find(r=>r.id===role):state.channels.find(c=>c.id===channel);
        Object.assign(entity,body);return structuredClone(entity);
      }
      if(method==='DELETE'&&channel) {state.channels=state.channels.filter(c=>c.id!==channel);return null;}
      if(method==='DELETE'&&role) {
        const position=state.roles.find(r=>r.id===role).position;
        state.roles=state.roles.filter(r=>r.id!==role);for(const r of state.roles)if(r.position>position)r.position--;
        for(const m of state.members)m.roles=m.roles.filter(id=>id!==role);return null;
      }
      throw new Error('Unexpected mutation '+method+' '+path);
    },
  };
  const capture=async()=>{await onCapture(++captures,state);return structuredClone(state);};
  const inventory=async()=>({members:structuredClone(state.members),membersComplete:state.membersComplete});
  return {api,state,calls,capture,inventory};
}
