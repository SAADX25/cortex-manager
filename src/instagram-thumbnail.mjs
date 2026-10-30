import {createHash} from 'node:crypto';
import {mediaURL} from './social-config.mjs';
import {MAX_IMAGE_BYTES,validateMessageImage} from './message-image.mjs';

const fail=code=>{throw Object.assign(new Error(code),{thumbnailCode:code});};
function postURL(value){
  const url=new URL(mediaURL(value));if(url.hostname!=='instagram.com')fail('unsupported');
  return `https://www.instagram.com${url.pathname.replace(/\/$/,'')}/`;
}
const decode=value=>value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,entity=>{
  if(entity[1]==='#'){const hex=entity[2].toLowerCase()==='x',n=parseInt(entity.slice(hex?3:2,-1),hex?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}
  return {'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}[entity.toLowerCase()]??entity;
});
export function instagramImageURL(html,requested){
  const canonical=postURL(requested),meta=new Map();
  // Only metadata is read: no script execution, login cookies or embedded executable data.
  const head=html.replace(/<!--[^]*?-->/g,'').replace(/<script\b[^>]*>[^]*?(?:<\/script\s*>|$)/gi,'').split(/<\/head\s*>/i)[0];
  for(const [tag]of head.matchAll(/<meta\b[^>]{0,12000}>/gi)){
    const attrs={};for(const [,key,,quoted,plain]of tag.matchAll(/([\w:-]+)\s*=\s*(?:(['"])(.*?)\2|([^\s>]+))/g))attrs[key.toLowerCase()]=decode(quoted??plain);
    if(attrs.property&&!meta.has(attrs.property.toLowerCase()))meta.set(attrs.property.toLowerCase(),attrs.content);
  }
  let target;try{target=new URL(meta.get('og:url'));}catch{fail('unavailable');}
  const match=target.pathname.match(/^\/(?:[\w.]+\/)?(?:p|reel|tv)\/([\w-]+)\/?$/);
  // Instagram may canonicalize /p/CODE to /username/reel/CODE. Bind to the same
  // case-sensitive post code, rather than mistaking it for an unrelated page.
  if(target.protocol!=='https:'||!['instagram.com','www.instagram.com'].includes(target.hostname)||target.username||target.password||target.port||!match||match[1]!==new URL(canonical).pathname.split('/')[2])fail('unavailable');
  let image;try{image=new URL(meta.get('og:image:secure_url')??meta.get('og:image'));}catch{fail('unavailable');}
  if(image.protocol!=='https:'||image.username||image.password||image.port||image.hash||!/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/.test(image.hostname))fail('unsafe-image');
  return image.href;
}
async function limitedResponse(url,fetchImpl,max,accept){
  let response;try{response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:accept,'User-Agent':'CortexManager/6.0 (public link preview)'}});}catch{fail('blocked');}
  if(!response.ok){await response.body?.cancel();fail(response.status===429?'rate-limited':'blocked');}
  if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();fail('too-large');}
  const reader=response.body?.getReader();if(!reader)fail('unavailable');const chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)fail('too-large');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  return {bytes:Buffer.concat(chunks),type:response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()};
}
export function createInstagramThumbnailResolver({fetchImpl=fetch,now=Date.now}={}){
  const cache=new Map();let running=0;
  return async function resolve(url){
    let canonical;try{canonical=postURL(url);}catch{return {status:'unavailable',reason:'unsupported'};}
    const saved=cache.get(canonical);if(saved&&saved.until>now())return saved.result;
    if(running>=2)return {status:'unavailable',reason:'busy'};running++;
    let result;
    try{
      const page=await limitedResponse(canonical,fetchImpl,1024*1024,'text/html');if(page.type!=='text/html')fail('unavailable');
      const imageURL=instagramImageURL(page.bytes.toString('utf8'),canonical);
      const {bytes,type}=await limitedResponse(imageURL,fetchImpl,MAX_IMAGE_BYTES,'image/png,image/jpeg,image/webp,image/gif');
      const image={type,data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
      try{validateMessageImage(image);}catch{fail('unsupported-image');}
      result={status:'ready',image};
    }catch(error){result={status:'unavailable',reason:error.thumbnailCode??'unavailable'};}
    finally{running--;}
    cache.set(canonical,{result,until:now()+(result.status==='ready'?300000:60000)});while(cache.size>16)cache.delete(cache.keys().next().value);
    return result;
  };
}
