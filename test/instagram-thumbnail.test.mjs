import test from 'node:test';
import assert from 'node:assert/strict';
import {createInstagramThumbnailResolver,instagramImageURL} from '../src/instagram-thumbnail.mjs';
const post='https://www.instagram.com/p/DfF98Xdqr4U/',cdn='https://scontent.cdninstagram.com/photo.jpg?a=1&b=2';
const html=`<head><meta content='${post}' property='og:url'><meta property="og:image" content="${cdn.replace('&','&amp;')}"></head>`;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZS8AAAAASUVORK5CYII=','base64');
test('Instagram metadata must refer to the requested post and use an official HTTPS image CDN',()=>{
 assert.equal(instagramImageURL(html,post),cdn);
 assert.equal(instagramImageURL(html.replace(post,'https://www.instagram.com/creator/reel/DfF98Xdqr4U/'),post),cdn);
 assert.throws(()=>instagramImageURL(html.replace(post,'https://www.instagram.com/creator/reel/DIFFERENT/'),post));
 for(const invalid of [html.replace(post,'https://www.instagram.com/accounts/login/'),html.replace('scontent.cdninstagram.com','cdninstagram.com.attacker.test'),html.replace('scontent.cdninstagram.com','127.0.0.1'),html.replace('https://scontent','http://scontent'),'<head><meta property="og:image" content="https://scontent.cdninstagram.com/avatar.jpg"></head>'])assert.throws(()=>instagramImageURL(invalid,post));
 assert.throws(()=>instagramImageURL('<script>'+html+'</script>',post));
});
test('resolver downloads a real image only from the verified CDN, hashes its bytes and caches the result',async()=>{
 const calls=[],resolve=createInstagramThumbnailResolver({fetchImpl:async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);return url===post?new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}}):new Response(png,{headers:{'Content-Type':'image/png'}});}});
 const result=await resolve(post);assert.equal(result.status,'ready');assert.equal(result.image.type,'image/png');assert.equal(result.image.data,png.toString('base64'));assert.match(result.image.sha256,/^[a-f0-9]{64}$/);assert.deepEqual(calls,[post,cdn]);assert.equal((await resolve(post+'?tracking=1')).status,'ready');assert.equal(calls.length,2);
});
test('private/login, redirects, rate limits and oversize responses produce explicit unavailability without fetching arbitrary URLs',async()=>{
 for(const [response,reason]of [[new Response('',{status:429}),'rate-limited'],[new Response('',{status:403}),'blocked'],[new Response(html,{headers:{'Content-Type':'text/html','Content-Length':'2000000'}}),'too-large'],[new Response('<head>Login required</head>',{headers:{'Content-Type':'text/html'}}),'unavailable']]){
  let calls=0;const resolve=createInstagramThumbnailResolver({fetchImpl:async()=>{calls++;return response;}});const result=await resolve(post);assert.equal(result.status,'unavailable');assert.equal(result.reason,reason);assert.equal(calls,1);assert.equal(result.image,undefined);
 }
 let calls=0;const resolve=createInstagramThumbnailResolver({fetchImpl:async()=>{calls++;throw new Error('redirect blocked');}});assert.equal((await resolve('https://localhost/private')).reason,'unsupported');assert.equal(calls,0);assert.equal((await resolve(post)).reason,'blocked');
});
test('HTML masquerading as an image is never returned as an attachment',async()=>{
 let calls=0;const resolve=createInstagramThumbnailResolver({fetchImpl:async()=>++calls===1?new Response(html,{headers:{'Content-Type':'text/html'}}):new Response('<html>login</html>',{headers:{'Content-Type':'image/png'}})});
 assert.deepEqual(await resolve(post),{status:'unavailable',reason:'unsupported-image'});
});
