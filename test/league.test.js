import assert from 'node:assert/strict';
import {test} from 'node:test';
import {handleApi, seal} from '../server/api.js';

const origin = 'https://laguia.test';
const competition = '/api/v1/competition/1';
const env = {SESSION_SECRET: 'test-only-secret'};
const league = 'L1';
const own = 'T1';
const rival = 'T2';
const market = competition + '/league/' + league + '/market';
const standings = competition + '/leagues/' + league + '/standing';
const squad = competition + '/leagues/' + league + '/teams/' + rival;
const balance = competition + '/teams/' + own + '/money';
const leagueList = competition + '/leagues';
const slot = {playerTeamId: 'slot-2', playerMaster: {id: '42'}, buyoutClause: 4200000};
const listing = {id: 'entry-7', discr: 'marketPlayerLeague', salePrice: '1200000', playerMaster: {id: '91', marketValue: '1100000'}};

async function fixture(overrides = {}) {
  const expires = Date.now() + 3600000;
  const token = await seal({access: 'test', expires, until: expires}, env);
  const requests = [];
  const replies = {
    ['GET ' + leagueList]: [{id: league, type: 'private', team: {id: own}}],
    ['GET ' + standings]: [{teamId: own}, {team: {id: rival}}],
    ['GET ' + squad]: {squad: [slot]},
    ['GET ' + balance]: {teamMoney: 8000000},
    ['GET ' + market]: [listing],
    ...overrides,
  };
  const fetcher = (url, options) => {
    const path = new URL(url).pathname;
    const key = options.method + ' ' + path;
    requests.push({key, body: options.body && JSON.parse(options.body)});
    assert.equal(options.headers.authorization, 'Bearer test');
    assert.ok(Object.hasOwn(replies, key), key);
    const response = replies[key];
    return response instanceof Response ? response.clone() : Response.json(response);
  };
  const call = async (body, {requestOrigin = origin, signed = true, url = '/api/league'} = {}) => {
    const headers = {origin: requestOrigin};
    if (signed) headers.cookie = '__Secure-lg_s0=' + token;
    const options = body ? {method: 'POST', body: JSON.stringify(body), headers} : {headers};
    const response = await handleApi(new Request(origin + url, options), env, fetcher);
    return [response.status, await response.json()];
  };
  return {requests, call};
}

const bid = {action: 'bid', leagueId: league, playerId: '91', listingId: listing.id, amount: 1500000};
const clause = {action: 'clause', leagueId: league, playerId: '42', sellerId: rival, slotId: 'slot-2', amount: 4200000};

test('a confirmed bid uses the market listing ID and a validated amount', async () => {
  const route = 'POST ' + market + '/entry-7/bid';
  const {requests, call} = await fixture({[route]: {ok: true}});
  assert.deepEqual(await call(bid), [200, {ok: true}]);
  assert.deepEqual(requests.at(-1), {key: route, body: {money: 1500000}});
});

test('only a current bid can be updated and other members receive offers', async () => {
  const route = 'PUT ' + market + '/entry-7/bid/bid-5';
  const onSale = {...listing, id: 'entry-8', discr: 'marketPlayerTeam', sellerTeam: {id: rival}};
  const offer = 'POST ' + market + '/entry-8/offer';
  const {requests, call} = await fixture({
    ['GET ' + market]: [{...listing, bid: {id: 'bid-5', money: 1600000}}, onSale],
    [route]: {ok: true},
    [offer]: {ok: true},
  });
  assert.equal((await call(bid))[0], 409);
  assert.equal((await call({...bid, previousBidId: 'bid-5', amount: 1}))[0], 409);
  assert.equal((await call({...bid, previousBidId: 'bid-5'}))[0], 200);
  assert.deepEqual(requests.at(-1), {key: route, body: {money: 1500000}});
  assert.equal((await call({...bid, action: 'offer', listingId: onSale.id}))[0], 200);
  assert.deepEqual(requests.at(-1), {key: offer, body: {money: 1500000}});
});

test('clausulazo rechecks ownership, cash, protection and agreed release price', async () => {
  const route = 'POST ' + competition + '/league/' + league + '/buyout/slot-2/pay';
  const {requests, call} = await fixture({[route]: {ok: true}});
  assert.equal((await call({...clause, amount: 4300000}))[0], 409);
  assert.equal((await call({...clause, sellerId: own}))[0], 400);
  assert.equal((await call({...clause, playerId: '43'}))[0], 409);
  assert.equal(requests.filter(r => r.key.startsWith('POST')).length, 0);
  assert.equal((await call(clause))[0], 200);
  assert.deepEqual(requests.at(-1), {key: route, body: {buyoutClauseToPay: 4200000}});

  for (const override of [
    {['GET ' + squad]: [{...slot, isShielded: true}]},
    {['GET ' + squad]: [{...slot, buyoutClauseLockedEndTime: '2099-12-31T12:00:00Z'}]},
    {['GET ' + balance]: {teamMoney: 10}},
  ]) {
    const blocked = await fixture(override);
    assert.equal((await blocked.call(clause))[0], 409);
    assert.equal(blocked.requests.some(r => r.key.startsWith('POST')), false);
  }
});

test('club actions require same origin, an authenticated session, and league membership', async () => {
  const {requests, call} = await fixture();
  assert.equal((await call(bid, {requestOrigin: 'https://other.test'}))[0], 403);
  assert.equal((await call(bid, {signed: false}))[0], 401);
  assert.equal((await call({...bid, listingId: '../other'}))[0], 400);
  assert.equal((await call({...bid, leagueId: 'other'}))[0], 403);
  assert.equal((await call({...bid, action: 'shield'}))[0], 400);
  assert.equal(requests.every(r => r.key === 'GET ' + leagueList), true);
});

test('reward availability is read for the signed-in team', async () => {
  const check = 'GET ' + competition + '/league/' + league + '/team/' + own + '/check-daily-reward';
  const catalogue = 'GET ' + competition + '/daily-reward';
  const overrides = {
    [catalogue]: [{leagueType: 'private', dailyLimit: 2, money: 150000}],
    [check]: {teamId: own, dailyRewardsRedeemed: 1},
  };
  const {call} = await fixture(overrides);
  const url = '/api/league?id=' + league;
  assert.deepEqual(await call(null, {url}), [200, {
    teamId: own, reward: {available: true, amount: 150000, claimed: 1, remaining: 1},
  }]);
  const limit = await fixture({...overrides, [check]: Response.json({errorCode: '050.01.04'}, {status: 400})});
  assert.equal((await limit.call(null, {url}))[1].reward.available, false);
});
