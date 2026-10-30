// Deliberately limited to RSS.app RSS 2.0 feeds. No DTDs, external entities,
// script execution, arbitrary feed hosts or redirects are supported.
export function instagramRSSURL(value){
  if(typeof value!=='string'||value.length>500)throw new Error('Use the direct RSS.app XML feed URL.');
  let url;try{url=new URL(value.trim());}catch{throw new Error('Use the direct RSS.app XML feed URL.');}
  if(url.protocol!=='https:'||url.hostname!=='rss.app'||url.username||url.password||url.port||url.search||url.hash||!/^\/feeds\/[A-Za-z0-9]{8,64}\.xml$/.test(url.pathname))throw new Error('Use https://rss.app/feeds/FEED_ID.xml, without the RSS viewer wrapper.');
  return url.href;
}
const bad=()=>{throw new Error('Invalid Instagram RSS XML.');};
function decode(text){return text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,value=>{
  if(value[1]==='#'){const hex=value[2].toLowerCase()==='x',n=parseInt(value.slice(hex?3:2,-1),hex?16:10);if(!n||n>0x10ffff||n>=0xd800&&n<=0xdfff)bad();return String.fromCodePoint(n);}
  return {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[value.toLowerCase()];
});}
function parseXML(xml){
  if(typeof xml!=='string'||Buffer.byteLength(xml)>1048576||/<!DOCTYPE|<!ENTITY/i.test(xml))bad();
  const document={name:'document',children:[],text:''},stack=[document];let offset=0,nodes=0;
  while(offset<xml.length){
    const node=stack.at(-1),next=xml.indexOf('<',offset);
    if(next<0){node.text+=decode(xml.slice(offset));break;}
    node.text+=decode(xml.slice(offset,next));offset=next;
    if(xml.startsWith('<![CDATA[',offset)){const end=xml.indexOf(']]>',offset+9);if(end<0)bad();node.text+=xml.slice(offset+9,end);offset=end+3;continue;}
    if(xml.startsWith('<!--',offset)){const end=xml.indexOf('-->',offset+4);if(end<0)bad();offset=end+3;continue;}
    if(xml.startsWith('<?',offset)){const end=xml.indexOf('?>',offset+2);if(end<0)bad();offset=end+2;continue;}
    let end=offset+1,quote=null;for(;end<xml.length;end++){const c=xml[end];if(quote){if(c===quote)quote=null;}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    if(end>=xml.length||end-offset>16000)bad();const tag=xml.slice(offset+1,end);offset=end+1;
    if(tag.startsWith('/')){if(!/^\/[A-Za-z_][\w.:-]*\s*$/.test(tag)||stack.length<2||node.name!==tag.slice(1).trim())bad();stack.pop();continue;}
    const match=tag.match(/^([A-Za-z_][\w.:-]*)(?:\s[^]*)?\/?$/);if(!match||++nodes>10000||stack.length>32)bad();
    const child={name:match[1],children:[],text:''};node.children.push(child);if(!tag.endsWith('/'))stack.push(child);
  }
  if(stack.length!==1||document.children.length!==1||document.text.trim())bad();return document.children[0];
}
const one=(node,name)=>node.children.find(c=>c.name===name);
const text=(node,name)=>one(node,name)?.text.trim()??'';
export function instagramRSSItems(xml,username){
  const root=parseXML(xml),channel=one(root,'channel');if(root.name!=='rss'||!channel)bad();
  let owner;try{const profile=new URL(text(channel,'link'));if(profile.protocol!=='https:'||!['instagram.com','www.instagram.com'].includes(profile.hostname)||profile.username||profile.password||profile.port)bad();owner=profile.pathname.replace(/^\/|\/$/g,'').toLowerCase();}catch{bad();}
  if(owner!==username.toLowerCase())throw new Error('Instagram RSS feed belongs to a different account.');
  const items=channel.children.filter(c=>c.name==='item');if(items.length>100)bad();const seen=new Set();
  return items.map(node=>{
    let url;try{url=new URL(text(node,'link'));}catch{bad();}
    const match=url.pathname.match(/^\/(?:[\w.]+\/)?(p|reel|tv)\/([\w-]+)\/?$/);
    if(url.protocol!=='https:'||!['instagram.com','www.instagram.com'].includes(url.hostname)||url.username||url.password||url.port||!match)bad();
    const published=text(node,'pubDate')||text(node,'dc:date');if(!Number.isFinite(Date.parse(published)))bad();
    const id='instagram:'+match[2];if(seen.has(id))bad();seen.add(id);
    return {id,title:decode(text(node,'title')).replace(/<[^>]*>/g,'').slice(0,200),url:`https://instagram.com/${match[1]}/${match[2]}/`,published:new Date(published).toISOString()};
  });
}
