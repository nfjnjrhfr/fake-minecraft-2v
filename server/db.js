import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 極簡 JSON 檔案儲存：整份讀進記憶體，寫入時先寫暫存檔再改名，避免寫到一半的殘檔。
 * 這是一台裝置的系統狀態（設定、已安裝 App、備忘錄），資料量很小，不引入外部依賴。
 */
export class Db {
  constructor(
    file = process.env.DB_FILE || path.join(rootDir, 'data', 'device.json'),
    initial = () => ({}),
  ) {
    this.file = file;
    this.initial = initial;
    this.data = initial();
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.data = { ...this.initial(), ...JSON.parse(raw) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.data = this.initial();
      this.save();
    }
    return this.data;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  reset() {
    this.data = this.initial();
    this.save();
  }

  /** 集合操作 */
  all(table) {
    return this.data[table];
  }

  find(table, predicate) {
    return this.data[table].find(predicate);
  }

  filter(table, predicate) {
    return this.data[table].filter(predicate);
  }

  insert(table, row) {
    const record = { id: nextId(this.data[table]), ...row };
    this.data[table].push(record);
    this.save();
    return record;
  }

  update(table, id, patch) {
    const row = this.data[table].find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    this.save();
    return row;
  }

  remove(table, predicate) {
    const before = this.data[table].length;
    this.data[table] = this.data[table].filter((row) => !predicate(row));
    if (this.data[table].length !== before) this.save();
    return before - this.data[table].length;
  }
}

function nextId(rows) {
  return rows.reduce((max, row) => Math.max(max, row.id ?? 0), 0) + 1;
}

export { rootDir };
