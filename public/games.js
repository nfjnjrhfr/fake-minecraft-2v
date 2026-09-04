import { api, el, esc, shade, tint } from './util.js';

/**
 * 真的能玩的遊戲。
 *
 * 每一款遊戲依它的類型對應一種玩法引擎，並套用該 App 自己的名稱與主色，
 * 所以桌面上的每個遊戲點下去都是實際可操作的東西，不是一張圖。
 * 最高分會存回裝置狀態。
 */

const ENGINE_BY_GENRE = {
  消除: 'match3',
  休閒: 'match3',
  益智: 'merge',
  競速: 'dodge',
  動作: 'dodge',
  太空冒險: 'dodge',
  音樂節奏: 'rhythm',
  棋類: 'gomoku',
  策略: 'gomoku',
  角色扮演: 'battle',
  即時戰略: 'battle',
  模擬經營: 'idle',
};

export const engineFor = (app) => ENGINE_BY_GENRE[app.genre] ?? 'dodge';

/** 遊戲外框：分數列、遊戲區、說明列，結束時回報最高分 */
export function playGame(app, ctx, host) {
  const best0 = ctx.state.scores?.[app.id] ?? 0;
  const shell = el(`<div class="game" style="${tint(app)}">
    <div class="game-bar">
      <button class="game-back">‹ 標題</button>
      <span class="game-score">0</span>
      <span class="game-best">最高 ${best0}</span>
    </div>
    <div class="game-stage"></div>
    <div class="game-hint"></div>
  </div>`);

  const stage = shell.querySelector('.game-stage');
  const scoreOut = shell.querySelector('.game-score');
  const bestOut = shell.querySelector('.game-best');
  const hint = shell.querySelector('.game-hint');
  const cleanups = [];

  const gameCtx = {
    app,
    stage,
    hint: (text) => { hint.textContent = text; },
    setScore: (n) => { scoreOut.textContent = n; },
    onCleanup: (fn) => cleanups.push(fn),
    key(handler) {
      const listener = (e) => {
        if (e.target.matches('input, textarea')) return;
        if (handler(e.key) !== false) e.preventDefault();
      };
      window.addEventListener('keydown', listener);
      cleanups.push(() => window.removeEventListener('keydown', listener));
    },
    async over(score, label = '遊戲結束') {
      const best = Math.max(best0, score);
      if (best > best0) {
        try {
          const res = await api('/api/scores', { method: 'POST', body: { id: app.id, score } });
          ctx.setState({ ...ctx.state, scores: res.scores });
        } catch { /* 分數存不起來不影響遊玩 */ }
      }
      bestOut.textContent = `最高 ${best}`;
      const over = el(`<div class="game-over">
        <div class="go-title">${esc(label)}</div>
        <div class="go-score">${score}</div>
        <div class="go-best">${best > best0 ? '新紀錄！' : `最高分 ${best}`}</div>
        <button class="big-btn" style="min-width:150px">再玩一次</button>
      </div>`);
      over.querySelector('button').addEventListener('click', () => {
        over.remove();
        start();
      });
      stage.append(over);
    },
  };

  const teardown = () => {
    cleanups.splice(0).forEach((fn) => fn());
    document.querySelector('#screen')?.classList.remove('playing');
  };

  const start = () => {
    teardown();
    document.querySelector('#screen')?.classList.add('playing');
    stage.replaceChildren();
    scoreOut.textContent = '0';
    ENGINES[engineFor(app)](gameCtx);
  };

  shell.querySelector('.game-back').addEventListener('click', () => {
    teardown();
    ctx.backToTitle();
  });
  ctx.onCleanup(teardown);

  host.replaceChildren(shell);
  start();
}

/* ============================================================ 三消 */
function match3(g) {
  const COLS = 7;
  const ROWS = 8;
  const KINDS = ['🍓', '🍋', '🍇', '🍏', '🫐', '🍊'];
  let board = [];
  let score = 0;
  let moves = 25;
  let busy = false;
  let picked = null;

  const grid = el('<div class="m3"></div>');
  const status = el('<div class="game-sub"></div>');
  g.stage.append(status, grid);
  g.hint('點兩個相鄰的格子交換，湊三個以上就消除');

  const at = (r, c) => (board[r] ? board[r][c] : undefined);
  const fill = () => {
    board = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => KINDS[Math.floor(Math.random() * KINDS.length)]));
    while (findMatches().length) resolve(false);
  };

  function findMatches() {
    const hits = new Set();
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const v = at(r, c);
        if (!v) continue;
        if (c + 2 < COLS && at(r, c + 1) === v && at(r, c + 2) === v) { hits.add(`${r},${c}`); hits.add(`${r},${c + 1}`); hits.add(`${r},${c + 2}`); }
        if (r + 2 < ROWS && at(r + 1, c) === v && at(r + 2, c) === v) { hits.add(`${r},${c}`); hits.add(`${r + 1},${c}`); hits.add(`${r + 2},${c}`); }
      }
    }
    return [...hits];
  }

  function resolve(count = true) {
    const hits = findMatches();
    if (!hits.length) return false;
    hits.forEach((key) => {
      const [r, c] = key.split(',').map(Number);
      board[r][c] = null;
    });
    if (count) {
      score += hits.length * 10;
      g.setScore(score);
    }
    // 讓上面的方塊掉下來，空出來的位置補新的
    for (let c = 0; c < COLS; c += 1) {
      const column = [];
      for (let r = ROWS - 1; r >= 0; r -= 1) if (board[r][c]) column.push(board[r][c]);
      for (let r = ROWS - 1; r >= 0; r -= 1) {
        board[r][c] = column[ROWS - 1 - r] ?? KINDS[Math.floor(Math.random() * KINDS.length)];
      }
    }
    return true;
  }

  const draw = () => {
    status.textContent = `剩餘步數 ${moves}`;
    grid.replaceChildren();
    grid.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const cell = el(`<button class="m3-cell${picked && picked.r === r && picked.c === c ? ' on' : ''}">${board[r][c]}</button>`);
        cell.addEventListener('click', () => tap(r, c));
        grid.append(cell);
      }
    }
  };

  async function tap(r, c) {
    if (busy) return;
    if (!picked) { picked = { r, c }; draw(); return; }
    const near = Math.abs(picked.r - r) + Math.abs(picked.c - c) === 1;
    if (!near) { picked = { r, c }; draw(); return; }

    busy = true;
    const a = picked;
    picked = null;
    [board[a.r][a.c], board[r][c]] = [board[r][c], board[a.r][a.c]];
    draw();

    if (!findMatches().length) {
      // 換了沒東西消，換回來
      await wait(180);
      [board[a.r][a.c], board[r][c]] = [board[r][c], board[a.r][a.c]];
      draw();
      busy = false;
      return;
    }
    moves -= 1;
    while (resolve()) {
      draw();
      await wait(180);
    }
    busy = false;
    if (moves <= 0) g.over(score, '步數用完了');
  }

  const wait = (ms) => new Promise((r) => { const t = setTimeout(r, ms); g.onCleanup(() => clearTimeout(t)); });

  fill();
  draw();
}

/* ============================================================ 合併方塊 */
function merge(g) {
  const N = 4;
  let cells = [];
  let score = 0;

  const grid = el('<div class="mg"></div>');
  g.stage.append(grid);
  g.hint('方向鍵或滑動來合併相同的方塊');

  const spawn = () => {
    const empty = [];
    cells.forEach((v, i) => { if (!v) empty.push(i); });
    if (!empty.length) return;
    cells[empty[Math.floor(Math.random() * empty.length)]] = Math.random() < 0.9 ? 2 : 4;
  };

  const COLORS = { 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' };

  const draw = () => {
    grid.replaceChildren();
    cells.forEach((v) => {
      const tile = el(`<div class="mg-cell">${v || ''}</div>`);
      if (v) {
        tile.style.background = COLORS[v] ?? '#3c3a32';
        tile.style.color = v <= 4 ? '#776e65' : '#f9f6f2';
        tile.style.fontSize = v >= 1024 ? '19px' : v >= 128 ? '23px' : '27px';
      }
      grid.append(tile);
    });
  };

  const slide = (row) => {
    const kept = row.filter(Boolean);
    const out = [];
    for (let i = 0; i < kept.length; i += 1) {
      if (kept[i] === kept[i + 1]) {
        out.push(kept[i] * 2);
        score += kept[i] * 2;
        i += 1;
      } else out.push(kept[i]);
    }
    while (out.length < N) out.push(0);
    return out;
  };

  const lines = (dir) => {
    const out = [];
    for (let i = 0; i < N; i += 1) {
      const line = [];
      for (let j = 0; j < N; j += 1) {
        const idx = dir === 'left' || dir === 'right' ? i * N + j : j * N + i;
        line.push(cells[idx]);
      }
      out.push(dir === 'right' || dir === 'down' ? line.reverse() : line);
    }
    return out;
  };

  const write = (dir, rows) => {
    rows.forEach((line, i) => {
      const ordered = dir === 'right' || dir === 'down' ? [...line].reverse() : line;
      ordered.forEach((v, j) => {
        const idx = dir === 'left' || dir === 'right' ? i * N + j : j * N + i;
        cells[idx] = v;
      });
    });
  };

  const move = (dir) => {
    const before = cells.join();
    write(dir, lines(dir).map(slide));
    if (cells.join() === before) return;
    spawn();
    g.setScore(score);
    draw();
    if (!canMove()) g.over(score, '沒有可以移動的方向了');
  };

  const canMove = () => {
    if (cells.some((v) => !v)) return true;
    for (let r = 0; r < N; r += 1) {
      for (let c = 0; c < N; c += 1) {
        const v = cells[r * N + c];
        if (c + 1 < N && cells[r * N + c + 1] === v) return true;
        if (r + 1 < N && cells[(r + 1) * N + c] === v) return true;
      }
    }
    return false;
  };

  g.key((key) => {
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' }[key];
    if (!dir) return false;
    move(dir);
  });

  let touch = null;
  grid.addEventListener('pointerdown', (e) => { touch = { x: e.clientX, y: e.clientY }; });
  grid.addEventListener('pointerup', (e) => {
    if (!touch) return;
    const dx = e.clientX - touch.x;
    const dy = e.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });

  cells = Array(N * N).fill(0);
  spawn();
  spawn();
  draw();
}

/* ============================================================ 閃避 */
function dodge(g) {
  const W = 360;
  const H = 520;
  const canvas = el(`<canvas class="game-canvas" width="${W}" height="${H}"></canvas>`);
  g.stage.append(canvas);
  g.hint('左右方向鍵或點畫面兩側閃避，撐越久分數越高');

  const c2d = canvas.getContext('2d');
  const color = g.app.color;
  let x = W / 2;
  let vx = 0;
  let speed = 2.6;
  let score = 0;
  let obstacles = [];
  let stars = Array.from({ length: 46 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + 0.4 }));
  let alive = true;
  let held = 0;

  g.key((key) => {
    if (key === 'ArrowLeft' || key === 'a') held = -1;
    else if (key === 'ArrowRight' || key === 'd') held = 1;
    else return false;
  });
  const release = () => { held = 0; };
  window.addEventListener('keyup', release);
  g.onCleanup(() => window.removeEventListener('keyup', release));

  const point = (e) => {
    const rect = canvas.getBoundingClientRect();
    held = e.clientX - rect.left < rect.width / 2 ? -1 : 1;
  };
  canvas.addEventListener('pointerdown', point);
  canvas.addEventListener('pointermove', (e) => { if (held) point(e); });
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointerleave', release);

  let last = performance.now();
  let raf = 0;
  const frame = (now) => {
    const dt = Math.min(34, now - last) / 16.7;
    last = now;
    if (!alive) return;

    speed += 0.0016 * dt;
    score += Math.round(dt * speed);
    g.setScore(score);

    vx = vx * 0.82 + held * 5.4 * 0.18 * 6;
    x = Math.max(24, Math.min(W - 24, x + vx * dt));

    // 每秒約 1.2 個障礙物；難度靠速度變快，不是靠塞滿畫面
    if (Math.random() < 0.02 * dt) {
      obstacles.push({ x: 24 + Math.random() * (W - 48), y: -30, w: 30 + Math.random() * 40 });
    }
    obstacles.forEach((o) => { o.y += speed * 2.6 * dt; });
    obstacles = obstacles.filter((o) => o.y < H + 40);
    stars.forEach((s) => { s.y = (s.y + speed * 1.5 * dt) % H; });

    for (const o of obstacles) {
      if (o.y > H - 92 && o.y < H - 40 && Math.abs(o.x - x) < o.w / 2 + 15) {
        alive = false;
        cancelAnimationFrame(raf);
        g.over(score, '撞上了');
        return;
      }
    }

    c2d.fillStyle = '#0b0d14';
    c2d.fillRect(0, 0, W, H);
    c2d.fillStyle = 'rgba(255,255,255,.4)';
    stars.forEach((s) => c2d.fillRect(s.x, s.y, s.r, s.r * 3));

    c2d.fillStyle = color;
    obstacles.forEach((o) => {
      c2d.globalAlpha = 0.9;
      roundRect(c2d, o.x - o.w / 2, o.y, o.w, 20, 7);
      c2d.fill();
    });
    c2d.globalAlpha = 1;

    c2d.fillStyle = '#fff';
    roundRect(c2d, x - 15, H - 78, 30, 40, 9);
    c2d.fill();
    c2d.font = '20px system-ui';
    c2d.textAlign = 'center';
    c2d.fillText(g.app.glyph, x, H - 50);

    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  g.onCleanup(() => cancelAnimationFrame(raf));
}

function roundRect(ctx2d, x, y, w, h, r) {
  ctx2d.beginPath();
  ctx2d.moveTo(x + r, y);
  ctx2d.arcTo(x + w, y, x + w, y + h, r);
  ctx2d.arcTo(x + w, y + h, x, y + h, r);
  ctx2d.arcTo(x, y + h, x, y, r);
  ctx2d.arcTo(x, y, x + w, y, r);
  ctx2d.closePath();
}


/* ============================================================ 節奏 */
function rhythm(g) {
  const LANES = 4;
  const KEYS = ['d', 'f', 'j', 'k'];
  const stage = el('<div class="rh"></div>');
  const board = el('<div class="rh-board"></div>');
  const judge = el('<div class="rh-judge"></div>');
  const pads = el('<div class="rh-pads"></div>');
  stage.append(judge, board, pads);
  g.stage.append(stage);
  g.hint('用 D F J K 或直接點下方四個按鍵，在光線到底線時按下');

  for (let i = 0; i < LANES; i += 1) {
    board.append(el(`<div class="rh-lane" data-lane="${i}"></div>`));
    const pad = el(`<button class="rh-pad">${KEYS[i].toUpperCase()}</button>`);
    pad.addEventListener('pointerdown', () => hit(i));
    pads.append(pad);
  }

  // 固定的譜面：同一首曲子每次都一樣，才有練習的意義
  const chart = [];
  let t = 900;
  for (let i = 0; i < 46; i += 1) {
    chart.push({ time: t, lane: (i * 3 + Math.floor(i / 4)) % LANES, hit: false, node: null });
    t += i < 12 ? 620 : i < 28 ? 460 : 360;
  }

  let score = 0;
  let combo = 0;
  let started = performance.now();
  const TRAVEL = 1500;
  const HIT_LINE = 372;

  const show = (text, cls) => {
    judge.textContent = text;
    judge.className = `rh-judge ${cls}`;
    judge.style.opacity = '1';
    setTimeout(() => { judge.style.opacity = '0'; }, 260);
  };

  function hit(lane) {
    const now = performance.now() - started;
    const note = chart.find((n) => !n.hit && n.lane === lane && Math.abs(n.time - now) < 260);
    if (!note) { combo = 0; show('Miss', 'miss'); return; }
    note.hit = true;
    note.node?.remove();
    const off = Math.abs(note.time - now);
    const perfect = off < 90;
    combo += 1;
    score += (perfect ? 300 : 150) + combo * 5;
    g.setScore(score);
    show(perfect ? `Perfect ${combo}` : `Good ${combo}`, perfect ? 'perfect' : 'good');
  }

  g.key((key) => {
    const lane = KEYS.indexOf(key.toLowerCase());
    if (lane < 0) return false;
    hit(lane);
  });

  let raf = 0;
  const frame = () => {
    const now = performance.now() - started;
    chart.forEach((note) => {
      const delta = note.time - now;
      if (note.hit) return;
      if (delta < TRAVEL && delta > -300 && !note.node) {
        note.node = el('<div class="rh-note"></div>');
        note.node.style.background = g.app.color;
        board.children[note.lane].append(note.node);
      }
      if (note.node) {
        const progress = 1 - delta / TRAVEL;
        note.node.style.top = `${progress * HIT_LINE}px`;
      }
      if (delta < -260 && note.node) {
        note.hit = true;
        note.node.remove();
        combo = 0;
        show('Miss', 'miss');
      }
    });
    if (chart.every((n) => n.hit) || now > chart.at(-1).time + 900) {
      cancelAnimationFrame(raf);
      g.over(score, '一曲結束');
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  g.onCleanup(() => cancelAnimationFrame(raf));
}

/* ============================================================ 五子棋 */
function gomoku(g) {
  const N = 11;
  const board = Array(N * N).fill(0); // 0 空 1 你 2 電腦
  let over = false;
  let score = 0;

  const status = el('<div class="game-sub">你先下，連成五子就贏</div>');
  const grid = el('<div class="gm"></div>');
  grid.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
  g.stage.append(status, grid);
  g.hint('點空格下子，電腦會擋你也會自己連線');

  const idx = (r, c) => r * N + c;
  const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  const countLine = (r, c, dr, dc, who) => {
    let n = 0;
    let rr = r + dr;
    let cc = c + dc;
    while (inside(rr, cc) && board[idx(rr, cc)] === who) { n += 1; rr += dr; cc += dc; }
    return n;
  };
  const openEnd = (r, c, dr, dc, who) => {
    let rr = r + dr;
    let cc = c + dc;
    while (inside(rr, cc) && board[idx(rr, cc)] === who) { rr += dr; cc += dc; }
    return inside(rr, cc) && board[idx(rr, cc)] === 0;
  };

  const wins = (r, c, who) =>
    DIRS.some(([dr, dc]) => 1 + countLine(r, c, dr, dc, who) + countLine(r, c, -dr, -dc, who) >= 5);

  /** 這一格對 who 來說值多少：自己能連多長，加上兩端是否還開著 */
  const value = (r, c, who) => {
    let best = 0;
    for (const [dr, dc] of DIRS) {
      const a = countLine(r, c, dr, dc, who);
      const b = countLine(r, c, -dr, -dc, who);
      const len = a + b + 1;
      const open = (openEnd(r, c, dr, dc, who) ? 1 : 0) + (openEnd(r, c, -dr, -dc, who) ? 1 : 0);
      if (len >= 5) return 1e6;
      best = Math.max(best, len * len * 10 + open * 6);
    }
    return best;
  };

  const draw = () => {
    grid.replaceChildren();
    for (let r = 0; r < N; r += 1) {
      for (let c = 0; c < N; c += 1) {
        const v = board[idx(r, c)];
        const cell = el(`<button class="gm-cell">${v === 1 ? '<i class="me"></i>' : v === 2 ? '<i class="ai"></i>' : ''}</button>`);
        if (v === 1) cell.querySelector('i').style.background = g.app.color;
        if (!v && !over) cell.addEventListener('click', () => play(r, c));
        grid.append(cell);
      }
    }
  };

  function play(r, c) {
    if (over || board[idx(r, c)]) return;
    board[idx(r, c)] = 1;
    score += 20;
    g.setScore(score);
    if (wins(r, c, 1)) { over = true; draw(); g.over(score + 500, '你贏了'); return; }
    if (board.every(Boolean)) { over = true; draw(); g.over(score, '平手'); return; }
    aiMove();
    draw();
  }

  function aiMove() {
    let best = null;
    let bestScore = -1;
    for (let r = 0; r < N; r += 1) {
      for (let c = 0; c < N; c += 1) {
        if (board[idx(r, c)]) continue;
        // 只考慮已下棋子附近的格子，避免它下在角落
        const near = DIRS.concat(DIRS.map(([a, b]) => [-a, -b])).some(([dr, dc]) =>
          [1, 2].some((k) => inside(r + dr * k, c + dc * k) && board[idx(r + dr * k, c + dc * k)]));
        if (!near && board.some(Boolean)) continue;
        const attack = value(r, c, 2);
        const defend = value(r, c, 1) * 0.92;
        const total = Math.max(attack, defend) + Math.random() * 3;
        if (total > bestScore) { bestScore = total; best = { r, c }; }
      }
    }
    const move = best ?? { r: (N - 1) / 2, c: (N - 1) / 2 };
    board[idx(move.r, move.c)] = 2;
    if (wins(move.r, move.c, 2)) {
      over = true;
      status.textContent = '電腦連成五子了';
      setTimeout(() => g.over(score, '電腦贏了'), 60);
    }
  }

  draw();
}

/* ============================================================ 回合戰鬥 */
function battle(g) {
  let wave = 1;
  let score = 0;
  let hp = 100;
  let mp = 40;
  let guard = false;
  let enemy = null;

  const view = el(`<div class="bt">
    <div class="bt-enemy"></div>
    <div class="bt-log"></div>
    <div class="bt-me"></div>
    <div class="bt-actions"></div>
  </div>`);
  g.stage.append(view);
  g.hint('選一個動作，撐過越多波敵人分數越高');

  const enemyBox = view.querySelector('.bt-enemy');
  const logBox = view.querySelector('.bt-log');
  const meBox = view.querySelector('.bt-me');
  const actions = view.querySelector('.bt-actions');
  const lines = [];

  const log = (text) => {
    lines.unshift(text);
    logBox.replaceChildren(...lines.slice(0, 4).map((t, i) => el(`<div style="opacity:${1 - i * 0.24}">${esc(t)}</div>`)));
  };

  const spawn = () => {
    const names = ['遊蕩骸骨', '沼澤巨蛛', '碎石魔像', '暗影騎士', '深淵之影'];
    enemy = {
      name: names[Math.min(names.length - 1, wave - 1)],
      hp: 40 + wave * 18,
      max: 40 + wave * 18,
      atk: 8 + wave * 3,
    };
  };

  const bar = (now, max, color) =>
    `<div class="bt-bar"><i style="width:${Math.max(0, (now / max) * 100)}%;background:${color}"></i></div>`;

  const draw = () => {
    enemyBox.innerHTML = `<div class="bt-face">👹</div>
      <div class="bt-name">第 ${wave} 波 · ${esc(enemy.name)}</div>
      ${bar(enemy.hp, enemy.max, '#ff453a')}
      <div class="game-sub">HP ${Math.max(0, enemy.hp)} / ${enemy.max}</div>`;
    meBox.innerHTML = `<div class="bt-name">${esc(g.app.name)} 的隊伍</div>
      ${bar(hp, 100, g.app.color)}
      <div class="game-sub">HP ${Math.max(0, hp)} / 100　MP ${mp} / 40</div>`;
  };

  const enemyTurn = () => {
    if (enemy.hp <= 0) return;
    let dmg = Math.round(enemy.atk * (0.8 + Math.random() * 0.5));
    if (guard) { dmg = Math.round(dmg * 0.35); log(`你擋下了大部分傷害（-${dmg}）`); }
    else log(`${enemy.name} 攻擊，你受到 ${dmg} 傷害`);
    guard = false;
    hp -= dmg;
    draw();
    if (hp <= 0) g.over(score, `倒在第 ${wave} 波`);
  };

  const act = (kind) => {
    if (hp <= 0 || enemy.hp <= 0) return;
    if (kind === 'attack') {
      const dmg = Math.round(12 + Math.random() * 10);
      enemy.hp -= dmg;
      log(`你揮劍造成 ${dmg} 傷害`);
    } else if (kind === 'skill') {
      if (mp < 12) { log('魔力不足'); return; }
      mp -= 12;
      const dmg = Math.round(26 + Math.random() * 14);
      enemy.hp -= dmg;
      log(`你施放光刃，造成 ${dmg} 傷害`);
    } else if (kind === 'guard') {
      guard = true;
      mp = Math.min(40, mp + 8);
      log('你舉盾防禦，回復了一些魔力');
    } else {
      hp = Math.min(100, hp + 28);
      log('你喝下藥水，回復 28 點生命');
    }
    score += 15;
    g.setScore(score);
    draw();

    if (enemy.hp <= 0) {
      score += wave * 120;
      g.setScore(score);
      log(`${enemy.name} 被擊倒了！`);
      wave += 1;
      hp = Math.min(100, hp + 12);
      mp = Math.min(40, mp + 10);
      spawn();
      draw();
      return;
    }
    setTimeout(enemyTurn, 420);
  };

  [['attack', '⚔️ 攻擊'], ['skill', '✨ 技能 (12 MP)'], ['guard', '🛡 防禦'], ['potion', '🧪 藥水']].forEach(([kind, label]) => {
    const btn = el(`<button class="bt-btn">${label}</button>`);
    btn.addEventListener('click', () => act(kind));
    actions.append(btn);
  });

  spawn();
  draw();
  log('敵人出現了');
}

/* ============================================================ 經營 */
function idle(g) {
  let gold = 20;
  let score = 0;
  const shops = [
    { name: '農田', glyph: '🌾', cost: 15, rate: 1, owned: 0 },
    { name: '木屋', glyph: '🏠', cost: 60, rate: 4, owned: 0 },
    { name: '磨坊', glyph: '🏭', cost: 260, rate: 16, owned: 0 },
    { name: '城堡', glyph: '🏰', cost: 1200, rate: 70, owned: 0 },
  ];

  const head = el('<div class="id-head"></div>');
  const tapBtn = el(`<button class="id-tap">${g.app.glyph}<span>點我 +1</span></button>`);
  const list = el('<div class="id-list"></div>');
  g.stage.append(head, tapBtn, list);
  g.hint('點大按鈕賺金幣，蓋建築讓它自己生產');

  const rate = () => shops.reduce((n, s) => n + s.rate * s.owned, 0);

  const draw = () => {
    head.innerHTML = `<div class="id-gold">💰 ${Math.floor(gold)}</div><div class="game-sub">每秒 +${rate()}</div>`;
    list.replaceChildren();
    shops.forEach((shop) => {
      const row = el(`<button class="id-row">
        <span class="id-glyph">${shop.glyph}</span>
        <span class="grow"><b>${shop.name} ×${shop.owned}</b><span class="game-sub">每秒 +${shop.rate}</span></span>
        <span class="id-cost">${Math.round(shop.cost)}</span>
      </button>`);
      if (gold < shop.cost) row.classList.add('poor');
      row.addEventListener('click', () => {
        if (gold < shop.cost) return;
        gold -= shop.cost;
        shop.owned += 1;
        shop.cost = Math.round(shop.cost * 1.6);
        draw();
      });
      list.append(row);
    });
  };

  tapBtn.addEventListener('click', () => {
    gold += 1 + Math.floor(rate() / 12);
    score += 1;
    draw();
  });

  const timer = setInterval(() => {
    gold += rate();
    score += rate();
    g.setScore(Math.floor(score));
    draw();
  }, 1000);
  g.onCleanup(() => clearInterval(timer));

  // 經營類沒有輸贏，兩分鐘後結算
  const finish = setTimeout(() => g.over(Math.floor(score + gold), '兩分鐘結算'), 120_000);
  g.onCleanup(() => clearTimeout(finish));

  draw();
}

export const ENGINES = { match3, merge, dodge, rhythm, gomoku, battle, idle };
