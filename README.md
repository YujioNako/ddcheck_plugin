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

需要 Node.js 20 或以上版本。本版在 Miao-Yunzai / Node.js 20 环境验证。

只需将 `查成分.js` 复制到 Yunzai 的 `plugins/example/` 目录，无需安装本仓库的其他文件。Cookie 自动续期模块已内嵌在主文件中。

```text
Miao-Yunzai/
└── plugins/example/
    └── 查成分.js
```

从上一版升级时，替换主文件并确认加载成功后，可以删除旧的 `plugins/example/lib/bili-session.mjs`；`lib` 目录只有在为空时才能删除。保留原有 `data/cha_chengfen/`，其中的列表、Cookie 和刷新令牌继续使用。

在 Yunzai 根目录安装二维码依赖（已安装则无需重复）：

```bash
pnpm add qrcode
```

加密使用 Node.js 内置的 `node:crypto`，无需安装名为 `crypto` 的 npm 包。其余依赖由现有 Yunzai 环境提供。复制完成后检查控制台是否出现“单文件会话自动续期模块 v1 已加载”；支持热更新的框架无需重启。

### 登录与配置

**以下登录和凭据管理命令仅限主人私聊使用。** 推荐发送 `#查成分登录`，使用哔哩哔哩 APP 扫码，插件会成对保存 Cookie 和 `ac_time_value`。

| 命令 | 功能 |
| --- | --- |
| `#查成分登录` | 扫码登录并保存配套凭据，也支持“登陆”“扫码登录” |
| `#查成分检查ck` | 立即检查，并在 B 站要求时刷新 |
| `#查成分刷新ck` / `#查成分更新ck` | 与检查命令相同，不强制轮换仍无需刷新的凭据 |
| `#查成分记录ck Cookie内容` | 手动保存 Cookie；更换登录会话时清空原刷新令牌，防止混用 |
| `#查成分记录ac ac_time_value内容` | 保存与当前 Cookie 配套的刷新令牌 |
| `#查成分查看ck` / `#查成分查看ac` | 查看是否已配置，不回显凭据内容 |

手动配置时，在已登录的 B 站网页开发者工具中读取 `www.bilibili.com` 请求的 Cookie，以及该站点 Local Storage 中的 `ac_time_value`。自动续期需要同一登录会话的 `SESSDATA`、`bili_jct` 和 `ac_time_value`；仅提供 `SESSDATA` 不能保证自动刷新正常。优先使用扫码登录，避免配错。

### 自动续期

- 自动检查默认开启，每小时巡检；正常状态下最多每 6 小时请求一次状态接口。查询成分前也会静默检查，手动命令可立即检查。
- 根据 B 站返回的 `data.refresh` 决定是否刷新，而非只判断 `code: 0`。获取刷新 CSRF 后，以旧令牌换取新 Cookie 和新令牌，持久化后再使用新 Cookie 确认废弃旧令牌。
- 同时发生的检查共用一个刷新任务；跨进程文件锁避免重复轮换。网络失败不会清空原凭据，失败检查有 15 分钟冷却，定时巡检或后续查询会重试。
- 更新过程使用恢复记录。若保存中断或确认失败，下次检查会先恢复保存或补做确认，不会直接丢弃已经取得的新凭据。
- 扫码等待每 3 秒查询一次，最长等待 3 分钟；成功回复只说明保存结果，不回显 Cookie 或令牌。日志也不会输出这些凭据。
- 若账号被强制下线，或刷新令牌失效、不匹配，自动刷新可能被 B 站拒绝，此时请重新扫码登录。

`bilibili_cookies.txt` 和 `ac_time_value.txt` 的路径不变，依赖这些文件的其他本地服务可以继续读取。不要公开 `data/cha_chengfen/`，其中的 Cookie、刷新令牌和更新恢复记录都是登录凭据。

可在主文件顶部调整 `auto_check_cookie`、V 列表更新设置和消息切割阈值。Cookie 定时检查独立于 V 列表更新，不会因为列表接口故障而跳过。

## 开发与测试

在本仓库根目录运行，无需安装测试依赖：

```bash
npm test
```

测试使用 Node.js 内置测试框架、临时目录和模拟接口，不访问真实 B 站账号，也不会连接 QQ 或发送消息。覆盖刷新协议、Cookie 解析、并发、失败保留、保存中断恢复、扫码保存及主人私聊权限。

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
