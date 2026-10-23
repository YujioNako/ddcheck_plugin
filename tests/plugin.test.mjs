import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
test('plugin integration: private-owner gates, quiet startup, one schedule, safe manual input and QR persistence',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ddcheck-plugin-test-')),cwd=process.cwd();
 const messages=[],jobs={},network=[];let pollCount=0,oldCancelled=false;
 const reply=async text=>{messages.push(text);};
 globalThis.__ddtest={plugin:class{},segment:{image:p=>({image:p})},cfg:{masterQQ:[123]},lodash:{},common:{},QRCode:{toFile:async(p)=>fs.writeFileSync(p,'fake qr')},schedule:{scheduledJobs:jobs,scheduleJob:(name,rule,callback)=>jobs[name]={job:callback,cancel(){delete jobs[name];}}},fetch:async(url,options)=>{
  network.push(url);const headers={raw:()=>({'set-cookie':['SESSDATA=qr==; Path=/','bili_jct=qr-csrf; Path=/']})};
  let data;
  if(url.includes('qrcode/generate'))data={code:0,data:{url:'https://passport.bilibili.com/test-qr',qrcode_key:'fake-key'}};
  else if(url.includes('qrcode/poll'))data={code:0,data:++pollCount===1?{code:86101}:{code:0,refresh_token:'qr-token'}};
  else data={code:0,data:{refresh:false}};
  return {ok:true,status:200,headers,json:async()=>data};
 }};
 jobs.old={job:function(){/* api_cdn check_refresh_cookie refresh_num */},cancel(){oldCancelled=true;delete jobs.old;}};
 globalThis.logger={info:()=>{},warn:()=>{},mark:()=>{}};globalThis.Bot={pickUser:()=>{throw Error('Unexpected startup message');}};
 try{
  let source=fs.readFileSync(path.join(here,'../查成分.js'),'utf8');
  source=source.replace(/^import .*$/gm,'');
  source=`import fs from 'node:fs';import path from 'node:path';import {publicEncrypt,createPublicKey,constants,randomBytes} from 'node:crypto';const {plugin,segment,fetch,schedule,cfg,lodash,common,QRCode}=globalThis.__ddtest;\n`+source;
  source=source.replace('setTimeout(resolve,3000)','setTimeout(resolve,1)');
  const file=path.join(dir,'plugin-test.mjs');fs.writeFileSync(file,source);process.chdir(dir);fs.mkdirSync('data');
  const {example}=await import(pathToFileURL(file));const p=new example();
  assert.equal(network.length,0);assert.equal(messages.length,0);assert(oldCancelled);assert.deepEqual(Object.keys(jobs).sort(),['ddcheck-cookie','ddcheck-v-list']);
  for(const method of ['check_refresh_cookie','write_cookies','write_ac_time_value','show_cookies','show_ac_time_value','scan_login']){
   await p[method]({isMaster:false,isGroup:false,msg:'#查成分登录',reply});
   await p[method]({isMaster:true,isGroup:true,msg:'#查成分登录',reply});
  }
  assert.equal(network.length,0);messages.length=0;
  await p.write_cookies({isMaster:true,isGroup:false,msg:'#查成分保存cookie SESSDATA=containscookieck==; bili_jct=csrf',reply});
  assert.equal(fs.readFileSync('data/cha_chengfen/bilibili_cookies.txt','utf8'),'SESSDATA=containscookieck==; bili_jct=csrf');
  await p.write_ac_time_value({isMaster:true,isGroup:false,msg:'#查成分保存ac_time_value containsac==',reply});
  assert.equal(fs.readFileSync('data/cha_chengfen/ac_time_value.txt','utf8'),'containsac==');
  await p.check_refresh_cookie({isMaster:true,isGroup:false,reply});assert(messages.some(s=>s.includes('无需刷新')));
  assert(!messages.some(s=>s.includes('containscookieck')||s.includes('containsac')));
  await p.scan_login({isMaster:true,isGroup:false,reply});assert.equal(pollCount,2);
  assert.equal(fs.readFileSync('data/cha_chengfen/ac_time_value.txt','utf8'),'qr-token');assert.equal(fs.readFileSync('data/cha_chengfen/bilibili_cookies.txt','utf8'),'SESSDATA=qr==; bili_jct=qr-csrf');
  assert(!messages.some(s=>typeof s==='string'&&(s.includes('qr-token')||s.includes('qr-csrf'))));
  assert(!fs.existsSync('data/cha_chengfen/qrcode.png'));
 }finally{process.chdir(cwd);delete globalThis[Symbol.for('pro-ivan.ddcheck.bili-session.v1')];delete globalThis.__ddtest;fs.rmSync(dir,{recursive:true,force:true});}
});
