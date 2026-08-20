/**
 * 闹钟层(浏览器专用)
 *
 * 解决的问题: 你登记完就切到别的 App 去玩了, 30 分钟到了得有人叫你。
 *
 * 三层保险, 从可靠到兜底:
 *   1. 页面还活着(桌面端切到别的窗口、手机上还没被冻结) -> 页面里的 setTimeout 直接弹通知;
 *   2. 页面被关掉但 Service Worker 还没被回收 -> SW 里的定时器弹通知;
 *   3. 上面两层都被系统杀掉了 -> 下次回到页面时立刻"补发"一条, 并且界面上直接是结算好的状态。
 *
 * 说人话: 前两层是尽力而为(手机系统随时可能冻结网页), 第三层一定生效。
 * 想要 100% 准时的后台闹钟, 只能上 Web Push(要服务端) 或者原生 App —— 见 README。
 *
 * 无论闹钟响没响, PlaytimeTimer 的状态永远是对的, 因为它只看时间戳。
 */

const FIRED_PREFIX = 'fake-minecraft:alarm-fired:';

export class AlarmScheduler {
  #storage;
  #swUrl;
  #registration = null;
  #alarms = new Map();      // id -> {id, at, title, body}
  #timers = new Map();      // id -> setTimeout handle
  #sound;

  /**
   * @param {object} [options]
   * @param {Storage} [options.storage]  记录"已经响过"的闹钟, 避免补发时重复打扰
   * @param {string}  [options.swUrl]    Service Worker 路径
   * @param {boolean} [options.sound]    页面可见时是否额外响一声
   */
  constructor({ storage = globalThis.localStorage, swUrl = './sw.js', sound = true } = {}) {
    this.#storage = storage;
    this.#swUrl = swUrl;
    this.#sound = sound;
  }

  /** 浏览器支不支持通知 */
  get supported() {
    return typeof globalThis.Notification !== 'undefined';
  }

  get permission() {
    return this.supported ? globalThis.Notification.permission : 'unsupported';
  }

  /** 注册 Service Worker。失败(不支持 / file:// 打开)时静默降级为只用页面定时器 */
  async init() {
    if (!('serviceWorker' in globalThis.navigator)) return null;
    try {
      this.#registration = await globalThis.navigator.serviceWorker.register(this.#swUrl);
      await globalThis.navigator.serviceWorker.ready;
    } catch {
      this.#registration = null;
    }
    return this.#registration;
  }

  /** 请求通知权限。必须由用户点击触发, 否则浏览器会直接拒绝 */
  async requestPermission() {
    if (!this.supported) return 'unsupported';
    if (globalThis.Notification.permission !== 'default') return globalThis.Notification.permission;
    try {
      return await globalThis.Notification.requestPermission();
    } catch {
      return globalThis.Notification.permission;
    }
  }

  /**
   * 设置闹钟列表(整体替换, 不在列表里的会被取消)。
   * @param {Array<{id:string, at:number, title:string, body:string}>} alarms
   */
  set(alarms) {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#alarms.clear();

    const now = Date.now();
    for (const alarm of alarms) {
      if (!alarm || typeof alarm.at !== 'number') continue;
      this.#alarms.set(alarm.id, alarm);
      const delay = alarm.at - now;
      if (delay <= 0) continue;
      // 第 1 层: 页面里的定时器
      this.#timers.set(alarm.id, setTimeout(() => this.fire(alarm), delay));
    }

    // 第 2 层: 交给 Service Worker 再排一遍
    this.#postToWorker({ type: 'schedule', alarms: [...this.#alarms.values()] });
  }

  /** 全部取消 */
  clear() {
    this.set([]);
  }

  /**
   * 第 3 层: 回到页面时调用, 把在离开期间已经到点、却没能弹出来的闹钟补发掉。
   * @returns {Array<object>} 实际补发的闹钟
   */
  checkMissed(now = Date.now()) {
    const missed = [];
    for (const alarm of this.#alarms.values()) {
      if (alarm.at <= now && !this.#alreadyFired(alarm)) {
        this.fire(alarm);
        missed.push(alarm);
      }
    }
    return missed;
  }

  /** 立刻弹一条通知(带去重, 同一个闹钟只会响一次) */
  fire(alarm) {
    if (this.#alreadyFired(alarm)) return false;
    this.#markFired(alarm);

    const options = {
      body: alarm.body,
      tag: alarm.id,          // 同 tag 的通知会互相替换, 页面和 SW 同时响也只会看到一条
      renotify: false,
      requireInteraction: true,
      icon: './icon.svg',
      badge: './icon.svg',
      vibrate: [200, 100, 200],
    };

    if (this.#registration) {
      // 通过 SW 弹, 手机上才能保留通知
      this.#registration.showNotification(alarm.title, options).catch(() => {});
    } else if (this.permission === 'granted') {
      try {
        new globalThis.Notification(alarm.title, options);
      } catch { /* 部分浏览器只允许 SW 弹通知 */ }
    }

    if (globalThis.document?.visibilityState === 'visible') {
      globalThis.navigator?.vibrate?.([200, 100, 200]);
      if (this.#sound) this.#beep();
    }
    return true;
  }

  // ------------------------------------------------------------------ 内部

  #postToWorker(message) {
    const controller = globalThis.navigator?.serviceWorker?.controller;
    if (controller) controller.postMessage(message);
    else this.#registration?.active?.postMessage(message);
  }

  #firedKey(alarm) {
    return `${FIRED_PREFIX}${alarm.id}`;
  }

  #alreadyFired(alarm) {
    try {
      return Number(this.#storage?.getItem(this.#firedKey(alarm))) === alarm.at;
    } catch {
      return false;
    }
  }

  #markFired(alarm) {
    try {
      this.#storage?.setItem(this.#firedKey(alarm), String(alarm.at));
    } catch { /* 存储不可用就不去重, 顶多同 tag 替换一次 */ }
  }

  /** 一声短促的提示音, 不依赖任何音频文件 */
  #beep() {
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      osc.onended = () => ctx.close().catch(() => {});
    } catch { /* 没有用户交互过的页面不允许播声音, 忽略 */ }
  }
}
