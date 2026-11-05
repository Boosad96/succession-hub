// app.js — succession wizard, court-fee estimator, legal-heir finder,
// Section 372 petition draft and NOC affidavit generator. No dependencies.
// All data comes from /data.json. Nothing the user types leaves the browser.
(function () {
  var DATA = null;
  var SOURCES = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function inr(n) {
    return '₹' + Number(n).toLocaleString('en-IN');
  }
  function srcLinks(keys) {
    if (!SOURCES) return '';
    return (keys || []).map(function (k) {
      var s = SOURCES[k];
      return s ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a>' : esc(k);
    }).join(', ');
  }
  function feeForState(f, amount) {
    if (!f || f.status === 'omitted' || f.status === 'conflict') return null;
    if (f.max_amount != null && amount > f.max_amount) return 'beyond_verified';
    if (f.basis === 'fixed') return f.fixed;
    if (f.basis === 'ad valorem') {
      var fee = amount * f.rate;
      if (f.cap != null && fee > f.cap) fee = f.cap;
      if (f.min != null && fee < f.min) fee = f.min;
      return Math.round(fee);
    }
    if (f.basis === 'slabs') {
      // Marginal slabs: each portion of the value is charged at its band's rate.
      var fee = 0, prev = 0;
      for (var i = 0; i < f.slabs.length; i++) {
        var s = f.slabs[i];
        var top = s.upto == null ? amount : Math.min(amount, s.upto);
        if (top > prev) fee += (top - prev) * s.rate;
        prev = s.upto == null ? amount : s.upto;
        if (amount <= prev) break;
      }
      if (f.cap != null && fee > f.cap) fee = f.cap;
      if (f.min != null && fee < f.min) fee = f.min;
      return Math.round(fee);
    }
    return null;
  }
  function feeBasisText(f) {
    if (f.basis === 'fixed') return inr(f.fixed) + ' (fixed fee)';
    if (f.basis === 'ad valorem') {
      var t = (f.rate * 100) + '% of the value of the debts and securities';
      if (f.cap != null) t += ', capped at ' + inr(f.cap);
      if (f.min != null) t += ', minimum ' + inr(f.min);
      return t;
    }
    if (f.basis === 'slabs') {
      var parts = f.slabs.map(function (s) {
        return (s.rate * 100) + '%' + (s.upto == null ? ' above ' + inr(f.slabs[f.slabs.length - 2].upto) : ' up to ' + inr(s.upto));
      });
      var t = 'slab rates (each portion of the value at its own rate): ' + parts.join('; ');
      if (f.cap != null) t += ', capped at ' + inr(f.cap);
      if (f.min != null) t += ', minimum ' + inr(f.min);
      return t;
    }
    return f.basis || '';
  }

  // ---------- wizard ----------
  function initWizard() {
    var form = document.getElementById('wizard');
    if (!form) return;
    document.getElementById('wizard-go').addEventListener('click', function () {
      var out = document.getElementById('wizard-result');
      function val(name) {
        var el = form.querySelector('input[name="' + name + '"]:checked');
        return el ? el.value : null;
      }
      var will = val('will'), asset = val('asset'), law = val('law'), agree = val('agree');
      if (!will || !asset || !law || !agree) {
        out.innerHTML = '<p>Please answer all four questions first.</p>';
        return;
      }
      var R = DATA.wizard.results;
      var key;
      if (will === 'unsure') key = 'find_will';
      else if (will === 'yes') key = 'probate';
      else if (asset === 'property') key = 'property';
      else if (asset === 'govt') key = 'legal_heir';
      else key = 'succession';
      var r = R[key];
      var lawNote = '';
      if (law === 'muslim') lawNote = '<p><strong>Personal law note:</strong> ' + esc(R._law_notes.muslim) + '</p>';
      else if (law === 'christian') lawNote = '<p><strong>Personal law note:</strong> ' + esc(R._law_notes.christian) + '</p>';
      else if (law === 'hindu') lawNote = '<p><strong>Personal law note:</strong> ' + esc(R._law_notes.hindu) + '</p>';
      else lawNote = '<p><strong>Personal law note:</strong> ' + esc(R._law_notes.other) + '</p>';
      var agreeNote = '';
      if (agree === 'no') agreeNote = '<p><strong>⚠ Dispute warning:</strong> ' + esc(R._agree_notes.no) + '</p>';
      else if (agree === 'unsure') agreeNote = '<p><strong>Note:</strong> ' + esc(R._agree_notes.unsure) + '</p>';
      var settleNote = '';
      if (key === 'succession' && agree === 'yes') settleNote = '<p><strong>Also possible:</strong> ' + esc(R._agree_notes.family_settlement) + '</p>';
      out.innerHTML = '<div class="answer"><h3>' + esc(r.title) + '</h3>'
        + '<p>' + esc(r.body) + '</p>'
        + '<ol>' + r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>'
        + lawNote + agreeNote + settleNote
        + '<p>' + r.links.map(function (l) { return '<a class="btn btn-secondary" href="' + esc(l.href) + '">' + esc(l.text) + '</a>'; }).join(' ') + '</p>'
        + '<p class="small">Not legal advice. ' + esc(r.caveat || '') + '</p></div>';
      out.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ---------- fee estimator ----------
  function initFeeCalc() {
    var form = document.getElementById('fee-calc');
    if (!form) return;
    var sel = document.getElementById('fee-state');
    sel.innerHTML = '<option value="">Select state…</option>' + DATA.court_fees.map(function (f) {
      return '<option value="' + esc(f.state) + '">' + esc(f.state) + (f.status === 'omitted' ? ' — not verified' : '') + '</option>';
    }).join('') + '<option value="__other">Another state</option>';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var out = document.getElementById('fee-result');
      var stName = sel.value;
      var amount = parseFloat(document.getElementById('fee-amount').value);
      if (!stName) { out.innerHTML = '<p>Please pick a state first.</p>'; return; }
      if (stName === '__other') {
        out.innerHTML = '<div class="answer"><h3>Fee not verified for this state</h3>'
          + '<p>We only publish court fees for the states we could verify against two independent published sources. For other states, check the District Court or the State Court Fees Act schedule directly — the court’s own figure is final.</p></div>';
        return;
      }
      if (!amount || amount <= 0) { out.innerHTML = '<p>Please enter the value of the debts and securities, in rupees.</p>'; return; }
      var f = DATA.court_fees.filter(function (x) { return x.state === stName; })[0];
      if (!f) { out.innerHTML = '<p>No fee data for this state.</p>'; return; }
      if (f.status === 'omitted') {
        out.innerHTML = '<div class="answer"><h3>' + esc(f.state) + ' — fee not verified</h3>'
          + '<p>We could not verify this state’s succession-certificate court fee against two independent published sources, so we do not publish a number. ' + esc(f.notes || '') + '</p>'
          + '<p>Check the District Court or the State Court Fees Act schedule directly — the court’s own figure is final.</p></div>';
        return;
      }
      if (f.status === 'conflict') {
        out.innerHTML = '<div class="answer"><h3>' + esc(f.state) + ' — fee sources conflict</h3>'
          + '<p>Published sources disagree about this state’s fee, so we do not publish a single number. ' + esc(f.notes || '') + '</p>'
          + '<p>Check the District Court or the State Court Fees Act schedule directly — the court’s own figure is final. See the <a href="/sources/">Sources page</a> for the conflicting figures.</p></div>';
        return;
      }
      var fee = feeForState(f, amount);
      if (fee === 'beyond_verified') {
        out.innerHTML = '<div class="answer"><h3>' + esc(f.state) + ' — value above the verified bands</h3>'
          + '<p>The published fee bands we could verify for this state only go up to ' + inr(f.max_amount) + '. The rate above that is not verified, so we cannot estimate it. ' + esc(f.notes || '') + '</p>'
          + '<p>Check the District Court or the State Court Fees Act schedule directly — the court’s own figure is final.</p></div>';
        return;
      }
      var badge = f.status === 'single' ? ' <span class="badge">single source — verify</span>' : '';
      out.innerHTML = '<div class="answer"><h3>Estimated court fee: ' + inr(fee) + badge + '</h3>'
        + '<p>On <strong>' + inr(amount) + '</strong> of debts and securities in <strong>' + esc(f.state) + '</strong>, the fee is calculated as: ' + esc(feeBasisText(f)) + '.</p>'
        + (f.notes ? '<p>' + esc(f.notes) + '</p>' : '')
        + '<p class="small">This is an <strong>estimate</strong> from published sources (' + srcLinks(f.sources) + '). Court fees are fixed by the State Court Fees Act and the District Court’s own figure is final — confirm before paying. Stamp duty / process fees, if any, are separate.</p>'
        + '<p><a class="btn" href="/petition/">Draft the petition →</a> <a class="btn btn-secondary" href="/checklist/">Timeline checklist →</a></p></div>';
      out.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ---------- legal-heir finder ----------
  function initLhFinder() {
    var form = document.getElementById('lh-finder');
    if (!form) return;
    var sel = document.getElementById('lh-state');
    sel.innerHTML = '<option value="">Select state…</option>' + DATA.legal_heir_states.map(function (s) {
      return '<option value="' + esc(s.state) + '">' + esc(s.state) + '</option>';
    }).join('') + '<option value="__other">Another state</option>';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var out = document.getElementById('lh-result');
      var stName = sel.value;
      if (!stName) { out.innerHTML = '<p>Please pick a state first.</p>'; return; }
      if (stName === '__other') {
        out.innerHTML = '<div class="answer"><h3>State not covered yet</h3>'
          + '<p>We only publish legal-heir routes for the states we could verify against two independent published sources. For other states, check your state e-District portal or the Tahsildar’s office — a legal-heir certificate may be issued under a different name (for example a surviving-member or family certificate), or the state may not issue one at all.</p></div>';
        return;
      }
      var s = DATA.legal_heir_states.filter(function (x) { return x.state === stName; })[0];
      if (!s) { out.innerHTML = '<p>No data for this state yet.</p>'; return; }
      if (!s.issues) {
        out.innerHTML = '<div class="answer"><h3>' + esc(s.state) + ' — no legal-heir certificate is issued</h3>'
          + '<p>' + esc(s.instead || 'This state does not issue a legal-heir certificate.') + '</p>'
          + '<p class="small">Sources: ' + srcLinks(s.sources) + '</p>'
          + '<p><a class="btn" href="/wizard/">Which certificate do I need? →</a></p></div>';
        return;
      }
      var badge = s.status === 'single' ? ' <span class="badge">single source — verify</span>' : '';
      out.innerHTML = '<div class="answer"><h3>' + esc(s.state) + ' — legal-heir certificate' + badge + '</h3>'
        + '<p><strong>Issuing authority:</strong> ' + esc(s.authority) + '</p>'
        + '<p><strong>Portal:</strong> ' + (s.portal_url ? '<a href="' + esc(s.portal_url) + '" target="_blank" rel="noopener">' + esc(s.portal) + '</a>' : esc(s.portal)) + '</p>'
        + '<p><strong>Fee:</strong> ' + esc(s.fee || 'Not verified — confirm on the portal') + ' &nbsp;·&nbsp; <strong>Timeline:</strong> ' + esc(s.timeline || 'Not verified — confirm on the portal') + '</p>'
        + '<p><strong>Documents:</strong> ' + DATA.documents.legal_heir.map(esc).join('; ') + '.</p>'
        + (s.notes ? '<p>' + esc(s.notes) + '</p>' : '')
        + '<p class="small">Sources: ' + srcLinks(s.sources) + '. Confirm the fee and the document list on the portal before applying.</p></div>';
      out.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ---------- petition draft ----------
  function initPetition() {
    var form = document.getElementById('petition-form');
    if (!form) return;
    document.getElementById('petition-go').addEventListener('click', function () {
      var out = document.getElementById('petition-output');
      function v(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
      var name = v('p-name'), addr = v('p-addr'), rel = v('p-rel'), district = v('p-district'),
        dname = v('p-dname'), ddate = v('p-ddate'), dplace = v('p-dplace'), daddr = v('p-daddr'),
        heirsRaw = v('p-heirs'), assetsRaw = v('p-assets'),
        noc = document.getElementById('p-noc').checked;
      if (!name || !dname || !ddate || !district) {
        out.innerHTML = '<p>Please fill in at least: your name, the deceased’s name, the date of death, and the district.</p>';
        return;
      }
      function parseLines(raw) {
        return raw.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
          var parts = l.split(/\s*[—–-]\s*/);
          return parts;
        });
      }
      var heirs = parseLines(heirsRaw);
      var assets = parseLines(assetsRaw);
      var total = 0;
      assets.forEach(function (a) {
        var n = parseFloat(String(a[1] || '').replace(/[^0-9.]/g, ''));
        if (n) total += n;
      });
      var heirRows = heirs.length ? heirs.map(function (h, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(h[0] || '') + '</td><td>' + esc(h[1] || '') + '</td><td>' + esc(h[2] || '') + '</td></tr>';
      }).join('') : '<tr><td colspan="4">[List each legal heir with name, relationship and age]</td></tr>';
      var assetRows = assets.length ? assets.map(function (a, i) {
        var n = parseFloat(String(a[1] || '').replace(/[^0-9.]/g, ''));
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(a[0] || '') + '</td><td>' + (n ? inr(n) : esc(a[1] || '')) + '</td></tr>';
      }).join('') : '<tr><td colspan="3">[List each debt / security with its approximate value]</td></tr>';
      out.innerHTML = '<div class="draft">'
        + '<h3>IN THE COURT OF THE DISTRICT JUDGE, ' + esc(district.toUpperCase()) + '</h3>'
        + '<p class="centre">Petition under Section 372 of the Indian Succession Act, 1925<br>for the grant of a Succession Certificate</p>'
        + '<p><strong>Petitioner:</strong> ' + esc(name) + (addr ? '<br>' + esc(addr) : '') + (rel ? '<br>Relationship to the deceased: ' + esc(rel) : '') + '</p>'
        + '<p><strong>1. The deceased:</strong> ' + esc(dname) + ', who died on ' + esc(ddate) + (dplace ? ' at ' + esc(dplace) : '') + (daddr ? ', ordinarily residing at ' + esc(daddr) : '') + '.</p>'
        + '<p><strong>2. Jurisdiction:</strong> The deceased ordinarily resided within the jurisdiction of this Court at the time of death, and this petition is filed before the District Judge of ' + esc(district) + '.</p>'
        + '<p><strong>3. The petitioner claims as heir:</strong> ' + esc(rel || '[state your relationship and the right in which you claim]') + ' of the deceased. The deceased died intestate, without leaving a valid will.</p>'
        + '<p><strong>4. Legal heirs of the deceased:</strong></p>'
        + '<table><thead><tr><th>#</th><th>Name</th><th>Relationship</th><th>Age</th></tr></thead><tbody>' + heirRows + '</tbody></table>'
        + '<p><strong>5. Debts and securities in respect of which the certificate is sought:</strong></p>'
        + '<table><thead><tr><th>#</th><th>Debt / security</th><th>Approximate value</th></tr></thead><tbody>' + assetRows + '</tbody></table>'
        + (total ? '<p><strong>Total approximate value:</strong> ' + inr(total) + '. Court fee is payable on this value as per the State Court Fees Act — see the <a href="/fees/">fee estimator</a>.</p>' : '')
        + '<p><strong>6. No objection:</strong> ' + (noc ? 'All other legal heirs consent to the grant of the certificate to the petitioner, and their NOC affidavits are annexed.' : '[State whether the other heirs consent. If they do, attach their NOC affidavits — make one with the NOC affidavit generator.]') + '</p>'
        + '<p><strong>7. No impediment:</strong> There is, to the petitioner’s knowledge, no impediment to the grant of the certificate, and no application for a succession certificate in respect of the same debts and securities has been made to any other court.</p>'
        + '<p><strong>Prayer:</strong> The petitioner prays that a Succession Certificate be granted to the petitioner in respect of the debts and securities listed above, under Section 372 of the Indian Succession Act, 1925.</p>'
        + '<p><strong>Verification:</strong> I, ' + esc(name) + ', verify that the facts stated above are true to my knowledge and belief. I understand that a false statement in this verification is an offence.</p>'
        + '<p><strong>Place:</strong> ___________ &nbsp;&nbsp; <strong>Date:</strong> ___________<br><strong>Signature of petitioner:</strong> ___________</p>'
        + '<p class="small">This is a free preview draft generated in your browser — nothing you typed was sent anywhere. Court formats vary by district: have a lawyer review this petition, confirm the court fee with the District Court, and attach the death certificate and the documents in the <a href="/checklist/">checklist</a> before filing. This is not legal advice.</p>'
        + '</div><p><button class="btn" onclick="window.print()">Print / save as PDF</button></p>';
      out.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ---------- NOC affidavit ----------
  function initNoc() {
    var form = document.getElementById('noc-form');
    if (!form) return;
    document.getElementById('noc-go').addEventListener('click', function () {
      var out = document.getElementById('noc-output');
      function v(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
      var name = v('n-name'), addr = v('n-addr'), rel = v('n-rel'),
        dname = v('n-dname'), ddate = v('n-ddate'), pet = v('n-pet'), petrel = v('n-petrel');
      if (!name || !dname || !pet || !ddate) {
        out.innerHTML = '<p>Please fill in at least: your name, the deceased’s name, the date of death, and the name of the heir filing the petition.</p>';
        return;
      }
      out.innerHTML = '<div class="draft">'
        + '<h3>AFFIDAVIT OF NO OBJECTION</h3>'
        + '<p>I, <strong>' + esc(name) + '</strong>' + (addr ? ', residing at ' + esc(addr) : '') + ', do hereby solemnly affirm and declare as under:</p>'
        + '<p><strong>1.</strong> That ' + esc(dname) + ' died on ' + esc(ddate) + '. I am the ' + esc(rel || '[relationship]') + ' of the deceased and one of the legal heirs.</p>'
        + '<p><strong>2.</strong> That ' + esc(pet) + ', the ' + esc(petrel || '[relationship]') + ' of the deceased, has applied / is applying for a Succession Certificate under Section 372 of the Indian Succession Act, 1925, in respect of the debts and securities left by the deceased.</p>'
        + '<p><strong>3.</strong> That I have no objection to the grant of the Succession Certificate to ' + esc(pet) + ' in respect of the said debts and securities, and I consent to the same.</p>'
        + '<p><strong>4.</strong> That I have no claim, objection or demand against the grant of the said certificate, and I shall not raise any objection to it in future.</p>'
        + '<p><strong>5.</strong> That the contents of this affidavit are true and correct to my knowledge and belief.</p>'
        + '<p><strong>Place:</strong> ___________ &nbsp;&nbsp; <strong>Date:</strong> ___________<br><strong>Signature of deponent:</strong> ___________</p>'
        + '<p><strong>Verification:</strong> Verified at ___________ on this the ___ day of ___________, 20___, that the contents of this affidavit are true to my knowledge.</p>'
        + '<p class="small">Print on stamp paper of the value your state requires — there is no single national stamp-paper value for affidavits, so confirm it locally — and sign before a Notary Public or Oath Commissioner. Each consenting heir signs a separate affidavit. This is a draft template generated in your browser — nothing you typed was sent anywhere. This is not legal advice.</p>'
        + '</div><p><button class="btn" onclick="window.print()">Print / save as PDF</button></p>';
      out.scrollIntoView({ behavior: 'smooth' });
    });
  }

  fetch('/data.json').then(function (r) { return r.json(); }).then(function (d) {
    DATA = d; SOURCES = d.meta.sources;
    initWizard(); initFeeCalc(); initLhFinder(); initPetition(); initNoc();
  }).catch(function () {
    var el = document.getElementById('wizard-result') || document.getElementById('fee-result') || document.getElementById('lh-result');
    if (el) el.innerHTML = '<p>Tool data could not be loaded. You can still read the <a href="/checklist/">timeline checklist</a> and the <a href="/fees/">fee table</a>.</p>';
  });
})();
