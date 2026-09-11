/* 本機進度儲存：單詞幣、統計、設定。完全離線，不需要網路。 */
(function (global) {
  'use strict';

  var KEY = 'pet-word-game.v1';
  var CORRECT_PER_COIN = 10;   // 答對 10 個 ⇒ 1 枚 PET 單詞幣

  /* 第一次開啟時跟隨系統的淺色／深色設定，之後以使用者的選擇為準 */
  function prefersLight() {
    try { return global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches; }
    catch (e) { return false; }
  }

  function defaults() {
    return {
      version: 1,
      name: '',
      totalCorrect: 0,
      totalWrong: 0,
      coins: 0,
      rounds: 0,
      bestTime: 0,          // 毫秒，最快完成一輪
      bestStreak: 0,
      streak: 0,
      learned: {},          // word -> {ok: n, ng: n}
      settings: {
        pairs: 5,
        cats: [],           // 空陣列 = 全部主題
        sound: true,
        haptics: true,
        doubleClick: true,  // 雙擊連線（關閉則改為單擊）
        theme: prefersLight() ? 'light' : 'dark'
      }
    };
  }

  function safeParse(raw) {
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  var mem = null;   // localStorage 不可用時的後備（無痕模式等）

  function readRaw() {
    try { return global.localStorage.getItem(KEY); } catch (e) { return mem; }
  }
  function writeRaw(v) {
    try { global.localStorage.setItem(KEY, v); } catch (e) { mem = v; }
  }

  function merge(base, extra) {
    if (!extra || typeof extra !== 'object') return base;
    Object.keys(extra).forEach(function (k) {
      if (k === 'settings') {
        base.settings = merge(base.settings, extra.settings);
      } else if (k in base) {
        base[k] = extra[k];
      }
    });
    return base;
  }

  var state = merge(defaults(), safeParse(readRaw()));

  function save() {
    writeRaw(JSON.stringify(state));
  }

  var listeners = [];
  function emit() { listeners.forEach(function (fn) { fn(state); }); }

  var Store = {
    CORRECT_PER_COIN: CORRECT_PER_COIN,

    get: function () { return state; },
    settings: function () { return state.settings; },

    onChange: function (fn) { listeners.push(fn); },

    set: function (patch) {
      merge(state, patch);
      save(); emit();
    },

    setSetting: function (k, v) {
      state.settings[k] = v;
      save(); emit();
    },

    /* 記錄一次答對；回傳這次新獲得的單詞幣數量 */
    correct: function (word) {
      var before = Math.floor(state.totalCorrect / CORRECT_PER_COIN);
      state.totalCorrect += 1;
      state.streak += 1;
      if (state.streak > state.bestStreak) state.bestStreak = state.streak;
      if (word) {
        var e = state.learned[word] || { ok: 0, ng: 0 };
        e.ok += 1; state.learned[word] = e;
      }
      var after = Math.floor(state.totalCorrect / CORRECT_PER_COIN);
      var gained = after - before;
      if (gained > 0) state.coins += gained;
      save(); emit();
      return gained;
    },

    wrong: function (word) {
      state.totalWrong += 1;
      state.streak = 0;
      if (word) {
        var e = state.learned[word] || { ok: 0, ng: 0 };
        e.ng += 1; state.learned[word] = e;
      }
      save(); emit();
    },

    finishRound: function (ms) {
      state.rounds += 1;
      if (ms > 0 && (state.bestTime === 0 || ms < state.bestTime)) state.bestTime = ms;
      save(); emit();
    },

    /* 距離下一枚單詞幣還差幾題 */
    toNextCoin: function () {
      return CORRECT_PER_COIN - (state.totalCorrect % CORRECT_PER_COIN);
    },
    coinProgress: function () {
      return (state.totalCorrect % CORRECT_PER_COIN) / CORRECT_PER_COIN;
    },

    /* 跨裝置搬移進度：匯出成一段文字 */
    exportCode: function () {
      var json = JSON.stringify(state);
      return 'PET1.' + global.PET_UTIL.b64encode(json);
    },
    importCode: function (code) {
      code = String(code || '').trim();
      if (code.indexOf('PET1.') !== 0) throw new Error('格式不符');
      var json = global.PET_UTIL.b64decode(code.slice(5));
      var data = safeParse(json);
      if (!data) throw new Error('資料損毀');
      // 合併：取兩邊較高的紀錄，避免覆蓋掉本機成績
      var cur = state;
      var next = merge(defaults(), data);
      next.totalCorrect = Math.max(cur.totalCorrect, next.totalCorrect);
      next.totalWrong = Math.max(cur.totalWrong, next.totalWrong);
      next.coins = Math.max(cur.coins, next.coins, Math.floor(next.totalCorrect / CORRECT_PER_COIN));
      next.rounds = Math.max(cur.rounds, next.rounds);
      next.bestStreak = Math.max(cur.bestStreak, next.bestStreak);
      if (cur.bestTime && next.bestTime) next.bestTime = Math.min(cur.bestTime, next.bestTime);
      else next.bestTime = next.bestTime || cur.bestTime;
      state = next;
      save(); emit();
      return state;
    },

    reset: function () {
      state = defaults();
      save(); emit();
    }
  };

  global.PET_STORE = Store;
})(this);
