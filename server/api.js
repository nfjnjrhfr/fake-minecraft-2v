import { createSession, destroySession, hashPassword, publicUser, verifyPassword } from './auth.js';

export const CATEGORIES = ['元器件识别', '电路设计', 'PCB制版', '嵌入式开发', '产品测试', '拆解分析'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);
const forbidden = (msg = '没有权限执行该操作') => new HttpError(403, msg);
const notFound = (msg = '资源不存在') => new HttpError(404, msg);

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, '请先登录');
  return ctx.user;
}

function requireTeacher(ctx) {
  const user = requireUser(ctx);
  if (user.role !== 'teacher') throw forbidden('仅教师可执行该操作');
  return user;
}

function requireStudent(ctx) {
  const user = requireUser(ctx);
  if (user.role !== 'student') throw forbidden('仅学生可执行该操作');
  return user;
}

function str(value, field, { max = 2000, required = true } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    if (required) throw bad(`${field}不能为空`);
    return '';
  }
  if (text.length > max) throw bad(`${field}不能超过 ${max} 个字符`);
  return text;
}

function parseDueAt(value) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw bad('截止时间格式不正确');
  return new Date(time).toISOString();
}

function assignmentInput(body, { partial = false } = {}) {
  const patch = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  if (!partial || has('title')) patch.title = str(body.title, '作业标题', { max: 120 });
  if (!partial || has('description')) {
    patch.description = str(body.description, '作业要求', { max: 5000, required: !partial });
  }
  if (!partial || has('category')) {
    const category = str(body.category, '作业分类', { max: 40 });
    if (!CATEGORIES.includes(category)) throw bad(`作业分类必须是：${CATEGORIES.join('、')}`);
    patch.category = category;
  }
  if (!partial || has('maxScore')) {
    const maxScore = Number(body.maxScore);
    if (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 1000) {
      throw bad('满分必须是 0 到 1000 之间的数字');
    }
    patch.maxScore = maxScore;
  }
  if (!partial || has('dueAt')) patch.dueAt = parseDueAt(body.dueAt);
  if (has('published')) patch.published = Boolean(body.published);
  if (has('allowLate')) patch.allowLate = Boolean(body.allowLate);
  return patch;
}

/** 学生视角下某份作业的状态 */
function statusOf(assignment, submission, now = Date.now()) {
  if (submission?.score !== null && submission?.score !== undefined) return 'graded';
  if (submission) return 'submitted';
  if (Date.parse(assignment.dueAt) < now) return 'overdue';
  return 'pending';
}

function decorate(db, assignment, viewer) {
  const submissions = db.filter('submissions', (s) => s.assignmentId === assignment.id);
  const base = {
    ...assignment,
    teacherName: db.find('users', (u) => u.id === assignment.createdBy)?.name ?? '未知',
  };
  if (viewer.role === 'teacher') {
    const graded = submissions.filter((s) => s.score !== null && s.score !== undefined);
    const studentCount = db.filter('users', (u) => u.role === 'student').length;
    return {
      ...base,
      submissionCount: submissions.length,
      gradedCount: graded.length,
      studentCount,
      averageScore: graded.length
        ? Number((graded.reduce((sum, s) => sum + s.score, 0) / graded.length).toFixed(2))
        : null,
    };
  }
  const mine = submissions.find((s) => s.studentId === viewer.id) ?? null;
  return { ...base, submission: mine, status: statusOf(assignment, mine) };
}

export const routes = [
  {
    method: 'POST',
    path: '/api/login',
    handler({ db, body }) {
      const username = str(body.username, '用户名', { max: 60 });
      const password = str(body.password, '密码', { max: 200 });
      const user = db.find('users', (u) => u.username === username);
      if (!user || !verifyPassword(password, user.password)) {
        throw new HttpError(401, '用户名或密码错误');
      }
      const token = createSession(db, user.id);
      return { status: 200, body: { token, user: publicUser(user) } };
    },
  },
  {
    method: 'POST',
    path: '/api/logout',
    handler({ db, token }) {
      destroySession(db, token);
      return { status: 200, body: { ok: true } };
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    handler(ctx) {
      return { status: 200, body: { user: publicUser(requireUser(ctx)), categories: CATEGORIES } };
    },
  },
  {
    method: 'GET',
    path: '/api/assignments',
    handler(ctx) {
      const user = requireUser(ctx);
      const visible = ctx.db
        .filter('assignments', (a) => user.role === 'teacher' || a.published)
        .map((a) => decorate(ctx.db, a, user))
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
      return { status: 200, body: { assignments: visible } };
    },
  },
  {
    method: 'POST',
    path: '/api/assignments',
    handler(ctx) {
      const teacher = requireTeacher(ctx);
      const input = assignmentInput(ctx.body);
      const created = ctx.db.insert('assignments', {
        ...input,
        published: input.published ?? false,
        allowLate: input.allowLate ?? false,
        createdBy: teacher.id,
        createdAt: new Date().toISOString(),
      });
      return { status: 201, body: { assignment: decorate(ctx.db, created, teacher) } };
    },
  },
  {
    method: 'GET',
    path: '/api/assignments/:id',
    handler(ctx) {
      const user = requireUser(ctx);
      const assignment = getAssignment(ctx);
      if (user.role !== 'teacher' && !assignment.published) throw notFound('作业不存在');
      return { status: 200, body: { assignment: decorate(ctx.db, assignment, user) } };
    },
  },
  {
    method: 'PATCH',
    path: '/api/assignments/:id',
    handler(ctx) {
      const teacher = requireTeacher(ctx);
      const assignment = getAssignment(ctx);
      const patch = assignmentInput(ctx.body, { partial: true });
      const updated = ctx.db.update('assignments', assignment.id, patch);
      return { status: 200, body: { assignment: decorate(ctx.db, updated, teacher) } };
    },
  },
  {
    method: 'DELETE',
    path: '/api/assignments/:id',
    handler(ctx) {
      requireTeacher(ctx);
      const assignment = getAssignment(ctx);
      ctx.db.remove('submissions', (s) => s.assignmentId === assignment.id);
      ctx.db.remove('assignments', (a) => a.id === assignment.id);
      return { status: 200, body: { ok: true } };
    },
  },
  {
    method: 'GET',
    path: '/api/assignments/:id/submissions',
    handler(ctx) {
      requireTeacher(ctx);
      const assignment = getAssignment(ctx);
      const students = ctx.db.filter('users', (u) => u.role === 'student');
      const rows = students.map((student) => {
        const submission =
          ctx.db.find(
            'submissions',
            (s) => s.assignmentId === assignment.id && s.studentId === student.id,
          ) ?? null;
        return {
          student: publicUser(student),
          submission,
          status: statusOf(assignment, submission),
        };
      });
      return { status: 200, body: { assignment, rows } };
    },
  },
  {
    method: 'POST',
    path: '/api/assignments/:id/submissions',
    handler(ctx) {
      const student = requireStudent(ctx);
      const assignment = getAssignment(ctx);
      if (!assignment.published) throw notFound('作业不存在');

      const content = str(ctx.body.content, '作业内容', { max: 20000 });
      const attachment = str(ctx.body.attachment, '附件链接', { max: 500, required: false });
      const overdue = Date.parse(assignment.dueAt) < Date.now();
      if (overdue && !assignment.allowLate) throw forbidden('作业已截止，无法提交');

      const existing = ctx.db.find(
        'submissions',
        (s) => s.assignmentId === assignment.id && s.studentId === student.id,
      );
      if (existing && existing.score !== null && existing.score !== undefined) {
        throw forbidden('作业已批改，无法重新提交');
      }

      const payload = {
        content,
        attachment,
        submittedAt: new Date().toISOString(),
        late: overdue,
      };
      const submission = existing
        ? ctx.db.update('submissions', existing.id, payload)
        : ctx.db.insert('submissions', {
            assignmentId: assignment.id,
            studentId: student.id,
            score: null,
            feedback: '',
            gradedAt: null,
            gradedBy: null,
            ...payload,
          });
      return { status: existing ? 200 : 201, body: { submission } };
    },
  },
  {
    method: 'POST',
    path: '/api/submissions/:id/grade',
    handler(ctx) {
      const teacher = requireTeacher(ctx);
      const submission = ctx.db.find('submissions', (s) => s.id === ctx.params.id);
      if (!submission) throw notFound('提交记录不存在');
      const assignment = ctx.db.find('assignments', (a) => a.id === submission.assignmentId);

      const score = Number(ctx.body.score);
      if (!Number.isFinite(score) || score < 0 || score > assignment.maxScore) {
        throw bad(`分数必须是 0 到 ${assignment.maxScore} 之间的数字`);
      }
      const feedback = str(ctx.body.feedback, '评语', { max: 2000, required: false });
      const updated = ctx.db.update('submissions', submission.id, {
        score,
        feedback,
        gradedAt: new Date().toISOString(),
        gradedBy: teacher.id,
      });
      return { status: 200, body: { submission: updated } };
    },
  },
  {
    method: 'GET',
    path: '/api/stats',
    handler(ctx) {
      const user = requireUser(ctx);
      return { status: 200, body: { stats: buildStats(ctx.db, user) } };
    },
  },
];

function getAssignment(ctx) {
  const assignment = ctx.db.find('assignments', (a) => a.id === ctx.params.id);
  if (!assignment) throw notFound('作业不存在');
  return assignment;
}

export function buildStats(db, user) {
  const assignments = db.filter('assignments', (a) => user.role === 'teacher' || a.published);

  if (user.role === 'teacher') {
    const submissions = db.all('submissions');
    const graded = submissions.filter((s) => s.score !== null && s.score !== undefined);
    const studentCount = db.filter('users', (u) => u.role === 'student').length;
    const expected = assignments.filter((a) => a.published).length * studentCount;
    return {
      role: 'teacher',
      assignmentCount: assignments.length,
      publishedCount: assignments.filter((a) => a.published).length,
      studentCount,
      submissionCount: submissions.length,
      pendingGradingCount: submissions.length - graded.length,
      submissionRate: expected ? Number(((submissions.length / expected) * 100).toFixed(1)) : 0,
      averageScoreRate: graded.length
        ? Number(
            (
              (graded.reduce((sum, s) => {
                const a = db.find('assignments', (x) => x.id === s.assignmentId);
                return sum + s.score / a.maxScore;
              }, 0) /
                graded.length) *
              100
            ).toFixed(1),
          )
        : 0,
    };
  }

  const mine = assignments.map((a) => ({
    assignment: a,
    submission:
      db.find('submissions', (s) => s.assignmentId === a.id && s.studentId === user.id) ?? null,
  }));
  const graded = mine.filter((m) => m.submission?.score !== null && m.submission?.score !== undefined);
  const earned = graded.reduce((sum, m) => sum + m.submission.score, 0);
  const total = graded.reduce((sum, m) => sum + m.assignment.maxScore, 0);
  return {
    role: 'student',
    assignmentCount: mine.length,
    submittedCount: mine.filter((m) => m.submission).length,
    gradedCount: graded.length,
    overdueCount: mine.filter((m) => statusOf(m.assignment, m.submission) === 'overdue').length,
    earnedScore: earned,
    totalScore: total,
    scoreRate: total ? Number(((earned / total) * 100).toFixed(1)) : 0,
  };
}

export { statusOf, hashPassword };
