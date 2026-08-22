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

/**
 * Network-egress allowlist the shell CSP enforces on every rendered
 * document. The node half validates sizes, not origins, so this list is the
 * only origin policy a document meets: the tool's public-CDN promise is
 * kept here and nowhere else. src/guide/contract.ts names the same four
 * hosts in the prompt prose — the client bundle cannot import the node
 * half, so a change to one list must land on the other. Widening it widens
 * what a rendered document may fetch and execute inside the frame.
 */
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
 *
 * The bridge also exposes `sendPrompt(text)` to the rendered document's
 * scripts: one postMessage to the host, which submits it as a tagged user
 * turn after validation and rate limiting. `openLink(url)` asks the host to
 * open an external link; the host enforces the http(s)-only scheme check.
 * `window.storage` is an async get/set/delete key-value store scoped to the
 * conversation, request/response with a per-call timeout. At boot the shell
 * requests the host's theme tokens and applies every `--dsw-*` variable to
 * its root element, so documents can theme with the host's own tokens; the
 * host re-pushes them when the theme changes. A failed external script load
 * is reported to the host as `scriptError`, which the card surfaces as a
 * load-failure notice.
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
  // A failed external load is reported to the host: the card shows which
  // library never arrived instead of rendering a silently dead document.
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
          if (s.getAttribute('src')) {
            s.onload = res;
            s.onerror = function () {
              try { parent.postMessage({ __dshGui: true, type: 'scriptError', src: s.getAttribute('src') }, '*'); } catch (err) {}
              res();
            };
          }
          if (old.parentNode) old.parentNode.replaceChild(s, old);
          if (!s.getAttribute('src')) res();
        });
      });
    });
  }
  // Host-theme channel: the shell asks once at boot and re-applies whatever
  // the host pushes on later theme changes. Applied to the root element so
  // the document's CSS can use var(--dsw-*) tokens and follow the host theme.
  var appliedTheme = {};
  function applyTheme(vars) {
    var root = document.documentElement;
    for (var name in appliedTheme) {
      if (!(name in vars)) root.style.removeProperty(name);
    }
    appliedTheme = vars || {};
    for (var key in appliedTheme) {
      root.style.setProperty(key, appliedTheme[key]);
    }
  }
  try { parent.postMessage({ __dshGui: true, type: 'theme-request' }, '*'); } catch (err) {}

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
    } else if (d.type === 'theme') {
      applyTheme(d.vars && typeof d.vars === 'object' ? d.vars : {});
    } else if (d.type === 'storage-response') {
      var entry = pendingOps[d.id];
      if (!entry) return;
      clearTimeout(entry.timer);
      delete pendingOps[d.id];
      if (d.ok) entry.resolve(d.value);
      else entry.reject(new Error(d.error || 'storage operation failed'));
    }
  });
  // Widget-facing conversation channel: a rendered document's scripts may
  // ask the agent a follow-up about what they show. Scripts only run after
  // the document completes, so this cannot fire mid-stream; the host
  // validates, rate-limits, and tags what arrives here.
  window.sendPrompt = function (text) {
    try { parent.postMessage({ __dshGui: true, type: 'sendPrompt', text: String(text) }, '*'); } catch (err) {}
  };
  // Widget-facing link channel: the host opens the URL itself, after an
  // http(s)-only scheme check the frame cannot influence.
  window.openLink = function (url) {
    try { parent.postMessage({ __dshGui: true, type: 'openLink', url: String(url) }, '*'); } catch (err) {}
  };
  // Widget-facing key-value store: request/response over postMessage, one
  // pending entry per call with its own timeout. get() rejects on a missing
  // key — absence is an error the widget catches, never a silent null.
  var pendingOps = {};
  var opSeq = 0;
  function storageOp(op, key, value) {
    return new Promise(function (resolve, reject) {
      var id = 'op' + (++opSeq);
      var timer = setTimeout(function () {
        delete pendingOps[id];
        reject(new Error('storage ' + op + ' timed out'));
      }, 10000);
      pendingOps[id] = { resolve: resolve, reject: reject, timer: timer };
      try {
        parent.postMessage({ __dshGui: true, type: 'storage-request', op: op, id: id, key: key, value: value }, '*');
      } catch (err) {
        clearTimeout(timer);
        delete pendingOps[id];
        reject(err);
      }
    });
  }
  window.storage = {
    get: function (key) { return storageOp('get', key); },
    set: function (key, value) { return storageOp('set', key, value); },
    delete: function (key) { return storageOp('delete', key); }
  };
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
