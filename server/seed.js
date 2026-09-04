import { Db } from './db.js';
import { hashPassword } from './auth.js';

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();

const USERS = [
  { username: 'teacher', password: 'teacher123', name: '李工', role: 'teacher' },
  { username: 'S2301', password: 'student123', name: '王小明', role: 'student', studentNo: 'S2301', className: '电子2301班' },
  { username: 'S2302', password: 'student123', name: '陈思远', role: 'student', studentNo: 'S2302', className: '电子2301班' },
  { username: 'S2303', password: 'student123', name: '赵一诺', role: 'student', studentNo: 'S2303', className: '电子2301班' },
  { username: 'S2304', password: 'student123', name: '孙可欣', role: 'student', studentNo: 'S2304', className: '电子2302班' },
];

const ASSIGNMENTS = [
  {
    title: '常用元器件识别与参数测量',
    category: '元器件识别',
    description:
      '任务：识别实验箱内 20 个常用元器件（电阻、电容、二极管、三极管、稳压器等），用万用表测量关键参数。\n\n提交内容：\n1. 元器件清单表（型号 / 标称值 / 实测值 / 误差）；\n2. 色环电阻读数方法说明；\n3. 至少 3 张实物照片链接。',
    maxScore: 100,
    dueAt: iso(-6),
    published: true,
    allowLate: true,
  },
  {
    title: '5V/2A 线性稳压电源电路设计',
    category: '电路设计',
    description:
      '任务：基于 LM7805 设计一款 5V/2A 直流稳压电源，输入 220V 市电。\n\n提交内容：\n1. 完整原理图（可用立创EDA / Multisim）；\n2. 变压器、整流桥、滤波电容的选型计算过程；\n3. 纹波与散热分析；\n4. 仿真波形截图。',
    maxScore: 100,
    dueAt: iso(-1),
    published: true,
    allowLate: true,
  },
  {
    title: '双层 PCB 布局布线实践',
    category: 'PCB制版',
    description:
      '任务：将上次的稳压电源原理图转为双层 PCB，板框不超过 60mm × 40mm。\n\n要求：\n1. 电源线宽按 2A 电流核算并说明依据；\n2. 大电流回路尽量短，地平面完整；\n3. 提交 Gerber 文件链接与 3D 预览图。',
    maxScore: 100,
    dueAt: iso(4),
    published: true,
    allowLate: false,
  },
  {
    title: 'STM32 温湿度采集与串口上报',
    category: '嵌入式开发',
    description:
      '任务：用 STM32F103 + DHT11 采集温湿度，每 2 秒通过 USART1 上报一次（115200-8-N-1）。\n\n提交内容：\n1. 工程源码仓库链接；\n2. 单总线时序说明；\n3. 串口助手接收截图；\n4. 采集失败时的重试策略说明。',
    maxScore: 120,
    dueAt: iso(9),
    published: true,
    allowLate: false,
  },
  {
    title: '蓝牙音箱产品拆解分析报告',
    category: '拆解分析',
    description:
      '任务：任选一款市售蓝牙音箱进行拆解，分析其电路架构与成本构成。\n\n提交内容：\n1. 拆解步骤照片；\n2. 主控 / 功放 / 电源管理芯片型号及作用；\n3. 系统框图；\n4. BOM 成本估算与改进建议。',
    maxScore: 100,
    dueAt: iso(16),
    published: false,
    allowLate: false,
  },
];

const SUBMISSIONS = [
  {
    assignment: 0,
    student: 'S2301',
    content:
      '已完成 20 个元器件的识别与测量。电阻误差均在 ±5% 以内；102 瓷片电容实测 0.97nF，偏差 3%。色环读数按“棕1红2橙3”口诀，第四环金色表示 ±5%。照片见 https://example.com/s2301/components',
    daysAgo: 7,
    score: 92,
    feedback: '测量数据完整，误差分析到位。建议补充三极管 hFE 的实测值。',
  },
  {
    assignment: 0,
    student: 'S2302',
    content:
      '完成清单表，万用表测量二极管压降 0.68V（1N4148）。稳压管测量部分因量程选择错误重测了一次。照片链接：https://example.com/s2302/lab1',
    daysAgo: 6,
    score: 85,
    feedback: '结论正确，但缺少误差来源分析，下次注意量程选择的说明。',
  },
  {
    assignment: 0,
    student: 'S2303',
    content: '因病请假，补交元器件清单表与照片：https://example.com/s2303/lab1',
    daysAgo: 4,
    score: null,
    feedback: '',
  },
  {
    assignment: 1,
    student: 'S2301',
    content:
      '原理图见 https://example.com/s2301/psu。变压器选 220V/9V 30VA，整流桥 KBP307，滤波电容按 C=I·t/ΔU 取 4700uF/25V，实测纹波 42mV。LM7805 压差 4V×2A=8W，加装 30×30 散热片，温升约 45K。',
    daysAgo: 1,
    score: null,
    feedback: '',
  },
  {
    assignment: 1,
    student: 'S2304',
    content:
      '完成设计与仿真。为降低 7805 功耗，输入端增加了一级 LC 滤波并把变压器次级改为 8V。仿真波形：https://example.com/s2304/sim',
    daysAgo: 2,
    score: null,
    feedback: '',
  },
];

export function seed(db = new Db(), { force = false } = {}) {
  if (force) db.reset();
  if (db.all('users').length > 0) return db;

  const users = new Map();
  for (const user of USERS) {
    const row = db.insert('users', { ...user, password: hashPassword(user.password) });
    users.set(row.username, row);
  }

  const teacher = users.get('teacher');
  const assignments = ASSIGNMENTS.map((a) =>
    db.insert('assignments', { ...a, createdBy: teacher.id, createdAt: iso(-20) }),
  );

  for (const item of SUBMISSIONS) {
    const assignment = assignments[item.assignment];
    const submittedAt = iso(-item.daysAgo);
    db.insert('submissions', {
      assignmentId: assignment.id,
      studentId: users.get(item.student).id,
      content: item.content,
      attachment: '',
      submittedAt,
      late: Date.parse(submittedAt) > Date.parse(assignment.dueAt),
      score: item.score,
      feedback: item.feedback,
      gradedAt: item.score === null ? null : iso(-item.daysAgo + 1),
      gradedBy: item.score === null ? null : teacher.id,
    });
  }
  return db;
}

const isMain = process.argv[1]?.endsWith('seed.js');
if (isMain) {
  const db = seed(new Db(), { force: process.argv.includes('--force') });
  console.log(
    `已写入演示数据：${db.all('users').length} 个用户、${db.all('assignments').length} 份作业、${db.all('submissions').length} 条提交`,
  );
}
