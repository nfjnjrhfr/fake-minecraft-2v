/**
 * 存储适配器。接口与 localStorage 一致: getItem / setItem / removeItem。
 * 浏览器里直接把 window.localStorage 传进去即可。
 */

/** 内存存储: 进程退出即丢失, 用于测试和 SSR 兜底 */
export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

/**
 * 浏览器存储。localStorage 不可用(隐私模式、被禁用)时自动降级为内存存储。
 */
export function createBrowserStorage() {
  try {
    const probe = '__playtime_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return createMemoryStorage();
  }
}

/**
 * Node 端的文件存储, 用于把进度落到磁盘。
 * @param {string} filePath
 */
export function createFileStorage(filePath) {
  const fs = require_fs();
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return {};
    }
  };
  return {
    getItem(key) {
      const data = read();
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      const data = read();
      data[key] = String(value);
      fs.mkdirSync(dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    },
    removeItem(key) {
      const data = read();
      delete data[key];
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    },
  };
}

// 让本文件在浏览器里也能被打包/直接 import: 只有真正调用 createFileStorage 时才碰 node:fs
function require_fs() {
  // eslint-disable-next-line no-undef
  const mod = globalThis.process?.getBuiltinModule?.('node:fs');
  if (!mod) throw new Error('createFileStorage 只能在 Node.js 环境中使用');
  return mod;
}

function dirname(p) {
  const i = p.replace(/\\/g, '/').lastIndexOf('/');
  return i <= 0 ? '.' : p.slice(0, i);
}
