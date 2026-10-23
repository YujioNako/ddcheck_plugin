/*
成分姬插件 - YunzaiBot特供版
核心代码思路来自：NoneBot2 成分姬插件 - https://github.com/noneplugin/nonebot-plugin-ddcheck
改编者：Yujio_Nako
若有bug可以在GitHub提请issue：
https://github.com/ldcivan/ddcheck_plugin
*/

import plugin from '../../lib/plugins/plugin.js'
import { segment } from "oicq";
import fetch from "node-fetch"
import schedule from 'node-schedule'
import fs from 'fs'
import cfg from '../../lib/config/config.js'
import lodash from 'lodash'
import common from '../../lib/common/common.js'
import path from 'node:path';
import { publicEncrypt, createPublicKey, constants, randomBytes } from 'node:crypto';
import QRCode from "qrcode"

// BEGIN EMBEDDED BILI SESSION
const biliSessionCore = (() => {

const BASE='https://passport.bilibili.com/x/passport-login/web/';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const KEY=createPublicKey({format:'jwk',key:{kty:'RSA',e:'AQAB',n:'y4HdjgJHBlbaBN04VERG4qNBIFHP6a3GozCl75AihQloSWCXC5HDNgyinEnhaQ_4-gaMud_GF50elYXLlCToR9se9Z8z433U3KjM-3Yx7ptKkmQNAMggQwAVKgq3zYAoidNEWuxpkY_mAitTSRLnsJW-NCTa0bqBFF6Wm1MxgfE'}});
const correspondPath=timestamp=>publicEncrypt({key:KEY,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(`refresh_${timestamp}`)).toString('hex');
function cookies(text='') {
    const out=new Map();
    for(const part of text.split(';')) { const i=part.indexOf('=');if(i>0)out.set(part.slice(0,i).trim(),part.slice(i+1).trim()); }
    return out;
}
function setCookieLines(headers) {
    if(typeof headers.getSetCookie==='function')return headers.getSetCookie();
    if(typeof headers.raw==='function')return headers.raw()['set-cookie']||[];
    return (headers.get('set-cookie')||'').split(/,(?=\s*[^;,=\s]+=)/).filter(Boolean);
}
function mergeCookies(previous,lines) {
    const values=cookies(previous);
    for(const line of lines) {
        const pair=line.split(';',1)[0],i=pair.indexOf('=');if(i<1)continue;
        const name=pair.slice(0,i).trim(),value=pair.slice(i+1).trim();
        if(!value || /;\s*max-age=0(?:;|$)/i.test(line))values.delete(name);else values.set(name,value);
    }
    return [...values].map(([k,v])=>`${k}=${v}`).join('; ');
}
function clean(value) { value=String(value||'').trim();return value==='{}'?'':value; }
function validText(value) { return typeof value==='string' && value.length>0 && value.length<65536 && !/[\r\n\0]/.test(value); }
function validPair(pair) { const c=cookies(pair.cookie);return validText(pair.cookie)&&validText(pair.token)&&!!c.get('SESSDATA')&&!!c.get('bili_jct'); }
class SessionError extends Error { constructor(kind,message){super(message);this.kind=kind;} }
function atomicWrite(file,value,mode=0o600) {
    let old;try{old=fs.statSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}
    const temp=file+`.tmp-${process.pid}-${randomBytes(5).toString('hex')}`;
    let fd;
    try {
        fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,value,'utf8');
        if(old && process.getuid?.()===0)fs.fchownSync(fd,old.uid,old.gid);
        fs.fchmodSync(fd,mode);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
        fs.renameSync(temp,file);
        // Flush the rename as well as the file contents on Linux.
        if(process.platform!=='win32'){const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
    } finally {if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch{}}
}
class BiliSession {
    constructor({dir,fetchImpl=globalThis.fetch,write=atomicWrite,now=()=>Date.now()}) {
        this.dir=dir;this.fetch=fetchImpl;this.write=write;this.now=now;this.queue=Promise.resolve();this.lastCheck=0;this.lastResult=null;
        this.cookieFile=path.join(dir,'bilibili_cookies.txt');this.tokenFile=path.join(dir,'ac_time_value.txt');
        this.journal=path.join(dir,'.session-pending.json');this.lock=path.join(dir,'.session-refresh.lock');
    }
    read() {
        const get=file=>{try{return clean(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return '';throw e;}};
        return {cookie:get(this.cookieFile),token:get(this.tokenFile)};
    }
    publish(pair) {
        // Both legacy paths stay intact for PHP/Python consumers. Journal recovery repairs a partial pair.
        this.write(this.tokenFile,pair.token,0o600);
        let mode=0o644;try{mode=fs.statSync(this.cookieFile).mode&0o777;}catch{}
        this.write(this.cookieFile,pair.cookie,mode);
    }
    async exclusive(fn) {
        const run=this.queue.catch(()=>{}).then(async()=>{
            fs.mkdirSync(this.dir,{recursive:true});
            for(let attempt=0;attempt<2;attempt++) {
                try { fs.mkdirSync(this.lock,{mode:0o700});fs.writeFileSync(path.join(this.lock,'pid'),String(process.pid));break; }
                catch(e) {
                    if(e.code!=='EEXIST')throw e;
                    let dead=false;
                    try{const pid=Number(fs.readFileSync(path.join(this.lock,'pid'),'utf8'));if(!Number.isInteger(pid)||pid<=0)throw Error();try{process.kill(pid,0);}catch(err){dead=err.code==='ESRCH';}}
                    catch{dead=this.now()-fs.statSync(this.lock).mtimeMs>120000;}
                    if(dead && attempt===0){fs.rmSync(this.lock,{recursive:true});continue;}
                    throw new SessionError('busy','另一个 Cookie 更新任务正在进行，请稍后再试');
                }
            }
            try{return await fn();}finally{fs.rmSync(this.lock,{recursive:true,force:true});}
        });
        this.queue=run;return run;
    }
    async request(url,cookie,{body,html=false}={}) {
        const dest=new URL(url);
        if(dest.protocol!=='https:' || !['passport.bilibili.com','www.bilibili.com'].includes(dest.hostname))throw new SessionError('invalid','拒绝非 B 站认证地址');
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try {
            const response=await this.fetch(url,{method:body?'POST':'GET',headers:{Cookie:cookie,'User-Agent':UA,Referer:'https://www.bilibili.com/',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(body?{body:new URLSearchParams(body).toString()}:{}),redirect:'error',signal:controller.signal});
            if(!response.ok)throw new SessionError('network',`B 站认证接口暂不可用（HTTP ${response.status}），保留现有凭据`);
            if(html)return {response,data:await response.text()};
            const data=await response.json();
            if(!data || !Number.isInteger(data.code))throw new SessionError('network','B 站认证接口返回异常，保留现有凭据');
            return {response,data};
        } catch(e) {if(e instanceof SessionError)throw e;throw new SessionError('network','B 站认证连接失败或超时，保留现有凭据稍后重试');}
        finally{clearTimeout(timer);}
    }
    async confirm(pending) {
        try {
            const {data}=await this.request(BASE+'confirm/refresh',pending.cookie,{body:{csrf:cookies(pending.cookie).get('bili_jct'),refresh_token:pending.oldToken}});
            if(data.code!==0)throw new SessionError('pending',`新凭据已保存，旧凭据确认尚未完成（code: ${data.code}），稍后自动重试`);
        } catch(e) {throw e.kind==='pending'?e:new SessionError('pending','新凭据已保存，确认连接失败，稍后自动重试确认');}
    }
    async recover() {
        if(!fs.existsSync(this.journal))return false;
        const pending=JSON.parse(fs.readFileSync(this.journal,'utf8'));
        if(!validPair(pending))throw new SessionError('storage','更新恢复记录不完整，未覆盖现有凭据');
        this.publish(pending);
        if(pending.oldToken)await this.confirm(pending);
        fs.unlinkSync(this.journal);return true;
    }
    async commit(pair,oldToken='') {
        if(!validPair(pair))throw new SessionError('invalid','B 站未返回完整 Cookie 和刷新令牌，未覆盖现有凭据');
        this.write(this.journal,JSON.stringify({...pair,oldToken}),0o600);
        this.publish(pair);
        if(oldToken)await this.confirm({...pair,oldToken});
        fs.unlinkSync(this.journal);
    }
    check(options={}) {
        if(this.inFlight)return this.inFlight;
        if(!options.forceCheck && this.lastResult && this.now()-this.lastCheck<(this.lastResult.ok?6*3600000:15*60000))return Promise.resolve(this.lastResult);
        this.inFlight=this.checkOnce(options).finally(()=>{this.inFlight=null;});return this.inFlight;
    }
    async checkOnce({forceCheck=false}={}) {
        try { return await this.exclusive(async()=>{
            const recovered=await this.recover();
            const pair=this.read();
            if(!forceCheck && !recovered && this.lastResult && this.now()-this.lastCheck<(this.lastResult.ok?6*3600000:15*60000))return this.lastResult;
            let result;
            if(!validText(pair.cookie) || !cookies(pair.cookie).get('SESSDATA'))result={ok:false,kind:'login',message:'尚未配置有效 Cookie，请主人私聊 #查成分登录'};
            else {
                const {data}=await this.request(BASE+'cookie/info?csrf='+encodeURIComponent(cookies(pair.cookie).get('bili_jct')||''),pair.cookie);
                if(data.code===0 && data.data?.refresh===false)result={ok:true,kind:recovered?'refreshed':'healthy',message:recovered?'Cookie 更新确认已完成':'Cookie 状态正常，当前无需刷新'};
                else if(data.code===0 && data.data?.refresh===true || data.code===-101) {
                    if(!validPair(pair))throw new SessionError('login','缺少可用的 ac_time_value 或 bili_jct，请主人私聊 #查成分登录重新保存配套凭据');
                    const timestamp=Number.isFinite(data.data?.timestamp)?data.data.timestamp:this.now();
                    const {data:html}=await this.request('https://www.bilibili.com/correspond/1/'+correspondPath(timestamp),pair.cookie,{html:true});
                    const csrf=html.match(/<div\b[^>]*\bid\s*=\s*["']1-name["'][^>]*>\s*([a-zA-Z0-9_-]+)\s*<\/div>/i)?.[1];
                    if(!csrf)throw new SessionError(data.code===-101?'login':'network','未能取得刷新凭据；若登录已失效，请主人私聊 #查成分登录');
                    const refreshed=await this.request(BASE+'cookie/refresh',pair.cookie,{body:{csrf:cookies(pair.cookie).get('bili_jct'),refresh_csrf:csrf,source:'main_web',refresh_token:pair.token}});
                    if(refreshed.data.code!==0)throw new SessionError([-101,-111,86095].includes(refreshed.data.code)?'login':'network',`Cookie 刷新被拒绝（code: ${refreshed.data.code}），未覆盖现有凭据；可用 #查成分登录重新配对`);
                    const lines=setCookieLines(refreshed.response.headers),fresh=cookies(mergeCookies('',lines));
                    if(!fresh.get('SESSDATA') || !fresh.get('bili_jct'))throw new SessionError('invalid','刷新响应缺少新 Cookie，未覆盖现有凭据');
                    if(fresh.get('DedeUserID') && cookies(pair.cookie).get('DedeUserID') && fresh.get('DedeUserID')!==cookies(pair.cookie).get('DedeUserID'))throw new SessionError('invalid','刷新账号不匹配，未覆盖现有凭据');
                    await this.commit({cookie:mergeCookies(pair.cookie,lines),token:refreshed.data.data?.refresh_token},pair.token);
                    result={ok:true,kind:'refreshed',message:'Cookie 和 ac_time_value 已刷新并保存，旧凭据已确认失效'};
                } else throw new SessionError('network',`Cookie 状态检查异常（code: ${data.code}），保留现有凭据`);
            }
            this.lastCheck=this.now();this.lastResult=result;return result;
        });} catch(e) {
            const result={ok:false,kind:e instanceof SessionError?e.kind:'storage',message:e instanceof SessionError?e.message:'凭据保存或恢复失败，已保留更新恢复记录，请检查磁盘和文件权限'};
            this.lastCheck=this.now();this.lastResult=result;return result;
        }
    }
    async saveLogin(headers,token) {
        return this.exclusive(async()=>{await this.commit({cookie:mergeCookies('',setCookieLines(headers)),token});this.lastCheck=0;this.lastResult=null;});
    }
    async saveManual(field,value) {
        return this.exclusive(async()=>{
            if(!validText(value) || field==='cookie' && !cookies(value).get('SESSDATA'))throw new SessionError('invalid','凭据格式不正确');
            if(fs.existsSync(this.journal))throw new SessionError('pending','存在未完成的凭据更新，请先检查 Cookie 或重新扫码登录');
            const pair=this.read();
            if(field==='cookie') {
                // An unrelated manual cookie must not reuse the previous account/session's refresh token.
                if(cookies(pair.cookie).get('SESSDATA')!==cookies(value).get('SESSDATA'))this.write(this.tokenFile,'',0o600);
                let mode=0o644;try{mode=fs.statSync(this.cookieFile).mode&0o777;}catch{}
                this.write(this.cookieFile,value,mode);
            } else if(field==='token')this.write(this.tokenFile,value,0o600);
            else throw new SessionError('invalid','未知凭据类型');
            this.lastCheck=0;this.lastResult=null;
        });
    }
}
    return { BiliSession, atomicWrite, cookies, mergeCookies, setCookieLines, correspondPath };
})();
// END EMBEDDED BILI SESSION
const { BiliSession } = biliSessionCore;

var cookie = "" //理论上SESSDATA即可 现在通过命令设置
var ac_time_value = ""
//在这里填写你的自动刷新列表设置↓↓↓↓↓
let rule =`0 58 23 * * ?`  //更新的秒，分，时，日，月，星期几；日月/星期几为互斥条件，必须有一组为*
let auto_refresh = true  //是否自动更新列表
let auto_check_cookie = true  //是否自动检查cookie
let divisor = 100  //切割发送阈值，0则不切割
let masterId = cfg.masterQQ[0]  //管理者QQ账号
let announce_limit = 10;  //新增或更新时，数量超过该值则不回报详情
let ping_timeout = 1500;  //api的ping值测试超时阈值

//v列表接口地址 https://github.com/dd-center/vtbs.moe/blob/master/api.md =>meta-cdn
var api_cdn = "https://api.vtbs.moe/meta/cdn" 



let record_num = 0
let refresh_num = 0
let record = []
let refresh = []

const generate_qr_url= "https://passport.bilibili.com/x/passport-login/web/qrcode/generate"; //申请二维码
const check_qr_url= "https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key="; //检查二维码扫描情况
const attention_url = "https://line3-h5-mobile-api.biligame.com/game/center/h5/user/relationship/following_list?vmid=" //B站用户关注表
const archive_url = "https://api.bilibili.com/x/web-interface/card?mid="; //b站用户基本信息
const medal_url = "https://api.live.bilibili.com/xlive/web-ucenter/user/MedalWall?target_id=" //粉丝牌查询接口
const search_url = `https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=bili_user&keyword=` //昵称转uid
const dirpath = "data/cha_chengfen" //本地V列表文件夹
var filename = `vtuber_list.json` //本地V列表文件名
var cookie_filename = `bilibili_cookies.txt`; //b站cookie
var ac_time_value_filename = `ac_time_value.txt`; //b站ac_time_value
if (!fs.existsSync(dirpath)) {//如果文件夹不存在
	fs.mkdirSync(dirpath);//创建文件夹
}
if (!fs.existsSync(dirpath + "/" + filename)) {
    fs.writeFileSync(dirpath + "/" + filename, JSON.stringify({
    }))
}
// One session coordinator survives plugin hot reloads and serializes login/refresh writes.
const sessionKey=Symbol.for('pro-ivan.ddcheck.bili-session.v1');
const biliSession=globalThis[sessionKey] ||= new BiliSession({dir:dirpath,fetchImpl:fetch});
function syncCredentials(){const current=biliSession.read();cookie=current.cookie;ac_time_value=current.token;}
syncCredentials();
logger.mark('[查成分] 单文件会话自动续期模块 v1 已加载');
async function ownerPrivate(e){
    if(!e.isMaster){await e.reply('仅主人可以管理 B 站登录凭据');return false;}
    if(e.isGroup){await e.reply('请主人私聊使用此命令');return false;}
    return true;
}

async function sortUrlsByPing(urls) {
    const pingResults = await Promise.all(urls.map(async (url) => {
        const pingTime = await ping(url);
        return { url, pingTime };
    }));

    pingResults.sort((a, b) => a.pingTime - b.pingTime);

    return pingResults
        .filter(result => result.pingTime < Infinity) // Filter out unreachable servers
        .map(result => result.url);
}

async function ping(url, timeout = ping_timeout) {
    const controller = new AbortController();
    const signal = controller.signal;

    const fetchPromise = fetch(url, { method: 'HEAD', mode: 'no-cors', signal })
        .then(() => Date.now() - start)
        .catch(() => Infinity); // If fetch fails, consider it as an infinite ping time

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => {
            controller.abort();
            reject(new Error('timeout'));
        }, timeout)
    );

    const start = Date.now();
    try {
        return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error) {
        return Infinity; // Consider timeout as an infinite ping time
    }
}

async function check_refresh_cookie({forceCheck=false}={}) {
    const result=await biliSession.check({forceCheck});
    syncCredentials();
    return result;
}
// Remove this plugin's old anonymous task on first upgrade, without touching other jobs.
for(const job of Object.values(schedule.scheduledJobs)){
    const source=typeof job.job==='function'?job.job.toString():'';
    if(source.includes('api_cdn') && source.includes('check_refresh_cookie') && source.includes('refresh_num'))job.cancel();
}
schedule.scheduledJobs['ddcheck-v-list']?.cancel();
schedule.scheduledJobs['ddcheck-cookie']?.cancel();
schedule.scheduleJob('ddcheck-cookie','0 17 * * * *',async()=>{
    if(!auto_check_cookie)return;
    const result=await check_refresh_cookie();
    // No credentials in diagnostics and no daily "normal" message spam.
    if(result.kind==='refreshed')logger.info('[查成分] Cookie 自动刷新完成');
    else if(!result.ok)logger.warn('[查成分] '+result.message);
});

let refresh_task = schedule.scheduleJob('ddcheck-v-list',rule, async (e) => {  //定时更新
    if(auto_refresh){
        const res = await fetch(api_cdn, { "method": "GET" })
        let urls = await res.json();
        urls = await sortUrlsByPing(urls);
        var local_json = JSON.parse(fs.readFileSync(dirpath + "/" + filename, "utf8"));//读取文件
        for(var i = 0;i<Object.keys(urls).length;i++){
            try {
                var response = await fetch(urls[i]+"/v1/short", { "method": "GET" });
            } catch (e) {
                Bot.pickUser(masterId).sendMsg("发生异常:" + e)
                console.log("发生异常:" + e)
            }
            if(response.status==200){
                await Bot.pickUser(masterId).sendMsg(`使用api：${urls[i]}`)
                break
            }
        }
        let v_list = await response.json()
        
        record_num = 0
        refresh_num = 0
        record = []
        refresh = []
        for(var j = 0;j<Object.keys(v_list).length;j++){
            var data = {
                "uname": v_list[j].uname,
                "roomid":v_list[j].roomid
            }
            if(!local_json.hasOwnProperty(v_list[j].mid)) {//如果json中不存在该用户
                local_json[v_list[j].mid] = data
                console.log(`${v_list[j].mid}已记录`)
                record.push(`${v_list[j].mid}已记录`)
                record_num++
            }else{
                if(local_json[v_list[j].mid].uname != data.uname || local_json[v_list[j].mid].roomid != data.roomid) //存在但有变化
                {   
                    console.log(`${v_list[j].mid}已刷新`)
                    refresh.push(`${v_list[j].mid}已刷新，${JSON.stringify(local_json[v_list[j].mid])}→${JSON.stringify(data)}`)
                    local_json[v_list[j].mid] = data
                    refresh_num++
                }
            }
        }
        await fs.writeFileSync(dirpath + "/" + filename, JSON.stringify(local_json, null, "\t"));//写入文件
        await Bot.pickUser(masterId).sendMsg(`虚拟主播列表更新完毕，共获取${Object.keys(v_list).length}条信息，现存在${Object.keys(local_json).length}条信息！`)
        if(record_num!=0) {
            await Bot.pickUser(masterId).sendMsg(`新增了${record_num}条`)
            if(record_num<=announce_limit) {await Bot.pickUser(masterId).sendMsg(`${record}`)}
        }
        if(refresh_num!=0) {
            await Bot.pickUser(masterId).sendMsg(`更新了${refresh_num}条`)
            if(refresh_num<=announce_limit) {await Bot.pickUser(masterId).sendMsg(`${refresh}`)}
        }
        await Bot.pickUser(masterId).sendMsg(`成分姬 V列表自动更新已完成`)
    }

})


export class example extends plugin {
    constructor() {
        super({
            name: 'DDchecker',
            event: 'message',
            priority: 5000,
            rule: [
                {
                    reg: '^#?查?成分帮助$',
                    fnc: 'chengfen_help'
                },
                {
                  reg: "^#?更新(V|v)列表$",
                  fnc: 'get_v_list'
                },
                {
                  reg: "^#?查?成分(保存|记录|设置)(ck|cookie|cookies).*$",
                  fnc: 'write_cookies'
                },
                {
                  reg: "^#?查?成分查看(ck|cookie|cookies)$",
                  fnc: 'show_cookies'
                },
                {
                  reg: "^#?查?成分(检查|更新|刷新)(ck|cookie|cookies)$",
                  fnc: 'check_refresh_cookie'
                },
                {
                  reg: "^#?查?成分(保存|记录|设置)(ac|ac_time_value).*$",
                  fnc: 'write_ac_time_value'
                },
                {
                  reg: "^#?查?成分查看(ac|ac_time_value)$",
                  fnc: 'show_ac_time_value'
                },
                {
                  reg: "^#?查?成分(扫码)?登(陆|录)$",
                  fnc: 'scan_login'
                },
                {
                  reg: "^#?查?成分.*$",
                  fnc: 'cha_chengfen'
                }
            ]
        })
    }


    async cha_chengfen(e) {
        let base_info = []
        let message = []
        let mid = e.msg.replace(/#| |查?成分/g, "")
        if(mid == "") {
            this.chengfen_help(e)
            return
        }
        
        
        await check_refresh_cookie(); //静默检查，必要时刷新后再查询
        let name = ''
        if(isNaN(mid)){
            var uid_name = await this.name2uid(mid)
            mid = uid_name["mid"]
            name = uid_name["name"]
            if (mid==0) {
                this.reply(`无法由该昵称(${name})转换为uid`)
                return false
            }
            else{
                this.reply(`已使用uid：${mid}，昵称为：${name}`)
            }
        }
        const vtb_list = JSON.parse(fs.readFileSync(dirpath + "/" + filename, "utf8"));//读取文件
        const attention_list = await this.get_attention_list(mid);
        if(attention_list[0]!==0 && JSON.stringify(attention_list[1])=="[]"){
            this.reply(`对方可能隐藏了关注列表`)
            return
        }
        const medal_list = await this.get_medal_list(mid);
        const archive = await this.get_archive(mid);
        await base_info.push(segment.image((archive.data.card.face)))
        await base_info.push(`${JSON.stringify(archive.data.card.name).replaceAll(`\"`, ``)} (uid: ${mid})  Lv${JSON.stringify(archive.data.card.level_info.current_level)}\n粉丝：${archive.data.card.fans}\n关注：${Object.keys(attention_list[1]).length}\n`)
        if(archive.data.card.official_verify.type!=-1)
            await base_info.push(`bilibili认证：${JSON.stringify(archive.data.card.official_verify.desc).replaceAll(`\"`, ``)}`)
        
        var v_num = 0;
        var split_index = 0;
        message[split_index] = [];
        for(var i = 0;i<Object.keys(attention_list[1]).length;i++){
            if(vtb_list.hasOwnProperty(attention_list[1][i].mid)) {//如果json中存在该用户
                let uid = attention_list[1][i].mid;
                message[split_index].push(`${JSON.stringify(vtb_list[uid].uname).replaceAll("\"","")} - ${uid}\n`)
                if(medal_list.hasOwnProperty(attention_list[1][i].mid)){
                    message[split_index].push(`└${JSON.stringify(medal_list[uid].medal_name).replaceAll("\"","")}|${medal_list[uid].level}\n`)
                }
                v_num++;
                if (divisor !== 0) {
                    if (v_num % divisor === 0) {
                        split_index++;
                        message[split_index] = [];
                    }
                }
            }
        }
        var dd_percent_str = `${(v_num/(i)*100).toFixed(2)}% (${v_num}/${i})\n-------\n`;
        for(var i = 0; i < message.length; i++) {
            message[i].unshift(dd_percent_str);
        
            let forwardMsg = await this.makeForwardMsg(`查成分结果(第${i+1}页/共${message.length}页${divisor===0?'':`/每页${divisor}项`})：`, base_info, message[i])
            await this.reply(forwardMsg)
        }
        return
    }
    
    async check_refresh_cookie(e) {
        if(!await ownerPrivate(e))return false;
        const result=await check_refresh_cookie({forceCheck:true});
        await e.reply(result.message);
        return true;
    }

    async scan_login(e) {
        if(!await ownerPrivate(e))return false;
        if(biliSession.qrBusy){await e.reply('已有扫码登录正在等待，请先完成或等待二维码过期');return true;}
        biliSession.qrBusy=true;
        try {
            const generated=await biliSession.request(generate_qr_url,'');
            if(generated.data.code!==0 || !generated.data.data?.url || !generated.data.data?.qrcode_key){await e.reply('二维码获取失败，请稍后重试');return true;}
            const {url,qrcode_key}=generated.data.data;
            await QRCode.toFile(dirpath+'/qrcode.png',url);
            await e.reply('请用哔哩哔哩 APP 扫码登录，仅扫描你本人发起的二维码');
            await e.reply(segment.image(dirpath+'/qrcode.png'));
            const deadline=Date.now()+180000;
            while(Date.now()<deadline){
                await new Promise(resolve=>setTimeout(resolve,3000));
                const polled=await biliSession.request(check_qr_url+encodeURIComponent(qrcode_key),'');
                if(polled.data.code!==0){await e.reply('扫码状态查询失败，请重新登录');return true;}
                const result=polled.data.data;
                if([86101,86090].includes(result?.code))continue;
                if(result?.code===86038)break;
                if(result?.code!==0){await e.reply('扫码登录未完成，请重新登录');return true;}
                await biliSession.saveLogin(polled.response.headers,result.refresh_token);
                syncCredentials();
                await e.reply('B 站登录成功，Cookie 和 ac_time_value 已保存，已启用自动刷新');
                return true;
            }
            await e.reply('二维码已过期，请重新发送 #查成分登录');
        } catch(err){await e.reply(err.kind?err.message:'登录凭据保存失败，请重试；未回显任何凭据');}
        finally{biliSession.qrBusy=false;try{fs.unlinkSync(dirpath+'/qrcode.png');}catch{}}
        return true;
    }

    async name2uid(name) {
        //https://api.bilibili.com/x/web-interface/wbi/search/type?page=1&page_size=36&platform=pc&keyword=%E8%8B%A6%E6%80%95creep-II&search_type=bili_user
        try {
            var response = await fetch((search_url+name), { "headers": {"cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Referer": "https://www.bilibili.com"}, "method": "GET" });
        } catch (e) {
            this.reply("name2uid请求发生异常:" + e + "，可能是Cookie失效导致")
            console.log("name2uid请求发生异常:" + e)
            let uid_name = {"mid": 0, "name": name}
            return uid_name
        }
        let search_result = await response.json()
        if(search_result['code']==0&&typeof(search_result['data']['result'])!='undefined'){
            if(search_result['data']['result'].length != 0){
                let uid = search_result['data']['result'][0]['mid']
                let name = search_result['data']['result'][0]['uname']
                let uid_name = {"mid": parseInt(uid), "name": name}
                return uid_name
            }
            else {
                this.reply("无法由昵称转为uid：搜索结果为0")
                console.log("昵称转uid解析过程发生异常：搜索结果为0")
                let uid_name = {"mid": 0, "name": name}
                return uid_name
            }
        }
        else {
            this.reply("昵称转uid解析过程发生异常，可能是Cookie失效:"+search_url+name+JSON.stringify(search_result))
            console.log("昵称转uid解析过程发生异常")
            let uid_name = {"mid": 0, "name": name}
            return uid_name
        }
    }
    
    async get_v_list(e) {
        const res = await fetch(api_cdn, { "method": "GET" })
        let urls = await res.json();
        urls = await this.sortUrlsByPing(urls);
        var local_json = JSON.parse(fs.readFileSync(dirpath + "/" + filename, "utf8"));//读取文件
        for(var i = 0;i<Object.keys(urls).length;i++){
            try {
                var response = await fetch(urls[i]+"/v1/short", { "method": "GET" });
            } catch (e) {
                this.reply("发生异常:" + e)
                console.log("发生异常:" + e)
            }
            if(response.status==200){
                await this.reply(`使用api：${urls[i]}`)
                break
            }
        }
        let v_list = await response.json()
        
        record_num = 0
        refresh_num = 0
        record = []
        refresh = []
        for(var j = 0;j<Object.keys(v_list).length;j++){
            var data = {
                "uname": v_list[j].uname,
                "roomid":v_list[j].roomid
            }
            if(!local_json.hasOwnProperty(v_list[j].mid)) {//如果json中不存在该用户
                local_json[v_list[j].mid] = data
                console.log(`${v_list[j].mid}已记录`)
                record.push(`${v_list[j].mid}已记录`)
                record_num++
            }else{
                if(local_json[v_list[j].mid].uname != data.uname || local_json[v_list[j].mid].roomid != data.roomid) //存在但有变化
                {   
                    console.log(`${v_list[j].mid}已刷新`)
                    refresh.push(`${v_list[j].mid}已刷新，${JSON.stringify(local_json[v_list[j].mid])}→${JSON.stringify(data)}`)
                    local_json[v_list[j].mid] = data
                    refresh_num++
                }
            }
        }
        await fs.writeFileSync(dirpath + "/" + filename, JSON.stringify(local_json, null, "\t"));//写入文件
        await this.reply(`虚拟主播列表更新完毕，共获取${Object.keys(v_list).length}条信息，现存在${Object.keys(local_json).length}条信息！`)
        if(record_num!=0) {await this.reply(`新增了${record_num}条`)
            if(record_num<=announce_limit) {await this.reply(`${record}`)}
        }
        if(refresh_num!=0) {await this.reply(`更新了${refresh_num}条`)
            if(refresh_num<=announce_limit) {await this.reply(`${refresh}`)}
        }
    }
    
    async get_attention_list(mid) {
        let page = 1;
        let resJson;
        var attention_list = [];
        var response;
        while (true){
            response = await fetch(attention_url+`${mid}&pn=${page}`, { "headers": {"cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Referer": "https://www.bilibili.com"},  "method": "GET", });
            if (response.status>=400&&response.status<500) {
                await this.reply("404，可能是uid不存在")
                return [0,[]];
            }
            resJson = await response.json();
            // await this.reply(attention_url+`${mid}&pn=${page}`+JSON.stringify(resJson));
            if(resJson.code!==0){
                await this.reply(`获取目标关注列表失败，可能是查无此人或者风控：${resJson.message}`)
                return [0,[]];
            } else if (resJson.data.list&&JSON.stringify(resJson.data.list) == '[]') {
                break;
            } else {
                attention_list = [...attention_list, ...resJson.data.list];
                page++;
            } 
        }
        return [resJson.total,attention_list];
    }
    
    async get_archive(mid) {
        let resJson;
        var response = await fetch(archive_url+mid, { "headers": {"cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Referer": "https://www.bilibili.com"},  "method": "GET" });
        if (response.status>=400&&response.status<500) {
            await this.reply("404，可能是uid不存在")
            return false;
        }
        resJson = await response.json();
        if(resJson.code!==0){
            await this.reply(`获取目标基本信息失败，可能是查无此人：${resJson.message}`)
            return false;
        } else {
            return resJson;
        } 
    }
    
    async get_medal_list(mid) {
        var response = await fetch(medal_url+mid, { "headers": {"cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Referer": "https://www.bilibili.com"},  "method": "GET" });
        if (response.status==404) {
            await this.reply("404，可能是uid不存在")
            return false
        }
        var medal_list_raw = await response.json()
        var medal_list = {};
        if(medal_list_raw.code!==0){
            await this.reply(`获取粉丝牌数据错误：${JSON.stringify(medal_list_raw.message)}，一般是cookie中的SESSDATA过期导致`)
            return medal_list
        }
        for(var i = 0;i<Object.keys(medal_list_raw.data.list).length;i++){
            var data = {
                "level":medal_list_raw.data.list[i].medal_info.level,
                "medal_name":medal_list_raw.data.list[i].medal_info.medal_name
            }
            medal_list[medal_list_raw.data.list[i].medal_info.target_id] = data
        }
        return medal_list
    }
    
    async write_cookies(e) {
        if(!await ownerPrivate(e))return false;
        const value=e.msg.replace(/^#?查?成分(?:保存|记录|设置)(?:cookies|cookie|ck)\s*/i,'').trim();
        try{await biliSession.saveManual('cookie',value);syncCredentials();await e.reply('Cookie 已保存；如更换了登录会话，请同时保存对应的 ac_time_value，或直接扫码登录');}
        catch(err){await e.reply(err.kind?err.message:'Cookie 保存失败');}
        return true;
    }
    async show_cookies(e) {
        if(!await ownerPrivate(e))return false;
        syncCredentials();await e.reply(cookie?'Cookie 已配置（不回显凭据）；可用 #查成分检查ck 检查或刷新':'尚未配置 Cookie，请使用 #查成分登录');return true;
    }
    async write_ac_time_value(e) {
        if(!await ownerPrivate(e))return false;
        const value=e.msg.replace(/^#?查?成分(?:保存|记录|设置)(?:ac_time_value|ac)\s*/i,'').trim();
        try{await biliSession.saveManual('token',value);syncCredentials();await e.reply('ac_time_value 已保存');}
        catch(err){await e.reply(err.kind?err.message:'ac_time_value 保存失败');}
        return true;
    }
    async show_ac_time_value(e) {
        if(!await ownerPrivate(e))return false;
        syncCredentials();await e.reply(ac_time_value?'ac_time_value 已配置（不回显凭据）':'尚未配置 ac_time_value，建议使用 #查成分登录');return true;
    }

    async ping(url, timeout = ping_timeout) {
        const controller = new AbortController();
        const signal = controller.signal;
    
        const fetchPromise = fetch(url, { method: 'HEAD', mode: 'no-cors', signal })
            .then(() => Date.now() - start)
            .catch(() => Infinity); // If fetch fails, consider it as an infinite ping time
    
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => {
                controller.abort();
                reject(new Error('timeout'));
            }, timeout)
        );
    
        const start = Date.now();
        try {
            return await Promise.race([fetchPromise, timeoutPromise]);
        } catch (error) {
            return Infinity; // Consider timeout as an infinite ping time
        }
    }
    
    async sortUrlsByPing(urls) {
        const pingResults = await Promise.all(urls.map(async (url) => {
            const pingTime = await this.ping(url);
            return { url, pingTime };
        }));
    
        pingResults.sort((a, b) => a.pingTime - b.pingTime);
    
        return pingResults
            .filter(result => result.pingTime < Infinity) // Filter out unreachable servers
            .map(result => result.url);
    }
    
    async makeForwardMsg (title, base_info, msg) {
    let nickname = Bot.nickname
    if (this.e.isGroup) {
      let info = await Bot.pickMember(this.e.group_id, Bot.uin)
      nickname = info.nickname || info.card
    }
    let userInfo = {
      user_id: Bot.uin,
      nickname
    }

    let forwardMsg = [
      {
        ...userInfo,
        message: title
      },
      {
        ...userInfo,
        message: base_info
      },
      {
        ...userInfo,
        message: msg
      }
    ]

    /** 制作转发内容 */
    if (this.e.isGroup) {
      forwardMsg = await this.e.group.makeForwardMsg(forwardMsg)
    } else {
      forwardMsg = await this.e.friend.makeForwardMsg(forwardMsg)
    }

    /** 处理描述 */
    forwardMsg.data = JSON.stringify(forwardMsg.data)
    forwardMsg.data = forwardMsg.data
      .replace(/\n/g, '')
      .replace(/<title color="#777777" size="26">(.+?)<\/title>/g, '___')
      .replace(/___+/, `<title color="#777777" size="26">${title}</title>`)
    forwardMsg.data = JSON.parse(forwardMsg.data)

    return forwardMsg
  }
  async chengfen_help(e){
      await this.reply("查成分帮助\n1.发送 #更新v列表 更新主播列表到本地，建议每周至少更新一次\n2.使用 #查成分 目标uid或者昵称全称 获取目标的成分，包括关注的V/游戏官号以及对应的粉丝牌\n3.使用 #查成分登录 来通过哔哩哔哩APP扫描获取cookie；若不能扫描或扫码登陆失败，可使用 #查成分记录ck 保存b站Cookie，并使用 #查成分记录ac 保存b站ac_time_value；要查看你的设置，使用 #查成分查看ck 查看保存的ck，使用 #查成分查看ac 查看保存的ac_time_value，你也可以通过 #查成分检查ck 检查 Cookie 并在需要时刷新；系统每小时巡检，正常状态最多每6小时请求一次。凭据管理仅限主人私聊，不回显凭据")
  }
}
