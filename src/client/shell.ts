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
 * latest document prefix parsed as inert markup; `commit` reconciles the
 * final document onto the streamed DOM — nodes that are already equal keep
 * their identity, so images, canvases, and scroll positions survive the
 * settle instead of flashing — lifts the streaming freeze, and runs the
 * document's scripts once in document order, awaiting each external script
 * (`src`) load before the next script executes, which is what makes CDN
 * libraries (e.g. Chart.js followed by an inline consumer) work. The freeze
 * strips animations for the whole streaming phase — every replace destroys
 * element identity, which would restart keyframes per tick and bake scrollbar
 * height into reported layout — and keeps overflow hidden while partial.
 * Every content change reports the measured content height back to the host,
 * which sizes the frame to its content instead of a fixed viewport.
 */
const BRIDGE_SCRIPT = `
<script>
(function () {
  var VIEWPORT_ID = 'dsh-gui-viewport';
  var frozen = true;
  function viewport() { return document.getElementById(VIEWPORT_ID); }
  function report() {
    var h = Math.ceil(document.documentElement.scrollHeight);
    try { parent.postMessage({ __dshGui: true, type: 'size', height: h }, '*'); } catch (err) {}
  }
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
    report();
  }
  // Keep identical streamed nodes; replace or append only what changed.
  function reconcile(target, frag) {
    var oldNodes = Array.prototype.slice.call(target.childNodes);
    var newNodes = Array.prototype.slice.call(frag.childNodes);
    for (var i = 0; i < newNodes.length; i++) {
      var existing = oldNodes[i];
      if (existing && existing.nodeType === newNodes[i].nodeType && existing.isEqualNode(newNodes[i])) continue;
      if (existing) target.replaceChild(newNodes[i], existing);
      else target.appendChild(newNodes[i]);
    }
    for (var j = oldNodes.length - 1; j >= newNodes.length; j--) target.removeChild(oldNodes[j]);
  }
  function unfreeze() {
    var vp = viewport();
    if (vp) vp.classList.remove('frozen');
    document.body.classList.remove('frozen');
    frozen = false;
  }
  // Execute in document order; an external script's load (or failure) gates
  // every later script, so a CDN library initializes before its consumer.
  function runScripts() {
    var vp = viewport();
    if (!vp) return;
    var olds = Array.prototype.slice.call(vp.querySelectorAll('script'));
    var chain = Promise.resolve();
    olds.forEach(function (old) {
      chain = chain.then(function () {
        return new Promise(function (res) {
          var s = document.createElement('script');
          for (var i = 0; i < old.attributes.length; i++) s.setAttribute(old.attributes[i].name, old.attributes[i].value);
          s.textContent = old.textContent;
          if (s.getAttribute('src')) { s.onload = res; s.onerror = res; }
          if (old.parentNode) old.parentNode.replaceChild(s, old);
          if (!s.getAttribute('src')) res();
        });
      });
    });
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__dshGui !== true) return;
    if (d.type === 'render') {
      if (frozen) setBody(d.html || '');
    } else if (d.type === 'commit') {
      unfreeze();
      var vp = viewport();
      if (vp) { reconcile(vp, toFragment(d.html || '')); }
      runScripts();
      report();
    }
  });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () { report(); }).observe(document.documentElement);
  }
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
  /* Transparent canvas: the chat background shows through the frame, so an
   * unstyled document reads as inline chat content. A document that paints
   * its own body/html background layers over the transparency by design. */
  html, body { background: transparent; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
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
