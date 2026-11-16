// Lumen Radar's dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, its filters, a per-protocol detail
// view with the model's arithmetic and farm plan, and the live-token peer set
// the model's multiples come from. No network: every byte is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    watchlist: params.get('watchlist') === '1',
    sort: params.get('sort') || 'implied',
    dir: -1,
    selected: params.get('select') || null,
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(3); }

  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var categories = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort(); chains.sort();

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.watchlist && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  var SORTS = {
    implied: function (r) { return r.implied_value_usd; },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
    age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    multiple: function (r) { return r.model.peer_multiple; },
    rank: function (r) { return -r.rank; },
  };
  function sorted(list) {
    var key = SORTS[state.sort] || SORTS.implied;
    return list.slice().sort(function (a, b) {
      var d = (key(a) - key(b)) * state.dir;
      return d !== 0 ? d : a.rank - b.rank;
    });
  }

  function headerHtml() {
    return '<header class="top">' +
      '<svg class="rings" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">' +
      '<circle cx="22" cy="22" r="19" fill="none" stroke="#134e4a" stroke-width="2"/>' +
      '<circle cx="22" cy="22" r="12.5" fill="none" stroke="#2dd4bf" stroke-width="2" opacity="0.65"/>' +
      '<circle cx="22" cy="22" r="6" fill="none" stroke="#2dd4bf" stroke-width="2"/>' +
      '<circle cx="22" cy="22" r="2.2" fill="#2dd4bf"/></svg>' +
      '<div><h1>Lumen <span class="accent">Radar</span></h1>' +
      '<p class="tagline">Protocols that record no token yet, ranked by what a token would be worth if the record stayed as it is. ' +
      'Snapshot: DefiLlama via make.fun, as of ' + esc(DATA.as_of) + '. An implied value is this board\'s own claim, not a prediction that a token is issued.</p></div></header>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + DATA.scanned_size + '</b><span>protocols scanned</span></div>' +
      '<div class="stat"><b>' + DATA.board_size + '</b><span>pre-token ranked</span></div>' +
      '<div class="stat"><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b><span>watchlist covered</span></div>' +
      '<div class="stat"><b>' + fmtMult(DATA.global_multiple) + '</b><span>median live mcap/TVL</span></div>' +
      '<div class="stat"><b>' + esc(DATA.model_version) + '</b><span>model</span></div></div>' +
      '<div class="model"><b>The model.</b> Each category\'s live-token protocols set its price of TVL: ' +
      '<code>implied = TVL x peer multiple (category median mcap/TVL)</code> then three adjustments from the same snapshot: ' +
      '<code>momentum</code> from the 7-day TVL change, <code>track</code> from how long DefiLlama has tracked the protocol with no token, ' +
      'and <code>breadth</code> from its chain count. Click any row for its arithmetic and farm plan.</div>';
  }

  function controlsHtml() {
    var catOpts = '<option value="all">All categories</option>' + categories.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainOpts = '<option value="all">All chains</option>' + chains.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var sortOpts = [['implied', 'Implied value'], ['tvl', 'TVL'], ['change', '7d change'], ['age', 'Age'], ['multiple', 'Peer multiple'], ['rank', 'Board rank']].map(function (s) {
      return '<option value="' + s[0] + '"' + (state.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
    }).join('');
    return '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search protocols" value="' + esc(state.q) + '">' +
      '<select id="category">' + catOpts + '</select>' +
      '<select id="chain">' + chainOpts + '</select>' +
      '<label class="check"><input type="checkbox" id="watchlist"' + (state.watchlist ? ' checked' : '') + '> Watchlist only</label>' +
      '<select id="sort">' + sortOpts + '</select>' +
      '<span class="count" id="count"></span></div>';
  }

  function boardHtml(list) {
    if (list.length === 0) return '<div class="empty">No protocol matches the current filter.</div>';
    var head = '<table class="board"><thead><tr>' +
      '<th data-k="rank">#</th><th data-k="rank">Protocol</th><th data-k="tvl">TVL</th>' +
      '<th data-k="change">7d</th><th data-k="age">Age</th><th data-k="multiple">Peer x</th>' +
      '<th data-k="implied">Implied value</th></tr></thead><tbody>';
    var body = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        '<div class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 3).join(', ') || 'no chain listed') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</div></td>' +
        '<td>' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td>' + fmtAge(r.age_days) + '</td>' +
        '<td>' + fmtMult(r.model.peer_multiple) + '</td>' +
        '<td class="implied">' + fmtUsd(r.implied_value_usd) + '</td></tr>';
    }).join('');
    return head + body + '</tbody></table>';
  }

  function detailHtml(r) {
    var m = r.model;
    var base = Math.round(r.tvl_usd * m.peer_multiple);
    var peerNote = m.peer_scope === 'category'
      ? 'category median, ' + m.peer_count + ' live ' + esc(r.category || '') + ' peers'
      : 'global median, ' + m.peer_count + ' live peers (too few live ' + esc(r.category || 'peers') + ' peers for its own)';
    var arith = 'TVL ' + fmtUsd(r.tvl_usd) + ' x peer multiple <b>' + fmtMult(m.peer_multiple) + '</b> (' + peerNote + ')' +
      ' = ' + fmtUsd(base) + '<br>x momentum <b>' + fmtMult(m.momentum_multiplier) + '</b> (7d change ' + fmtPct(r.change_7d) + ')' +
      ' x track <b>' + fmtMult(m.track_multiplier) + '</b> (tracked ' + fmtAge(r.age_days) + ' with no token)' +
      ' x breadth <b>' + fmtMult(m.breadth_multiplier) + '</b> (' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + ')' +
      '<br>= implied value <b>' + fmtUsd(r.implied_value_usd) + '</b>';
    var plan = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<section class="detail" id="detail"><button class="close" id="closeDetail">Close</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<div class="facts">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chain listed') +
      ' · TVL ' + fmtUsd(r.tvl_usd) + ' · 7d ' + fmtPct(r.change_7d) + ' · first tracked ' + esc(r.listed_at || 'unknown') +
      ' · records no token (no market cap, no CoinGecko id, no symbol in the snapshot)</div>' +
      '<div class="arith">' + arith + '</div>' +
      '<h3>Farm plan</h3><ol class="plan">' + plan + '</ol></section>';
  }

  function liveHtml() {
    var body = DATA.live.map(function (p) {
      return '<tr><td><span class="name">' + esc(p.name) + '</span> <span class="sub">' + esc(p.symbol || '') + '</span></td>' +
        '<td>' + esc(p.category || '') + '</td><td>' + fmtUsd(p.tvl_usd) + '</td>' +
        '<td>' + fmtUsd(p.mcap_usd) + '</td><td>' + fmtMult(p.tvl_multiple) + '</td>' +
        '<td class="' + (p.change_7d === null ? '' : p.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(p.change_7d) + '</td></tr>';
    }).join('');
    return '<section class="live"><h2>Already trading: the peer set</h2>' +
      '<p>These protocols record a token, so the board never ranks them. Their market caps are the market\'s own values, ' +
      'and their mcap-to-TVL ratios, grouped by category, are the peer multiples that price the pre-token board above.</p>' +
      '<table class="live"><thead><tr><th>Protocol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>mcap/TVL</th><th>7d</th></tr></thead><tbody>' +
      body + '</tbody></table></section>';
  }

  function render() {
    var list = sorted(filtered());
    var sel = state.selected ? bySlug[state.selected] : null;
    app.innerHTML = headerHtml() + controlsHtml() +
      (sel ? detailHtml(sel) : '') + boardHtml(list) + liveHtml() +
      '<footer>Data: ' + esc(DATA.source) + ' · Board: ' + DATA.board_size + ' pre-token protocols, every one of the ' +
      DATA.watchlist_size + ' watchlist protocols included · Model ' + esc(DATA.model_version) +
      ': category peer multiples from the snapshot\'s live protocols, adjusted for momentum, track record and chain breadth. ' +
      'Implied values are this board\'s claims about a hypothetical token, not prices and not investment advice.</footer>';
    app.setAttribute('aria-busy', 'false');
    document.getElementById('count').textContent = list.length + ' of ' + rows.length + ' rows';
    bind(list);
  }

  function bind(list) {
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; rerender(false); });
    var cat = document.getElementById('category');
    cat.addEventListener('change', function () { state.category = cat.value; rerender(true); });
    var ch = document.getElementById('chain');
    ch.addEventListener('change', function () { state.chain = ch.value; rerender(true); });
    var w = document.getElementById('watchlist');
    w.addEventListener('change', function () { state.watchlist = w.checked; rerender(true); });
    var so = document.getElementById('sort');
    so.addEventListener('change', function () { state.sort = so.value; rerender(true); });
    app.querySelectorAll('table.board th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = -1; }
        rerender(true);
      });
    });
    app.querySelectorAll('table.board tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.selected = tr.getAttribute('data-slug');
        rerender(true);
        var d = document.getElementById('detail');
        if (d) d.scrollIntoView({ block: 'nearest' });
      });
    });
    var close = document.getElementById('closeDetail');
    if (close) close.addEventListener('click', function () { state.selected = null; rerender(true); });
    // Keep the search box focused while typing: render() rebuilt the DOM.
    if (document.activeElement && document.activeElement.id === 'q') { /* focus is lost on rebuild; restore below */ }
  }
  var focusSearch = false;
  function rerender(restoreFocus) {
    var hadFocus = document.activeElement && document.activeElement.id === 'q';
    render();
    if (hadFocus || restoreFocus === false && focusSearch) {
      var q2 = document.getElementById('q');
      if (q2 && hadFocus) { q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }
    }
    focusSearch = false;
  }

  render();
})();
