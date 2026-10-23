import fs from 'node:fs';
import path from 'node:path';
import { publicEncrypt, createPublicKey, constants, randomBytes } from 'node:crypto';

const BASE='https://passport.bilibili.com/x/passport-login/web/';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const KEY=createPublicKey({format:'jwk',key:{kty:'RSA',e:'AQAB',n:'y4HdjgJHBlbaBN04VERG4qNBIFHP6a3GozCl75AihQloSWCXC5HDNgyinEnhaQ_4-gaMud_GF50elYXLlCToR9se9Z8z433U3KjM-3Yx7ptKkmQNAMggQwAVKgq3zYAoidNEWuxpkY_mAitTSRLnsJW-NCTa0bqBFF6Wm1MxgfE'}});
export const correspondPath=timestamp=>publicEncrypt({key:KEY,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(`refresh_${timestamp}`)).toString('hex');
export function cookies(text='') {
    const out=new Map();
    for(const part of text.split(';')) { const i=part.indexOf('=');if(i>0)out.set(part.slice(0,i).trim(),part.slice(i+1).trim()); }
    return out;
}
export function setCookieLines(headers) {
    if(typeof headers.getSetCookie==='function')return headers.getSetCookie();
    if(typeof headers.raw==='function')return headers.raw()['set-cookie']||[];
    return (headers.get('set-cookie')||'').split(/,(?=\s*[^;,=\s]+=)/).filter(Boolean);
}
export function mergeCookies(previous,lines) {
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
export function atomicWrite(file,value,mode=0o600) {
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
export class BiliSession {
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
