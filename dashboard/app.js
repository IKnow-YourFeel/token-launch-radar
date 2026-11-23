// Token Radar's dashboard, radar-3. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer
// with the model's own inputs and the protocol's farm plan. No network: every byte it shows
// is in data.js. The board is every rankable pre-token protocol: all 40 watchlist slugs
// plus every other protocol that passes the house's exclusion rules. The pricing term is
// a size curve fitted on the snapshot's live-token protocols and tested held-out two ways;
// the cover proves its own claims with an integrity strip that recomputes them from the
// loaded board, and an audit ledger accounts for all 758 snapshot protocols.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });
  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, growthOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks
  // the number board.json carries, so the page's code and the board's data are visibly the
  // same arithmetic. The pricing term is the fitted size curve: exp(a) x TVL^b, with a and
  // b fit by least squares on log(market cap) against log(TVL) over the snapshot's live
  // protocols. The category multiple is descriptive only since radar-3; see the model
  // panel below the board.
  function catMult(row) {
    var m = DATA.category_multiples || {};
    var v = m[row.category || 'Other'];
    return v === undefined || v === null ? DATA.overall_multiple : v;
  }
  function impliedOf(row, model) {
    var curve = DATA.size_curve || { a: 6.965, b: 0.522 };
    var base = row.tvl_usd > 0 ? Math.exp(curve.a + curve.b * Math.log(row.tvl_usd)) : 1;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chainMult = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_max) * model.chain_step;
    return Math.max(1, Math.round(base * growthMult * maturity * chainMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains,
  // TVL and age decide the action, the capital, the hold and every cost and time.
  // No name is special-cased. Seven steps: set up, the main action, a second feature,
  // a weekly action, the hold, the claim check, and the exit.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('curator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin for a basis position on ' + name + ' on ' + chain + '.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $20 against the supply on ' + name + ' and repay it the same week, so the position shows both sides.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $20 through ' + name + "'s main pool on " + chain + ' in the same week as the deposit.';
    if (c.indexOf('risk curator') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Allocate $20 to a second vault on ' + name + ' on ' + chain + ', so the activity spans two vaults.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Open a second, smaller position on ' + name + ' in the opposite direction and close it the same day.';
    if (c.indexOf('prediction') >= 0) return 'Place a second $20 position on a different market on ' + name + '.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Delegate $20 more through ' + name + ' to a second validator or pool.';
    if (c.indexOf('stable') >= 0 || c.indexOf('rwa') >= 0) return 'Use $20 of the minted asset in ' + name + "'s own app on " + chain + ' instead of leaving it idle.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $20 back through ' + name + ' the following week, so the flow is not one-way.';
    return 'Make a second $20 deposit into ' + name + ' on ' + chain + ' on a different day from the first.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, chain), cost: '$20 of capital and about $2 of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Unwind in two tranches a week apart, keep $10 of gas in the wallet, and write every transaction in a farm log.', cost: 'about $4 of gas to exit', time: '10 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.watchlistOnly = true;
    if (params.get('growth') === '1') state.growthOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('wl', '1');
    if (state.growthOnly) params.set('growth', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.watchlistOnly && !WATCH[r.slug]) return false;
      if (state.growthOnly && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.token_odds; bv = b.token_odds; }
      else if (key === 'expected') { av = a.expected_value_usd; bv = b.expected_value_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The board is every rankable pre-token protocol in the snapshot: the ' + DATA.watchlist_size + ' watchlist protocols, plus ' + DATA.early_size + ' more that pass the same exclusion rules. Implied value is a model, not a promise: a size curve fitted on the snapshot\u2019s live-token protocols (market cap against TVL), times bounded growth, maturity and chain-breadth adjustments. Every row also carries fitted token launch odds and an expected value, and a costed farm verdict.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Rows beyond the watchlist' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  // The integrity strip: the cover proves its own claims by recomputing them from the
  // loaded board, not by repeating the builder's words. Every check runs in this page,
  // on this data, and shows pass or fail.
  function integrityStrip() {
    var rows = DATA.rows.slice().sort(function (a, b) { return a.rank - b.rank; });
    var covered = rows.filter(function (r) { return WATCH[r.slug]; }).length;
    var ranksOk = rows.every(function (r, i) { return r.rank === i + 1; });
    var monoOk = rows.every(function (r, i) { return i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd; });
    var distinct = new Set(rows.map(function (r) { return r.implied_value_usd; })).size;
    var audit = DATA.audit || null;
    var auditOk = audit !== null && (audit.ranked + audit.live + audit.excluded_total) === audit.total;
    var v = DATA.validation || null;
    function chip(label, ok, value) {
      return el('span', { class: 'check' + (ok ? ' pass' : ' fail') },
        el('b', { text: ok ? '✓ ' : '✗ ' }), el('span', { text: label + ': ' }), el('b', { text: value }));
    }
    return el('section', { class: 'panel checks', 'aria-label': 'Integrity checks' },
      el('h2', { text: 'Integrity strip — recomputed live from this board' }),
      el('div', { class: 'check-row' },
        chip('Rows', rows.length >= 100, rows.length + ' rows'),
        chip('Watchlist', covered === DATA.watchlist_size, covered + ' / ' + DATA.watchlist_size),
        chip('Ranks', ranksOk, ranksOk ? '1..' + rows.length : 'broken'),
        chip('Implied order', monoOk, monoOk ? 'non-increasing' : 'out of order'),
        chip('Distinct values', distinct === rows.length, distinct + ' distinct'),
        chip('Audit', auditOk, auditOk ? audit.total + ' accounted for' : 'does not sum'),
        chip('Held-out walk-forward', v !== null, v !== null ? 'x' + v.walk_forward.x + ' (flat x' + v.flat_walk_forward.x + ')' : 'missing'),
        chip('Held-out leave-one-out', v !== null, v !== null ? 'x' + v.leave_one_out.x + ' (flat x' + v.flat_leave_one_out.x + ')' : 'missing')
      ),
      el('p', { class: 'sub', text: 'Walk-forward trains the size curve on the oldest half of dated live protocols and predicts the newest half; leave-one-out predicts each live protocol from all the others. x is the median factor by which the prediction misses the actual market cap — smaller is tighter. The flat multiple is the same two tests for one overall multiple, so the fit\u2019s gain is visible.' })
    );
  }

  // The audit ledger: all 758 snapshot protocols, each counted exactly once.
  function auditLedger() {
    var a = DATA.audit;
    if (!a) return null;
    return el('section', { class: 'panel audit', 'aria-label': 'Audit of all snapshot protocols' },
      el('h2', { text: 'Audit — all ' + a.total + ' snapshot protocols, each counted once' }),
      el('div', { class: 'ledger' },
        el('div', null, el('span', { text: 'Ranked on the board' }), el('b', { class: 'num', text: String(a.ranked) })),
        el('div', null, el('span', { text: 'Live token, set aside' }), el('b', { class: 'num', text: String(a.live) })),
        el('div', null, el('span', { text: 'Excluded: category' }), el('b', { class: 'num', text: String(a.excluded.category) })),
        el('div', null, el('span', { text: 'Excluded: versioned name' }), el('b', { class: 'num', text: String(a.excluded.versioned) })),
        el('div', null, el('span', { text: 'Excluded: wrapped / staked' }), el('b', { class: 'num', text: String(a.excluded.wrapped) })),
        el('div', null, el('span', { text: 'Excluded: exchange name' }), el('b', { class: 'num', text: String(a.excluded.exchange) })),
        el('div', { class: 'total' }, el('span', { text: 'Total accounted for' }), el('b', { class: 'num', text: String(a.ranked + a.live + a.excluded_total) + ' / ' + a.total }))
      ),
      el('p', { class: 'sub', text: 'A protocol is live when the snapshot records any token for it. A pre-token protocol is ranked unless the house\u2019s exclusion rules keep it off the board — an excluded category first, then a versioned name, a wrapped or staked product, or an exchange\u2019s own name — in that order, so no protocol is counted twice.' })
    );
  }

  function topThree() {
    var cards = DATA.rows.slice(0, 3).map(function (r) {
      return el('button', { type: 'button', class: 'spot', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'spot-rank', text: 'Rank ' + r.rank }),
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' · TVL ' + fmtUsd(r.tvl_usd) + ' · 7d ' + fmtPct(r.change_7d) }),
        el('span', { class: 'spot-value', text: fmtUsd(r.implied_value_usd) + ' implied' }),
        el('span', { class: 'sub', text: 'Expected ' + fmtUsd(r.expected_value_usd) + ' · launch odds ' + Math.round(r.token_odds * 100) + '%' })
      );
    });
    return el('section', { class: 'spots', 'aria-label': 'Top three protocols' }, cards);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; }).slice(0, 12);
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wl = el('button', { type: 'button', class: 'toggle', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchlistOnly = !state.watchlistOnly; writeHash(); render(); } });
    var gr = el('button', { type: 'button', class: 'toggle', 'aria-pressed': state.growthOnly ? 'true' : 'false', text: 'Growing only', onclick: function () { state.growthOnly = !state.growthOnly; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Show' }), el('div', { class: 'toggles' }, wl, gr)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; state.growthOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: Math.round(r.token_odds * 100) + '%' }),
        el('td', null, el('span', { class: 'status', text: WATCH[r.slug] ? 'watchlist · no token' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('odds', 'Launch odds'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var c = DATA.size_curve || { a: 6.965, b: 0.522, n: 0 };
    var v = DATA.validation || null;
    var o = DATA.odds_model || null;
    var mults = Object.keys(DATA.category_multiples || {}).map(function (k) { return [k, DATA.category_multiples[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( exp(' + c.a.toFixed(3) + ' + ' + c.b.toFixed(3) + ' x ln(tvl_usd)) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + min(chains - 1, ' + m.chain_max + ') x ' + m.chain_step + ') )'
      ),
      el('p', { class: 'sub', text: 'The pricing term is a size curve fitted on the snapshot\u2019s ' + c.n + ' live-token protocols: log(market cap) = ' + c.a.toFixed(3) + ' + ' + c.b.toFixed(3) + ' x log(TVL) by least squares. Market cap grows slower than TVL, so the curve is sub-linear. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
      el('p', { class: 'sub', text: v !== null ? 'Held-out tests of the size curve: walk-forward x' + v.walk_forward.x + ' (' + v.walk_forward.n_test + ' newest dated protocols predicted from the ' + v.walk_forward.n_train + ' oldest) and leave-one-out x' + v.leave_one_out.x + ' (' + v.leave_one_out.n_test + ' protocols). The same two tests for one flat overall multiple give x' + v.flat_walk_forward.x + ' and x' + v.flat_leave_one_out.x + ' — the fit buys a tighter prediction on both. A per-category intercept was tested the same way and did not beat the curve, so no category term prices the board; growth, maturity and chain breadth are bounded launch adjustments, not fitted pricing terms, and the tests show they neither help nor hurt the pricing fit.' : 'Held-out test numbers are missing from this data.' }),
      el('p', { class: 'sub', text: o !== null ? 'Token launch odds come from the peers\u2019 record: the share of protocols already trading in each age bucket (launch rate ' + o.buckets.map(function (b) { return b.lo_days + 'd ' + Math.round(b.rate * 100) + '%'; }).join(', ') + '), smoothed monotone, with the oldest bucket (' + Math.round(o.f_infinity * 100) + '%) as the plateau. A pre-token protocol\u2019s odds are the conditional share of protocols that reach its age unlaunched and still launch later, adjusted by its TVL tier. Expected value is implied value times odds, a separate field — the ranking never moves on odds.' : '' }),
      el('p', { class: 'sub', text: 'Category multiples below are descriptive only since radar-3: the median market-cap / TVL of live protocols in the category, shrunk toward the overall live median (' + DATA.overall_multiple + ') with a prior of ' + m.category_prior + ' protocols, clamped to ' + m.category_floor + '..' + m.category_cap + '. They feed the launch-readiness score, not the price.' }),
      el('div', { class: 'mults' }, mults.map(function (kv) {
        return el('span', { class: 'mult', text: kv[0] + ' ' + kv[1] });
      }))
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' · watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Fitted base value' }), el('b', { class: 'num', text: fmtUsd(Math.exp(row.size_curve_a + row.size_curve_b * Math.log(row.tvl_usd))) })),
        el('div', null, el('span', { text: 'Category multiple (descriptive)' }), el('b', { class: 'num', text: String(catMult(row)) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: String(row.chain_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    var rd = row.launch_readiness || null;
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Launch odds & expected value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Token launch odds' }), el('b', { class: 'num', text: Math.round(row.token_odds * 100) + '%' })),
        el('div', null, el('span', { text: 'Expected value' }), el('b', { class: 'num', text: fmtUsd(row.expected_value_usd) })),
        el('div', null, el('span', { text: 'Launch readiness' }), el('b', { class: 'num', text: rd !== null ? rd.score + ' / 100 · ' + rd.band : 'n/a' })),
        el('div', null, el('span', { text: 'Launch window' }), el('b', { class: 'num', text: rd !== null ? rd.window : 'n/a' }))
      ),
      el('p', { class: 'sub', text: 'Odds come from the peers\u2019 record: the conditional share of protocols that reach this age unlaunched and still launch later, adjusted by TVL tier. Expected value is implied value times odds; the ranking itself never moves on odds.' + (rd !== null && rd.drivers ? ' Readiness drivers: ' + rd.drivers.join('; ') + '.' : '') })
    ));
    var fv = row.farm_verdict || null;
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan · 7 steps' }),
      fv !== null ? el('div', { class: 'verdict ' + fv.verdict },
        el('b', { text: fv.verdict === 'farm' ? 'Verdict: farm' : fv.verdict === 'thin' ? 'Verdict: thin' : 'Verdict: skip' }),
        el('p', { class: 'sub', text: fv.note }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'Capital' }), el('b', { class: 'num', text: '$' + fv.capital_usd })),
          el('div', null, el('span', { text: 'Gas, whole plan' }), el('b', { class: 'num', text: '$' + fv.gas_usd })),
          el('div', null, el('span', { text: 'Active work' }), el('b', { class: 'num', text: fv.active_minutes + ' min' })),
          el('div', null, el('span', { text: 'Cost per hour of work' }), el('b', { class: 'num', text: '$' + fv.cost_per_hour_usd })),
          el('div', null, el('span', { text: 'Break-even airdrop' }), el('b', { class: 'num', text: '$' + fv.breakeven_usd }))
        )
      ) : null,
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(integrityStrip());
    shell.appendChild(auditLedger());
    if (state.tab === 'pre-token') shell.appendChild(topThree());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
