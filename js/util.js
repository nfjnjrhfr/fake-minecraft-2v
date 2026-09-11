/* 共用工具：UTF-8 安全的 base64、亂數種子、洗牌、音效、震動 */
(function (global) {
  'use strict';

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return global.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64decode(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = global.atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* mulberry32：同一個 seed 在任何裝置上都產生同一副牌，
     連線對戰時雙方不必傳整副題目，只要傳 seed。 */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function randomSeed() {
    if (global.crypto && global.crypto.getRandomValues) {
      return global.crypto.getRandomValues(new Uint32Array(1))[0];
    }
    return Math.floor(Math.random() * 0xFFFFFFFF);
  }

  function roomCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';
    var buf = (global.crypto && global.crypto.getRandomValues)
      ? global.crypto.getRandomValues(new Uint8Array(5))
      : [0, 0, 0, 0, 0].map(function () { return Math.floor(Math.random() * 256); });
    for (var i = 0; i < 5; i++) out += chars[buf[i] % chars.length];
    return out;
  }

  /* 用 WebAudio 即時合成音效，不需要任何音檔，離線一樣有聲音 */
  var actx = null;
  function tone(freq, ms, type, gain) {
    if (!PET_STORE.settings().sound) return;
    try {
      if (!actx) actx = new (global.AudioContext || global.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.value = 0;
      o.connect(g); g.connect(actx.destination);
      var t = actx.currentTime;
      g.gain.linearRampToValueAtTime(gain == null ? 0.12 : gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      o.start(t); o.stop(t + ms / 1000 + 0.02);
    } catch (e) { /* 音效失敗不影響遊戲 */ }
  }

  var Sound = {
    pick:  function () { tone(660, 90, 'triangle', 0.07); },
    good:  function () { tone(880, 110, 'sine', 0.10); setTimeout(function () { tone(1320, 150, 'sine', 0.09); }, 90); },
    bad:   function () { tone(180, 200, 'sawtooth', 0.07); },
    coin:  function () { tone(1046, 90, 'square', 0.07); setTimeout(function () { tone(1568, 220, 'square', 0.07); }, 85); },
    win:   function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { tone(f, 200, 'triangle', 0.09); }, i * 110); }); }
  };

  function vibrate(pattern) {
    if (!PET_STORE.settings().haptics) return;
    if (global.navigator && global.navigator.vibrate) {
      try { global.navigator.vibrate(pattern); } catch (e) {}
    }
  }

  function fmtTime(ms) {
    if (!ms) return '--';
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    s = s % 60;
    return (m > 0 ? m + ':' + (s < 10 ? '0' : '') + s : s + '.' + Math.floor((ms % 1000) / 100) + ' 秒');
  }

  global.PET_UTIL = {
    b64encode: b64encode,
    b64decode: b64decode,
    rng: rng,
    shuffle: shuffle,
    randomSeed: randomSeed,
    roomCode: roomCode,
    Sound: Sound,
    vibrate: vibrate,
    fmtTime: fmtTime
  };
})(this);
