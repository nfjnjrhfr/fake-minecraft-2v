/* PET 單詞連線 — 主程式
   ‧ 雙擊連線：雙擊左邊英文，再雙擊右邊中文，兩張卡之間會拉出一條線
   ‧ 離線可玩；同裝置可連線對戰（不用網路），也可跨裝置連線（有網路）
   ‧ 每答對 10 個單字 ⇒ 獲得 1 枚 PET 單詞幣 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var Store = global.PET_STORE;
  var U = global.PET_UTIL;
  var WORDS = global.PET_DATA.WORDS;
  var CATEGORIES = global.PET_DATA.CATEGORIES;

  var RING = 2 * Math.PI * 15.5;

  /* ===================== 通用 UI ===================== */

  function show(screen) {
    ['home', 'link', 'play', 'result', 'stats', 'settings'].forEach(function (s) {
      $('screen-' + s).classList.toggle('active', s === screen);
    });
    global.scrollTo(0, 0);
  }

  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    $('toast-wrap').appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity .3s';
      setTimeout(function () { el.remove(); }, 320);
    }, 2200);
  }

  function copyText(text) {
    if (!text) return Promise.reject();
    if (global.navigator.clipboard && global.isSecureContext) {
      return global.navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      ok ? resolve() : reject();
    });
  }

  function coinPop(n) {
    var pop = $('coin-pop');
    pop.querySelector('b').textContent = '+' + n + ' PET 單詞幣';
    pop.hidden = false;
    U.Sound.coin();
    U.vibrate([20, 40, 60]);
    setTimeout(function () { pop.hidden = true; }, 1300);
  }

  function refreshCoins(gainedBump) {
    var s = Store.get();
    $('coin-count').textContent = s.coins;
    $('coin-ring').style.strokeDashoffset = String(RING * (1 - Store.coinProgress()));
    $('to-next').textContent = Store.toNextCoin();
    if (gainedBump) {
      var box = $('coin-box');
      box.classList.remove('bump');
      void box.offsetWidth;
      box.classList.add('bump');
    }
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', Store.settings().theme === 'light' ? 'light' : 'dark');
  }

  /* ===================== 出題 ===================== */

  function buildDeck(seed, pairs, cats) {
    var rand = U.rng(seed);
    var pool = WORDS.filter(function (w) { return !cats.length || cats.indexOf(w.c) >= 0; });
    if (pool.length < pairs) pool = WORDS;
    var picked = U.shuffle(pool, rand).slice(0, pairs);
    return {
      picked: picked,
      left: U.shuffle(picked.map(function (_, i) { return i; }), rand),
      right: U.shuffle(picked.map(function (_, i) { return i; }), rand)
    };
  }

  /* ===================== 遊戲狀態 ===================== */

  var G = {
    mode: 'solo',        // solo | local | peer
    deck: null,
    seed: 0,
    pairs: 5,
    cats: [],
    matched: 0,
    wrong: 0,
    sel: null,           // {side, idx, el}
    started: 0,
    timer: null,
    roundCoins: 0,
    log: [],             // 本局作答紀錄
    busy: false,
    opp: null            // {name, matched, wrong, done, ms}
  };

  var link = null;       // 連線物件
  var myId = Math.floor(Math.random() * 1e9);
  var amHost = true;

  /* ===================== 牌桌 ===================== */

  function tileEl(side, idx, word) {
    var b = document.createElement('button');
    b.className = 'tile';
    b.type = 'button';
    b.dataset.side = side;
    b.dataset.idx = String(idx);
    if (side === 'L') {
      b.innerHTML = '<span class="en"></span><span class="pos"></span><span class="dot"></span>';
      b.querySelector('.en').textContent = word.w;
      b.querySelector('.pos').textContent = word.p;
      b.setAttribute('aria-label', '英文單字 ' + word.w);
    } else {
      b.innerHTML = '<span class="zh"></span><span class="dot"></span>';
      b.querySelector('.zh').textContent = word.z;
      b.setAttribute('aria-label', '中文意思 ' + word.z);
    }
    bindActivate(b);
    return b;
  }

  /* 雙擊（含手機雙點）偵測：同一張卡在 450 毫秒內被點兩次才算數。
     設定中可切換成單擊。 */
  function bindActivate(el) {
    var last = 0;
    el.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (!Store.settings().doubleClick) { activate(el); return; }
      var now = Date.now();
      if (now - last < 450) { last = 0; activate(el); }
      else {
        last = now;
        el.classList.add('tap1');
        setTimeout(function () { el.classList.remove('tap1'); }, 460);
      }
    });
    // 滑鼠原生雙擊也直接生效
    el.addEventListener('dblclick', function (ev) { ev.preventDefault(); });
  }

  function renderBoard() {
    var L = $('col-left'), R = $('col-right');
    L.innerHTML = ''; R.innerHTML = '';
    G.deck.left.forEach(function (i) { L.appendChild(tileEl('L', i, G.deck.picked[i])); });
    G.deck.right.forEach(function (i) { R.appendChild(tileEl('R', i, G.deck.picked[i])); });
    $('wires').innerHTML = '';
    drawWires();
  }

  function tileFor(side, idx) {
    return document.querySelector('.tile[data-side="' + side + '"][data-idx="' + idx + '"]');
  }

  /* ---- 連線的線 ---- */
  var wires = [];   // [{idx}]

  function dotPos(el, side) {
    var b = $('board').getBoundingClientRect();
    var r = el.getBoundingClientRect();
    return {
      x: (side === 'L' ? r.right - b.left : r.left - b.left),
      y: r.top - b.top + r.height / 2
    };
  }

  function pathBetween(a, b) {
    var dx = Math.max(28, Math.abs(b.x - a.x) * 0.45);
    return 'M' + a.x + ',' + a.y + ' C' + (a.x + dx) + ',' + a.y + ' ' + (b.x - dx) + ',' + b.y + ' ' + b.x + ',' + b.y;
  }

  function drawWires() {
    var svg = $('wires');
    // 保留暫時性的線（錯誤／預覽），重畫已完成的線
    Array.prototype.slice.call(svg.querySelectorAll('.wire.ok')).forEach(function (n) { n.remove(); });
    wires.forEach(function (w) {
      var l = tileFor('L', w.idx), r = tileFor('R', w.idx);
      if (!l || !r) return;
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', 'wire ok');
      p.setAttribute('d', pathBetween(dotPos(l, 'L'), dotPos(r, 'R')));
      svg.appendChild(p);
    });
  }

  function flashWire(aEl, aSide, bEl, bSide) {
    var svg = $('wires');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('class', 'wire ng');
    var a = dotPos(aEl, aSide), b = dotPos(bEl, bSide);
    p.setAttribute('d', aSide === 'L' ? pathBetween(a, b) : pathBetween(b, a));
    svg.appendChild(p);
    setTimeout(function () { p.remove(); }, 620);
  }

  /* 選取後拉一條虛線跟著手指／滑鼠 */
  var liveWire = null;
  function updateLive(x, y) {
    if (!G.sel) return;
    var svg = $('wires');
    if (!liveWire) {
      liveWire = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      liveWire.setAttribute('class', 'wire live');
      svg.appendChild(liveWire);
    }
    var b = $('board').getBoundingClientRect();
    var a = dotPos(G.sel.el, G.sel.side);
    var p = { x: x - b.left, y: y - b.top };
    liveWire.setAttribute('d', G.sel.side === 'L' ? pathBetween(a, p) : pathBetween(p, a));
  }
  function clearLive() {
    if (liveWire) { liveWire.remove(); liveWire = null; }
  }

  /* ---- 連線判定 ---- */
  function activate(el) {
    if (G.busy) return;
    if (el.classList.contains('matched')) return;
    var side = el.dataset.side, idx = Number(el.dataset.idx);

    if (!G.sel) {
      G.sel = { side: side, idx: idx, el: el };
      el.classList.add('sel');
      U.Sound.pick();
      U.vibrate(10);
      return;
    }

    if (G.sel.el === el) {                     // 再點一次 = 取消
      el.classList.remove('sel'); G.sel = null; clearLive(); return;
    }

    if (G.sel.side === side) {                 // 同一欄 = 改選
      G.sel.el.classList.remove('sel');
      G.sel = { side: side, idx: idx, el: el };
      el.classList.add('sel');
      U.Sound.pick();
      return;
    }

    var a = G.sel, b = { side: side, idx: idx, el: el };
    clearLive();
    a.el.classList.remove('sel');
    G.sel = null;

    var word = G.deck.picked[a.idx];
    if (a.idx === b.idx) {
      a.el.classList.add('matched'); b.el.classList.add('matched');
      a.el.disabled = true; b.el.disabled = true;
      wires.push({ idx: a.idx });
      drawWires();
      G.matched++;
      G.log.push({ w: word, ok: true });
      var gained = Store.correct(word.w);
      refreshCoins(true);
      U.Sound.good();
      U.vibrate(25);
      if (gained > 0) { G.roundCoins += gained; coinPop(gained); }
      updateHud();
      sendProgress();
      if (G.matched >= G.pairs) finishRound();
    } else {
      flashWire(a.el, a.side, b.el, b.side);
      [a.el, b.el].forEach(function (n) {
        n.classList.add('shake');
        setTimeout(function () { n.classList.remove('shake'); }, 400);
      });
      G.wrong++;
      G.log.push({ w: word, ok: false, chose: G.deck.picked[b.idx] });
      Store.wrong(word.w);
      U.Sound.bad();
      U.vibrate([15, 40, 15]);
      updateHud();
      sendProgress();
    }
  }

  function updateHud() {
    $('hud-matched').textContent = G.matched + '/' + G.pairs;
    $('hud-wrong').textContent = G.wrong;
    $('hud-streak').textContent = Store.get().streak;
  }

  function tick() {
    $('hud-time').textContent = ((Date.now() - G.started) / 1000).toFixed(1);
  }

  /* ===================== 回合流程 ===================== */

  function startRound(seed) {
    var s = Store.settings();
    G.pairs = s.pairs;
    G.cats = s.cats.slice();
    G.seed = seed || U.randomSeed();
    G.deck = buildDeck(G.seed, G.pairs, G.cats);
    G.matched = 0; G.wrong = 0; G.sel = null; G.roundCoins = 0;
    G.log = []; G.busy = false;
    wires = [];
    if (G.opp) { G.opp.matched = 0; G.opp.wrong = 0; G.opp.done = false; }

    renderBoard();
    updateHud();
    $('hud-time').textContent = '0.0';
    $('versus').hidden = (G.mode === 'solo' || !G.opp);
    if (G.opp) {
      $('vs-name').textContent = G.opp.name || '對手';
      $('vs-fill').style.width = '0%';
      $('vs-num').textContent = '0/' + G.pairs;
    }
    $('play-tip').textContent = Store.settings().doubleClick
      ? '雙擊左邊英文 → 再雙擊右邊中文'
      : '點一下左邊英文 → 再點一下右邊中文';

    G.started = Date.now();
    clearInterval(G.timer);
    G.timer = setInterval(tick, 100);
    show('play');
  }

  function finishRound() {
    clearInterval(G.timer);
    G.busy = true;
    var ms = Date.now() - G.started;
    Store.finishRound(ms);
    U.Sound.win();
    send({ t: 'done', ms: ms, matched: G.matched, wrong: G.wrong });
    showResult(ms);
  }

  function showResult(ms) {
    var title = '完成！';
    if (G.mode !== 'solo' && G.opp) {
      if (G.opp.done && G.opp.ms < ms) title = '這局輸了，再接再厲 💪';
      else if (G.opp.done) title = '你贏了！🏆';
      else title = '你先完成了！🏆 等對手…';
    }
    $('result-title').textContent = title;
    $('res-time').textContent = U.fmtTime(ms);
    $('res-correct').textContent = G.matched;
    $('res-wrong').textContent = G.wrong;
    $('res-coins').textContent = G.roundCoins;

    var ul = $('review');
    ul.innerHTML = '';
    G.deck.picked.forEach(function (w) {
      var missed = G.log.some(function (l) { return !l.ok && l.w.w === w.w; });
      var li = document.createElement('li');
      var en = document.createElement('span'); en.className = 'en'; en.textContent = w.w;
      var zh = document.createElement('span'); zh.className = 'zh'; zh.textContent = '　' + w.p + ' ' + w.z;
      var ex = document.createElement('span'); ex.className = 'ex'; ex.textContent = w.ex;
      if (missed) { li.classList.add('bad'); en.textContent = '⚠️ ' + w.w; }
      li.appendChild(en); li.appendChild(zh); li.appendChild(ex);
      ul.appendChild(li);
    });
    refreshCoins();
    show('result');
  }

  function hint() {
    var left = G.deck.picked.map(function (_, i) { return i; }).filter(function (i) {
      return !wires.some(function (w) { return w.idx === i; });
    });
    if (!left.length) return;
    var idx = left[Math.floor(Math.random() * left.length)];
    [tileFor('L', idx), tileFor('R', idx)].forEach(function (n) {
      if (!n) return;
      n.classList.add('hinted');
      setTimeout(function () { n.classList.remove('hinted'); }, 2100);
    });
    G.wrong++;
    Store.wrong(null);
    updateHud();
    toast('提示用掉了，記 1 次失誤');
  }

  /* ===================== 連線對戰 ===================== */

  function send(obj) { if (link && link.opened) link.send(obj); }

  function sendProgress() {
    send({ t: 'prog', matched: G.matched, wrong: G.wrong });
  }

  function renderOpp() {
    if (!G.opp) return;
    $('versus').hidden = false;
    $('vs-name').textContent = (G.opp.name || '對手') + (G.opp.done ? '（已完成）' : '');
    $('vs-fill').style.width = Math.round(100 * G.opp.matched / Math.max(1, G.pairs)) + '%';
    $('vs-num').textContent = G.opp.matched + '/' + G.pairs;
  }

  function linkStatus(msg, kind) {
    var el = $('link-status');
    el.textContent = msg;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  /* 依目前連線狀況重畫狀態列與「開始對戰」按鈕 */
  function refreshLinkUI() {
    if (!link || !link.opened) return;
    if (G.opp && G.opp.name) {
      linkStatus('已連線：' + G.opp.name + (amHost ? '（由你開始）' : '（等對方開始）'), 'ok');
      $('btn-link-start').disabled = !amHost;
      $('btn-link-start').textContent = amHost ? '開始對戰' : '等待對方開始…';
    } else {
      linkStatus('已連線！正在交換資料…', 'ok');
    }
  }

  function attachLink(l) {
    detachLink();
    link = l;
    l.on('status', function (m) { if (!l.opened) linkStatus(m); });
    l.on('open', function () {
      G.opp = G.opp || { name: '', matched: 0, wrong: 0, done: false, ms: 0 };
      send({ t: 'hello', name: Store.get().name || '對手', id: myId });
      refreshLinkUI();
      U.Sound.good();
    });
    l.on('close', function (why) {
      linkStatus(why || '連線已結束', 'err');
      toast(why || '連線已結束', 'err');
      $('btn-link-start').disabled = true;
      G.opp = null;
      $('versus').hidden = true;
    });
    l.on('message', function (m) {
      if (!m || !m.t) return;
      if (m.t === 'hello') {
        G.opp = G.opp || { matched: 0, wrong: 0, done: false, ms: 0 };
        G.opp.name = m.name || '對手';
        amHost = myId > m.id;
        refreshLinkUI();
        return;
      }
      if (m.t === 'start') {
        Store.set({ settings: { pairs: m.pairs, cats: m.cats || [] } });
        syncSettingsUI();
        startRound(m.seed);
        return;
      }
      if (m.t === 'prog') {
        if (!G.opp) return;
        G.opp.matched = m.matched; G.opp.wrong = m.wrong;
        renderOpp();
        return;
      }
      if (m.t === 'done') {
        if (!G.opp) return;
        G.opp.done = true; G.opp.ms = m.ms; G.opp.matched = m.matched;
        renderOpp();
        if (G.matched >= G.pairs) showResult(Date.now() - G.started);
        else toast((G.opp.name || '對手') + ' 已經完成了！', 'err');
        return;
      }
    });
  }

  function detachLink() {
    if (link) { try { link.close(); } catch (e) {} }
    link = null;
    G.opp = null;
  }

  function hostStartMatch() {
    var s = Store.settings();
    var seed = U.randomSeed();
    send({ t: 'start', seed: seed, pairs: s.pairs, cats: s.cats });
    startRound(seed);
  }

  /* ===================== 首頁設定 UI ===================== */

  function syncSettingsUI() {
    var s = Store.settings();
    Array.prototype.forEach.call($('pairs-chips').children, function (b) {
      b.classList.toggle('on', Number(b.dataset.pairs) === s.pairs);
    });
    Array.prototype.forEach.call($('cat-chips').children, function (b) {
      b.classList.toggle('on', s.cats.indexOf(b.dataset.cat) >= 0);
    });
    $('set-double').checked = !!s.doubleClick;
    $('set-sound').checked = !!s.sound;
    $('set-haptics').checked = !!s.haptics;
    $('set-light').checked = s.theme === 'light';
    $('set-name').value = Store.get().name || '';
  }

  function buildCatChips() {
    var box = $('cat-chips');
    box.innerHTML = '';
    CATEGORIES.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.dataset.cat = c.id;
      b.textContent = c.icon + ' ' + c.name;
      b.addEventListener('click', function () {
        var cats = Store.settings().cats.slice();
        var i = cats.indexOf(c.id);
        if (i >= 0) cats.splice(i, 1); else cats.push(c.id);
        var pool = WORDS.filter(function (w) { return !cats.length || cats.indexOf(w.c) >= 0; });
        if (cats.length && pool.length < Store.settings().pairs) {
          toast('這些主題的單字不夠出題，已保留原設定');
          return;
        }
        Store.setSetting('cats', cats);
        syncSettingsUI();
      });
      box.appendChild(b);
    });
  }

  function renderStats() {
    var s = Store.get();
    $('st-coins').textContent = s.coins;
    $('st-correct').textContent = s.totalCorrect;
    $('st-wrong').textContent = s.totalWrong;
    $('st-rounds').textContent = s.rounds;
    $('st-streak').textContent = s.bestStreak;
    $('st-best').textContent = U.fmtTime(s.bestTime);

    var weak = Object.keys(s.learned)
      .map(function (k) { return { w: k, ng: s.learned[k].ng || 0, ok: s.learned[k].ok || 0 }; })
      .filter(function (x) { return x.ng > 0; })
      .sort(function (a, b) { return b.ng - a.ng; })
      .slice(0, 12);
    var ul = $('weak-list');
    ul.innerHTML = '';
    if (!weak.length) {
      ul.innerHTML = '<li class="muted">還沒有資料，先玩幾局吧！</li>';
    } else {
      weak.forEach(function (x) {
        var found = WORDS.filter(function (w) { return w.w === x.w; })[0];
        var li = document.createElement('li');
        var en = document.createElement('span'); en.className = 'en'; en.textContent = x.w;
        var zh = document.createElement('span'); zh.className = 'zh';
        zh.textContent = '　' + (found ? found.z : '') + '　錯 ' + x.ng + ' 次';
        li.appendChild(en); li.appendChild(zh);
        if (found) {
          var ex = document.createElement('span'); ex.className = 'ex'; ex.textContent = found.ex;
          li.appendChild(ex);
        }
        ul.appendChild(li);
      });
    }
    $('export-code').value = Store.exportCode();
  }

  /* ===================== 事件綁定 ===================== */

  function wire() {
    $('word-total').textContent = WORDS.length;

    $('btn-home').addEventListener('click', function () { detachLink(); clearInterval(G.timer); show('home'); });
    $('btn-stats').addEventListener('click', function () { renderStats(); show('stats'); });
    $('btn-settings').addEventListener('click', function () { syncSettingsUI(); show('settings'); });
    $('btn-stats-back').addEventListener('click', function () { show('home'); });
    $('btn-settings-back').addEventListener('click', function () { show('home'); });
    $('coin-box').addEventListener('click', function () { renderStats(); show('stats'); });

    // 模式
    Array.prototype.forEach.call(document.querySelectorAll('.mode-card'), function (card) {
      card.addEventListener('click', function () {
        var mode = card.dataset.mode;
        G.mode = mode;
        if (mode === 'solo') { detachLink(); startRound(); return; }
        openLinkScreen(mode);
      });
    });

    // 題數
    Array.prototype.forEach.call($('pairs-chips').children, function (b) {
      b.addEventListener('click', function () {
        Store.setSetting('pairs', Number(b.dataset.pairs));
        syncSettingsUI();
      });
    });

    // 遊戲中
    $('btn-quit').addEventListener('click', function () {
      clearInterval(G.timer);
      if (G.matched > 0) showResult(Date.now() - G.started);
      else show('home');
    });
    $('btn-hint').addEventListener('click', hint);
    $('btn-again').addEventListener('click', function () {
      if (G.mode !== 'solo' && link && link.opened) {
        if (amHost) hostStartMatch();
        else toast('等對方開始下一局…');
        return;
      }
      startRound();
    });
    $('btn-back-home').addEventListener('click', function () { show('home'); });

    // 滑鼠／手指移動時的預覽線
    var board = $('board');
    board.addEventListener('pointermove', function (e) { updateLive(e.clientX, e.clientY); });
    board.addEventListener('pointerleave', clearLive);

    global.addEventListener('resize', drawWires);
    if (global.ResizeObserver) new ResizeObserver(drawWires).observe(board);

    /* ---- 設定 ---- */
    $('set-double').addEventListener('change', function () { Store.setSetting('doubleClick', this.checked); });
    $('set-sound').addEventListener('change', function () { Store.setSetting('sound', this.checked); });
    $('set-haptics').addEventListener('change', function () { Store.setSetting('haptics', this.checked); });
    $('set-light').addEventListener('change', function () {
      Store.setSetting('theme', this.checked ? 'light' : 'dark');
      applyTheme();
    });
    $('set-name').addEventListener('change', function () { Store.set({ name: this.value.trim() }); });
    $('btn-reset').addEventListener('click', function () {
      if (global.confirm('確定要清除所有進度與單詞幣嗎？此動作無法復原。')) {
        Store.reset(); applyTheme(); syncSettingsUI(); refreshCoins(); renderStats();
        toast('已清除');
      }
    });

    /* ---- 進度搬移 ---- */
    $('btn-export-copy').addEventListener('click', function () {
      copyText($('export-code').value).then(function () { toast('已複製，貼到另一台裝置匯入', 'ok'); },
        function () { $('export-code').select(); toast('請長按選取後複製'); });
    });
    $('btn-import').addEventListener('click', function () {
      try {
        Store.importCode($('import-code').value);
        applyTheme(); syncSettingsUI(); refreshCoins(true); renderStats();
        $('import-code').value = '';
        toast('進度已合併匯入', 'ok');
      } catch (e) {
        toast('匯入失敗：' + e.message, 'err');
      }
    });

    wireLinkScreen();
  }

  /* ===================== 連線畫面 ===================== */

  function openLinkScreen(mode) {
    detachLink();
    $('link-local').hidden = (mode !== 'local');
    $('link-peer').hidden = (mode !== 'peer');
    $('link-title').textContent = '連線對戰';
    $('peer-steps').hidden = true;
    $('code-out').value = '';
    $('code-in').value = '';
    $('btn-link-start').disabled = true;
    $('btn-link-start').textContent = '開始對戰';
    if (mode === 'local') {
      if (!PET_NET.supportsLocal()) { toast('這個瀏覽器不支援同裝置連線', 'err'); return; }
      if (!$('room-input').value) $('room-input').value = U.roomCode();
      linkStatus('輸入同一個房號，兩邊都按「開始連線」');
    } else {
      if (!PET_NET.supportsPeer()) { toast('這個瀏覽器不支援 WebRTC 連線', 'err'); return; }
      linkStatus('選擇你是主持人還是加入者');
    }
    show('link');
  }

  var peerRole = null;   // 'host' | 'join'

  function wireLinkScreen() {
    $('btn-room-random').addEventListener('click', function () { $('room-input').value = U.roomCode(); });
    $('btn-room-copy').addEventListener('click', function () {
      copyText($('room-input').value).then(function () { toast('房號已複製', 'ok'); }, function () { toast('複製失敗'); });
    });

    $('btn-local-connect').addEventListener('click', function () {
      var room = ($('room-input').value || '').trim().toUpperCase();
      if (room.length < 3) { toast('房號至少 3 個字元', 'err'); return; }
      $('room-input').value = room;
      var l = PET_NET.local();
      attachLink(l);
      l.start(room, true);
      linkStatus('等待另一個視窗加入房號 ' + room + '…');
    });

    $('btn-peer-host').addEventListener('click', function () {
      peerRole = 'host';
      var l = PET_NET.peer();
      attachLink(l);
      $('peer-steps').hidden = false;
      $('out-label').textContent = '① 把這段「邀請碼」傳給對方';
      $('in-label').textContent = '② 貼上對方傳回的「回應碼」';
      $('code-out').value = '產生中，請稍候…';
      linkStatus('正在產生邀請碼…');
      l.createOffer().then(function (code) {
        $('code-out').value = code;
        linkStatus('邀請碼好了，傳給對方吧');
      }, function (e) {
        $('code-out').value = '';
        linkStatus('產生失敗：' + e.message, 'err');
      });
    });

    $('btn-peer-join').addEventListener('click', function () {
      peerRole = 'join';
      var l = PET_NET.peer();
      attachLink(l);
      $('peer-steps').hidden = false;
      $('in-label').textContent = '① 貼上對方給你的「邀請碼」，然後按下方按鈕';
      $('out-label').textContent = '② 把產生的「回應碼」傳回給對方';
      $('code-out').value = '';
      $('code-out').placeholder = '送出邀請碼後，這裡會出現回應碼';
      linkStatus('等你貼上邀請碼');
    });

    $('btn-copy-code').addEventListener('click', function () {
      copyText($('code-out').value).then(function () { toast('代碼已複製', 'ok'); },
        function () { $('code-out').select(); toast('請長按選取後複製'); });
    });

    $('btn-share-code').addEventListener('click', function () {
      var text = $('code-out').value;
      if (!text) { toast('還沒有代碼'); return; }
      if (global.navigator.share) {
        global.navigator.share({ title: 'PET 單詞連線', text: text }).catch(function () {});
      } else {
        copyText(text).then(function () { toast('已複製，貼給對方即可', 'ok'); }, function () { toast('複製失敗'); });
      }
    });

    $('btn-code-submit').addEventListener('click', function () {
      var code = ($('code-in').value || '').trim();
      if (!code) { toast('請先貼上代碼', 'err'); return; }
      if (!link) { toast('請先選擇主持人或加入者', 'err'); return; }
      if (peerRole === 'join') {
        linkStatus('處理中…');
        link.acceptOffer(code).then(function (answer) {
          $('code-out').value = answer;
          linkStatus('回應碼好了，傳回給對方，連上就會自動開始');
        }, function (e) { linkStatus('失敗：' + e.message, 'err'); });
      } else {
        linkStatus('處理中…');
        link.acceptAnswer(code).then(function () {
          linkStatus('已送出，正在建立連線…');
        }, function (e) { linkStatus('失敗：' + e.message, 'err'); });
      }
    });

    $('btn-link-cancel').addEventListener('click', function () { detachLink(); show('home'); });
    $('btn-link-start').addEventListener('click', function () {
      if (!link || !link.opened) { toast('還沒連上', 'err'); return; }
      hostStartMatch();
    });
  }

  /* ===================== 啟動 ===================== */

  function boot() {
    applyTheme();
    buildCatChips();
    syncSettingsUI();
    refreshCoins();
    wire();
    Store.onChange(function () { refreshCoins(); });

    // PWA：用 http/https 開啟時註冊，之後完全離線也能玩
    if ('serviceWorker' in global.navigator && location.protocol.indexOf('http') === 0) {
      global.navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(this);
