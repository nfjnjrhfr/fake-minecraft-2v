/* 連線層：兩種對戰方式
   1) 同裝置連線（local）— 用 BroadcastChannel / localStorage，完全不需要網路。
      同一台裝置開兩個視窗、兩個分頁，或手機分割畫面都能互連。
   2) 跨裝置連線（peer）— WebRTC DataChannel，用「邀請碼 / 回應碼」手動交換，
      不需要我們自己的伺服器。有網路時走 STUN；同一個 Wi-Fi 下即使沒有外網也常能直連。 */
(function (global) {
  'use strict';

  var STUN = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ];

  function Emitter() { this._h = {}; }
  Emitter.prototype.on = function (ev, fn) {
    (this._h[ev] = this._h[ev] || []).push(fn); return this;
  };
  Emitter.prototype.emit = function (ev, a, b) {
    (this._h[ev] || []).forEach(function (fn) { fn(a, b); });
  };

  /* ---------- 壓縮（讓邀請碼短一點；瀏覽器不支援時自動退回純 base64） ---------- */
  function pack(obj) {
    var json = JSON.stringify(obj);
    if (!global.CompressionStream) return Promise.resolve('R' + PET_UTIL.b64encode(json));
    try {
      var cs = new global.CompressionStream('deflate-raw');
      var stream = new Blob([json]).stream().pipeThrough(cs);
      return new Response(stream).arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf), bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return 'Z' + global.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }).catch(function () { return 'R' + PET_UTIL.b64encode(json); });
    } catch (e) {
      return Promise.resolve('R' + PET_UTIL.b64encode(json));
    }
  }

  function unpack(code) {
    code = String(code || '').replace(/\s+/g, '');
    var tag = code[0], body = code.slice(1);
    if (tag === 'R') return Promise.resolve(JSON.parse(PET_UTIL.b64decode(body)));
    if (tag !== 'Z') return Promise.reject(new Error('代碼格式不正確'));
    var s = body.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = global.atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var ds = new global.DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).text().then(JSON.parse);
  }

  /* ---------- 同裝置連線（零網路） ---------- */
  function LocalLink() {
    Emitter.call(this);
    this.kind = 'local';
    this.room = '';
    this.isHost = false;
    this.opened = false;
    this._bc = null;
    this._onStorage = null;
    this._me = PET_UTIL.roomCode() + Date.now().toString(36);
    this._seq = 0;
  }
  LocalLink.prototype = Object.create(Emitter.prototype);

  LocalLink.prototype._channel = function () {
    var self = this, name = 'pet-word-game/' + this.room;
    if (global.BroadcastChannel) {
      this._bc = new global.BroadcastChannel(name);
      this._bc.onmessage = function (e) { self._recv(e.data); };
      return 'BroadcastChannel';
    }
    // 後備：localStorage 事件（同樣不經過網路）
    this._key = 'pet-net/' + this.room;
    this._onStorage = function (e) {
      if (e.key !== self._key || !e.newValue) return;
      var env = null;
      try { env = JSON.parse(e.newValue); } catch (err) { return; }
      if (env && env.from !== self._me) self._recv(env.data);
    };
    global.addEventListener('storage', this._onStorage);
    return 'localStorage';
  };

  LocalLink.prototype._recv = function (data) {
    if (!data) return;
    if (data.__sys === 'hello') {
      if (!this.opened) { this.opened = true; this.emit('open'); }
      this._raw({ __sys: 'hi' });
      return;
    }
    if (data.__sys === 'hi') {
      if (!this.opened) { this.opened = true; this.emit('open'); }
      return;
    }
    if (data.__sys === 'bye') { this.emit('close', '對方離開了'); return; }
    this.emit('message', data);
  };

  LocalLink.prototype._raw = function (data) {
    if (this._bc) { this._bc.postMessage(data); return; }
    try {
      global.localStorage.setItem(this._key, JSON.stringify({ from: this._me, seq: ++this._seq, data: data }));
    } catch (e) {}
  };

  LocalLink.prototype.start = function (room, asHost) {
    this.room = (room || 'LOCAL').toUpperCase();
    this.isHost = !!asHost;
    var how = this._channel();
    this.emit('status', '同裝置連線已開啟（' + how + '）；房號 ' + this.room);
    this._raw({ __sys: 'hello' });
    var self = this;
    this._ping = setInterval(function () { if (!self.opened) self._raw({ __sys: 'hello' }); }, 1200);
    setTimeout(function () { clearInterval(self._ping); }, 60000);
    return Promise.resolve();
  };

  LocalLink.prototype.send = function (obj) { this._raw(obj); };

  LocalLink.prototype.close = function () {
    clearInterval(this._ping);
    try { this._raw({ __sys: 'bye' }); } catch (e) {}
    if (this._bc) { try { this._bc.close(); } catch (e) {} this._bc = null; }
    if (this._onStorage) global.removeEventListener('storage', this._onStorage);
    this.opened = false;
  };

  /* ---------- 跨裝置連線（WebRTC，無自建伺服器） ---------- */
  function PeerLink() {
    Emitter.call(this);
    this.kind = 'peer';
    this.isHost = false;
    this.opened = false;
    this.pc = null;
    this.dc = null;
  }
  PeerLink.prototype = Object.create(Emitter.prototype);

  PeerLink.prototype._newPC = function () {
    var self = this;
    var pc = new (global.RTCPeerConnection || global.webkitRTCPeerConnection)({ iceServers: STUN });
    pc.oniceconnectionstatechange = function () {
      self.emit('status', '連線狀態：' + pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        self.emit('close', '連線中斷');
      }
    };
    this.pc = pc;
    return pc;
  };

  PeerLink.prototype._bindChannel = function (dc) {
    var self = this;
    this.dc = dc;
    dc.onopen = function () { self.opened = true; self.emit('open'); };
    dc.onclose = function () { self.opened = false; self.emit('close', '對方離開了'); };
    dc.onmessage = function (e) {
      var data = null;
      try { data = JSON.parse(e.data); } catch (err) { return; }
      self.emit('message', data);
    };
  };

  /* 等 ICE 蒐集完成（最多 4 秒，之後用目前已有的候選）*/
  PeerLink.prototype._gathered = function () {
    var pc = this.pc;
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') return resolve();
      var done = false;
      function finish() { if (!done) { done = true; resolve(); } }
      pc.onicegatheringstatechange = function () {
        if (pc.iceGatheringState === 'complete') finish();
      };
      setTimeout(finish, 4000);
    });
  };

  /* 主持人：產生邀請碼 */
  PeerLink.prototype.createOffer = function () {
    var self = this;
    this.isHost = true;
    var pc = this._newPC();
    this._bindChannel(pc.createDataChannel('pet', { ordered: true }));
    return pc.createOffer()
      .then(function (o) { return pc.setLocalDescription(o); })
      .then(function () { return self._gathered(); })
      .then(function () { return pack({ t: 'offer', sdp: pc.localDescription.sdp }); });
  };

  /* 加入者：吃下邀請碼，吐出回應碼 */
  PeerLink.prototype.acceptOffer = function (code) {
    var self = this;
    this.isHost = false;
    var pc = this._newPC();
    pc.ondatachannel = function (e) { self._bindChannel(e.channel); };
    return unpack(code).then(function (msg) {
      if (!msg || msg.t !== 'offer') throw new Error('這不是邀請碼');
      return pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    })
      .then(function () { return pc.createAnswer(); })
      .then(function (a) { return pc.setLocalDescription(a); })
      .then(function () { return self._gathered(); })
      .then(function () { return pack({ t: 'answer', sdp: pc.localDescription.sdp }); });
  };

  /* 主持人：貼回回應碼，連線完成 */
  PeerLink.prototype.acceptAnswer = function (code) {
    var self = this;
    return unpack(code).then(function (msg) {
      if (!msg || msg.t !== 'answer') throw new Error('這不是回應碼');
      return self.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    });
  };

  PeerLink.prototype.send = function (obj) {
    if (this.dc && this.dc.readyState === 'open') {
      try { this.dc.send(JSON.stringify(obj)); } catch (e) {}
    }
  };

  PeerLink.prototype.close = function () {
    if (this.dc) { try { this.dc.close(); } catch (e) {} }
    if (this.pc) { try { this.pc.close(); } catch (e) {} }
    this.dc = this.pc = null;
    this.opened = false;
  };

  global.PET_NET = {
    local: function () { return new LocalLink(); },
    peer: function () { return new PeerLink(); },
    supportsPeer: function () { return !!(global.RTCPeerConnection || global.webkitRTCPeerConnection); },
    supportsLocal: function () { return !!(global.BroadcastChannel || global.localStorage); }
  };
})(this);
