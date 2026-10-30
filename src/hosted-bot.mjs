import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DiscordAPI} from './api.mjs';
import {GatewaySession} from './gateway.mjs';
import {validateSocial} from './social-config.mjs';
import {createSocialProviders} from './social-providers.mjs';
import {createSocialEngine} from './social-engine.mjs';

export async function startHostedBot({env=process.env,root=fileURLToPath(new URL('../',import.meta.url)),api,Gateway=GatewaySession,fetchItems,onFatal=()=>{},log=event=>process.stdout.write(JSON.stringify(event)+'\n')}={}){
  if(!env.DISCORD_BOT_TOKEN?.trim())throw new Error('Set DISCORD_BOT_TOKEN in the hosting environment.');
  const configFile=path.join(root,'config','social-feeds.json');
  const readConfig=()=>{if(fs.statSync(configFile).size>64000)throw new Error('Social config too large.');return validateSocial(JSON.parse(fs.readFileSync(configFile,'utf8')));};
  readConfig();api??=new DiscordAPI(env.DISCORD_BOT_TOKEN.trim());
  const gateway=new Gateway(env.DISCORD_BOT_TOKEN.trim(),{api});
  let stopped=false,timer=null,active=null,failed=false;
  const engine=createSocialEngine({api,fetchItems:fetchItems??createSocialProviders({env}),stateFile:path.join(root,'data','social-deliveries.json'),onStatus:log,isStopping:()=>stopped});
  async function cycle(){if(stopped)return;try{await engine.tick(readConfig());}catch{log({status:'config-or-storage-error',message:'Check configuration and persistent data storage. No reset was performed.'});}finally{if(!stopped)timer=setTimeout(()=>{active=cycle();},120000);}}
  async function stop(){if(stopped)return;stopped=true;clearTimeout(timer);gateway.stop();await active;}
  gateway.on('status',event=>{
    // Gateway descriptions can contain provider/server details: emit only the status enum.
    log({component:'gateway',status:event.status});
    if(event.status==='error'&&!gateway.running){failed=true;void stop().then(onFatal);}
  });
  gateway.start();if(!stopped)active=cycle();
  return {stop,get failed(){return failed;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const bot=await startHostedBot({onFatal:()=>{process.exitCode=1;}});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void bot.stop().then(()=>{process.exitCode=bot.failed?1:0;});});
  }catch{process.stderr.write('Hosted bot could not start. Check DISCORD_BOT_TOKEN, config/social-feeds.json and persistent storage.\n');process.exitCode=1;}
}
