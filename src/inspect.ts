/**
 * Static document inspection for the `visualizer` tool: the finished HTML
 * is checked for the authoring defects a live preview otherwise reveals
 * only as a broken frame — script syntax errors, duplicate attributes,
 * duplicate element ids, dangling id references, and inline handlers that
 * do not parse. Script bodies are compiled (`new Function`), never
 * executed, so inspection has no side effects and needs no browser.
 * @module dsh-visualizer/inspect
 */

/** One statically detectable defect, located by 1-based document line. */
export interface DocumentIssue {
  /** Line of the offending construct in the source document. */
  readonly line: number
  /** What is wrong, phrased around its fix target. */
  readonly message: string
}

/** Outcome of one inspection pass. */
export interface InspectionResult {
  /** Found defects, ascending by line; empty means the document is clean. */
  readonly issues: readonly DocumentIssue[]
}

/* Script types whose bodies are data or manifests, not executable JS. */
const SCRIPT_SKIP_TYPES = new Set([
  'application/json',
  'importmap',
  'speculationrules',
  'application/ld+json',
])

/* A tag: name plus raw attribute text. Values may contain any non-quote,
 * non-'>' character, so quoted '>' never terminates the tag early. */
const TAG_RE = /<([a-zA-Z][-\w:.]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g
/* One attribute inside tag text: name plus optional value in three forms. */
const ATTR_RE = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
/* An SVG paint reference, `url(#id)`, in style attributes or CSS text. */
const URL_REF_RE = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g

/** Blank HTML comments while preserving newlines, so line numbers of the
 * surviving markup stay identical to the source document. */
function maskComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\n]/g, ' '))
}

/** Blank script bodies, keeping the tags themselves: JavaScript routinely
 * contains `<`-comparisons whose right side reads as a tag name (`i <cfg.rows`
 * parses as `<cfg.rows>`), so an unmasked body feeds the markup scan fake
 * tags — the source of duplicate-attribute false positives that sent the
 * model into pointless re-render loops. Line numbers stay identical. */
function maskScriptBodies(html: string): string {
  return html.replace(
    /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
    (_all, open: string, body: string, close: string) =>
      open + body.replace(/[^\n]/g, ' ') + close,
  )
}

/** 1-based line of one character index. */
function lineAt(html: string, index: number): number {
  let line = 1
  for (let cursor = 0; cursor < index; cursor++) {
    if (html.charCodeAt(cursor) === 10) line++
  }
  return line
}

/**
 * Syntax-check one script body by compiling it without running it.
 * Classic scripts compile directly; module scripts get their import and
 * export statements stripped first because `new Function` parses only
 * classic grammar — top-level await is covered by an async wrapper.
 * @param body - the script's source text.
 * @param isModule - whether the tag carried `type="module"`.
 * @returns the parser's message when the body does not compile, else null.
 */
function checkScriptSyntax(body: string, isModule: boolean): string | null {
  try {
    if (!isModule) {
      new Function(body)
      return null
    }
    let classic = body
      .replace(/^[ \t]*import\s+['"][^'"]*['"];?[ \t]*$/gm, '')
      .replace(/^[ \t]*import[\s\S]*?from\s*['"][^'"]*['"];?[ \t]*$/gm, '')
      .replace(/^[ \t]*export\s+default\s+/gm, '')
      .replace(/^[ \t]*export\s+/gm, '')
    // A multi-line import the stripper could not lift cleanly would turn a
    // valid module into a false syntax error — decline to judge instead.
    if (/^[ \t]*import\b/m.test(classic)) return null
    new Function(`(async () => {\n${classic}\n})`)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'does not parse'
  }
}

/**
 * Inspect one finished visualizer document.
 * @param html - the complete document as the call's `html` argument.
 * @returns the found defects, ascending by line.
 */
export function inspectDocument(html: string): InspectionResult {
  // Comments first, then script bodies: a comment may wrap a script tag, and
  // the body mask must not repair what the comment mask already blanked.
  const masked = maskScriptBodies(maskComments(html))
  const issues: DocumentIssue[] = []
  /** id value to the line of its first definition. */
  const idFirstLine = new Map<string, number>()
  /** id references collected from href attributes and url(#…) paint values. */
  const idRefs: { name: string; line: number }[] = []

  for (const match of masked.matchAll(TAG_RE)) {
    const [raw, name, attrText] = match
    const line = lineAt(masked, match.index ?? 0)
    const tag = name.toLowerCase()

    /** Attribute names seen in this tag, lowercased for comparison. */
    const seen = new Set<string>()
    for (const attr of attrText.matchAll(ATTR_RE)) {
      const attrName = attr[1]!.toLowerCase()
      const value = attr[2] ?? attr[3] ?? attr[4] ?? ''
      if (seen.has(attrName)) {
        issues.push({ line, message: `duplicate attribute "${attr[1]}" on <${tag}>` })
        continue
      }
      seen.add(attrName)

      if (attrName === 'id' && value.length > 0) {
        if (idFirstLine.has(value)) {
          issues.push({ line, message: `duplicate id "${value}" (first defined at line ${idFirstLine.get(value)})` })
        } else {
          idFirstLine.set(value, line)
        }
        continue
      }
      if ((attrName === 'href' || attrName === 'xlink:href') && value.startsWith('#') && value.length > 1) {
        idRefs.push({ name: value.slice(1), line })
        continue
      }
      // Event handlers are classic script; compile-check their bodies.
      if (attrName.length > 2 && attrName.startsWith('on') && tag !== 'script' && value.length > 0) {
        const failure = checkScriptSyntax(value, false)
        if (failure !== null) issues.push({ line, message: `inline ${attr[1]} handler does not parse: ${failure}` })
      }
    }

    if (tag !== 'script') continue
    /** Script tag attributes, lowercased names to bare values. */
    const attrs = new Map<string, string>()
    for (const attr of attrText.matchAll(ATTR_RE)) {
      attrs.set(attr[1]!.toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? '')
    }
    if (attrs.has('src')) continue
    const type = attrs.get('type') ?? ''
    if (SCRIPT_SKIP_TYPES.has(type)) continue
    const bodyStart = (match.index ?? 0) + raw.length
    const close = masked.indexOf('</script', bodyStart)
    // Syntax comes from the ORIGINAL body — masked blanks it. Line numbers
    // agree between the two views, so `line` still points at the tag.
    const body = html.slice(bodyStart, close === -1 ? html.length : close)
    const failure = checkScriptSyntax(body, type === 'module')
    if (failure !== null) issues.push({ line, message: `script does not parse: ${failure}` })
  }

  for (const match of masked.matchAll(URL_REF_RE)) {
    idRefs.push({ name: match[1]!, line: lineAt(masked, match.index ?? 0) })
  }
  for (const ref of idRefs) {
    if (!idFirstLine.has(ref.name)) {
      issues.push({ line: ref.line, message: `references id "${ref.name}" but no element defines it` })
    }
  }

  issues.sort((a, b) => a.line - b.line)
  return { issues }
}
