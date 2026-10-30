import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DiscordAPI} from './api.mjs';
import {GatewaySession} from './gateway.mjs';
import {validateSocial} from './social-config.mjs';
import {createSocialProviders} from './social-providers.mjs';
import {createSocialEngine} from './social-engine.mjs';

const STARTUP_ERRORS={
  MISSING_BOT_TOKEN:'DISCORD_BOT_TOKEN is not available to the running process. Check the application variable name, save/apply it and recreate the runtime if necessary.',
  INVALID_TOKEN_FORMAT:'DISCORD_BOT_TOKEN must contain only the bot token, without a Bot prefix or KEY=value text.',
  MISSING_FEED_CONFIG:'config/social-feeds.json is missing. Upload the complete Cortex Social Discloud package.',
  INVALID_FEED_CONFIG:'config/social-feeds.json is invalid or unreadable. Export a fresh package from the desktop app.',
  INVALID_DELIVERY_STATE:'data/social-deliveries.json is invalid or unreadable. Restore its backup; it was not reset.',
  UNSUPPORTED_RUNTIME:'The runtime needs Node.js >=22.9 with its built-in WebSocket enabled.',
  STARTUP_FAILED:'Unexpected startup failure. Check runtime version and application logs. Credentials were not printed.'
};
const startupFailure=code=>Object.assign(new Error(STARTUP_ERRORS[code]),{startupCode:code});
export function hostedStartupDiagnostic(error){const code=Object.hasOwn(STARTUP_ERRORS,error?.startupCode??'')?error.startupCode:'STARTUP_FAILED';return {component:'startup',status:'error',code,message:STARTUP_ERRORS[code]};}

export async function startHostedBot({env=process.env,root=fileURLToPath(new URL('../',import.meta.url)),api,Gateway=GatewaySession,fetchItems,onFatal=()=>{},log=event=>process.stdout.write(JSON.stringify(event)+'\n')}={}){
  if(typeof env.DISCORD_BOT_TOKEN!=='string'||!env.DISCORD_BOT_TOKEN.trim())throw startupFailure('MISSING_BOT_TOKEN');
  const token=env.DISCORD_BOT_TOKEN.trim();if(/^Bot\s|^DISCORD_BOT_TOKEN\s*=/i.test(token))throw startupFailure('INVALID_TOKEN_FORMAT');
  const configFile=path.join(root,'config','social-feeds.json');
  const readConfig=()=>{try{if(fs.statSync(configFile).size>64000)throw startupFailure('INVALID_FEED_CONFIG');return validateSocial(JSON.parse(fs.readFileSync(configFile,'utf8')));}catch(error){throw startupFailure(error.code==='ENOENT'?'MISSING_FEED_CONFIG':'INVALID_FEED_CONFIG');}};
  const initial=readConfig();api??=new DiscordAPI(token);
  if(Gateway===GatewaySession&&typeof globalThis.WebSocket!=='function')throw startupFailure('UNSUPPORTED_RUNTIME');
  const gateway=new Gateway(token,{api});
  let stopped=false,timer=null,active=null,failed=false;
  let engine;try{engine=createSocialEngine({api,fetchItems:fetchItems??createSocialProviders({env}),stateFile:path.join(root,'data','social-deliveries.json'),onStatus:log,isStopping:()=>stopped});}catch{throw startupFailure('INVALID_DELIVERY_STATE');}
  async function cycle(){if(stopped)return;try{await engine.tick(readConfig());}catch(error){log(error.startupCode?hostedStartupDiagnostic(error):{status:'config-or-storage-error',message:'Check persistent data storage. No reset was performed.'});}finally{if(!stopped)timer=setTimeout(()=>{active=cycle();},120000);}}
  async function stop(){if(stopped)return;stopped=true;clearTimeout(timer);gateway.stop();await active;}
  gateway.on('status',event=>{
    // Gateway descriptions can contain provider/server details: emit only the status enum.
    log({component:'gateway',status:event.status});
    if(event.status==='error'&&!gateway.running){failed=true;void stop().then(onFatal);}
  });
  log({component:'startup',status:'ready',tokenConfigured:true,configuredSources:initial.feeds.length,nodeVersion:process.versions.node});
  gateway.start();if(!stopped)active=cycle();
  return {stop,get failed(){return failed;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const bot=await startHostedBot({onFatal:()=>{process.exitCode=1;}});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void bot.stop().then(()=>{process.exitCode=bot.failed?1:0;});});
  }catch(error){process.stderr.write(JSON.stringify(hostedStartupDiagnostic(error))+'\n');process.exitCode=1;}
}
