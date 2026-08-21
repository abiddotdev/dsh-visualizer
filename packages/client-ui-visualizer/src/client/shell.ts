/**
 * Shell document of one live streaming card, assigned to the iframe's
 * `srcDoc` exactly once per card. The frame keeps `sandbox="allow-scripts"`
 * without `allow-same-origin`, so it runs at a null origin with no access to
 * the harness page; the `<meta>` CSP confines its network egress to the same
 * public-CDN allowlist the settled card's documents assume. The embedded
 * bridge receives the growing document prefix through `postMessage` and
 * applies it as inert markup — `innerHTML` never executes `<script>`, and
 * event-handler attributes fire only inside the null-origin frame — until
 * one `commit` message swaps in the final document and executes its scripts
 * exactly once by cloning each `<script>` node.
 */

/** CDN allowlist mirrored from the tool's public-CDN allowance. */
const CDN_LIST = [
  'https://esm.sh',
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
].join(' ')

const CSP_DIRECTIVES = [
  "default-src 'unsafe-inline' data:",
  `script-src 'unsafe-inline' ${CDN_LIST}`,
  `style-src 'unsafe-inline' ${CDN_LIST}`,
  `img-src 'self' data: ${CDN_LIST}`,
  `font-src ${CDN_LIST}`,
  `connect-src ${CDN_LIST}`,
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')

/**
 * Bridge injected into the shell. `render` replaces the viewport with the
 * latest document prefix parsed as inert markup; `commit` applies the final
 * document, lifts the streaming freeze, and runs scripts once. The freeze
 * strips animations for the whole streaming phase — every replace destroys
 * element identity, which would restart keyframes per tick and bake scrollbar
 * height into reported layout — and keeps overflow hidden while partial.
 */
const BRIDGE_SCRIPT = `
<script>
(function () {
  var VIEWPORT_ID = 'dsh-gui-viewport';
  var frozen = true;
  function viewport() { return document.getElementById(VIEWPORT_ID); }
  function toFragment(html) {
    var full = /<html[\\s>]/i.test(html) || /<head[\\s>]/i.test(html) || /<body[\\s>]/i.test(html) || /^\\s*<!doctype/i.test(html);
    if (!full) {
      var tpl = document.createElement('template');
      tpl.innerHTML = html;
      return tpl.content;
    }
    var parsed = new DOMParser().parseFromString(html, 'text/html');
    var frag = document.createDocumentFragment();
    if (parsed.head) { while (parsed.head.firstChild) frag.appendChild(parsed.head.firstChild); }
    if (parsed.body) { while (parsed.body.firstChild) frag.appendChild(parsed.body.firstChild); }
    return frag;
  }
  function setBody(html) {
    var vp = viewport();
    if (!vp) return;
    vp.replaceChildren(toFragment(html));
  }
  function unfreeze() {
    var vp = viewport();
    if (vp) vp.classList.remove('frozen');
    document.body.classList.remove('frozen');
    frozen = false;
  }
  function runScripts() {
    var vp = viewport();
    if (!vp) return;
    vp.querySelectorAll('script').forEach(function (old) {
      var s = document.createElement('script');
      for (var i = 0; i < old.attributes.length; i++) s.setAttribute(old.attributes[i].name, old.attributes[i].value);
      s.textContent = old.textContent;
      old.parentNode.replaceChild(s, old);
    });
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__dshGui !== true) return;
    if (d.type === 'render') {
      if (frozen) setBody(d.html || '');
    } else if (d.type === 'commit') {
      unfreeze();
      setBody(d.html || '');
      runScripts();
    }
  });
})();
</script>
`

/** The complete shell document; one constant — the shell never varies per card. */
export const STREAM_SHELL = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP_DIRECTIVES}">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; padding: 12px; }
  body.frozen { overflow: hidden !important; }
  .frozen, .frozen *, .frozen *::before, .frozen *::after {
    animation: none !important;
    transition: none !important;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
    }
  }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  * { scrollbar-width: thin; }
</style>
</head>
<body class="frozen">
  <div id="dsh-gui-viewport" class="frozen"></div>
  ${BRIDGE_SCRIPT}
</body>
</html>`
