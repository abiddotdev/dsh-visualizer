/**
 * Compile-time settings-scope face, trimmed from the harness client runtime
 * (see ../README.md): only the members this plugin's transcript-view read
 * needs. The deployed runtime supplies the full implementation through the
 * module table.
 */

/** Client-side sync state of one settings namespace's durable section. */
export interface SettingsScopeSnapshot<T> {
  /** Last accepted schema-resolved section; undefined before the first acceptance. */
  readonly value: T | undefined
}

/** Reactive owner handle over one namespace's durable section. */
export interface SettingsScope<T> {
  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshot<T>
  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
}

/** Domain-owned description of one settings namespace consumed by a browser plugin. */
export interface SettingsScopeSpec<T> {
  /** Settings namespace registered by the owning Host plugin. */
  namespace: string
}

/** Namespace-scope binder, reached through `ctx.settingsScope`. */
export interface SettingsScopeBinder {
  /**
   * Bind one namespace's durable section for reactive reads.
   * @param spec - the namespace to read.
   * @returns the reactive scope handle.
   */
  bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T>
}
