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

import { RENDER_CSP_DIRECTIVES } from '../shared/export-csp.ts'

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
 * which sizes the frame to its content instead of a fixed viewport. A
 * ResizeObserver on the document keeps that measurement live after settle
 * too, guarded against runaway self-feedback (viewport-relative CSS units,
 * a responsive chart resizing to fill an intrinsically-unsized container) by
 * a consecutive-growth streak limit — see `reportFromResize`.
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
 * is reported to the host as `scriptError`, and a throwing script, async
 * error, or unhandled rejection as `runtimeError`; the card surfaces both
 * as notices, so a dead document is labeled instead of silent.
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
  // Resize-driven growth guard: a document whose own size feeds back into
  // its measured height (a 100vh/100dvh container, whose viewport IS this
  // frame's current height, or a "responsive" chart canvas resizing to
  // fill a container with no intrinsic height of its own) can keep growing
  // in lockstep with the auto-sizing this observer drives — every resize
  // triggers a taller measurement, which grows the frame, which grows the
  // viewport-relative content again. Content settling for a real reason
  // (a font swap, an image decoding, one responsive redraw) stops growing
  // within a few ticks; only a genuine feedback loop keeps climbing on every
  // single tick indefinitely, so a run of consecutive same-direction growth
  // ticks is the loop's signature, not its content. Once that streak trips,
  // this stops trusting the observer for the rest of the frame's life —
  // explicit content-driven reports (render/commit/heartbeat) are untouched
  // and keep working normally.
  var RESIZE_GROW_STREAK_LIMIT = 6;
  var resizeGrowStreak = 0;
  var lastResizeHeight = null;
  var resizeUntrusted = false;
  function reportFromResize() {
    if (resizeUntrusted) return;
    var h = Math.ceil(document.documentElement.scrollHeight);
    if (lastResizeHeight !== null && h > lastResizeHeight) {
      resizeGrowStreak++;
      if (resizeGrowStreak > RESIZE_GROW_STREAK_LIMIT) {
        resizeUntrusted = true;
        return;
      }
    } else {
      resizeGrowStreak = 0;
    }
    lastResizeHeight = h;
    report();
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
  // Failures reach the host, not a console nobody opens: a failed external
  // load is reported as scriptError, and a throwing inline script is
  // reported as runtimeError while the chain continues, so one bad script
  // no longer kills every script after it.
  function reportRuntimeError(message, line) {
    try {
      parent.postMessage({
        __dshGui: true, type: 'runtimeError',
        message: String(message).slice(0, 300),
        line: typeof line === 'number' && isFinite(line) ? line : null
      }, '*');
    } catch (err) {}
  }
  window.addEventListener('error', function (e) {
    if (e && e.message) reportRuntimeError(e.message, e.lineno);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e && e.reason;
    reportRuntimeError(reason instanceof Error ? reason.message : String(reason), null);
  });
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
            if (old.parentNode) old.parentNode.replaceChild(s, old);
          } else {
            try {
              if (old.parentNode) old.parentNode.replaceChild(s, old);
            } catch (err) {
              reportRuntimeError(err && err.message ? err.message : String(err), null);
            }
            res();
          }
        });
      }).catch(function (err) {
        reportRuntimeError(err && err.message ? err.message : String(err), null);
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
    } else if (d.type === 'annotate') {
      if (d.on === true) annotateEnter();
      else annotateExit();
    } else if (d.type === 'annotate-marks') {
      if (!annotating) return;
      repaintMarks(Array.isArray(d.ids) ? d.ids : []);
    } else if (d.type === 'storage-response') {
      var entry = pendingOps[d.id];
      if (!entry) return;
      clearTimeout(entry.timer);
      delete pendingOps[d.id];
      if (d.ok) entry.resolve(d.value);
      else entry.reject(new Error(d.error || 'storage operation failed'));
    }
  });
  // Navigation guard: the frame is a null-origin srcdoc whose base URL is
  // inherited from the host, so even a fragment anchor click would navigate
  // the whole host app inside this card. Anchor clicks never navigate:
  // fragment links scroll in place, absolute http(s) links go through the
  // host's openLink gate, everything else is dropped.
  document.addEventListener('click', function (e) {
    var t = e.target;
    var link = t && t.closest ? t.closest('a[href]') : null;
    if (!link) return;
    e.preventDefault();
    var href = link.getAttribute('href');
    if (!href) return;
    if (href.charAt(0) === '#') {
      var id = href.slice(1);
      if (!id) return;
      try { id = decodeURIComponent(id); } catch (err) {}
      var target = document.getElementById(id);
      if (!target || !target.scrollIntoView) return;
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    if (/^https?:\\/\\//i.test(href)) window.openLink(href);
  }, true);
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
  // Comment mode: the host toggles it from the card's row chrome. While on,
  // capture-phase pointer handlers intercept the document — clicks pick the
  // deepest element, drags mark a rectangle — and an overlay layer (outside
  // the document's own DOM, so measurements and layout stay untouched)
  // outlines the hover and the marks. Listeners are installed on mode-on and
  // removed on mode-off: an interactive page runs pristine until the user
  // asks to comment.
  var annotating = false;
  var overlay = null;
  var hoverBox = null;
  var markBoxes = {};
  var pickRects = {};
  var dragBox = null;
  var dragStart = null;
  var pickSeq = 0;
  function ensureOverlay() {
    if (overlay || !document.body) return;
    overlay = document.createElement('div');
    overlay.setAttribute('data-dsh-annotate-overlay', '');
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '0';
    overlay.style.height = '0';
    overlay.style.overflow = 'visible';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483647';
    document.body.appendChild(overlay);
  }
  function boxFor(entry, x, y, w, h, cls) {
    var box = entry;
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('data-dsh-annotate-box', cls);
      var s = box.style;
      s.position = 'absolute';
      s.pointerEvents = 'none';
      s.borderRadius = '3px';
      if (cls === 'hover') {
        s.border = '1px dashed rgba(125, 145, 245, 0.9)';
        s.background = 'rgba(125, 145, 245, 0.08)';
      } else if (cls === 'drag') {
        s.border = '1px dashed rgba(125, 145, 245, 0.7)';
        s.background = 'rgba(125, 145, 245, 0.12)';
      } else {
        s.border = '1.5px solid rgba(245, 92, 60, 0.95)';
        s.background = 'rgba(245, 92, 60, 0.10)';
      }
      overlay.appendChild(box);
    }
    box.style.left = Math.round(x) + 'px';
    box.style.top = Math.round(y) + 'px';
    box.style.width = Math.max(0, Math.round(w)) + 'px';
    box.style.height = Math.max(0, Math.round(h)) + 'px';
    return box;
  }
  // Viewport-fixed rects painted into the absolutely-positioned overlay; a
  // scroll listener repaints marks so they stay glued to content.
  function pageRect(el) {
    var r = el.getBoundingClientRect();
    var left = window.scrollX || 0;
    var top = window.scrollY || 0;
    return { x: r.left + left, y: r.top + top, w: r.width, h: r.height };
  }
  function paintMark(id, rect) {
    pickRects[id] = rect;
    if (!overlay) return;
    markBoxes[id] = boxFor(markBoxes[id], rect.x, rect.y, rect.w, rect.h, 'mark');
  }
  function clearTransient() {
    if (hoverBox && hoverBox.parentNode) hoverBox.parentNode.removeChild(hoverBox);
    hoverBox = null;
    if (dragBox && dragBox.parentNode) dragBox.parentNode.removeChild(dragBox);
    dragBox = null;
  }
  // Sync the mark set to the host's live ids: prune retained rects, then
  // rebuild the painted boxes to exactly that set (a no-op mid-mode, a full
  // repaint right after mode-enter).
  function repaintMarks(ids) {
    var live = {};
    for (var i = 0; i < ids.length; i++) live[ids[i]] = true;
    for (var id in pickRects) {
      if (!live[id]) delete pickRects[id];
    }
    if (!overlay) return;
    for (var box in markBoxes) {
      if (markBoxes[box].parentNode) markBoxes[box].parentNode.removeChild(markBoxes[box]);
      delete markBoxes[box];
    }
    for (var keep in pickRects) {
      var r = pickRects[keep];
      markBoxes[keep] = boxFor(null, r.x, r.y, r.w, r.h, 'mark');
    }
  }
  function annotateExit() {
    annotating = false;
    clearTransient();
    // Destroy the painted layer; pickRects survives so a later mode-on
    // repaints the picks the host still holds.
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    markBoxes = {};
    document.removeEventListener('mouseover', onAnnotateOver, true);
    document.removeEventListener('mousedown', onAnnotateDown, true);
    document.removeEventListener('mousemove', onAnnotateMove, true);
    document.removeEventListener('mouseup', onAnnotateUp, true);
    document.removeEventListener('keydown', onAnnotateKey, true);
    if (repaintOnScroll) {
      window.removeEventListener('scroll', repaintOnScroll, true);
      repaintOnScroll = null;
    }
  }
  // Selector derivation, frame-side: an id anchors the chain, else an
  // nth-of-type chain up to four levels. Deliberately short — the snippet
  // carries the ground truth for the model.
  function selectorFor(el) {
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      var seg = node.tagName.toLowerCase();
      var id = node.getAttribute('id');
      if (id) {
        // An id anchors the chain; ancestors sit left of descendants.
        var anchor = seg + '[id="' + id.replace(/"/g, '\\"') + '"]';
        return parts.length > 0 ? anchor + ' > ' + parts.join(' > ') : anchor;
      }
      var sameTag = 0;
      var sib = node.parentNode ? node.parentNode.firstElementChild : null;
      while (sib) {
        if (sib.tagName === node.tagName) sameTag++;
        sib = sib.nextElementSibling;
      }
      if (sameTag > 1) {
        var at = 1;
        var scan = node;
        while (scan.previousElementSibling) {
          scan = scan.previousElementSibling;
          if (scan.tagName === node.tagName) at++;
        }
        seg += ':nth-of-type(' + at + ')';
      }
      parts.unshift(seg);
      node = node.parentNode;
      depth++;
    }
    return parts.join(' > ');
  }
  function snippetFor(el) {
    var html = (el.outerHTML || '').replace(/\s+/g, ' ').trim();
    return html.length > 360 ? html.slice(0, 360) + '…' : html;
  }
  function textFor(el) {
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > 160 ? text.slice(0, 160) + '…' : text;
  }
  function inViewport(el) {
    var view = viewport();
    return !!view && (el === view || (view.contains ? view.contains(el) : false));
  }
  function postPick(kind, el, rect) {
    if (!el || el.nodeType !== 1 || !inViewport(el)) return;
    var id = 'a' + (++pickSeq);
    paintMark(id, rect || pageRect(el));
    try {
      parent.postMessage({
        __dshGui: true, type: 'annotation', pick: {
          id: id, kind: kind,
          selector: selectorFor(el).slice(0, 300),
          tag: el.tagName.toLowerCase(),
          snippet: snippetFor(el),
          text: textFor(el)
        }
      }, '*');
    } catch (err) {}
  }
  function onAnnotateOver(e) {
    if (!annotating || dragStart) return;
    var el = e.target;
    if (!el || el.nodeType !== 1 || !inViewport(el) || overlay && (el === overlay || overlay.contains(el))) return;
    if (!hoverBox) ensureOverlay();
    if (!overlay) return;
    var r = pageRect(el);
    hoverBox = boxFor(hoverBox, r.x, r.y, r.w, r.h, 'hover');
  }
  function onAnnotateDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    ensureOverlay();
    dragStart = { cx: e.clientX, cy: e.clientY };
    if (hoverBox && hoverBox.parentNode) hoverBox.parentNode.removeChild(hoverBox);
    hoverBox = null;
  }
  function onAnnotateMove(e) {
    if (!dragStart || !overlay) return;
    var r = dragRect(e.clientX, e.clientY);
    if (r.w < 4 && r.h < 4) return;
    dragBox = boxFor(dragBox, r.x, r.y, r.w, r.h, 'drag');
  }
  /** Page-coordinate rect of the current drag, from the fixed client point. */
  function dragRect(cx, cy) {
    var left = Math.min(dragStart.cx, cx), right = Math.max(dragStart.cx, cx);
    var top = Math.min(dragStart.cy, cy), bottom = Math.max(dragStart.cy, cy);
    return {
      x: left + (window.scrollX || 0), y: top + (window.scrollY || 0),
      w: right - left, h: bottom - top
    };
  }
  function onAnnotateUp(e) {
    if (!dragStart) return;
    // Compute the rect before clearing the drag state it reads.
    var r = dragRect(e.clientX, e.clientY);
    var start = dragStart;
    dragStart = null;
    if (dragBox && dragBox.parentNode) dragBox.parentNode.removeChild(dragBox);
    dragBox = null;
    if (r.w < 5 && r.h < 5) {
      // A click: pick the deepest element under the point.
      var el = document.elementFromPoint(e.clientX, e.clientY);
      postPick('element', el);
      return;
    }
    // A drag: mark the area, named by the element holding its center. A
    // null center (outside the viewport) leaves the area unnamed; skip.
    var center = document.elementFromPoint(
      (start.cx + e.clientX) / 2,
      (start.cy + e.clientY) / 2
    );
    postPick('area', center, r);
  }
  function onAnnotateKey(e) {
    if (e.key === 'Escape' && annotating) {
      try { parent.postMessage({ __dshGui: true, type: 'annotateExited' }, '*'); } catch (err) {}
      annotateExit();
    }
  }
  var repaintOnScroll = null;
  function annotateEnter() {
    if (annotating) return;
    annotating = true;
    ensureOverlay();
    // Repaint every retained pick; the host's marks sync prunes to its
    // live list right after, so removed picks never flash back.
    for (var id in pickRects) {
      var r = pickRects[id];
      markBoxes[id] = boxFor(markBoxes[id], r.x, r.y, r.w, r.h, 'mark');
    }
    document.addEventListener('mouseover', onAnnotateOver, true);
    document.addEventListener('mousedown', onAnnotateDown, true);
    document.addEventListener('mousemove', onAnnotateMove, true);
    document.addEventListener('mouseup', onAnnotateUp, true);
    document.addEventListener('keydown', onAnnotateKey, true);
    repaintOnScroll = function () { clearTransient(); };
    window.addEventListener('scroll', repaintOnScroll, true);
  }
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
  // Streaming height heartbeat: while frozen, re-report the measured height
  // on a slow interval so a dropped per-render report cannot leave the
  // frame clipped until commit. It stops itself on the first tick after
  // unfreeze; an interrupted card keeps its frame mounted, where the
  // repeated identical post is a no-op for the host.
  var heartbeat = setInterval(function () {
    if (!frozen) {
      clearInterval(heartbeat);
      return;
    }
    report();
  }, 500);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () { reportFromResize(); }).observe(document.documentElement);
  }
})();
</script>
`

/** The complete shell document; one constant — the shell never varies per card. */
export const STREAM_SHELL = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${RENDER_CSP_DIRECTIVES}">
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
