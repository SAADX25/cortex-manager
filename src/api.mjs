const BASE='https://discord.com/api/v10';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class DiscordAPI {
  constructor(token,{fetchImpl=fetch,sleep=delay}={}) {
    if(!token)throw new Error('DISCORD_BOT_TOKEN missing');
    this.token=token;this.fetch=fetchImpl;this.sleep=sleep;this.queue=Promise.resolve();
  }
  call(method,path,body,options) {
    // Serialize requests so route and global cooldowns apply to every caller.
    const result=this.queue.then(()=>this.request(method,path,body,options));
    this.queue=result.catch(()=>{});return result;
  }
  async request(method,path,body,{files}={}) {
    for(let tries=0;tries<7;tries++) {
      let payload=body===undefined?undefined:JSON.stringify(body);
      if(files?.length){payload=new FormData();payload.append('payload_json',JSON.stringify(body));files.forEach((file,index)=>payload.append(`files[${index}]`,new Blob([file.bytes],{type:file.type}),file.name));}
      const r=await this.fetch(BASE+path,{
        method,headers:{Authorization:`Bot ${this.token}`,...(files?.length?{}:{'Content-Type':'application/json'}),'User-Agent':'CortexManager/4.0',
          ...(method==='GET'?{}:{'X-Audit-Log-Reason':'Reviewed Cortex Manager server redesign'})},
        body:payload,signal:AbortSignal.timeout(30000),
      });
      const raw=await r.text();
      let json;try{json=raw?JSON.parse(raw):null;}catch{json=null;}
      if(r.status===429) {
        const seconds=Math.max(Number(json?.retry_after)||0,Number(r.headers.get('retry-after'))||0,Number(r.headers.get('x-ratelimit-reset-after'))||0,1);
        await this.sleep(Math.ceil(seconds*1000)+250);continue;
      }
      // POST may have succeeded despite an ambiguous failure. Re-preview to
      // discover and reuse it; blindly retrying creation could produce duplicates.
      if([500,502,503,504].includes(r.status)&&method!=='POST'&&tries<6) {
        await this.sleep(650*(tries+1));continue;
      }
      if(!r.ok)throw new Error(`Discord ${method} ${path}: HTTP ${r.status}, code ${json?.code??'unknown'}. ${json?.message??'Request failed'}`);
      if(r.headers.get('x-ratelimit-remaining')==='0')await this.sleep(Math.ceil((Number(r.headers.get('x-ratelimit-reset-after'))||1)*1000)+250);
      else await this.sleep(180);
      return json;
    }
    throw new Error(`Discord API exhausted rate-limit retries for ${method} ${path}`);
  }
  get(p){return this.call('GET',p);}
  post(p,b,options){return this.call('POST',p,b,options);}
  patch(p,b){return this.call('PATCH',p,b);}
  del(p){return this.call('DELETE',p);}
}
export async function memberInventory(api,guildId) {
  const members=[];let after='0';
  try {
    while(true) {
      const page=await api.get(`/guilds/${guildId}/members?limit=1000&after=${after}`);
      if(!Array.isArray(page))throw new Error('Invalid member inventory response');
      for(const m of page)members.push({id:m.user.id,roles:[...m.roles],bot:!!m.user.bot});
      if(page.length<1000)break;
      const next=page.at(-1).user.id;
      if(BigInt(next)<=BigInt(after))throw new Error('Member pagination did not advance');
      after=next;
    }
    return {members,membersComplete:true};
  } catch(error) {
    return {members:[],membersComplete:false,membersError:`Member backup unavailable: ${error.message}. Enable Server Members Intent. Obsolete roles will be retained.`};
  }
}
export async function snapshot(api,guildId,{includeMembers=true}={}) {
  if(!/^\d{16,22}$/.test(guildId??''))throw new Error('Set DISCORD_GUILD_ID to the numerical Discord Server ID.');
  const bot=await api.get('/users/@me');
  const guild=await api.get(`/guilds/${guildId}`);
  const roles=await api.get(`/guilds/${guildId}/roles`);
  const channels=await api.get(`/guilds/${guildId}/channels`);
  const botMember=await api.get(`/guilds/${guildId}/members/${bot.id}`);
  const inventory=includeMembers?await memberInventory(api,guildId):{members:[],membersComplete:false};
  return {captured_at:new Date().toISOString(),guild,bot:{id:bot.id,username:bot.username},botMember,roles,channels,...inventory};
}
