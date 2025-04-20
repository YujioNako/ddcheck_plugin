# ddcheck_plugin
成分姬Yunzai-Bot版本，查询B站关注列表的VTuber/游戏官号成分，并统计成文字发出

如果有用的话，**请给个star吧**~

**数据来源**

VTB列表数据来源：[vtbs.moe](https://vtbs.moe/)

## 用户使用指南

**更新列表**

```
#更新v列表
```

注：有反馈称更新列表（包括自动更新）时出现无反应的情况，这似乎是原因不明的（疑似风控）与`api.vtbs.moe/meta/cdn`的连接超时，目前来看只能通过等待解决。

**查成分**

```
#查成分 UID
例子：#查成分 114514
```

**按昵称查成分**

```
#查成分 昵称
例子：#查成分 田所浩二
```
**注意：首次使用时应该先更新列表，否则本地列表将为空，程序无法对比生成目标成分**

## 管理员使用指南
### 部署到云崽

直接将`查成分.js`放置到`/plugin/example`即可，文件名可修改

初次部署时，下面两个依赖是需要优先安装好的

在yunzai根目录运行以下bash来安装二维码及公钥相关依赖
```
pnpm add qrcode crypto
```

安装上述依赖后仍然请注意控制台载入信息是否正常，若出现类似“XXX is not defined”的报错，请确认是否安装好对应的依赖

### 配置
请优先使用命令`#查成分登陆`来用哔哩哔哩APP扫码登陆自动获取cookie

若扫码登陆失败，也可以使用命令`#查成分记录ck 您的cookie`来配置或更新您的b站账号的cookie，否则该插件无法使用；进一步的，您可以使用`#查成分记录ac 您的ac_time_value`来配置或更新您的b站账号的ac_time_value，这样做可以让插件得以自动化更新cookie（该功能正在研究中，尚不能正常运作）

> `cookie` 获取方式：<br>
> 登录bilibili后，`F12` 打开开发工具，查看 `www.bilibili.com` 的请求头下的`cookie`内，形如`SESSDATA=XXXX;bili_jct=XXXX;`的字段，即为您的b站cookie <br>

理论上，使用粉丝牌查询只需要`SESSDATA`，使用昵称转uid同时需要`bili_jct`以及`SESSDATA`；如果您不是很了解cookie的结构、用法、用途，请直接将cookie字段下的所有内容贴入

`SESSDATA`与`bili_jct`可能需要经常更新，当cookie失效后，查成分时会出现提示；若您还设置了ac_time_value，您可尝试使用`#查成分更新ck`来自动化更新cookie

<b><h3>注意：不要将包含`SESSDATA`或`bili_jct`在内的cookie透露给任何人，这些字段包含了您的Bilibili登录令牌，其泄露可能给您的账号带来风险</h3></b>

> `ac_time_value`获取方式：<br>
> 在控制台中输入下面的JavaScript：
```
const acTimeValue = localStorage.getItem('ac_time_value');

if (acTimeValue !== null) {
  console.log('ac_time_value 的值是:', acTimeValue);
} else {
  console.log('未找到名为 "ac_time_value" 的存储项');
}
```

您还可以根据需要在js内配置是否开启自动更新列表，自动更新的时间，是否切割发送等设置，具体调整方式请参考js内注释

## 示例
<div align="left">
  <img src="https://i0.hdslb.com/bfs/new_dyn/88a145db1880ccd159e3ea3b48bf524111022578.png" height=500px />
  <img src="https://i0.hdslb.com/bfs/new_dyn/453a037d4108cad14734cadbe48c46b111022578.jpg" height=500px />
</div>

## 其他
### 感谢
* [官方Yunzai-Bot-V3](https://github.com/Le-niao/Yunzai-Bot) : [Gitee](https://gitee.com/Le-niao/Yunzai-Bot)
  / [Github](https://github.com/Le-niao/Yunzai-Bot)
* [noneplugin](https://github.com/noneplugin/) : [NoneBot2 成分姬插件](https://github.com/noneplugin/nonebot-plugin-ddcheck)
