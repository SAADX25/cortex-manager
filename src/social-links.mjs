import fs from 'node:fs';
import path from 'node:path';
import {mediaURL,snowflake} from './social-config.mjs';

const keys=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new Error('Invalid saved link fields.');};
// Read previous saved links so the direct-open buttons keep working. The old
// link-edit dialog was removed; this compatibility reader never changes data.
export function createSocialLinkReader({root,demo=false,socialStore}){
  const file=path.join(root,'out','desktop-modern',demo?'demo-social-links.json':'social-links.json');
  function read(){
    if(fs.existsSync(file)&&fs.statSync(file).size>100000)throw new Error('Saved links file is too large.');
    const data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,links:[]};keys(data,['version','links']);
    if(data.version!==1||!Array.isArray(data.links)||data.links.length>40)throw new Error('Invalid saved links file.');
    const seen=new Set();for(const item of data.links){keys(item,['feedId','guildId','url','caption']);if(typeof item.feedId!=='string'||!/^[\w-]{1,64}$/.test(item.feedId)||seen.has(item.feedId)||!snowflake(item.guildId)||typeof item.caption!=='string'||item.caption.length>1200)throw new Error('Invalid saved link.');mediaURL(item.url);seen.add(item.feedId);}
    const feeds=socialStore.read().config.feeds,links=data.links.filter(item=>feeds.some(f=>f.id===item.feedId&&f.guildId===item.guildId));
    return {links};
  }
  return {read};
}
