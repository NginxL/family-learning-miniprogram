// Single-device UI demonstration. No network, no real family invitation or multi-device sync.
const { chinaDate } = require('./sync-engine');
function createDemo(wx) {
  const read = () => wx.getStorageSync('demo-backend-v1') || { family: null, days: {} };
  const write = (data) => wx.setStorageSync('demo-backend-v1', data);
  const id = () => `demo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return async (action, input = {}) => {
    const state = read();
    const today = chinaDate();
    if (action === 'bootstrap') return { userId: 'demo-parent', today, family: state.family };
    if (action === 'createFamily') {
      if (!input.name || !input.memberName || !input.childName) throw new Error('请填写家庭名称、你的称呼和孩子昵称');
      const childId = 'demo-child';
      state.family = { id: 'demo-family', name: input.name, ownerId: 'demo-parent', myRole: 'owner',
        members: [{ id: 'demo-parent', name: input.memberName, role: 'owner' }], children: [{ id: childId, name: input.childName }],
        plans: [{ id: 'demo-poem', childId, title: '读一读《咏鹅》', subject: 'poetry', minutes: 5, enabled: true,
          detail: '骆宾王\n鹅，鹅，鹅，曲项向天歌。\n白毛浮绿水，红掌拨清波。\n\n一起读诗，说说你看到了什么。', source: '古诗文示例；未映射校内教材' },
        { id: 'demo-english', childId, title: '用英语打个招呼', subject: 'english', minutes: 5, enabled: true,
          detail: 'Hello! 你好！\nGood morning! 早上好！\nMy name is ... 我的名字是……\n\n和家人轮流练习两次。', source: '自编入门示例；非教材单元' }] };
      write(state); return { family: state.family };
    }
    if (['joinFamily', 'createInvite', 'removeMember', 'leaveFamily'].includes(action)) throw new Error('演示模式仅在本机运行；连接云开发后可邀请和同步');
    if (!state.family) throw new Error('请先创建演示家庭');
    if (action === 'getDay') {
      const date = input.date || today;
      const day = state.days[date] || { date, familyId: state.family.id, tasks: [] };
      if (date === today) state.family.plans.filter((plan) => plan.enabled && !day.tasks.some((task) => task.id === plan.id))
        .forEach((plan) => day.tasks.push({ ...plan, done: false, version: 0 }));
      state.days[date] = day; write(state); return { day, today };
    }
    if (action === 'setTaskDone') {
      const task = state.days[input.date].tasks.find((item) => item.id === input.taskId);
      task.done = input.done; task.version += 1; task.updatedBy = 'demo-parent'; task.updatedAt = Date.now();
      write(state); return { task };
    }
    if (action === 'addChild') {
      if (!input.name || state.family.children.length >= 5) throw new Error('请输入昵称，最多5个档案');
      state.family.children.push({ id: id(), name: input.name });
    } else if (action === 'addPlan') {
      if (!input.title || !Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 120) throw new Error('请填写任务名称和1–120分钟的时长');
      state.family.plans.push({ id: id(), childId: input.childId, subject: input.subject, title: input.title, detail: input.detail || '', minutes: input.minutes, enabled: true, source: '家长自建' });
    } else if (action === 'setPlanEnabled') {
      state.family.plans.find((plan) => plan.id === input.planId).enabled = input.enabled;
    } else { throw new Error('不支持的演示操作'); }
    write(state); return { family: state.family };
  };
}
module.exports = { createDemo };
