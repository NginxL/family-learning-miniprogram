# TypeScript 核心与构建约定

## 迁移范围

项目采用渐进迁移。知识库、学习记录规则和云函数接口使用严格类型检查；微信小程序与云函数继续运行编译后的 CommonJS JavaScript。

| 源码 | 负责内容 | 运行产物 |
|---|---|---|
| `src/shared/models.ts` | 知识条目、教材映射、年级、学习档案、任务及六类数据库文档 | 类型在编译时擦除 |
| `src/shared/api.ts` | 18 种操作各自的请求、返回值与成功／失败响应 | 类型在编译时擦除 |
| `src/shared/catalog.ts`、`learning.ts`、`child-profile.ts` | 目录合并、任务生成、历史与掌握、进度、生日计算 | `shared/`、`miniprogram/lib/learning/`、`cloudfunctions/familyApi/learning/` 中的同名 `.js` |
| `src/cloud/` | 云函数入口、权限与参数校验、业务服务、数据库适配 | `cloudfunctions/familyApi/{index,service,store}.js` |
| `src/client/cloud-transport.ts` | 小程序的云函数调用与响应信封检查 | `miniprogram/lib/cloud-transport.js` |

页面脚本、同步队列、演示适配器和数据采集脚本仍使用 JavaScript。新增 TS 调用方可直接复用共用模型与接口；尚未迁移的 JS 调用方依靠现有运行时校验和行为测试。

## 开发与生成

```sh
npm ci --ignore-scripts
npm ci --prefix cloudfunctions/familyApi --ignore-scripts
npm run typecheck
npm run build
npm run verify
```

TypeScript 固定为 `6.0.2`，Node 类型固定到 Node 20；均为开发依赖，不进入小程序或云函数生产依赖。`strict`、`noImplicitReturns`、`noFallthroughCasesInSwitch` 已启用。

编辑 `src/` 中的 TS 源文件，随后运行 `npm run build`，将源码与生成的 JS 一起提交。带有 `Generated from src/…` 标记的文件不得单独修改。`npm run check` 会重新编译并逐文件比对产物，遗漏构建或手改产物都会失败。

`scripts/typescript-build.js` 在临时目录编译并生成产物映射，退出时删除临时目录；`scripts/sync-shared.js` 写入原有运行目录。构建不包含上传、发布、云函数部署或数据库写入。

`tsconfig.json` 的 `rootDirs` 只用于把云端 `./learning/*` 导入解析到共用 TS 源码；实际部署包中仍由构建脚本放置相应 JS 文件。小程序知识数据继续生成 `.js` 模块，不依赖 Node 的 JSON 加载器。

## 数据与接口边界

知识源仍位于 `data/catalogs/`，由 `scripts/knowledge.js` 整理。JSON 不会因 TS 声明自动变得可信：构建时先由 `knowledge-validation.ts` 检查字段类型、唯一 ID、内容类型、年级范围及教材映射结构，再生成运行模块。结构检查不能代替教材版次、正文或中考范围的事实核验。

`ApiPayloads` 与 `ApiResults` 按操作名关联。类型检查会拒绝未知操作、错误字段类型、缺少版本号的打卡请求，以及读取不属于该操作的返回字段。客户端与云端共用这一约定。

云端入口仍将外部请求视为 `unknown`，交给 `executeRaw` 做运行时校验；调用身份只取自微信上下文，所有家庭读写继续核验成员权限。类型检查不会代替权限、数值范围、日期或版本冲突检查。

以下边界保留受限类型断言：数据库适配器读取本服务维护的 v1 文档；客户端核对响应信封后接收自有服务的操作结果；微信 SDK 声明缺失的 `DYNAMIC_CURRENT_ENV`、`throwOnNotFound` 配置。数据库文档与接口响应没有增加完整的运行时 Schema 解码，SDK 适配由安装包契约测试覆盖。

## 兼容与验证

| 项目 | 验证依据 |
|---|---|
| 知识内容、内容 ID 与排序 | 对照迁移前提交 `6da5ab3`，全部 1,871 项一致；目录和教材映射测试继续执行 |
| 接口及数据库格式 | 21 次代表性调用结果、7 份持久化文档与迁移前一致；操作名、字段名、六个集合及缓存 key 保持兼容 |
| 旧档案读取与更新 | `tests/fixtures/v1-family.json` 保存迁移前生成的虚构数据；`tests/api-contract.test.js` 验证身份、生日、掌握状态、旧记录撤销和已移除成员的拒绝访问 |
| 编译期约束 | `tests/types/contracts.ts` 同时包含合法调用和预期报错案例；错误案例不再报错时，类型检查也会失败 |
| 非法输入与数据源 | 云接口运行时验证测试、`tests/knowledge-build.test.js` 的非法年级和重复 ID 检查 |
| 原生入口与同步 | 既有原生 JS 加载、双客户端、离线恢复、重试去重和冲突测试 |

本阶段无需数据库迁移，不生成新家庭，也不改变旧内容的身份。测试不等于真机与真实云环境验收。

## 发布状态

截至 2026-10-13，TS 核心迁移仅用于仓库开发，尚未上传微信或部署到云环境。当前审核中的 `1.0.0` 和已部署云函数保持原版本。后续启用迁移产物前，仍需按[部署说明](DEPLOYMENT.md)完成真机验证，并按[发布说明](RELEASE.md)推进版本发布。
