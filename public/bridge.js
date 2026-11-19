/*!
 * Vistazo bridge — optional. Include it in the app under review:
 *   <script src="https://<your-vistazo>/bridge.js" defer></script>
 * It only activates inside an iframe whose parent is the SAME origin this
 * script was loaded from. It sends nothing to any server: it only talks to the
 * Vistazo window via postMessage (current URL, picked element). It does not read forms.
 */
(function () {
  if (window.parent === window) return;
  var me = document.currentScript && document.currentScript.src;
  var PARENT;
  try {
    PARENT = new URL(me).origin;
  } catch (e) {
    return;
  }
  var picking = false, hover = null, box = null, pinLayer = null, pins = [];

  function send(m) {
    window.parent.postMessage(m, PARENT);
  }
  function hello(kind) {
    send({ vz: kind, url: location.href });
  }

  // Stable selector: data-testid > id > short tag path with nth-of-type.
  function selectorOf(el) {
    if (!(el instanceof Element)) return "";
    var t = el.closest("[data-testid]");
    if (t) return '[data-testid="' + t.getAttribute("data-testid") + '"]';
    if (el.id) return "#" + CSS.escape(el.id);
    var parts = [];
    while (el && el.nodeType === 1 && parts.length < 5 && el !== document.body) {
      var p = el.parentElement, tag = el.tagName.toLowerCase();
      if (p) {
        var same = Array.prototype.filter.call(p.children, function (c) { return c.tagName === el.tagName; });
        if (same.length > 1) tag += ":nth-of-type(" + (same.indexOf(el) + 1) + ")";
      }
      parts.unshift(tag);
      if (el.id) { parts[0] = "#" + CSS.escape(el.id); break; }
      el = p;
    }
    return parts.join(" > ");
  }

  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #ff5b1f;background:rgba(255,91,31,.08);border-radius:4px;transition:all .05s";
    document.documentElement.appendChild(box);
    return box;
  }
  function onMove(e) {
    if (!picking) return;
    hover = e.target;
    var r = hover.getBoundingClientRect(), b = ensureBox();
    b.style.display = "block";
    b.style.left = r.left + "px"; b.style.top = r.top + "px";
    b.style.width = r.width + "px"; b.style.height = r.height + "px";
  }
  function onClick(e) {
    if (!picking) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target;
    setPick(false);
    send({
      vz: "picked",
      url: location.href,
      selector: selectorOf(el),
      text: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || "").trim().slice(0, 200),
      x: e.clientX / window.innerWidth,
      y: e.clientY / window.innerHeight,
      viewport: { w: window.innerWidth, h: window.innerHeight }
    });
  }
  function setPick(on) {
    picking = on;
    document.documentElement.style.cursor = on ? "crosshair" : "";
    if (!on && box) box.style.display = "none";
  }

  function drawPins() {
    if (!pinLayer) {
      pinLayer = document.createElement("div");
      pinLayer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483645";
      document.body.appendChild(pinLayer);
    }
    pinLayer.innerHTML = "";
    pins.forEach(function (p) {
      var el = null;
      try { el = p.selector ? document.querySelector(p.selector) : null; } catch (e) {}
      var x, y;
      if (el) {
        var r = el.getBoundingClientRect();
        x = r.right + window.scrollX - 6; y = r.top + window.scrollY - 6;
      } else {
        x = p.x * window.innerWidth + window.scrollX; y = p.y * window.innerHeight + window.scrollY;
      }
      var d = document.createElement("div");
      d.textContent = p.n;
      d.title = "Comment " + p.n;
      d.style.cssText = "position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid #fff;color:#fff;font:700 11px/18px system-ui;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.3);background:" + (p.resolved ? "#127a4a" : "#ff5b1f");
      d.style.left = x + "px"; d.style.top = y + "px";
      pinLayer.appendChild(d);
    });
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== PARENT || !e.data || typeof e.data !== "object") return;
    if (e.data.vz === "ping") hello("hello");
    if (e.data.vz === "pick") setPick(!!e.data.on);
    if (e.data.vz === "pins") { pins = e.data.pins || []; drawPins(); }
  });
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("resize", drawPins);

  // SPA navigation: report URL changes.
  var last = location.href;
  setInterval(function () {
    if (location.href !== last) { last = location.href; hello("nav"); setTimeout(drawPins, 300); }
  }, 400);
  window.addEventListener("load", function () { hello("hello"); });
  hello("hello");
})();
