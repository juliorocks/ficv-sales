(function () {
    var script = document.currentScript;
    var slug = script.getAttribute("data-slug");
    if (!slug) return;

    var origin = new URL(script.src).origin;
    var container = document.getElementById("ficv-form-" + slug) || (function () {
        var div = document.createElement("div");
        script.parentNode.insertBefore(div, script);
        return div;
    })();

    var params = new URLSearchParams();
    params.set("parent_url", window.location.href);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(function (k) {
        var v = new URLSearchParams(window.location.search).get(k);
        if (v) params.set(k, v);
    });

    var iframe = document.createElement("iframe");
    iframe.src = origin + "/f/" + slug + "?" + params.toString();
    iframe.style.width = "100%";
    iframe.style.border = "0";
    iframe.style.minHeight = "200px";
    iframe.scrolling = "no";
    container.appendChild(iframe);

    window.addEventListener("message", function (event) {
        if (event.source !== iframe.contentWindow) return;
        var data = event.data || {};
        if (data.type === "ficv-form-resize" && data.height) {
            iframe.style.height = data.height + "px";
        } else if (data.type === "ficv-form-redirect" && data.url) {
            window.top.location.href = data.url;
        }
    });
})();
