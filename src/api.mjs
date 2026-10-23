const BASE='https://discord.com/api/v10';
const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
export class DiscordAPI{
  constructor(token){if(!token)throw new Error('DISCORD_BOT_TOKEN missing');this.token=token;}
  async call(method,path,body){
    for(let tries=0;tries<7;tries++){
      const r=await fetch(BASE+path,{
        method,headers:{Authorization:`Bot ${this.token}`,'Content-Type':'application/json','User-Agent':'CortexManagerPro/3.0'},
        body:body===undefined?undefined:JSON.stringify(body)
      });
      if(r.status===429){
        const json=await r.json().catch(()=>({}));
        await delay(Math.max(400,Math.ceil((json.retry_after??2)*1000)+250));continue;
      }
      if([500,502,503,504].includes(r.status)&&tries<6){await delay(650*(tries+1));continue;}
      const raw=await r.text();const json=raw?JSON.parse(raw):null;
      if(!r.ok)throw new Error(`Discord ${method} ${path}: HTTP ${r.status} — ${JSON.stringify(json).slice(0,900)}`);
      await delay(180);
      return json;
    }
    throw new Error(`Discord API exhausted retries for ${method} ${path}`);
  }
  get(p){return this.call('GET',p);}
  post(p,b){return this.call('POST',p,b);}
  patch(p,b){return this.call('PATCH',p,b);}
  del(p){return this.call('DELETE',p);}
}
export async function snapshot(api,guildId){
  if(!/^\d{16,22}$/.test(guildId??''))throw new Error('Set DISCORD_GUILD_ID to the numerical Discord Server ID in GitHub Variables.');
  const bot=await api.get('/users/@me');
  const guild=await api.get(`/guilds/${guildId}`);
  const [roles,channels,botMember]=await Promise.all([
    api.get(`/guilds/${guildId}/roles`),api.get(`/guilds/${guildId}/channels`),api.get(`/guilds/${guildId}/members/${bot.id}`)
  ]);
  return {captured_at:new Date().toISOString(),guild,bot:{id:bot.id,username:bot.username},botMember,roles,channels};
}
