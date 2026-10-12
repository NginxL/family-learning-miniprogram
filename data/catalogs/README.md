# 内容数据、来源与使用范围

数据版本：2026-10-12。入库范围和核验缺口见[知识库与年级核验](../../docs/知识库与年级核验.md)。

| 文件 | 用途 | 来源与许可 |
|---|---|---|
| `chinese-moe-2022-index.json` | 135 条国家课标索引，保留年段和选段标识 | 教育部课标的事实性目录，包含官方页码 |
| `chinese-moe-2022-texts.json` | 对应 135 篇／组原作 | 仅古代公版原作；逐项保留转录出处；未复制现代注释、译文或录音 |
| `shanghai-54-evidence.json` | 三册官方五四制目录、两册公开样本、21 项补充原作或节选 | 国家平台目录／公开样本的事实及公版原作；学校选用版次、全文异文待确认 |
| `shanghai-zhongkao-framework.json` | 上海中考参考年份、能力方向、官方依据、内容缺项 | 事实性摘要；历史材料与现行政策分开，不作为完整中考清单 |
| `english-moe-2022.json` | 1,600 组国家课标词头、505 个星标、通用词典参考 | 词头来自课标；部分释义来自 ECDICT，采用 MIT，见下方声明 |
| `english-foundation-meanings.json` | 505 个基础词的常用义提示 | 自编简短释义，供家庭学习参考；不是教材单元词义 |
| `english-moe-2022-tables.json` | 数词／月份／星期另列表 77 项 | 词表来自课标；中文提示自编 |

英文原始参考保留转录页码、列号、PDF SHA-256、ECDICT 版本及 CSV SHA-256。运行时优先使用基础词自编释义；60 个亲子入门词沿用自编词卡。源 JSON 保留原始词典参考，不能把里面的专业义或少用义直接当作教材释义。

原作转录参考 [aopao/chinese-gushiwen](https://github.com/aopao/chinese-gushiwen/tree/c2345d0abf2404b8b3601e4afc2e8fd12f90d6c8)，固定版本 `c2345d0abf2404b8b3601e4afc2e8fd12f90d6c8`。该仓库未声明整体开源许可；本库使用的对象为已进入公版的古代原作，不继承或声称拥有该仓库现代编辑内容的许可。

ECDICT 来源：[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)，固定版本 `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`。Copyright (c) 2025 Linwei，MIT License；完整许可保留在 [licenses/ECDICT-MIT.txt](../../licenses/ECDICT-MIT.txt)。这里只提取课标所需的参考释义，不分发整个词典 CSV。

现代课本整册、课文中的现代作品、扫描 PDF、录音及注释没有进入本仓库。源码公开不改变这些材料的权利归属。小程序保留官方阅读入口和事实性书目信息。

## 生成与校验

`npm run build` 从上述源数据生成 `shared/knowledge-data.json`、`shared/resources.json`，并同步到小程序和云函数。生成文件不手工修改；修改源数据后必须重建并运行 `npm run verify`。

年级记录由具名教材的 `gradeVerification` 控制。只有 `catalogue_verified` 且有阅读器定位值或样本页码的条目进入年级进度；候选、截断标题、未展开组及学校采用版本不会因生成脚本运行而自动升级为已核实。`bookIds` 可保留候选关联，不能单凭它计算年级掌握程度。

内容 ID 区分同名诗、不同作者、不同首句与英语大小写；不能为合并方便而把 `May` 和 `may`、`Miss` 和 `miss` 合并。新增或修正教材映射要同时附证据及适用版本。

公开样本一上、三上封面标注审定 2024；样本版权页没有具体 ISBN 和印次，不能据网站的“2024版”称其为学校当前用书。五四制目录与样本总计 29 个年级映射，分别标明 `official_outline`／`public_sample`。
