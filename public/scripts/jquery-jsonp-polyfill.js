/**
 * Minimal jQuery JSONP polyfill for codefcert.js
 * Only implements $.ajax with dataType:"jsonp" — nothing else.
 */
(function () {
  if (typeof window.$ !== "undefined" && typeof window.$.ajax === "function") return;

  var counter = 0;

  window.$ = window.$ || {};
  window.$.ajax = function (opts) {
    if (opts.dataType !== "jsonp") return;

    var callbackName = "_jsonp_" + (++counter) + "_" + Date.now();
    var paramName = opts.jsonp || "callback";
    var sep = opts.url.indexOf("?") > -1 ? "&" : "?";
    var url = opts.url + sep + paramName + "=" + callbackName;

    var timer = setTimeout(function () {
      cleanup();
      if (typeof opts.error === "function") opts.error({}, "timeout", "Timeout");
    }, opts.timeout || 10000);

    function cleanup() {
      clearTimeout(timer);
      try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
      var el = document.getElementById(callbackName);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    window[callbackName] = function (data) {
      cleanup();
      if (typeof opts.success === "function") opts.success(data);
    };

    var script = document.createElement("script");
    script.id = callbackName;
    script.src = url;
    script.onerror = function () {
      cleanup();
      if (typeof opts.error === "function") opts.error({}, "error", "Script load error");
    };
    document.head.appendChild(script);
  };
})();
