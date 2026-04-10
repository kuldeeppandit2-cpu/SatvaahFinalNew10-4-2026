// MMKV stub — in-memory storage for Expo Go simulator testing
const stores: Record<string, Record<string, string>> = {};

export class MMKV {
  private id: string;
  constructor(options?: { id?: string; encryptionKey?: string }) {
    this.id = options?.id ?? 'default';
    if (!stores[this.id]) stores[this.id] = {};
  }
  private get store() { return stores[this.id]; }
  set(key: string, value: string | number | boolean) { this.store[key] = String(value); }
  getString(key: string): string | undefined { return this.store[key]; }
  getNumber(key: string): number { return Number(this.store[key] ?? 0); }
  getBoolean(key: string): boolean { return this.store[key] === 'true'; }
  delete(key: string) { delete this.store[key]; }
  contains(key: string) { return key in this.store; }
  clearAll() { stores[this.id] = {}; }
}
