/**
 * Title-scoped key-value store behind the widget bridge's
 * `window.storage`: one namespace per document title, so a widget the model
 * regenerates under the same title keeps its state across calls and across
 * the streaming/settled card halves. Durable in the browser profile when
 * localStorage is reachable and per-mount memory when it is not. String
 * values only; a widget serializes its own structures.
 * @module dsh-visualizer/widget-storage
 */

/** localStorage key prefix; one browser profile holds many scopes. */
const STORE_PREFIX = 'dsh-visualizer:'
/** Longest accepted key, in UTF-16 units. */
export const STORAGE_KEY_MAX_CHARS = 200
/** Longest scope derived from a document title, in UTF-16 units. */
export const STORAGE_SCOPE_MAX_CHARS = 200
/** Longest accepted value, in UTF-16 units. */
export const STORAGE_VALUE_MAX_CHARS = 65_536
/** Most units one scope's keys and values may occupy together. */
export const STORAGE_SESSION_MAX_CHARS = 262_144
/** Scope for a document that carried no explicit title. */
const UNTITLED_SCOPE = 'untitled'

/** The store face the frame bridge drives. */
export interface WidgetStorage {
  /** Read one value.
   * @param key - namespaced key, e.g. `todos:todo_123`.
   * @returns the stored value.
   * @throws when the key is invalid or holds no value — absence is an error
   * a widget catches, never a silent null.
   */
  get(key: string): string
  /** Write one value, replacing any previous.
   * @param key - namespaced key.
   * @param value - the complete next value.
   * @throws when the key or value is invalid or the session is at its cap.
   */
  set(key: string, value: string): void
  /** Remove one key; a missing key is already gone, so the op is idempotent.
   * @param key - namespaced key.
   * @throws when the key is invalid.
   */
  delete(key: string): void
}

/** The Storage surface the store needs; satisfied by localStorage. */
export interface StorageBackend {
  /** Read one entry; null when absent. */
  getItem(key: string): string | null
  /** Write one entry. */
  setItem(key: string, value: string): void
  /** Remove one entry. */
  removeItem(key: string): void
  /** Nth key of the whole backend, for cap accounting. */
  key(index: number): string | null
  /** Entry count of the whole backend. */
  readonly length: number
}

/**
 * Validate one widget key: non-empty, at most
 * {@link STORAGE_KEY_MAX_CHARS} units, no whitespace.
 * @param key - the widget-supplied key.
 * @throws with the failing rule.
 */
function checkKey(key: string): void {
  if (key.length === 0) throw new Error('storage key must be non-empty')
  if (key.length > STORAGE_KEY_MAX_CHARS) {
    throw new Error(`storage key is ${key.length} units, over the ${STORAGE_KEY_MAX_CHARS}-unit limit`)
  }
  if (/\s/.test(key)) throw new Error('storage key must not contain whitespace')
}

/** Map-backed backend for contexts where localStorage is unreachable. */
function memoryBackend(): StorageBackend {
  const entries = new Map<string, string>()
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value) },
    removeItem: key => { entries.delete(key) },
    key: index => [...entries.keys()][index] ?? null,
    get length(): number { return entries.size },
  }
}

/**
 * Resolve the durable backend, falling back to per-mount memory when
 * localStorage is absent or its access throws (private modes, embedders).
 * @returns a backend the store can write through.
 */
function defaultBackend(): StorageBackend {
  try {
    const local = globalThis.localStorage
    if (local !== undefined && local !== null) return local
  } catch {
    // Only localStorage access can throw here; memory keeps the bridge live.
  }
  return memoryBackend()
}

/**
 * Derive the storage scope of one document from its explicit title: absent
 * or blank titles share the `untitled` scope, an over-long title keeps its
 * first {@link STORAGE_SCOPE_MAX_CHARS} units.
 * @param title - the call's explicit `title` argument, or null.
 * @returns the scope its widget storage lives under.
 */
export function widgetStorageScope(title: string | null): string {
  if (title === null) return UNTITLED_SCOPE
  const trimmed = title.trim()
  if (trimmed.length === 0) return UNTITLED_SCOPE
  return trimmed.slice(0, STORAGE_SCOPE_MAX_CHARS)
}

/**
 * Create one document scope's widget store.
 * @param scope - the namespace (see {@link widgetStorageScope}); keys of
 * different scopes never meet.
 * @param backend - durable storage; defaults to localStorage with a
 * memory fallback.
 * @returns the store the bridge answers from.
 */
export function createWidgetStorage(scope: string, backend: StorageBackend = defaultBackend()): WidgetStorage {
  const namespace = `${STORE_PREFIX}${scope}:`
  const full = (key: string): string => namespace + key

  /** Units this scope already occupies across all its keys and values. */
  const usedUnits = (): number => {
    let total = 0
    for (let index = 0; index < backend.length; index++) {
      const stored = backend.key(index)
      if (stored === null || !stored.startsWith(namespace)) continue
      total += stored.length - namespace.length
      total += backend.getItem(stored)?.length ?? 0
    }
    return total
  }

  return {
    get(key: string): string {
      checkKey(key)
      const value = backend.getItem(full(key))
      if (value === null) throw new Error(`no stored value for key "${key}"`)
      return value
    },
    set(key: string, value: string): void {
      checkKey(key)
      if (value.length > STORAGE_VALUE_MAX_CHARS) {
        throw new Error(`storage value is ${value.length} units, over the ${STORAGE_VALUE_MAX_CHARS}-unit limit`)
      }
      const previous = backend.getItem(full(key))?.length ?? 0
      const next = usedUnits() - previous + key.length + value.length
      if (next > STORAGE_SESSION_MAX_CHARS) {
        throw new Error(`this document's stored keys and values would reach ${next} units, over the ${STORAGE_SESSION_MAX_CHARS}-unit limit`)
      }
      backend.setItem(full(key), value)
    },
    delete(key: string): void {
      checkKey(key)
      backend.removeItem(full(key))
    },
  }
}
