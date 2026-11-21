import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const now = Date.parse('2026-11-16T10:00:00+01:00');

class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [now]));
  }

  static now() {
    return now;
  }
}

function loadMarket() {
  const code = script.replace(/^boot\(\);$/m, '') +
    '\n({S, historyValues, dailyMarketChanges, squadValuePeriod, squadValuation, newClauseMarket, clauseRows,' +
    ' standingInfo, mergePrivate, clauseOwner, profilePlayerActions, available, assistantPurchaseOptions,' +
    ' assistantSalePlans, optimize, loadLeaguePreferences, saveLeaguePreference, rewardBalanceChange})';
  const storage = new Map([['lg-v2-watch', '["legacy"]']]);
  return runInNewContext(code, {
    Date: FixedDate,
    document: {addEventListener() {}},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    setInterval() {},
  });
}

test('player history uses the last reading per Madrid day and skips gaps in daily changes', () => {
  const {historyValues, dailyMarketChanges} = loadMarket();
  const rows = historyValues([
    {date: '2026-10-25T03:00:00Z', marketValue: 1500000},
    {date: '2026-10-24T00:00:00+02:00', marketValue: 1400000},
    {date: '2026-10-24T22:10:00Z', marketValue: 1450000},
    {date: '2026-10-27T00:00:00+01:00', marketValue: 1800000},
  ]);
  assert.deepEqual(Array.from(dailyMarketChanges(rows), ([day, change]) => [day, change]),
    [['2026-10-25', 100000]]);
});

test('team valuation compares the same players and reports coverage for each day', () => {
  const {S, squadValuePeriod, squadValuation} = loadMarket();
  S.roster = [{id: '1', value: 140}, {id: '2', value: 180}, {id: '3', value: 20}];
  S.squadValue = {histories: new Map([
    ['1', [{day: '2026-11-14', value: 100}, {day: '2026-11-15', value: 120}, {day: '2026-11-16', value: 140}]],
    ['2', [{day: '2026-11-14', value: 190}, {day: '2026-11-15', value: 195}, {day: '2026-11-16', value: 180}]],
    ['3', [{day: '2026-11-16', value: 20}]],
  ])};
  const summary = squadValuation({from: '2026-11-15', to: '2026-11-16'}, true);
  assert.equal(summary.price, 340);
  assert.equal(summary.change, 30);
  assert.equal(summary.compared, 2);
  assert.deepEqual(Array.from(summary.rows, row => [row.day, row.value, row.count]),
    [['2026-11-15', 25, 2], ['2026-11-16', 5, 2]]);
  const week = squadValuePeriod({mode: 'week', week: '2026-11-15'});
  assert.equal(week.from, '2026-11-09');
  assert.equal(week.to, '2026-11-15');
  assert.equal(squadValuation({from: '2026-11-18', to: '2026-11-16'}).change, null);
});

test('clause lists respect protection dates and recommendations exclude risky or unaffordable picks', () => {
  const {S, newClauseMarket, clauseRows} = loadMarket();
  S.teamId = 'own';
  S.balance = 7000000;
  S.clauseMarket = newClauseMarket();
  const candidate = (id, overrides = {}) => ({
    id, name: id, privateId: 'slot-' + id, ownerTeamId: 'rival', clause: 5000000, value: 6000000,
    points: 75, average: 5.8, recent: 6.2, prob: 90, status: 'ok', ...overrides,
  });
  const twoHours = new Date(now + 7200000).toISOString();
  const fourHours = new Date(now + 14400000).toISOString();
  S.clauseMarket.rosters.set('rival', [
    candidate('Oferta'), candidate('Sin saldo', {clause: 8000000, value: 10000000}),
    candidate('Titularidad baja', {prob: 30}), candidate('Precio excesivo', {clause: 6900000, value: 4500000}),
    candidate('Datos antiguos', {probabilityMismatch: true}), candidate('Lesionado', {status: 'injured'}),
    candidate('Fecha desconocida', {shielded: true}),
    candidate('Bloqueada', {shielded: true, shieldedUntil: twoHours, clauseLockedUntil: fourHours}),
  ]);
  S.clauseMarket.rosters.set('own', [candidate('Propio', {ownerTeamId: 'own'})]);
  S.marketTab = 'clauses-open';
  assert.deepEqual(Array.from(clauseRows({smart: true}), row => row.p.id), ['Oferta']);
  assert.equal(clauseRows().length, 7);
  S.marketTab = 'clauses-locked';
  assert.equal(clauseRows().length, 2);
  const [locked] = clauseRows({smart: true});
  assert.equal(locked.p.id, 'Bloqueada');
  assert.equal(locked.protection.until, Date.parse(fourHours));
});

test('clauses and player profiles keep the league manager name when the team name is missing', () => {
  const {S, standingInfo, mergePrivate, clauseOwner, profilePlayerActions} = loadMarket();
  const slot = {id: 'slot', playerMaster: {id: '1', nickname: 'Jugador', teamId: 'club'}, buyoutClause: 5000000};
  S.teams = [{id: 'club', name: 'Club de LALIGA'}];
  const standing = {teamId: 'rival', team: {user: {nickname: '  Ana & Co  '}}};
  const [fromStanding] = mergePrivate([slot], 'roster', standingInfo(standing));
  assert.equal(fromStanding.ownerTeamId, 'rival');
  assert.equal(fromStanding.ownerName, null);
  assert.equal(fromStanding.ownerManager, 'Ana & Co');
  assert.match(clauseOwner(fromStanding), /Ana &amp; Co/);
  assert.match(profilePlayerActions(fromStanding), /Mánager fantasy · Ana &amp; Co/);

  const payload = {data: {team: {displayName: 'Equipo Rival', manager: {username: 'Carlos'}}, players: [slot]}};
  const [fromRoster] = mergePrivate(payload, 'roster', standingInfo({teamId: 'rival'}));
  assert.equal(fromRoster.ownerName, 'Equipo Rival');
  assert.equal(fromRoster.ownerManager, 'Carlos');

  S.standings = [standing];
  const [listing] = mergePrivate([{...slot, discr: 'marketPlayerTeam', sellerTeamId: 'rival'}], 'market');
  assert.equal(listing.ownerManager, 'Ana & Co');
  const [auction] = mergePrivate([{...slot, discr: 'marketPlayerLeague', teamName: 'Club de LALIGA'}], 'market');
  assert.equal(auction.ownerName, null);
  assert.equal(auction.ownerManager, null);
});

test('purchase analysis uses actual league listings, bid minima, position and available balance', () => {
  const {S, available, assistantPurchaseOptions, newClauseMarket} = loadMarket();
  S.teamId = 'own';
  S.balance = 7000000;
  const listing = (id, overrides = {}) => ({
    id, position: 2, listing: 'listing-' + id, listingType: 'marketPlayerLeague', price: 4000000, value: 4500000,
    points: 50, average: 4, recent: 5, prob: 90, ...overrides,
  });
  S.roster = [listing('already-own')];
  S.players = [listing('catalogue-only', {listing: ''})];
  S.market = [
    listing('valid'),
    listing('too-expensive', {value: 7500000}),
    listing('wrong-position', {position: 3}),
    listing('expired', {expires: new Date(now - 1000).toISOString()}),
    listing('already-own'),
  ];
  const state = {source: 'league', position: '2', order: 'price', budget: 6000000};
  assert.deepEqual(Array.from(assistantPurchaseOptions(state), row => [row.p.id, row.amount]), [['valid', 4500000]]);
  assert.equal(assistantPurchaseOptions({...state, budget: 4400000}).length, 0);
  const simulated = assistantPurchaseOptions({...state,budget:8000000,funding:'simulation'});
  assert.deepEqual(Array.from(simulated,row=>row.p.id), ['valid','too-expensive']);
  S.clauseMarket = newClauseMarket();
  S.clauseMarket.rosters.set('rival', [
    listing('open', {ownerTeamId: 'rival', privateId: 'slot-open', clause: 5000000}),
    listing('blocked', {ownerTeamId: 'rival', privateId: 'slot-blocked', clause: 5000000, shielded: true}),
  ]);
  assert.deepEqual(Array.from(assistantPurchaseOptions({...state, source: 'clauses-open'}), row=>row.p.id), ['open']);
  assert.deepEqual(Array.from(assistantPurchaseOptions({...state, source: 'clauses-locked'}), row=>row.p.id), ['blocked']);
  S.market = [];
  assert.equal(available().length, 0);
  assert.equal(assistantPurchaseOptions(state).length, 0);
});

test('sale plans cover the target with substitutes and keep a valid lineup and pinned players', () => {
  const {S, assistantSalePlans, optimize} = loadMarket();
  const player = (id, position, value = 8e6, average = 5) => ({id, position, value, average, recent: average, prob: 90});
  S.roster = [player('gk', 1), ...Array.from({length:4}, (_, i)=>player('def'+i,2)),
    ...Array.from({length:4}, (_, i)=>player('mid'+i,3)), player('fwd0',4), player('fwd1',4),
    player('bench-def',2,5e6,1), player('bench-mid',3,6e6,1)];
  S.locked = ['def0'];
  S.lineup = optimize(S.roster, '4-4-2', S.risk, S.locked);
  const [plan] = assistantSalePlans(11e6, 'bench');
  assert.ok(plan.meets);
  assert.equal(plan.loss, 0);
  assert.equal(plan.lineup.players.length, 11);
  assert.deepEqual(Array.from(plan.sold, p=>p.id), ['bench-def','bench-mid']);
  for (const option of assistantSalePlans(50e6, 'all')) {
    assert.ok(option.sold.every(p=>p.id!=='def0'));
    assert.equal(option.lineup.players.length, 11);
  }
});

test('watchlists and dismissed alerts are restored per account and league', () => {
  const {S, loadLeaguePreferences, saveLeaguePreference} = loadMarket();
  S.auth = {authenticated:true,userId:'account-1'};
  S.league = {id:'league-a'};
  loadLeaguePreferences();
  assert.equal(S.watch.length, 0);
  S.watch = ['only-in-a'];
  S.dismissed = ['status-only-in-a'];
  saveLeaguePreference('watch');
  saveLeaguePreference('dismissed');

  S.league = {id:'league-b'};
  loadLeaguePreferences();
  assert.equal(S.watch.length, 0);
  assert.equal(S.dismissed.length, 0);
  S.watch = ['only-in-b'];
  saveLeaguePreference('watch');

  S.league = {id:'league-a'};
  loadLeaguePreferences();
  assert.deepEqual(Array.from(S.watch), ['only-in-a']);
  assert.deepEqual(Array.from(S.dismissed), ['status-only-in-a']);
  S.auth.userId = 'account-2';
  loadLeaguePreferences();
  assert.equal(S.watch.length, 0);
});


test('a reward balance update needs a claim confirmed for the same team and day', () => {
  const {rewardBalanceChange} = loadMarket();
  const day = '2026-11-16';
  const before = {teamId: 'T1', day, claimed: 0, balance: 3200000};
  assert.equal(rewardBalanceChange(before, {available:true,claimed:0}, 3300000, 'T1', day), null);
  assert.equal(rewardBalanceChange(before, {available:true,claimed:1}, 3300000, 'T2', day), null);
  assert.equal(rewardBalanceChange(before, {available:false}, 3300000, 'T1', '2026-11-17'), null);
  assert.equal(rewardBalanceChange(before, {available:false}, null, 'T1', day), null);
  assert.equal(rewardBalanceChange(before, {available:false,claimed:1}, 3200000, 'T1', day), null);
  assert.equal(rewardBalanceChange(before, {available:false,claimed:1}, 3100000, 'T1', day), null);
  assert.equal(rewardBalanceChange({...before,claimed:1}, {available:false,claimed:1}, 3300000, 'T1', day), null);
  const delayedStatus = rewardBalanceChange({...before,confirmed:true}, {available:true,claimed:0}, 3300000, 'T1', day);
  assert.equal(delayedStatus.after, 3300000);
  for (const reward of [{available:true,claimed:1},{available:false,claimed:null}]) {
    const delta = rewardBalanceChange(before, reward, 3300000, 'T1', day);
    assert.equal(delta.before, 3200000);
    assert.equal(delta.after, 3300000);
  }
});
