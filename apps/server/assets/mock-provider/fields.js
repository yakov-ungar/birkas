'use strict';
(function () {
  var $ = function (id) {
    return document.getElementById(id);
  };
  var digits = function (s) {
    return s.replace(/\D/g, '');
  };
  function luhn(d) {
    var sum = 0,
      dbl = false;
    for (var i = d.length - 1; i >= 0; i--) {
      var n = +d[i];
      if (dbl) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }
  function brand(d) {
    return { 4: 'ויזה', 5: 'מאסטרקארד', 3: 'אמריקן אקספרס / דיינרס' }[d[0]] || 'כרטיס';
  }
  function rand() {
    var a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.prototype.map
      .call(a, function (b) {
        return b.toString(16).padStart(2, '0');
      })
      .join('');
  }
  function validate() {
    var pan = digits($('pan').value),
      exp = $('exp').value.trim(),
      cvv = $('cvv').value.trim();
    if (!$('holder').value.trim()) return 'יש להזין שם בעל הכרטיס';
    if (!/^\d{5,9}$/.test(digits($('tz').value))) return 'ת״ז לא תקינה';
    if (pan.length < 13 || pan.length > 19 || !luhn(pan)) return 'מספר כרטיס לא תקין';
    var m = /^(\d{2})\/(\d{2})$/.exec(exp);
    if (!m || +m[1] < 1 || +m[1] > 12) return 'תוקף בפורמט MM/YY';
    var now = new Date(),
      y = 2000 + +m[2];
    if (y < now.getFullYear() || (y === now.getFullYear() && +m[1] < now.getMonth() + 1))
      return 'הכרטיס פג תוקף';
    if (!/^\d{3,4}$/.test(cvv)) return 'CVV לא תקין';
    return '';
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || e.source !== window.parent || !e.data || e.data.type !== 'tokenize')
      return;
    var err = validate();
    $('err').textContent = err;
    if (err) {
      parent.postMessage({ type: 'tokenize-error', message: err, id: e.data.id }, location.origin);
      return;
    }
    var pan = digits($('pan').value),
      m = /^(\d{2})\/(\d{2})$/.exec($('exp').value.trim());
    var last4 = pan.slice(-4);
    var result = {
      token: 'mock_tok_' + last4 + '_' + rand(),
      last4: last4,
      brand: brand(pan),
      expMonth: +m[1],
      expYear: 2000 + +m[2],
      holderName: $('holder').value.trim(),
    };
    // Wipe the sensitive fields as soon as the token exists.
    $('pan').value = '';
    $('cvv').value = '';
    $('tz').value = '';
    parent.postMessage({ type: 'tokenized', result: result, id: e.data.id }, location.origin);
  });
  $('f').addEventListener('submit', function (e) {
    e.preventDefault();
  });
  parent.postMessage({ type: 'fields-ready' }, location.origin);
})();
