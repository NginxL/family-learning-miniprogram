# TypeScript 工程与构建约定

## 迁移范围

项目采用渐进迁移。知识库、学习记录规则、云函数接口、页面及同步队列使用严格类型检查；微信小程序与云函数继续运行编译后的 CommonJS JavaScript。

| 源码 | 负责内容 | 运行产物 |
|---|---|---|
| `src/shared/models.ts` | 知识条目、教材映射、年级、学习档案、任务及八类数据库文档 | 类型在编译时擦除 |
| `src/shared/api.ts` | 各操作的请求、返回值与成功／失败响应 | 类型在编译时擦除 |
| `src/shared/catalog.ts`、`learning.ts`、`child-profile.ts` | 目录合并、任务生成、历史与掌握、进度、生日计算 | `shared/`、`miniprogram/lib/learning/`、`cloudfunctions/familyApi/learning/` 中的同名 `.js` |
| `src/cloud/` | 云函数入口、权限与参数校验、业务服务、数据库适配 | `cloudfunctions/familyApi/{index,service,store,validation,homework}.js` |
| `src/client/cloud-transport.ts` | 小程序的云函数调用与响应信封检查 | `miniprogram/lib/cloud-transport.js` |
| `src/miniprogram/app.ts`、`pages/` | 应用启动及页面的状态、事件、生命周期 | `miniprogram/app.js`、`miniprogram/pages/*/index.js` |
| `src/miniprogram/lib/` | 同步队列、页面共用逻辑、任务分组与错误信息；客户端模型及页面类型 | 同名运行模块输出到 `miniprogram/lib/`；类型在编译时擦除 |

演示适配器 `miniprogram/lib/demo.js`、构建与数据采集脚本仍使用 JavaScript。页面、同步队列和真实云调用共用请求与响应约定；演示适配器通过声明文件接入，并由页面与原生模块加载测试验证。WXML、WXSS、页面路径和运行配置格式保持不变。

## 开发与生成

```sh
npm ci --ignore-scripts
npm ci --prefix cloudfunctions/familyApi --ignore-scripts
npm run typecheck
npm run build
npm run verify
```

TypeScript 固定为 `6.0.2`，Node 类型固定到 Node 20，微信官方 API 类型包 `miniprogram-api-typings` 固定为 `5.2.3`；均为开发依赖，不进入小程序或云函数生产依赖。`strict`、`noImplicitReturns`、`noFallthroughCasesInSwitch` 已启用。

编辑 `src/` 中的 TS 源文件，随后运行 `npm run build`，将源码与生成的 JS 一起提交。带有 `Generated from src/…` 标记的文件不得单独修改。`npm run check` 会重新编译并逐文件比对产物，遗漏构建或手改产物都会失败。

`scripts/typescript-build.js` 在临时目录编译并生成产物映射，退出时删除临时目录；`scripts/sync-shared.js` 写入原有运行目录。构建不包含上传、发布、云函数部署或数据库写入。

`tsconfig.json` 的 `rootDirs` 只用于把云端和小程序的 `learning/*` 导入解析到共用 TS 源码；实际部署包中仍由构建脚本放置相应 JS 文件。构建读取 `miniprogram/app.json` 的页面清单，每个页面都须有对应 TS 源码。小程序知识数据继续生成 `.js` 模块，不依赖 Node 的 JSON 加载器。 `scripts/data-module.js`在构建时合并重复的长字符串，运行时仍导出普通对象与数组；`tests/data-module.test.js`核对客户端与云端JSON深度相等，包体检查保留2 MiB上限。

## 数据与接口边界

知识源仍位于 `data/catalogs/`，由 `scripts/knowledge.js` 整理。JSON 不会因 TS 声明自动变得可信：构建时先由 `knowledge-validation.ts` 检查字段类型、唯一 ID、内容类型、年级范围及教材映射结构，再生成运行模块。结构检查不能代替教材版次、正文或中考范围的事实核验。

`ApiPayloads` 与 `ApiResults` 按操作名关联。类型检查会拒绝未知操作、错误字段类型、缺少版本号的打卡请求，以及读取不属于该操作的返回字段。客户端与云端共用这一约定。

云端入口仍将外部请求视为 `unknown`，交给 `executeRaw` 做运行时校验；调用身份只取自微信上下文，所有家庭读写继续核验成员权限。类型检查不会代替权限、数值范围、日期或版本冲突检查。

以下边界保留受限类型断言：数据库适配器读取本服务维护的 v1 文档；客户端核对响应信封后接收自有服务的操作结果；微信 SDK 声明缺失的 `DYNAMIC_CURRENT_ENV`、`throwOnNotFound` 配置。数据库文档与接口响应没有增加完整的运行时 Schema 解码，SDK 适配由安装包契约测试覆盖。

页面的 `PageDefinition` 约束 `this.data`、事件值和顶层 `setData` 字段，避免把拼错字段或表单字符串直接作为已转换的数据提交。年级选择器的数字来自固定的 0–9 选项；自动计划允许输入框暂时为空，提交前仍检查整数及数量范围。WXML 表达式不由 TypeScript 检查，事件绑定由页面测试核验。

同步队列沿用 `family-learning-v1:<mode>:<envId>` 缓存，演示后端沿用 `demo-backend-v1`。队列条目的 `familyId`、`date`、`taskId`、`done`、`baseVersion`、`mutationId` 原样恢复；30 天任务缓存、8 组历史查询、5 组进度查询和 500 条待同步上限不变。旧缓存中缺省的历史、进度、提示字段仍按原逻辑处理。家庭或账号切换清理旧缓存，收到服务端权限拒绝后清理对应缓存，冲突仍以云端结果为准。

本机缓存由应用自行维护，在 `app.ts` 的存储入口作类型断言，不新增重置缓存或转换数据的步骤。`ClientResults` 仅兼容旧演示响应缺少 `canJoinFamily`、`duplicate` 的情况，不放宽云端接口。`command` 仍自动填入当前家庭 ID，并保留未加载家庭时由服务端拒绝请求的行为。微信抛出的普通错误对象按 `unknown` 处理；缺少有效错误信息时显示既有通用提示。

## 兼容与验证

| 项目 | 验证依据 |
|---|---|
| 知识内容、内容 ID 与排序 | 对照迁移前提交 `6da5ab3`，全部 1,871 项一致；目录和教材映射测试继续执行 |
| 接口及数据库格式 | 21 次代表性调用结果、7 份持久化文档与迁移前一致；操作名、字段名、原六个集合及缓存 key 保持兼容；作业另增两个集合 |
| 旧档案读取与更新 | `tests/fixtures/v1-family.json` 保存迁移前生成的虚构数据；`tests/api-contract.test.js` 验证身份、生日、掌握状态、旧记录撤销和已移除成员的拒绝访问 |
| 页面与演示数据 | 对照页面迁移前提交 `11b6080`，七个页面的 15 份数据快照及两份本地存储内容一致；模板、样式和路由未改动 |
| 旧队列恢复 | `tests/fixtures/v1-sync-cache.json` 由迁移前 JS 生成，仅含虚构数据；`tests/client-migration.test.js` 验证旧队列重启、撤销／完成顺序、响应丢失重试及旧缓存缺省字段 |
| 页面异步生命周期 | `tests/page-lifecycle.test.js` 验证切换孩子、隐藏页面后拒绝过期结果，移除同步订阅和刷新／搜索定时器 |
| 编译期约束 | `tests/types/contracts.ts`、`tests/types/pages-sync.ts` 同时包含合法调用和预期报错案例，覆盖接口、队列、页面字段及表单类型；错误案例不再报错时，类型检查也会失败 |
| 非法输入与数据源 | 云接口运行时验证测试、`tests/knowledge-build.test.js` 的非法年级和重复 ID 检查 |
| 原生入口与同步 | 既有原生 JS 加载、双客户端、离线恢复、重试去重和冲突测试 |

本阶段无需数据库或缓存迁移，不生成新家庭，也不改变旧内容的身份。严格类型检查及行为测试通过；具体数量以当前 `npm run verify` 为准。测试不等于真机与真实云环境验收。

## 发布状态

客户端 TS 编译产物已于 2026-10-13 上传为 `1.0.1`；账号持有人已确认手机预览可用及代码审核通过。截至 2026-10-16，首次备案仍在办理，尚未正式发布。云函数新增角色与作业接口，继续兼容原家长服务调用。任务详情页、角色与作业属于后续开发预览，未覆盖 `1.0.1` 审核包；发布状态见[正式发布](RELEASE.md)。
