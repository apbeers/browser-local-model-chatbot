// appkit: injected into every Studio app (as an inline classic script).
// The app runs in a sandboxed frame with no access to the main app's data;
// everything goes through postMessage to the host page, which enforces that
// each app only reaches its own storage. See docs/APPKIT.md.
(function () {
  "use strict";
  var host = window.parent;
  var seq = 0;
  var pending = {};
  var listeners = { theme: [] };

  function call(method, params, onToken) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject, onToken: onToken };
      host.postMessage({ ak: 1, id: id, method: method, params: params }, "*");
    });
  }

  window.addEventListener("message", function (e) {
    if (e.source !== host) return;
    var m = e.data;
    if (!m || m.ak !== 1) return;
    if (m.event === "theme") {
      applyTheme(m.data);
      listeners.theme.forEach(function (fn) {
        try {
          fn(m.data);
        } catch (err) {}
      });
      return;
    }
    var p = pending[m.id];
    if (!p) return;
    if (m.token !== undefined) {
      if (p.onToken) p.onToken(m.token);
      return;
    }
    delete pending[m.id];
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m.result);
  });

  function applyTheme(t) {
    if (!t) return;
    var root = document.documentElement;
    if (t.mode === "light" || t.mode === "dark") root.setAttribute("data-theme", t.mode);
    else root.removeAttribute("data-theme");
    var style = document.getElementById("ak-theme");
    if (style && t.css) style.textContent = t.css;
  }

  // Report errors and console output to the Studio Console tab.
  function send(level, args) {
    try {
      host.postMessage(
        {
          ak: 1,
          log: {
            level: level,
            text: Array.prototype.map
              .call(args, function (a) {
                if (a instanceof Error) return a.message;
                if (typeof a === "object") {
                  try {
                    return JSON.stringify(a);
                  } catch (e) {
                    return String(a);
                  }
                }
                return String(a);
              })
              .join(" ")
              .slice(0, 2000),
          },
        },
        "*",
      );
    } catch (e) {}
  }
  ["log", "info", "warn", "error"].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      send(level, arguments);
      return orig.apply(console, arguments);
    };
  });
  window.addEventListener("error", function (e) {
    send("error", [(e.message || "Error") + (e.lineno ? " (line " + e.lineno + ")" : "")]);
  });
  window.addEventListener("unhandledrejection", function (e) {
    send("error", ["Unhandled promise rejection: " + (e.reason && e.reason.message ? e.reason.message : e.reason)]);
  });

  window.appkit = {
    version: 1,
    // Key/value storage for this app only. Values are any JSON.
    storage: {
      get: function (key, fallback) {
        return call("storage.get", { key: key }).then(function (v) {
          return v === undefined || v === null ? (fallback === undefined ? null : fallback) : v;
        });
      },
      set: function (key, value) {
        return call("storage.set", { key: key, value: value });
      },
      remove: function (key) {
        return call("storage.remove", { key: key });
      },
      keys: function () {
        return call("storage.keys", {});
      },
    },
    // Text files for this app only.
    files: {
      list: function () {
        return call("files.list", {});
      },
      read: function (name) {
        return call("files.read", { name: name });
      },
      write: function (name, text) {
        return call("files.write", { name: name, text: String(text) });
      },
      remove: function (name) {
        return call("files.remove", { name: name });
      },
    },
    // The on-device language model.
    ai: {
      // messages: [{role: "system"|"user"|"assistant", content}]
      // options: {onToken(fullText), maxTokens, temperature, json (true = reply is JSON)}
      chat: function (messages, options) {
        options = options || {};
        return call("ai.chat", { messages: messages, maxTokens: options.maxTokens, temperature: options.temperature, json: !!options.json }, options.onToken);
      },
      ask: function (prompt, options) {
        return window.appkit.ai.chat([{ role: "user", content: String(prompt) }], options);
      },
      status: function () {
        return call("ai.status", {});
      },
    },
    // Tools (web access etc.) the user allowed. See docs/APPKIT.md.
    tools: {
      list: function () {
        return call("tools.list", {});
      },
      call: function (name, args) {
        return call("tools.call", { name: name, args: args || {} });
      },
    },
    theme: {
      onChange: function (fn) {
        listeners.theme.push(fn);
      },
    },
    notify: function (text) {
      return call("notify", { text: String(text) });
    },
    download: function (filename, text, type) {
      return call("download", { filename: String(filename), text: String(text), type: type || "text/plain" });
    },
  };
  host.postMessage({ ak: 1, hello: true }, "*");
})();
