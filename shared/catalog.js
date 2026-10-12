'use strict';
// Stable IDs are shared by the cloud and the demo. Never reuse an ID for different content.
// Public-domain originals; prompts and all English/reading/maths examples are independently written.
const poems = [
  ['goose', '咏鹅', '骆宾王', '鹅，鹅，鹅，曲项向天歌。\n白毛浮绿水，红掌拨清波。'],
  ['quiet-night', '静夜思', '李白', '床前明月光，疑是地上霜。\n举头望明月，低头思故乡。'],
  ['spring-morning', '春晓', '孟浩然', '春眠不觉晓，处处闻啼鸟。\n夜来风雨声，花落知多少。'],
  ['stork-tower', '登鹳雀楼', '王之涣', '白日依山尽，黄河入海流。\n欲穷千里目，更上一层楼。'],
  ['farmer-two', '悯农（其二）', '李绅', '锄禾日当午，汗滴禾下土。\n谁知盘中餐，粒粒皆辛苦。'],
  ['river-snow', '江雪', '柳宗元', '千山鸟飞绝，万径人踪灭。\n孤舟蓑笠翁，独钓寒江雪。'],
  ['hermit', '寻隐者不遇', '贾岛', '松下问童子，言师采药去。\n只在此山中，云深不知处。'],
  ['wind', '风', '李峤', '解落三秋叶，能开二月花。\n过江千尺浪，入竹万竿斜。'],
  ['pond', '池上', '白居易', '小娃撑小艇，偷采白莲回。\n不解藏踪迹，浮萍一道开。'],
  ['small-pond', '小池', '杨万里', '泉眼无声惜细流，树阴照水爱晴柔。\n小荷才露尖尖角，早有蜻蜓立上头。'],
  ['willow', '咏柳', '贺知章', '碧玉妆成一树高，万条垂下绿丝绦。\n不知细叶谁裁出，二月春风似剪刀。'],
  ['baidi', '早发白帝城', '李白', '朝辞白帝彩云间，千里江陵一日还。\n两岸猿声啼不住，轻舟已过万重山。']
].map(([id, title, author, body]) => ({
  id: `poem-${id}`, kind: 'poetry', title: `《${title}》`, detail: `${author}\n${body}\n\n读两遍，再和家人说说诗里的画面。`,
  source: '古诗原文；学习提示自编，未映射校内教材', minutes: 5
}));
const words = [
  ['hello','你好'],['goodbye','再见'],['I','我'],['you','你；你们'],['we','我们'],['my','我的'],
  ['cat','猫'],['dog','狗'],['bird','鸟'],['fish','鱼'],['rabbit','兔子'],['duck','鸭子'],
  ['red','红色'],['blue','蓝色'],['green','绿色'],['yellow','黄色'],['black','黑色'],['white','白色'],
  ['one','一'],['two','二'],['three','三'],['four','四'],['five','五'],['six','六'],['seven','七'],['eight','八'],['nine','九'],['ten','十'],
  ['book','书'],['pen','钢笔'],['pencil','铅笔'],['bag','包'],['desk','书桌'],['chair','椅子'],
  ['apple','苹果'],['banana','香蕉'],['milk','牛奶'],['water','水'],['rice','米饭'],['egg','鸡蛋'],
  ['mother','母亲'],['father','父亲'],['sister','姐妹'],['brother','兄弟'],['friend','朋友'],['family','家庭'],
  ['sun','太阳'],['moon','月亮'],['star','星星'],['tree','树'],['flower','花'],['rain','雨'],
  ['read','阅读'],['write','写'],['listen','听'],['look','看'],['run','跑'],['jump','跳'],['happy','快乐的'],['small','小的']
].map(([word, meaning]) => ({ id: `word-${word.toLowerCase()}`, kind: 'word', title: word,
  detail: `${word} · ${meaning}\n\n和家人读一读，再遮住中文，说出意思。`, source: '自编入门词卡；非教材词表', minutes: 1 }));
const sentences = [
  ['hello','Hello!','你好！'],['morning','Good morning!','早上好！'],['name','My name is ...','我的名字是……'],
  ['how','How are you?','你好吗？'],['fine','I am fine, thank you.','我很好，谢谢你。'],['nice','Nice to meet you.','很高兴认识你。'],
  ['book','This is my book.','这是我的书。'],['apple','I like apples.','我喜欢苹果。'],['cat','I can see a cat.','我看见一只猫。'],
  ['help','Can you help me, please?','你能帮帮我吗？'],['ready','Are you ready?','你准备好了吗？'],['bye','See you tomorrow!','明天见！']
].map(([id, title, meaning]) => ({ id: `sentence-${id}`, kind: 'sentence', title,
  detail: `${title}\n${meaning}\n\n和家人一人一句，轮流说两遍。`, source: '自编口语练习；非教材单元', minutes: 3 }));
const readings = [
  ['seed','一颗小种子','小树把一颗种子放进土里。他每天给它一点水。有一天，一片嫩绿的叶子钻了出来。小树开心地说：“你好，小芽！”','小树怎样照顾种子？'],
  ['umbrella','两个人的小伞','放学时下雨了。小禾带着一把伞，小圆没有带。小禾把伞往小圆那边挪了挪。两个人慢慢走，一起回到了家。','小禾做了什么？你会怎样帮助朋友？'],
  ['book','书签去哪里了','小米找不到书签了。她先看桌面，再翻书包，最后在书里找到了它。原来昨天读完书，她已经把书签夹好了。','小米按什么顺序找书签？'],
  ['park','公园里的声音','清晨，小安走进公园。树上有鸟在叫，草丛里有虫在鸣。风吹过树叶，发出沙沙声。小安闭上眼睛，认真听了一会儿。','文中写到了哪些声音？'],
  ['share','分一分橘子','桌上有两个橘子。小贝和弟弟一人拿了一个。他们把橘子剥开，又各留出两瓣给奶奶。奶奶笑了，两个人也笑了。','小贝和弟弟怎样分享橘子？'],
  ['moon','窗边看月亮','晚上，小舟在窗边看月亮。月亮弯弯的，像一只小船。他拿起笔，把月亮画在纸上，还画了三颗星星。','你觉得月亮还像什么？']
].map(([id, title, body, question]) => ({ id: `reading-${id}`, kind: 'reading', title,
  detail: `${body}\n\n想一想：${question}`, source: '自编亲子短文；每篇算一次阅读，可添加自家书目的阅读任务', minutes: 8 }));
const maths = Array.from({ length: 20 }, (_, i) => {
  const a = i % 5 + 1; const b = Math.floor(i / 5) + 1;
  return { id: `math-add-${a}-${b}`, kind: 'math', title: `${a} + ${b} = ?`,
    detail: `拿出 ${a} 个积木，再拿出 ${b} 个。一共有几个？\n先摆一摆，再说出算式。\n\n家长参考：${a} + ${b} = ${a + b}`, source: '自编 10 以内加法练习', minutes: 2 };
});
const knowledge = require('./knowledge-data');
const byId = new Map(knowledge.map((item) => [item.id, item]));
const starters = [...poems, ...words, ...sentences, ...readings, ...maths].map((item) => {
  const full = byId.get(item.id);
  if (!full) return { ...item, collections: ['starter'] };
  byId.delete(item.id);
  return { ...item, ...full,
    ...(item.kind === 'word' ? { detail: item.detail, source: full.source.replace(/；.*$/, '；自编入门释义') } : {}),
    aliases: [...(full.aliases || []), item.title], collections: ['starter', ...full.collections] };
});
module.exports = [...starters, ...byId.values()];
