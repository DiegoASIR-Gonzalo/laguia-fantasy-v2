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
    '\n({S, historyValues, dailyMarketChanges, squadValuePeriod, squadValuation, newClauseMarket, clauseRows})';
  return runInNewContext(code, {
    Date: FixedDate,
    document: {addEventListener() {}},
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
