import { describe, expect, it } from 'vitest'
import {
  createWidgetStorage, STORAGE_KEY_MAX_CHARS, STORAGE_SCOPE_MAX_CHARS, STORAGE_SESSION_MAX_CHARS,
  STORAGE_VALUE_MAX_CHARS, widgetStorageScope, type StorageBackend,
} from '../src/client/widget-storage.ts'

/** Fresh Map-backed backend; length/key mirror the Storage surface. */
function backend(): StorageBackend {
  const entries = new Map<string, string>()
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value) },
    removeItem: key => { entries.delete(key) },
    key: index => [...entries.keys()][index] ?? null,
    get length(): number { return entries.size },
  }
}

describe('widget storage', () => {
  it('round-trips a value and names the key on a missing get', () => {
    const store = createWidgetStorage('s1', backend())
    store.set('todos:todo_1', '{"done":true}')
    expect(store.get('todos:todo_1')).toBe('{"done":true}')
    expect(() => { store.get('todos:missing') }).toThrow('no stored value for key "todos:missing"')
  })

  it('isolates scopes sharing one backend', () => {
    const shared = backend()
    createWidgetStorage('Dash', shared).set('counter', '1')
    createWidgetStorage('Other', shared).set('counter', '2')
    expect(createWidgetStorage('Dash', shared).get('counter')).toBe('1')
    expect(createWidgetStorage('Other', shared).get('counter')).toBe('2')
  })

  it('derives the scope from the document title', () => {
    expect(widgetStorageScope(null)).toBe('untitled')
    expect(widgetStorageScope('   ')).toBe('untitled')
    expect(widgetStorageScope('  Q3 dash ')).toBe('Q3 dash')
    const long = 't'.repeat(STORAGE_SCOPE_MAX_CHARS + 10)
    expect(widgetStorageScope(long)).toBe(long.slice(0, STORAGE_SCOPE_MAX_CHARS))
  })

  it('overwrites on set and treats delete as idempotent', () => {
    const store = createWidgetStorage('s1', backend())
    store.set('k', 'a')
    store.set('k', 'b')
    expect(store.get('k')).toBe('b')
    store.delete('k')
    store.delete('k')
    expect(() => { store.get('k') }).toThrow('no stored value')
  })

  it('rejects blank, whitespace-bearing, and over-long keys', () => {
    const store = createWidgetStorage('s1', backend())
    expect(() => { store.get('') }).toThrow('non-empty')
    expect(() => { store.set('has space', 'v') }).toThrow('whitespace')
    const long = 'x'.repeat(STORAGE_KEY_MAX_CHARS + 1)
    expect(() => { store.set(long, 'v') }).toThrow('over the 200-unit limit')
    const exact = 'x'.repeat(STORAGE_KEY_MAX_CHARS)
    store.set(exact, 'v')
    expect(store.get(exact)).toBe('v')
  })

  it('accepts a value at the limit and rejects one unit over', () => {
    const store = createWidgetStorage('s1', backend())
    const exact = 'v'.repeat(STORAGE_VALUE_MAX_CHARS)
    store.set('big', exact)
    expect(store.get('big')).toBe(exact)
    expect(() => { store.set('big', exact + 'v') }).toThrow('over the 65536-unit limit')
  })

  it('caps the whole scope and keeps earlier values readable', () => {
    const store = createWidgetStorage('Dash', backend())
    // Three values at the per-value limit leave 65533 units of headroom.
    for (let index = 0; index < 3; index++) store.set(`k${index}`, 'v'.repeat(STORAGE_VALUE_MAX_CHARS))
    expect(() => { store.set('big', 'x'.repeat(STORAGE_VALUE_MAX_CHARS)) }).toThrow('over the 262144-unit limit')
    // A write inside the remaining headroom still lands.
    store.set('big', 'x'.repeat(20_000))
    expect(store.get('big')).toHaveLength(20_000)
    expect(store.get('k2')).toHaveLength(STORAGE_VALUE_MAX_CHARS)
    expect(STORAGE_SESSION_MAX_CHARS).toBe(262_144)
  })

  it('falls back to memory when localStorage access throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      get() { throw new Error('SecurityError') },
      configurable: true,
    })
    try {
      const store = createWidgetStorage('s1')
      store.set('k', 'v')
      expect(store.get('k')).toBe('v')
    } finally {
      if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage
      else Object.defineProperty(globalThis, 'localStorage', original)
    }
  })
})
