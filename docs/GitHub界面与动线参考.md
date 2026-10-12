# GitHub 界面与学习动线参考

核对日期：2026-10-12。用途：家庭私人学习工具的页面组织、每日计划、回顾入口。项目代码没有复制进本工程，教材内容也不以开源项目自称的年级分类作为权威依据。

| 项目 | 可参考的交互 | 本工程对应方式 | 局限 |
|---|---|---|---|
| [UnlearnableWord](https://github.com/Mint-green/UnlearnableWord) | 每日新学／复习数量、词卡、历史与掌握记录 | 今日任务、分类数量、回顾页采用同一内容身份 | MIT；旧小程序，演示服务已停，不能以其后台作为可用服务 |
| [eterplan](https://github.com/omigeft/eterplan) | 计划与复习安排相邻，用户能看见后续安排 | 全新／复习紧邻数量设置，回顾可一键加入今日 | MIT；作者说明云数据遗失；当前工程未采用其遗忘曲线算法 |
| [weapp-poem](https://github.com/nslogx/weapp-poem) | 诗名／作者检索、从列表进入正文 | 知识库搜索、展开正文和来源、加入今日 | MIT；WePY 1.x／LeanCloud 技术栈较旧，不直接复用工程 |
| [lingosnake](https://github.com/eoeac/lingosnake) | 儿童词汇学习、每日数量、学习记录和复习 | 入门词卡、分量设置、少量每日积累 | MIT；侧重本地记录，与家庭共享权限模型不同 |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | 可作为将来间隔复习的算法库 | 当前保留新学／复习状态，复习按最近学习日期排序 | MIT；是算法库而非完整 UI；尚未引入，不能宣传已使用 FSRS |
| [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry) | 作者／诗题／正文的内容索引结构 | 稳定作品 ID、同名篇目消歧、保留来源 | MIT 语料库不等于上海教材或考试清单 |

## 页面动线

```mermaid
flowchart LR
  A[家庭：孩子档案] --> B[计划：全新或复习及每天数量]
  B --> C[今日：查看与完成]
  D[知识库：内容及来源] --> C
  C --> E[回顾：学过与确认掌握]
  E -->|安排再次复习| C
  E --> F[知识进度：按年级和科目]
  F --> D
```

英语、古诗文、阅读、数学共用选择孩子、安排任务、完成、回顾和知识进度的路径；数学当前只有自编加法示例，尚无上海教材全量知识清单。知识库浏览可离线，家庭写操作依赖同一云端权限模型。

## 教材分类反例

[另一个教育项目的沪教牛津一年级索引](https://github.com/Hanlin-cheng6/xhs-note-education/blob/main/data/textbooks/英语-一年级-上册-沪教牛津2024.json)虽然文件名含“沪教牛津2024”，其 `edition` 标注“六三制一起”、ISBN 未核实，来源也是第三方教辅站。因此只能作为检索线索，不能据此标为上海五四制一年级的已核实教材内容。

开源项目可参考交互方式；地区、学制、版次、册次及正文必须另行核对官方教材证据。
