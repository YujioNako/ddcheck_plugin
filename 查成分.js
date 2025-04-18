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

var cookie = "" //理论上SESSDATA即可 现在通过命令设置
var ac_time_value = ""
//在这里填写你的自动刷新列表设置↓↓↓↓↓
let rule =`0 0 0 * * ?`  //更新的秒，分，时，日，月，星期几；日月/星期几为互斥条件，必须有一组为*
let auto_refresh = 1  //是否自动更新列表，1开0关
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

let refresh_task = schedule.scheduleJob(rule, async (e) => {  //定时更新
    if(auto_refresh==1){
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


const login_check_url = "https://passport.bilibili.com/x/passport-login/web/cookie/info"; //检测是否需要更新cookie
const refresh_csrf_url = "https://www.bilibili.com/correspond/1/";
const refresh_cookie_url = "https://passport.bilibili.com/x/passport-login/web/cookie/refresh";
const refresh_confirm_url = "https://passport.bilibili.com/x/passport-login/web/confirm/refresh";
const attention_url = "https://api.bilibili.com/x/relation/followings?vmid=" //B站基本信息接口 含关注表
const archive_url = "http://api.bilibili.com/x/web-interface/card?mid=";
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
if (!fs.existsSync(dirpath + "/" + cookie_filename)) {
    fs.writeFileSync(dirpath + "/" + cookie_filename, JSON.stringify({
    }))
}
if (!fs.existsSync(dirpath + "/" + ac_time_value_filename)) {
    fs.writeFileSync(dirpath + "/" + ac_time_value_filename, JSON.stringify({
    }))
}
// 读取文件内容并存储到变量 cookie 中
fs.readFile(dirpath + "/" + cookie_filename, 'utf8', async function(err, data) {
    if (err) {
        await Bot.pickUser(masterId).sendMsg('Cookie 文件读取错误');
        console.error(err);
        return;
    }

    if (data === '') {
        await Bot.pickUser(masterId).sendMsg('您尚未设置cookie，请使用 #查成分保存ck 来保存');
        console.log('文件为空');
    } else {
        cookie = data;
        await Bot.pickUser(masterId).sendMsg('查成分 Cookie已设置');
        console.log('读取到的 Cookie:', cookie);
    }
});
// 读取文件内容并存储到变量 ac_time_value 中
fs.readFile(dirpath + "/" + ac_time_value_filename, 'utf8', async function(err, data) {
    if (err) {
        await Bot.pickUser(masterId).sendMsg('ac_time_value 文件读取错误');
        console.error(err);
        return;
    }

    if (data === '') {
        await Bot.pickUser(masterId).sendMsg('您尚未设置ac_time_value，请使用 #查成分保存ac 来保存');
        console.log('文件为空');
    } else {
        ac_time_value = data;
        await Bot.pickUser(masterId).sendMsg('查成分 ac_time_value已设置');
        console.log('读取到的 ac_time_value:', cookie);
    }
});

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
                  fnc: 'check_cookie'
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
    
    async check_cookie(e) {
        async function check_cookie() {
            let response = await fetch(login_check_url, { "headers": {"cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Reference": "https://www.bilibili.com"},  "method": "GET", });
            if (response.status>=400&&response.status<500) {
                await e.reply("检查cookie状态失败")
                return false;
            }
            let cookie_status = await response.json();
            if(cookie_status.code === 0) {
                e.reply('cookie状态正常，无需刷新');
                return true;
            } else {
                e.reply('cookie失效，将重新获取cookie');
                return false;
            }
        }
        
        async function createCorrespondPath() {
            const publicKey = await crypto.subtle.importKey(
              "jwk",
              {
                kty: "RSA",
                n: "y4HdjgJHBlbaBN04VERG4qNBIFHP6a3GozCl75AihQloSWCXC5HDNgyinEnhaQ_4-gaMud_GF50elYXLlCToR9se9Z8z433U3KjM-3Yx7ptKkmQNAMggQwAVKgq3zYAoidNEWuxpkY_mAitTSRLnsJW-NCTa0bqBFF6Wm1MxgfE",
                e: "AQAB",
              },
              { name: "RSA-OAEP", hash: "SHA-256" },
              true,
              ["encrypt"],
            )
            
            async function getCorrespondPath(timestamp) {
              const data = new TextEncoder().encode(`refresh_${timestamp}`);
              const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, data))
              return encrypted.reduce((str, c) => str + c.toString(16).padStart(2, "0"), "")
            }
            
            const ts = Date.now()
            return await getCorrespondPath(ts)
        }
        
        async function refresh_cookie(refresh_csrf) {
            async function getCookieValue(cookieString, key) {
              return cookieString
                .split('; ')
                .reduce((result, item) => {
                  const [k, v] = item.split('=');
                  return k === key ? v : result;
                }, '');
            }
            
            async function refresh_confirm(csrf, refresh_token) {
                const data = {
                    csrf: csrf,
                    refresh_token: refresh_token
                }
                let response = await fetch(refresh_cookie, { "headers": {'Content-Type': 'application/x-www-form-urlencoded', "cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Reference": "https://www.bilibili.com"},  "method": "POST", "body": data.toString() });
                let confirm_result = response.json();
                if (confirm_result.code === 0) {
                    return true;
                } else {
                    this.reply(`刷新确认异常，错误码${confirm_result.code}，错误报${confirm_result.message}，参考错误码解释：\n-101：账号未登录\n-111：csrf 校验失败\n-400：请求错误`);
                    return false;
                }
            }
            let biliJct = await getCookieValue(cookie, 'bili_jct');
            
            const data = new URLSearchParams({
              csrf: biliJct,
              refresh_csrf: refresh_csrf,
              source: 'main_web',
              refresh_token: ac_time_value
            });
            let response = await fetch(refresh_cookie, { "headers": {'Content-Type': 'application/x-www-form-urlencoded', "cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Reference": "https://www.bilibili.com"},  "method": "POST", "body": data.toString() });
            let refresh_result = response.json();
            if (refresh_result.code === 0) {
                const last_ac_time_value = ac_time_value;
                ac_time_value = refresh_result.data.refresh_token;
                e.write_ac_time_value({ "msg": refresh_token });
                const setCookieHeaders = response.headers.getAll('set-cookie') || [];
                // 解析并提取 SESSDATA 和 bili_jct 的值
                cookie = "";
                setCookieHeaders.forEach(cookieString => {
                    // 提取键值对（示例使用正则表达式）
                    const match = cookieString.match(/^(.*?);/); // 提取键值对部分（忽略其他参数）
                    if (match) {
                        const [pair] = match;
                        const [key, value] = pair.split('=');
                        cookie += `"${key}": "${value}"`;
                    }
                });
                e.write_cookies({ "msg": cookie });
                biliJct = await getCookieValue(cookie, 'bili_jct');
                if(await refresh_confirm(biliJct, last_ac_time_value)) {
                    e.reply("Cookie 刷新成功");
                    return true;
                } else {
                    e.reply("Cookie 刷新确认失败");
                    return false;
                }
            } else {
                e.reply('刷新cookie失败');
                return false;
            }
        }
        
        if (await check_cookie()) {
            return true;
        }
        
        const full_refresh_csrf_url = refresh_csrf_url + await createCorrespondPath();
        let response = await fetch(full_refresh_csrf_url, { "headers": {"cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Reference": "https://www.bilibili.com"},  "method": "GET", });
        let refresh_result = await response.text();
        const regex = /<div\s+id=["']1-name["']>(.*?)<\/div>/is; // i 表示不区分大小写，s 表示点匹配换行
        const match = htmlString.match(regex);
        let refresh_csrf;
        if (match) {
          refresh_csrf = match[1]; // 提取第一个捕获组的内容
        }
        
        await refresh_cookie(refresh_csrf);
        return true;
    }
    
    async name2uid(name) {
        //https://api.bilibili.com/x/web-interface/wbi/search/type?page=1&page_size=36&platform=pc&keyword=%E8%8B%A6%E6%80%95creep-II&search_type=bili_user
        try {
            var response = await fetch((search_url+name), { "headers": {"cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Reference": "https://www.bilibili.com"}, "method": "GET" });
        } catch (e) {
            this.reply("name2uid请求发生异常:" + e + "，可能是cookie失效导致")
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
            this.reply("昵称转uid解析过程发生异常，可能是cookie失效:"+search_url+name+JSON.stringify(search_result))
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
            response = await fetch(attention_url+`${mid}&pn=${page}`, { "headers": {"cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Reference": "https://www.bilibili.com"},  "method": "GET", });
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
        var response = await fetch(archive_url+mid, { "headers": {"cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Reference": "https://www.bilibili.com"},  "method": "GET" });
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
        var response = await fetch(medal_url+mid, { "headers": {"cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Reference": "https://www.bilibili.com"},  "method": "GET" });
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
        cookie = e.msg.replace(/#| |查?成分|保存|记录|设置|ck|cookie|cookies/g, "");
        fs.writeFile(dirpath + "/" + cookie_filename, cookie, 'utf8', async function(err) {
            if (err) {
                console.error(err);
                await e.reply('Cookie 保存失败');
                return;
            }
            console.log('Cookie 已成功保存到文件:', cookie_filename);
            await e.reply('Cookie 已保存：' + cookie);
        });
    }
    
    async show_cookies(e) {
        // 读取文件内容并存储到变量 cookie 中
        fs.readFile(dirpath + "/" + cookie_filename, 'utf8', async function(err, data) {
            if (err) {
                await e.reply('Cookie 文件读取错误');
                console.error(err);
                return;
            }
    
            if (data === '') {
                await e.reply('您尚未设置cookie，请使用 #查成分保存ck 来保存');
                console.log('文件为空');
            } else {
                await e.reply('读取到的 Cookie:' + data);
                console.log('读取到的 Cookie:', data);
            }
        });
    }
    
    async write_ac_time_value(e) {
        ac_time_value = e.msg.replace(/#| |查?成分|保存|记录|设置|ac|ac_time_value/g, "");
        fs.writeFile(dirpath + "/" + ac_time_value_filename, ac_time_value, 'utf8', async function(err) {
            if (err) {
                console.error(err);
                await e.reply('ac_time_value 保存失败');
                return;
            }
            console.log('ac_time_value 已成功保存到文件:', ac_time_value_filename);
            await e.reply('ac_time_value 已保存：' + ac_time_value);
        });
    }
    
    async show_ac_time_value(e) {
        // 读取文件内容并存储到变量 ac_time_value 中
        fs.readFile(dirpath + "/" + ac_time_value_filename, 'utf8', async function(err, data) {
            if (err) {
                await e.reply('ac_time_value 文件读取错误');
                console.error(err);
                return;
            }
    
            if (data === '') {
                await e.reply('您尚未设置ac_time_value，请使用 #查成分保存ac 来保存');
                console.log('文件为空');
            } else {
                await e.reply('读取到的 ac_time_value:' + data);
                console.log('读取到的 ac_time_value:', data);
            }
        });
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
      await this.reply("查成分帮助\n1.发送 #更新v列表 更新主播列表到本地，建议每周至少更新一次\n2.使用 #查成分 目标uid或者昵称全称 获取目标的成分，包括关注的V/游戏官号以及对应的粉丝牌\n3.使用 #查成分记录ck 保存b站cookie，使用 #查成分查看ck 查看保存的ck")
  }
}
