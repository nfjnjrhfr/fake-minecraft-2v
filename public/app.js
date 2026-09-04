const state = {
  token: localStorage.getItem('token') || '',
  user: null,
  categories: [],
  tab: 'overview',
  assignments: [],
  stats: null,
};

const $ = (sel) => document.querySelector(sel);
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : '—';

function dueHint(iso) {
  const diff = Date.parse(iso) - Date.now();
  const days = Math.ceil(diff / 86400000);
  if (diff < 0) return `已截止 ${Math.abs(days)} 天`;
  if (days <= 1) return '今明两天截止';
  return `剩余 ${days} 天`;
}

const STATUS = {
  pending: ['tag warn', '待提交'],
  submitted: ['tag brand', '已提交'],
  graded: ['tag ok', '已批改'],
  overdue: ['tag danger', '已逾期'],
};

/* ---------------- 网络 ---------------- */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.user) logout();
    throw new Error(data.error || `请求失败（${res.status}）`);
  }
  return data;
}

let toastTimer;
function toast(message, bad = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('bad', bad);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}

/* ---------------- 登录 ---------------- */
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const errorBox = $('#login-error');
  errorBox.hidden = true;
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: { username: form.get('username'), password: form.get('password') },
    });
    state.token = data.token;
    localStorage.setItem('token', data.token);
    await boot();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
});

document.querySelectorAll('.chip').forEach((chip) =>
  chip.addEventListener('click', () => {
    $('#login-form').username.value = chip.dataset.user;
    $('#login-form').password.value = chip.dataset.pass;
  }),
);

$('#logout').addEventListener('click', logout);

async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* 已失效则忽略 */ }
  state.token = '';
  state.user = null;
  localStorage.removeItem('token');
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#login-form').reset();
}

/* ---------------- 弹窗 ---------------- */
function openModal(title, node) {
  $('#modal-title').textContent = title;
  $('#modal-body').replaceChildren(node);
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; }
$('#modal-close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

/* ---------------- 启动与刷新 ---------------- */
async function boot() {
  const me = await api('/api/me');
  state.user = me.user;
  state.categories = me.categories;
  state.tab = 'overview';
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#who').textContent =
    state.user.role === 'teacher'
      ? `${state.user.name} · 教师`
      : `${state.user.name} · ${state.user.className}（${state.user.studentNo}）`;
  renderTabs();
  await refresh();
}

async function refresh() {
  const [a, s] = await Promise.all([api('/api/assignments'), api('/api/stats')]);
  state.assignments = a.assignments;
  state.stats = s.stats;
  render();
}

function renderTabs() {
  const tabs = [
    ['overview', '概览'],
    ['assignments', state.user.role === 'teacher' ? '作业管理' : '我的作业'],
  ];
  $('#tabs').replaceChildren(
    ...tabs.map(([key, label]) => {
      const btn = el(`<button data-tab="${key}">${label}</button>`);
      btn.addEventListener('click', () => { state.tab = key; render(); });
      return btn;
    }),
  );
}

function render() {
  document.querySelectorAll('#tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === state.tab),
  );
  const main = $('#main');
  main.replaceChildren();
  if (state.tab === 'overview') renderOverview(main);
  else renderAssignments(main);
}

/* ---------------- 概览 ---------------- */
function renderOverview(main) {
  const s = state.stats;
  const cards =
    s.role === 'teacher'
      ? [
          [s.assignmentCount, '作业总数'],
          [s.publishedCount, '已发布'],
          [s.studentCount, '学生人数'],
          [s.submissionCount, '收到提交'],
          [s.pendingGradingCount, '待批改'],
          [`${s.submissionRate}%`, '提交率'],
          [`${s.averageScoreRate}%`, '平均得分率'],
        ]
      : [
          [s.assignmentCount, '作业总数'],
          [s.submittedCount, '已提交'],
          [s.gradedCount, '已批改'],
          [s.overdueCount, '逾期未交'],
          [`${s.earnedScore}/${s.totalScore}`, '累计得分'],
          [`${s.scoreRate}%`, '得分率'],
        ];

  main.append(
    el(`<div class="stat-grid">${cards
      .map(([v, l]) => `<div class="stat"><div class="value">${esc(v)}</div><div class="label">${l}</div></div>`)
      .join('')}</div>`),
  );

  const panel = el('<section class="panel"></section>');
  panel.append(el('<div class="panel-head"><h2>近期截止</h2></div>'));

  const upcoming = state.assignments
    .filter((a) => (state.user.role === 'teacher' ? a.published : true))
    .filter((a) => Date.parse(a.dueAt) >= Date.now())
    .slice(0, 5);

  if (!upcoming.length) {
    panel.append(el('<p class="empty">暂无未截止的作业</p>'));
  } else {
    const rows = upcoming
      .map((a) => {
        const right =
          state.user.role === 'teacher'
            ? `${a.submissionCount}/${a.studentCount} 已交`
            : `<span class="${STATUS[a.status][0]}">${STATUS[a.status][1]}</span>`;
        return `<tr><td><strong>${esc(a.title)}</strong><div class="muted">${esc(a.category)}</div></td>
          <td>${fmtDate(a.dueAt)}<div class="muted">${dueHint(a.dueAt)}</div></td>
          <td>${right}</td></tr>`;
      })
      .join('');
    panel.append(el(`<table><thead><tr><th>作业</th><th>截止时间</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>`));
  }
  main.append(panel);
}

/* ---------------- 作业列表 ---------------- */
function renderAssignments(main) {
  const panel = el('<section class="panel"></section>');
  const head = el('<div class="panel-head"><h2>作业列表</h2><span class="spacer"></span></div>');
  if (state.user.role === 'teacher') {
    const add = el('<button class="primary">+ 新建作业</button>');
    add.addEventListener('click', () => openAssignmentForm());
    head.append(add);
  }
  panel.append(head);

  if (!state.assignments.length) {
    panel.append(el('<p class="empty">还没有作业</p>'));
    main.append(panel);
    return;
  }

  const list = el('<div class="list"></div>');
  state.assignments.forEach((a) =>
    list.append(state.user.role === 'teacher' ? teacherCard(a) : studentCard(a)),
  );
  panel.append(list);
  main.append(panel);
}

function teacherCard(a) {
  const pct = a.studentCount ? Math.round((a.submissionCount / a.studentCount) * 100) : 0;
  const card = el(`<article class="item">
    <div class="item-head">
      <h3>${esc(a.title)}</h3>
      <span class="tag brand">${esc(a.category)}</span>
      <span class="tag ${a.published ? 'ok' : ''}">${a.published ? '已发布' : '草稿'}</span>
      ${a.allowLate ? '<span class="tag">允许补交</span>' : ''}
    </div>
    <div class="item-meta">
      <span>截止 ${fmtDate(a.dueAt)} · ${dueHint(a.dueAt)}</span>
      <span>满分 ${a.maxScore}</span>
      <span>已交 ${a.submissionCount}/${a.studentCount} · 已批改 ${a.gradedCount}</span>
      <span>平均分 ${a.averageScore ?? '—'}</span>
    </div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="item-actions"></div>
  </article>`);

  const actions = card.querySelector('.item-actions');
  actions.append(
    action('批改提交', () => openGrading(a)),
    action('编辑', () => openAssignmentForm(a)),
    action(a.published ? '撤回' : '发布', async () => {
      await api(`/api/assignments/${a.id}`, { method: 'PATCH', body: { published: !a.published } });
      toast(a.published ? '已撤回为草稿' : '作业已发布');
      await refresh();
    }),
    action('删除', async () => {
      if (!confirm(`确认删除《${a.title}》？该作业下的提交记录会一并删除。`)) return;
      await api(`/api/assignments/${a.id}`, { method: 'DELETE' });
      toast('作业已删除');
      await refresh();
    }, 'danger'),
  );
  return card;
}

function studentCard(a) {
  const [cls, label] = STATUS[a.status];
  const score =
    a.submission && a.submission.score !== null
      ? `<span>得分 <strong>${a.submission.score}/${a.maxScore}</strong></span>`
      : `<span>满分 ${a.maxScore}</span>`;
  const card = el(`<article class="item">
    <div class="item-head">
      <h3>${esc(a.title)}</h3>
      <span class="tag brand">${esc(a.category)}</span>
      <span class="${cls}">${label}</span>
      ${a.submission?.late ? '<span class="tag warn">补交</span>' : ''}
    </div>
    <div class="item-meta">
      <span>截止 ${fmtDate(a.dueAt)} · ${dueHint(a.dueAt)}</span>
      ${score}
      <span>教师 ${esc(a.teacherName)}</span>
    </div>
    <div class="item-actions"></div>
  </article>`);
  card.querySelector('.item-actions').append(action('查看详情 / 提交', () => openSubmitForm(a)));
  return card;
}

function action(label, handler, variant = '') {
  const btn = el(`<button class="ghost ${variant}">${label}</button>`);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await handler(); } catch (err) { toast(err.message, true); }
    btn.disabled = false;
  });
  return btn;
}

/* ---------------- 教师：新建 / 编辑作业 ---------------- */
function openAssignmentForm(assignment) {
  const isEdit = Boolean(assignment);
  const due = assignment ? toLocalInput(assignment.dueAt) : toLocalInput(Date.now() + 7 * 86400000);
  const form = el(`<form class="form-grid">
    <label><span>作业标题</span><input name="title" maxlength="120" required value="${esc(assignment?.title ?? '')}" placeholder="例如：STM32 温湿度采集实验" /></label>
    <label><span>作业要求</span><textarea name="description" required placeholder="写清任务目标、提交内容和评分要点">${esc(assignment?.description ?? '')}</textarea></label>
    <div class="form-row">
      <label><span>分类</span><select name="category">${state.categories
        .map((c) => `<option ${assignment?.category === c ? 'selected' : ''}>${esc(c)}</option>`)
        .join('')}</select></label>
      <label><span>满分</span><input name="maxScore" type="number" min="1" max="1000" required value="${assignment?.maxScore ?? 100}" /></label>
    </div>
    <div class="form-row">
      <label><span>截止时间</span><input name="dueAt" type="datetime-local" required value="${due}" /></label>
      <div style="display:grid;gap:8px;align-content:end;padding-bottom:6px">
        <span class="checkbox"><input type="checkbox" name="published" ${assignment?.published ?? true ? 'checked' : ''} /> 立即发布给学生</span>
        <span class="checkbox"><input type="checkbox" name="allowLate" ${assignment?.allowLate ? 'checked' : ''} /> 允许逾期补交</span>
      </div>
    </div>
    <p class="error" hidden></p>
    <button class="primary" type="submit">${isEdit ? '保存修改' : '创建作业'}</button>
  </form>`);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const body = {
      title: f.get('title'),
      description: f.get('description'),
      category: f.get('category'),
      maxScore: Number(f.get('maxScore')),
      dueAt: new Date(f.get('dueAt')).toISOString(),
      published: form.published.checked,
      allowLate: form.allowLate.checked,
    };
    const errorBox = form.querySelector('.error');
    errorBox.hidden = true;
    try {
      if (isEdit) await api(`/api/assignments/${assignment.id}`, { method: 'PATCH', body });
      else await api('/api/assignments', { method: 'POST', body });
      closeModal();
      toast(isEdit ? '作业已更新' : '作业已创建');
      await refresh();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    }
  });

  openModal(isEdit ? '编辑作业' : '新建作业', form);
}

function toLocalInput(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------------- 教师：批改 ---------------- */
async function openGrading(assignment) {
  const { rows } = await api(`/api/assignments/${assignment.id}/submissions`);
  const wrap = el('<div class="form-grid"></div>');
  wrap.append(
    el(`<p class="muted">满分 ${assignment.maxScore} · 截止 ${fmtDate(assignment.dueAt)} · 共 ${rows.length} 名学生</p>`),
  );

  if (!rows.length) {
    wrap.append(el('<p class="empty">暂无学生</p>'));
  }

  rows.forEach((row) => {
    const [cls, label] = STATUS[row.status];
    const card = el(`<article class="item">
      <div class="item-head">
        <h3>${esc(row.student.name)}</h3>
        <span class="tag">${esc(row.student.studentNo)} · ${esc(row.student.className)}</span>
        <span class="${cls}">${label}</span>
        ${row.submission?.late ? '<span class="tag warn">补交</span>' : ''}
      </div>
    </article>`);

    if (!row.submission) {
      card.append(el('<p class="muted">该学生尚未提交</p>'));
      wrap.append(card);
      return;
    }

    card.append(
      el(`<div class="item-meta"><span>提交于 ${fmtDate(row.submission.submittedAt)}</span>${
        row.submission.attachment ? `<span>附件：${esc(row.submission.attachment)}</span>` : ''
      }</div>`),
      el(`<div class="desc">${esc(row.submission.content)}</div>`),
    );

    const form = el(`<form class="form-row grade-form">
      <label><span>分数（满分 ${assignment.maxScore}）</span>
        <input name="score" type="number" min="0" max="${assignment.maxScore}" step="0.5" required value="${row.submission.score ?? ''}" /></label>
      <label><span>评语</span><input name="feedback" maxlength="2000" value="${esc(row.submission.feedback ?? '')}" placeholder="选填" /></label>
    </form>`);
    const submit = el('<button class="primary" type="submit">保存评分</button>');
    form.append(submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        await api(`/api/submissions/${row.submission.id}/grade`, {
          method: 'POST',
          body: { score: Number(form.score.value), feedback: form.feedback.value },
        });
        toast(`已保存 ${row.student.name} 的评分`);
        await refresh();
      } catch (err) {
        toast(err.message, true);
      }
      submit.disabled = false;
    });
    card.append(form);
    wrap.append(card);
  });

  openModal(`批改：${assignment.title}`, wrap);
}

/* ---------------- 学生：查看与提交 ---------------- */
function openSubmitForm(a) {
  const wrap = el('<div class="form-grid"></div>');
  wrap.append(
    el(`<div class="item-meta">
      <span class="tag brand">${esc(a.category)}</span>
      <span>截止 ${fmtDate(a.dueAt)} · ${dueHint(a.dueAt)}</span>
      <span>满分 ${a.maxScore}</span>
      <span>教师 ${esc(a.teacherName)}</span>
    </div>`),
    el(`<div class="desc">${esc(a.description)}</div>`),
  );

  const graded = a.submission && a.submission.score !== null;
  if (graded) {
    wrap.append(
      el(`<div class="panel" style="box-shadow:none">
        <div class="panel-head"><h2>批改结果</h2><span class="spacer"></span>
          <span class="tag ok">${a.submission.score} / ${a.maxScore}</span></div>
        <p class="muted">批改于 ${fmtDate(a.submission.gradedAt)}</p>
        <div class="desc">${esc(a.submission.feedback || '教师未留评语')}</div>
      </div>`),
    );
  }

  const overdue = Date.parse(a.dueAt) < Date.now();
  if (graded) {
    wrap.append(el('<p class="muted">作业已批改，不能再修改提交内容。</p>'));
    wrap.append(el(`<div class="desc">${esc(a.submission.content)}</div>`));
    openModal(a.title, wrap);
    return;
  }
  if (overdue && !a.allowLate) {
    wrap.append(el('<p class="error">作业已截止，且不允许补交。</p>'));
    if (a.submission) wrap.append(el(`<div class="desc">${esc(a.submission.content)}</div>`));
    openModal(a.title, wrap);
    return;
  }

  const form = el(`<form class="form-grid">
    ${overdue ? '<p class="error">已超过截止时间，本次提交将被标记为「补交」。</p>' : ''}
    <label><span>作业内容</span><textarea name="content" required placeholder="填写实验过程、计算依据、结论等">${esc(a.submission?.content ?? '')}</textarea></label>
    <label><span>附件链接（选填）</span><input name="attachment" maxlength="500" value="${esc(a.submission?.attachment ?? '')}" placeholder="原理图 / 源码仓库 / 照片链接" /></label>
    <p class="error form-error" hidden></p>
    <button class="primary" type="submit">${a.submission ? '更新提交' : '提交作业'}</button>
  </form>`);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = form.querySelector('.form-error');
    try {
      await api(`/api/assignments/${a.id}/submissions`, {
        method: 'POST',
        body: { content: form.content.value, attachment: form.attachment.value },
      });
      closeModal();
      toast('提交成功');
      await refresh();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    }
  });

  wrap.append(form);
  openModal(a.title, wrap);
}

/* ---------------- 入口 ---------------- */
if (state.token) {
  boot().catch(() => {
    state.token = '';
    localStorage.removeItem('token');
  });
}
