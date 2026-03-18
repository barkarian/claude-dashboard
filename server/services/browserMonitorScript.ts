// Vanilla JS script injected into HTML responses to capture browser console logs.
// Posts batched logs to /__claw_console__ which tunnelClient intercepts.

export const BROWSER_MONITOR_SCRIPT = `<script data-claw-monitor>
(function() {
  if (window.__clawMonitor) return;
  window.__clawMonitor = true;

  var MAX_ARG_LEN = 2048;
  var MAX_PAYLOAD = 10240;
  var BATCH_MS = 100;
  var queue = [];
  var timer = null;
  var originals = {};
  var levels = ['log', 'warn', 'error', 'info', 'debug'];

  function safeStringify(val, depth) {
    if (depth > 3) return '[nested]';
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'function') return '[Function: ' + (val.name || 'anonymous') + ']';
    if (val instanceof Error) return val.stack || val.message || String(val);
    if (typeof val === 'symbol') return val.toString();
    if (val instanceof HTMLElement) return val.outerHTML.slice(0, 200);
    if (val instanceof Node) return '[Node: ' + val.nodeName + ']';
    if (typeof val !== 'object') return String(val);
    var seen = safeStringify._seen || (safeStringify._seen = []);
    if (seen.indexOf(val) !== -1) return '[Circular]';
    seen.push(val);
    try {
      if (Array.isArray(val)) {
        var items = [];
        for (var i = 0; i < Math.min(val.length, 50); i++) items.push(safeStringify(val[i], depth + 1));
        if (val.length > 50) items.push('... +' + (val.length - 50) + ' more');
        return '[' + items.join(', ') + ']';
      }
      var keys = Object.keys(val);
      var parts = [];
      for (var k = 0; k < Math.min(keys.length, 30); k++) {
        try { parts.push(keys[k] + ': ' + safeStringify(val[keys[k]], depth + 1)); } catch(e) { parts.push(keys[k] + ': [error]'); }
      }
      if (keys.length > 30) parts.push('... +' + (keys.length - 30) + ' more');
      return '{' + parts.join(', ') + '}';
    } finally {
      seen.pop();
    }
  }

  function serialize(args) {
    var parts = [];
    var total = 0;
    for (var i = 0; i < args.length; i++) {
      safeStringify._seen = [];
      var s = safeStringify(args[i], 0);
      if (s.length > MAX_ARG_LEN) s = s.slice(0, MAX_ARG_LEN) + '...';
      total += s.length;
      if (total > MAX_PAYLOAD) { parts.push('[truncated]'); break; }
      parts.push(s);
    }
    return parts.join(' ');
  }

  function flush() {
    timer = null;
    if (queue.length === 0) return;
    var batch = queue;
    queue = [];
    try {
      var body = JSON.stringify(batch);
      if (body.length > MAX_PAYLOAD) body = body.slice(0, MAX_PAYLOAD);
      navigator.sendBeacon('/__claw_console__', new Blob([body], { type: 'application/json' }));
    } catch(e) {}
  }

  function enqueue(level, args) {
    queue.push({ l: level, m: serialize(args), t: Date.now() });
    if (!timer) timer = setTimeout(flush, BATCH_MS);
  }

  for (var i = 0; i < levels.length; i++) {
    (function(level) {
      originals[level] = console[level];
      console[level] = function() {
        originals[level].apply(console, arguments);
        enqueue(level, arguments);
      };
    })(levels[i]);
  }

  window.addEventListener('error', function(e) {
    enqueue('error', ['Uncaught ' + (e.error ? (e.error.stack || e.error.message || e.message) : e.message) + ' at ' + e.filename + ':' + e.lineno + ':' + e.colno]);
  });

  window.addEventListener('unhandledrejection', function(e) {
    var reason = e.reason;
    var msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
    enqueue('error', ['Unhandled Promise Rejection: ' + msg]);
  });
})();
</script>`;
