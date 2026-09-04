import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../server/db.js';
import { createApp } from '../server/index.js';
import { seed } from '../server/seed.js';
import { hashPassword, verifyPassword } from '../server/auth.js';

const DAY = 86400000;

async function withServer(run) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-')), 'db.json');
  const db = seed(new Db(file), { force: true });
  const server = createApp(db);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (path, { method = 'GET', body, token } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const login = async (username, password) => {
    const res = await call('/api/login', { method: 'POST', body: { username, password } });
    assert.equal(res.status, 200, `登录失败: ${JSON.stringify(res.body)}`);
    return res.body.token;
  };

  try {
    await run({ call, login, db, base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

test('密码散列可验证且不可逆向匹配', () => {
  const stored = hashPassword('teacher123');
  assert.ok(stored.includes(':'));
  assert.equal(verifyPassword('teacher123', stored), true);
  assert.equal(verifyPassword('teacher124', stored), false);
});

test('错误的密码无法登录', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/api/login', { method: 'POST', body: { username: 'teacher', password: 'wrong' } });
    assert.equal(res.status, 401);
  });
});

test('未登录访问受保护接口返回 401', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('/api/assignments')).status, 401);
    assert.equal((await call('/api/stats')).status, 401);
  });
});

test('登录后返回的用户信息不含密码', async () => {
  await withServer(async ({ call, login }) => {
    const token = await login('teacher', 'teacher123');
    const me = await call('/api/me', { token });
    assert.equal(me.body.user.username, 'teacher');
    assert.equal(me.body.user.password, undefined);
    assert.ok(me.body.categories.includes('电路设计'));
  });
});

test('学生看不到草稿作业，教师可以', async () => {
  await withServer(async ({ call, login }) => {
    const teacher = await login('teacher', 'teacher123');
    const student = await login('S2301', 'student123');

    const asTeacher = (await call('/api/assignments', { token: teacher })).body.assignments;
    const asStudent = (await call('/api/assignments', { token: student })).body.assignments;

    assert.ok(asTeacher.some((a) => !a.published));
    assert.equal(asStudent.every((a) => a.published), true);
    assert.ok(asStudent.length < asTeacher.length);
  });
});

test('学生不能创建作业', async () => {
  await withServer(async ({ call, login }) => {
    const token = await login('S2301', 'student123');
    const res = await call('/api/assignments', {
      method: 'POST',
      token,
      body: { title: 'x', description: 'y', category: '电路设计', maxScore: 100, dueAt: new Date().toISOString() },
    });
    assert.equal(res.status, 403);
  });
});

test('教师创建作业时会校验字段', async () => {
  await withServer(async ({ call, login }) => {
    const token = await login('teacher', 'teacher123');
    const base = {
      title: '示波器使用实验',
      description: '测量方波上升沿',
      category: '产品测试',
      maxScore: 100,
      dueAt: new Date(Date.now() + DAY).toISOString(),
    };
    assert.equal((await call('/api/assignments', { method: 'POST', token, body: { ...base, title: '' } })).status, 400);
    assert.equal((await call('/api/assignments', { method: 'POST', token, body: { ...base, category: '语文' } })).status, 400);
    assert.equal((await call('/api/assignments', { method: 'POST', token, body: { ...base, maxScore: 0 } })).status, 400);
    assert.equal((await call('/api/assignments', { method: 'POST', token, body: { ...base, dueAt: '不是时间' } })).status, 400);

    const ok = await call('/api/assignments', { method: 'POST', token, body: { ...base, published: true } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.assignment.title, '示波器使用实验');
    assert.equal(ok.body.assignment.submissionCount, 0);
  });
});

test('完整流程：布置 → 提交 → 批改 → 学生查看成绩', async () => {
  await withServer(async ({ call, login }) => {
    const teacher = await login('teacher', 'teacher123');
    const student = await login('S2301', 'student123');

    const created = await call('/api/assignments', {
      method: 'POST',
      token: teacher,
      body: {
        title: '运放同相放大电路',
        description: '设计增益为 11 的同相放大器',
        category: '电路设计',
        maxScore: 50,
        dueAt: new Date(Date.now() + DAY).toISOString(),
        published: true,
      },
    });
    const id = created.body.assignment.id;

    const submitted = await call(`/api/assignments/${id}/submissions`, {
      method: 'POST',
      token: student,
      body: { content: '取 R1=1k, Rf=10k，增益 1+Rf/R1=11，实测 10.8。', attachment: 'https://example.com/lab' },
    });
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.submission.late, false);
    assert.equal(submitted.body.submission.score, null);

    // 重复提交视为更新，而不是新增记录
    const again = await call(`/api/assignments/${id}/submissions`, {
      method: 'POST',
      token: student,
      body: { content: '修正：实测增益 10.9。' },
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.submission.id, submitted.body.submission.id);

    const rows = await call(`/api/assignments/${id}/submissions`, { token: teacher });
    assert.equal(rows.status, 200);
    assert.equal(rows.body.rows.length, 4);
    const mine = rows.body.rows.find((r) => r.student.username === 'S2301');
    assert.equal(mine.status, 'submitted');
    assert.equal(mine.submission.content, '修正：实测增益 10.9。');

    const graded = await call(`/api/submissions/${mine.submission.id}/grade`, {
      method: 'POST',
      token: teacher,
      body: { score: 46, feedback: '增益计算正确，建议补充误差来源。' },
    });
    assert.equal(graded.status, 200);
    assert.equal(graded.body.submission.score, 46);

    const view = (await call('/api/assignments', { token: student })).body.assignments.find((a) => a.id === id);
    assert.equal(view.status, 'graded');
    assert.equal(view.submission.feedback, '增益计算正确，建议补充误差来源。');

    // 已批改后不可再提交
    const blocked = await call(`/api/assignments/${id}/submissions`, {
      method: 'POST',
      token: student,
      body: { content: '再改一次' },
    });
    assert.equal(blocked.status, 403);
  });
});

test('评分必须落在 0 到满分之间', async () => {
  await withServer(async ({ call, login, db }) => {
    const teacher = await login('teacher', 'teacher123');
    const submission = db.all('submissions')[0];
    const assignment = db.find('assignments', (a) => a.id === submission.assignmentId);

    for (const score of [-1, assignment.maxScore + 1, '优秀']) {
      const res = await call(`/api/submissions/${submission.id}/grade`, { method: 'POST', token: teacher, body: { score } });
      assert.equal(res.status, 400, `score=${score} 应被拒绝`);
    }
    const ok = await call(`/api/submissions/${submission.id}/grade`, {
      method: 'POST',
      token: teacher,
      body: { score: assignment.maxScore },
    });
    assert.equal(ok.status, 200);
  });
});

test('学生不能批改作业', async () => {
  await withServer(async ({ call, login, db }) => {
    const token = await login('S2301', 'student123');
    const submission = db.all('submissions')[0];
    const res = await call(`/api/submissions/${submission.id}/grade`, { method: 'POST', token, body: { score: 100 } });
    assert.equal(res.status, 403);
  });
});

test('截止后是否可提交由 allowLate 决定', async () => {
  await withServer(async ({ call, login, db }) => {
    const teacher = await login('teacher', 'teacher123');
    const student = await login('S2302', 'student123');

    const strict = db.insert('assignments', {
      title: '已截止且不允许补交', description: 'x', category: '产品测试',
      maxScore: 100, dueAt: new Date(Date.now() - DAY).toISOString(),
      published: true, allowLate: false, createdBy: 1, createdAt: new Date().toISOString(),
    });
    const lenient = db.insert('assignments', {
      title: '已截止但允许补交', description: 'x', category: '产品测试',
      maxScore: 100, dueAt: new Date(Date.now() - DAY).toISOString(),
      published: true, allowLate: true, createdBy: 1, createdAt: new Date().toISOString(),
    });

    const denied = await call(`/api/assignments/${strict.id}/submissions`, {
      method: 'POST', token: student, body: { content: '迟到的作业' },
    });
    assert.equal(denied.status, 403);

    const allowed = await call(`/api/assignments/${lenient.id}/submissions`, {
      method: 'POST', token: student, body: { content: '迟到的作业' },
    });
    assert.equal(allowed.status, 201);
    assert.equal(allowed.body.submission.late, true);

    assert.equal((await call(`/api/assignments/${strict.id}`, { token: teacher })).status, 200);
  });
});

test('删除作业会级联删除提交记录', async () => {
  await withServer(async ({ call, login, db }) => {
    const teacher = await login('teacher', 'teacher123');
    const assignment = db.all('assignments')[0];
    assert.ok(db.filter('submissions', (s) => s.assignmentId === assignment.id).length > 0);

    const res = await call(`/api/assignments/${assignment.id}`, { method: 'DELETE', token: teacher });
    assert.equal(res.status, 200);
    assert.equal(db.find('assignments', (a) => a.id === assignment.id), undefined);
    assert.equal(db.filter('submissions', (s) => s.assignmentId === assignment.id).length, 0);
  });
});

test('统计数据按角色区分', async () => {
  await withServer(async ({ call, login }) => {
    const teacherStats = (await call('/api/stats', { token: await login('teacher', 'teacher123') })).body.stats;
    assert.equal(teacherStats.role, 'teacher');
    assert.equal(teacherStats.studentCount, 4);
    assert.ok(teacherStats.pendingGradingCount >= 1);
    assert.ok(teacherStats.submissionRate > 0 && teacherStats.submissionRate <= 100);

    const studentStats = (await call('/api/stats', { token: await login('S2301', 'student123') })).body.stats;
    assert.equal(studentStats.role, 'student');
    assert.equal(studentStats.submittedCount, 2);
    assert.equal(studentStats.gradedCount, 1);
    assert.ok(studentStats.scoreRate > 0);
  });
});

test('退出登录后令牌立即失效', async () => {
  await withServer(async ({ call, login }) => {
    const token = await login('teacher', 'teacher123');
    assert.equal((await call('/api/me', { token })).status, 200);
    assert.equal((await call('/api/logout', { method: 'POST', token })).status, 200);
    assert.equal((await call('/api/me', { token })).status, 401);
  });
});

test('静态资源可访问且拒绝路径穿越', async () => {
  await withServer(async ({ base }) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes('电子产品课程作业系统'));

    const escape = await fetch(`${base}/../server/db.js`, { redirect: 'manual' });
    assert.notEqual(escape.status, 200);

    const missing = await fetch(`${base}/api/不存在`);
    assert.equal(missing.status, 404);
  });
});
