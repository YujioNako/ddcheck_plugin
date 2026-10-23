import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BiliSession,atomicWrite,cookies,mergeCookies,setCookieLines,correspondPath} from './session-core.mjs';
const OLD='SESSDATA=old==; bili_jct=old-csrf; DedeUserID=123; buvid3=keep';
const TOKEN='old+token&value';
const LINES=['SESSDATA=new==; Path=/; Secure','bili_jct=new-csrf; Path=/','DedeUserID=123; Path=/'];
function response(data,lines=[],status=200){return {ok:status>=200&&status<300,status,headers:{raw:()=>({'set-cookie':lines})},json:async()=>data,text:async()=>data};}
function fixture(t,overrides={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bili-refresh-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'bilibili_cookies.txt'),OLD);fs.writeFileSync(path.join(dir,'ac_time_value.txt'),TOKEN);
 const calls=[];
 const fetchImpl=async(url,options)=>{
  const step=url.includes('cookie/info')?'info':url.includes('/correspond/')?'csrf':url.includes('/confirm/')?'confirm':'refresh';
  calls.push({step,url,options});
  if(overrides[step])return overrides[step](url,options);
  if(step==='info')return response({code:0,data:{refresh:true,timestamp:1792725300000}});
  if(step==='csrf')return response('<div class="x" id="1-name" data-v="1">refresh-csrf</div>');
  if(step==='refresh')return response({code:0,data:{refresh_token:'new+token&value'}},LINES);
  return response({code:0});
 };
 const session=new BiliSession({dir,fetchImpl,...overrides.options});return {dir,session,calls,fetchImpl};
}
test('complete refresh: proper forms, new cookie + OLD token confirmation, saved before confirmation',async t=>{
 const f=fixture(t,{confirm:(url,o)=>{
  assert.equal(new URLSearchParams(o.body).get('csrf'),'new-csrf');assert.equal(new URLSearchParams(o.body).get('refresh_token'),TOKEN);
  assert.equal(cookies(o.headers.Cookie).get('SESSDATA'),'new==');assert.equal(f.session.read().token,'new+token&value');assert.equal(cookies(f.session.read().cookie).get('bili_jct'),'new-csrf');return response({code:0});
 }});
 const r=await f.session.check();assert.equal(r.kind,'refreshed');assert.equal(r.ok,true);
 assert.deepEqual(f.calls.map(c=>c.step),['info','csrf','refresh','confirm']);
 const request=f.calls[2].options;assert.equal(new URLSearchParams(request.body).get('refresh_token'),TOKEN);assert.equal(new URLSearchParams(request.body).get('csrf'),'old-csrf');assert.equal(new URLSearchParams(request.body).get('source'),'main_web');
 assert.equal(cookies(f.session.read().cookie).get('buvid3'),'keep');assert(!fs.existsSync(f.session.journal));
 assert(!JSON.stringify(r).includes(TOKEN));
});
test('code 0 and refresh false skips refresh POST',async t=>{const f=fixture(t,{info:()=>response({code:0,data:{refresh:false}})});assert.equal((await f.session.check()).kind,'healthy');assert.equal(f.calls.length,1);assert.equal(f.session.read().cookie,OLD);});
test('-101 can attempt recovery with a paired token',async t=>{const f=fixture(t,{info:()=>response({code:-101})});assert.equal((await f.session.check()).kind,'refreshed');});
test('missing refresh token asks for login without overwriting cookie',async t=>{const f=fixture(t);fs.writeFileSync(f.session.tokenFile,'{}');assert.equal((await f.session.check()).kind,'login');assert.equal(f.calls.length,1);assert.equal(f.session.read().cookie,OLD);});
for(const [name,overrides,kind] of [
 ['HTTP 412',{info:()=>response('<html>',[],412)},'network'],
 ['timeout',{info:()=>{throw Error('secret-network-payload');}},'network'],
 ['bad JSON',{info:()=>({ok:true,json:async()=>{throw Error('secret');}})},'network'],
 ['missing refresh flag',{info:()=>response({code:0,data:{}})},'network'],
 ['missing csrf',{csrf:()=>response('<html>blocked</html>')},'network'],
 ['mismatched refresh token',{refresh:()=>response({code:86095})},'login'],
 ['missing new cookie',{refresh:()=>response({code:0,data:{refresh_token:'new'}})},'invalid'],
 ['partial cookie',{refresh:()=>response({code:0,data:{refresh_token:'new'}},LINES.slice(0,1))},'invalid'],
 ['missing new token',{refresh:()=>response({code:0,data:{}},LINES)},'invalid'],
 ['wrong account',{refresh:()=>response({code:0,data:{refresh_token:'new'}},[...LINES,'DedeUserID=456; Path=/'])},'invalid']
])test(name+' preserves old pair',async t=>{const f=fixture(t,overrides),r=await f.session.check();assert.equal(r.kind,kind);assert.equal(f.session.read().cookie,OLD);assert.equal(f.session.read().token,TOKEN);assert(!JSON.stringify(r).includes('secret'));assert(!f.calls.some(c=>c.step==='confirm'));});
test('parallel manual and scheduled checks share one refresh',async t=>{const f=fixture(t);const results=await Promise.all(Array.from({length:12},()=>f.session.check({forceCheck:true})));assert(results.every(r=>r.ok));assert.equal(f.calls.filter(c=>c.step==='refresh').length,1);});
test('confirm failure keeps new pair and restart retries only confirmation',async t=>{
 const f=fixture(t,{confirm:()=>{throw Error('timeout');}});assert.equal((await f.session.check()).kind,'pending');assert.equal(f.session.read().token,'new+token&value');assert(fs.existsSync(f.session.journal));
 const calls=[];const restarted=new BiliSession({dir:f.dir,fetchImpl:async(url,o)=>{calls.push(url);if(url.includes('confirm')){assert.equal(new URLSearchParams(o.body).get('refresh_token'),TOKEN);return response({code:0});}return response({code:0,data:{refresh:false}});}});
 assert.equal((await restarted.check()).kind,'refreshed');assert.equal(calls.length,2);assert(!calls.some(url=>url.endsWith('cookie/refresh')));assert(!fs.existsSync(f.session.journal));
});
test('partial disk write is recoverable and old session is not confirmed early',async t=>{
 let fail=true;const f=fixture(t,{options:{write:(file,value,mode)=>{if(file.endsWith('bilibili_cookies.txt')&&fail){fail=false;throw Error('disk full');}atomicWrite(file,value,mode);}}});
 assert.equal((await f.session.check()).kind,'storage');assert.equal(f.session.read().cookie,OLD);assert.equal(f.session.read().token,'new+token&value');assert(fs.existsSync(f.session.journal));assert(!f.calls.some(c=>c.step==='confirm'));
 const restarted=new BiliSession({dir:f.dir,fetchImpl:async url=>response(url.includes('confirm')?{code:0}:{code:0,data:{refresh:false}})});
 assert.equal((await restarted.check()).ok,true);assert.equal(cookies(restarted.read().cookie).get('SESSDATA'),'new==');assert(!fs.existsSync(restarted.journal));
});
test('journal write failure leaves both old credentials unchanged',async t=>{const f=fixture(t,{options:{write:()=>{throw Error('disk full');}}});assert.equal((await f.session.check()).kind,'storage');assert.deepEqual(f.session.read(),{cookie:OLD,token:TOKEN});});
test('QR login persists matched pair without old account cookies',async t=>{const f=fixture(t);await f.session.saveLogin({raw:()=>({'set-cookie':LINES})},'qr-token');assert.equal(f.session.read().token,'qr-token');assert(!f.session.read().cookie.includes('buvid3'));assert.equal(f.calls.length,0);});
test('QR incomplete result does not overwrite prior pair',async t=>{const f=fixture(t);await assert.rejects(f.session.saveLogin({raw:()=>({'set-cookie':[]})},'qr-token'));assert.equal(f.session.read().cookie,OLD);});
test('manual replacement clears mismatched token and preserves equals signs',async t=>{const f=fixture(t);await f.session.saveManual('cookie','SESSDATA=manual==; bili_jct=x');assert.equal(f.session.read().token,'');await f.session.saveManual('token','manual+token==');assert.equal(f.session.read().token,'manual+token==');});
test('normal checks throttled for six hours, explicit checks bypass cache',async t=>{let now=100000;const f=fixture(t,{info:()=>response({code:0,data:{refresh:false}}),options:{now:()=>now}});await f.session.check();await f.session.check();assert.equal(f.calls.length,1);await f.session.check({forceCheck:true});assert.equal(f.calls.length,2);now+=6*3600000;await f.session.check();assert.equal(f.calls.length,3);});
test('another process lock prevents refresh',async t=>{const f=fixture(t);fs.mkdirSync(f.session.lock);fs.writeFileSync(path.join(f.session.lock,'pid'),String(process.pid));assert.equal((await f.session.check()).kind,'busy');assert.equal(f.calls.length,0);assert(fs.existsSync(f.session.lock));});
test('cookie parsing handles expires comma, equals in values and deletion',()=>{
 const lines=setCookieLines({get:()=> 'SESSDATA=a==; Expires=Wed, 21 Oct 2030 07:28:00 GMT, bili_jct=b; Path=/'});assert.equal(lines.length,2);
 assert.equal(mergeCookies('drop=x; keep=y',[...lines,'drop=; Max-Age=0']), 'keep=y; SESSDATA=a==; bili_jct=b');
});
test('correspond path is randomized 1024-bit OAEP ciphertext',()=>{const a=correspondPath(1792725300000),b=correspondPath(1792725300000);assert.match(a,/^[0-9a-f]{256}$/);assert.notEqual(a,b);});
test('credentials are never sent to another host or HTTP',async t=>{const f=fixture(t);await assert.rejects(f.session.request('https://example.com/',OLD));await assert.rejects(f.session.request('http://passport.bilibili.com/',OLD));assert.equal(f.calls.length,0);});
