# 小小日课 · Family Learning

微信原生小程序 + 腾讯云开发 CloudBase 的家庭学习 MVP。支持家人共同照看孩子、每日古诗文与英语任务、打卡及跨设备同步。

**默认启动为本机演示模式。云端版本需要配置自己的 AppID、云环境并部署云函数；仅导入代码不会启用真实多手机同步。**

## 当前功能

| 场景 | 行为 |
|---|---|
| 家庭成员 | 创建家庭、一次性邀请码加入、创建者移除成员、成员退出 |
| 孩子档案 | 最多 5 个孩子；家长使用自己的微信身份共享档案 |
| 每日任务 | 按孩子添加古诗文／英语／其他每日计划；暂停计划保留已生成任务 |
| 学习记录 | 查看当天与近一年历史、完成或撤销；仅有实际生成任务的日期才有记录 |
| 同步 | 打卡先持久化；联网、打开应用和前台每 20 秒同步；重复请求去重，冲突提示重新确认 |

示例包含《咏鹅》和自编英语问候练习。`data/catalogs/` 有国家课标 135 条目录，尚未接入完整正文或上海教材映射，不能视为全部中考内容。录音、AI 评分、间隔复习和教材整库的状态见[版本边界](docs/MVP.md)。

## 本地运行

需要 Node.js 20+、微信开发者工具。

```sh
npm ci
npm ci --prefix cloudfunctions/familyApi --ignore-scripts
npm run configure
npm run verify
```

微信开发者工具打开仓库根目录（包含生成的 `project.config.json`）。未设置 AppID 时可使用测试号／游客模式。进入「家庭」创建演示家庭，再到「今日」查看和完成任务。演示数据保存在本机，不能邀请真实家人。模拟身份只存在演示和测试中，生产函数只使用微信提供的 `OPENID`。

## 接入云开发

```sh
npm run configure -- --appid wxYOUR_APP_ID --env YOUR_CLOUDBASE_ENV_ID
```

占位参数应替换成真实编号。命令生成被 Git 忽略的配置。按[部署说明](docs/DEPLOYMENT.md)建立数据库集合及规则，部署 `familyApi`，再进行两个微信账号的实机验证。

公共仓库不包含真实 AppID 配置、AppSecret、上传私钥、访问密钥、邀请码或家庭记录。云函数使用运行时身份访问数据库，无需将云密钥放进代码。

## 工程结构

```text
miniprogram/                 微信页面、演示模式、同步队列
cloudfunctions/familyApi/    家庭权限、任务与事务 API
cloud/database.rules.json   集合的客户端拒绝读写规则
tests/                      家庭隔离、冲突、离线重试和 SDK 契约测试
data/catalogs/              国家课标古诗文基础索引
docs/                       部署、边界与调研来源
```

`npm run verify` 检查 JS/JSON、页面入口、包体和核心测试；`npm audit --prefix cloudfunctions/familyApi --omit=dev` 检查部署依赖。GitHub Actions 执行同样检查。测试使用隔离内存事务和两个独立客户端缓存，不等于真实云环境或真机验收。

源码公开可读。第三方 SDK 许可归各权利人；教材、配音和注释需分别确认再分发授权。当前提供可追溯目录和自编学习提示。
