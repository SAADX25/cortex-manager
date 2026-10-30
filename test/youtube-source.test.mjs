import test from 'node:test';
import assert from 'node:assert/strict';
import {youtubeHandle,youtubeChannelFromHTML,createYouTubeSourceResolver} from '../src/youtube-source.mjs';
const id='UC2kbSW84Vq-ytyAxlynZjog',url='https://www.youtube.com/@Luffy-Gaming-JO',html='<head><link rel="alternate" type="application/rss+xml" href="https://www.youtube.com/feeds/videos.xml?channel_id='+id+'"></head>';
const feed={id:'youtube',guildId:'111111111111111111',channelId:'777777777777777777',platform:'youtube',source:url,enabled:true,language:'en'},config={version:1,feeds:[feed]};
test('YouTube handles accept official profile URLs and reject credentials, spoofed hosts and media URLs',()=>{
 assert.equal(youtubeHandle(url),'@Luffy-Gaming-JO');assert.equal(youtubeHandle('@Luffy-Gaming-JO'),'@Luffy-Gaming-JO');assert.equal(youtubeChannelFromHTML(html),id);
 for(const value of [url.replace('youtube.com','youtube.com.evil'),url.replace('www.youtube.com','user:secret@www.youtube.com'),url+'?x=1',url+'/videos','http://youtube.com/@creator','https://127.0.0.1/@creator','@ab'])assert.throws(()=>youtubeHandle(value));
 assert.equal(youtubeChannelFromHTML('<head></head><body>'+html.replace(/<\/?head>/g,'')+'</body>'),id);
});
test('YouTube lookup normalizes to a stable UC ID, caches and never follows redirects or sends credentials',async()=>{
 const calls=[],resolve=createYouTubeSourceResolver({fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(html);}});
 const result=await resolve(config);assert.equal(result.feeds[0].source,id);assert.equal(config.feeds[0].source,url);assert.equal((await resolve(config)).feeds[0].source,id);assert.equal(calls.length,1);assert.equal(calls[0].url,url);assert.equal(calls[0].options.redirect,'error');assert.ok(!calls[0].options.headers.Authorization);
 assert.equal((await resolve(result)).feeds[0].source,id);assert.equal(calls.length,1);
 await assert.rejects(resolve({...config,feeds:[feed,{...feed,id:'second',source:id}]}),/already targets/);
 await assert.rejects(resolve(config,{allowNetwork:false}),/demo mode/);
});
test('YouTube lookup rejects malformed settings before network access and exposes no remote error body',async()=>{
 let calls=0;const resolve=createYouTubeSourceResolver({fetchImpl:async()=>{calls++;return new Response('private body',{status:403});}});
 await assert.rejects(resolve({...config,token:'secret'}));assert.equal(calls,0);
 await assert.rejects(resolve(config),error=>!error.message.includes('private body'));assert.equal(calls,1);
 const conflicting=html.replace('</head>','<link type="application/rss+xml" href="https://www.youtube.com/feeds/videos.xml?channel_id=UC'+'a'.repeat(22)+'"></head>');assert.throws(()=>youtubeChannelFromHTML(conflicting));
});
