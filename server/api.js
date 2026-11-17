import {footballFantasyTeam} from './futbolfantasy.js';

const API='https://fantasy-api.llt-services.com/api';
const IDP='https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/';
const POLICY='B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN';
const CLIENT='af88bcff-1157-40a0-b579-030728aacf0b';
const REDIRECT='authredirect://com.lfp.laligafantasy';
const encoder=new TextEncoder();
const inflight=new Map();
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=str=>Uint8Array.from(atob(str.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const random=n=>b64(crypto.getRandomValues(new Uint8Array(n)));
const cookies=request=>Object.fromEntries((request.headers.get('cookie')||'').split(';').map(s=>{const i=s.indexOf('=');return i>0?[s.slice(0,i).trim(),s.slice(i+1)]:['','']}).filter(x=>x[0]));
async function key(env){if(!env.SESSION_SECRET)throw Object.assign(Error('El servicio de conexión necesita configuración.'),{status:503});return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode(env.SESSION_SECRET)),{name:'AES-GCM'},false,['encrypt','decrypt'])}
export async function seal(obj,env){const iv=crypto.getRandomValues(new Uint8Array(12));const payload=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('laguia-v2-session')},await key(env),encoder.encode(JSON.stringify(obj)));return b64(iv)+'.'+b64(payload)}
export async function unseal(text,env){try{if(!text||text.length>25000)return null;const [iv,payload]=text.split('.');const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:encoder.encode('laguia-v2-session')},await key(env),unb64(payload));const decoded=JSON.parse(new TextDecoder().decode(data));if(decoded.until<Date.now())return null;return decoded}catch{return null}}
function cookie(name,value,maxAge){return `${name}=${value}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0,Math.floor(maxAge))}; Priority=High`}
function clearSession(headers){for(let i=0;i<6;i++)headers.append('set-cookie',cookie('__Secure-lg_s'+i,'',0));headers.append('set-cookie',cookie('__Secure-lg_p','',0))}
async function setSession(headers,session,env){const payload=await seal(session,env);const pieces=payload.match(/.{1,3300}/g)||[];if(pieces.length>6)throw Error('La respuesta de acceso es demasiado grande.');for(let i=0;i<6;i++)headers.append('set-cookie',cookie('__Secure-lg_s'+i,pieces[i]||'',pieces[i]?(session.until-Date.now())/1000:0));headers.append('set-cookie',cookie('__Secure-lg_p','',0))}
function claims(token){try{return JSON.parse(new TextDecoder().decode(unb64(token.split('.')[1])))}catch{return {}}}
function identity(raw){const c=claims(raw.id_token||raw.access_token||'');return {name:c.name||c.given_name||'',userId:c.sub||c.oid||'',email:c.email||c.emails?.[0]||''}}
function expiry(raw){const token=raw.access_token||raw.id_token;return Number(raw.expires_on)*1000||Number(claims(token||'').exp)*1000||Date.now()+(Number(raw.expires_in)||3600)*1000}
async function tokenRequest(values,fetcher){const response=await fetcher(IDP+'token?p='+POLICY,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body:new URLSearchParams({client_id:CLIENT,scope:'openid offline_access',...values}),signal:AbortSignal.timeout(20000)});const raw=await response.json();if(!response.ok||!(raw.access_token||raw.id_token)){const error=Error(response.status>=500?'LALIGA no responde ahora. Vuelve a intentarlo.':'LALIGA no ha aceptado la autorización. Abre un acceso nuevo y vuelve a conectar.');error.status=response.status>=500?502:401;throw error}return raw}
async function sessionFrom(request,env,fetcher,headers){const jar=cookies(request);let sealed='';for(let i=0;i<6;i++)sealed+=jar['__Secure-lg_s'+i]||'';let session=await unseal(sealed,env);if(!session)return null;const user=request.headers.get('oai-authenticated-user-id')||'';if(session.owner&&user!==session.owner)return null;
 if(session.expires<Date.now()+180000){if(!session.refresh){clearSession(headers);return null}const digest=b64(await crypto.subtle.digest('SHA-256',encoder.encode(session.refresh)));let work=inflight.get(digest);if(!work){work=(async()=>{const fresh=await tokenRequest({grant_type:'refresh_token',refresh_token:session.refresh},fetcher);return {...session,access:fresh.access_token||fresh.id_token,refresh:fresh.refresh_token||session.refresh,expires:expiry(fresh)}})();inflight.set(digest,work);work.finally(()=>{setTimeout(()=>inflight.delete(digest),5000)}).catch(()=>{})}try{session=await work;await setSession(headers,session,env)}catch(error){if(error.status===401){clearSession(headers);return null}throw error}}
 return session;
}
function sessionInfo(s){return {authenticated:!!s,...(s?{managerName:s.managerName,userId:s.userId,expiresAt:new Date(s.until).toISOString(),tokenExpiresAt:new Date(s.expires).toISOString(),renewable:!!s.refresh,remember:s.remember}:{} )}}
async function official(path,session,fetcher,options={}){return fetcher(API+path+(path.includes('?')?'&':'?')+'x-lang=es',{method:options.method||'GET',headers:{'x-app':'2','x-lang':'es','accept':'application/json','referer':'https://fantasy.laliga.com/',...(session?{authorization:'Bearer '+session.access}:{}),...(options.body?{'content-type':'application/json'}:{})},body:options.body?JSON.stringify(options.body):undefined,signal:AbortSignal.timeout(20000)})}
const safeId=id=>/^[a-zA-Z0-9_-]{1,100}$/.test(String(id));
function list(raw,depth=0){if(Array.isArray(raw))return raw;if(!raw||typeof raw!=='object'||depth>4)return [];for(const k of ['leagues','players','playerTeams','teamPlayers','roster','squad','market','standing','standings','teams','rewards','items','data','content','results','entries']){if(Array.isArray(raw[k]))return raw[k];if(raw[k]&&typeof raw[k]==='object'){const values=list(raw[k],depth+1);if(values.length)return values}}return []}
function teamFor(league){return String(league.team?.id??league.myTeam?.id??league.userTeam?.id??league.ownTeam?.id??league.teamId??league.myTeamId??league.userTeamId??'')}
async function verifyOwnTeam(teamId,session,fetcher){const response=await official('/v1/competition/1/leagues',session,fetcher);if(!response.ok)throw Object.assign(Error('No se pudo verificar tu equipo. Actualiza tus ligas.'),{status:403});const leagues=list(await response.json());const league=leagues.find(l=>teamFor(l)===teamId);if(!league)throw Object.assign(Error('Esta operación solo está disponible para tu propio equipo.'),{status:403});return league}
const competition = '/v1/competition/1';
const leagueActionsInFlight = new Set();
const fail = (status, message) => Object.assign(Error(message), {status});
const numeric = value => (typeof value !== 'string' && typeof value !== 'number') || value === ''
  ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const positiveAmount = value => Number.isSafeInteger(value) && value > 0;
const validId = value => typeof value === 'string' && safeId(value);
const masterOf = row => row.playerMaster ?? row.playerTeam?.playerMaster ?? row.player?.playerMaster ?? row.player ?? {};
const standingTeamId = row => String(row.teamId ?? row.team?.id ?? row.id ?? '');

async function upstreamJson(response) {
  return response.json().catch(() => null);
}

async function gameRead(path, session, fetcher) {
  const response = await official(path, session, fetcher);
  if (response.status === 401) throw fail(401, 'Tu acceso ha caducado. Conecta de nuevo tu cuenta.');
  if (!response.ok) throw fail(502, 'No se pudo verificar la información con LALIGA. Actualiza e inténtalo de nuevo.');
  const value = await upstreamJson(response);
  if (value === null) throw fail(502, 'LALIGA no ha devuelto información válida.');
  return value;
}

async function leagueMember(id, session, fetcher) {
  const leagues = list(await gameRead(competition + '/leagues', session, fetcher));
  const league = leagues.find(row => String(row.id ?? row.leagueId ?? row.league?.id ?? '') === id);
  if (!league) throw fail(403, 'Tu cuenta no pertenece a esa liga.');

  let teamId = teamFor(league);
  if (!teamId) {
    const [me, standings] = await Promise.all([
      gameRead('/v4/user/me', session, fetcher),
      gameRead(competition + '/leagues/' + id + '/standing', session, fetcher),
    ]);
    const userId = String(me.id ?? me.userId ?? '');
    const own = list(standings).find(row =>
      row.isMyTeam === true || (userId && String(row.userId ?? row.team?.manager?.id ?? '') === userId));
    teamId = own ? standingTeamId(own) : '';
  }
  if (!safeId(teamId)) throw fail(403, 'LALIGA no ha identificado tu equipo en esta liga.');
  return {id, teamId, league};
}

async function leagueReward(member, session, fetcher) {
  const {id, teamId, league} = member;
  const [status, catalogue] = await Promise.all([
    official(competition + '/league/' + id + '/team/' + teamId + '/check-daily-reward', session, fetcher),
    official(competition + '/daily-reward', session, fetcher).catch(() => null),
  ]);
  if (status.status === 401) throw fail(401, 'Tu acceso ha caducado. Conecta de nuevo tu cuenta.');
  const progress = await upstreamJson(status);
  const type = league.isPremium === true ? 'premium' :
    String(league.leagueType ?? league.type ?? league.discr ?? league.league?.type ?? '').toLowerCase();
  const plan = catalogue?.ok ? list(await upstreamJson(catalogue)).find(item => item.leagueType === type) : null;
  const limit = numeric(plan?.dailyLimit);
  const count = numeric(progress?.dailyRewardsRedeemed);
  if (String(progress?.errorCode) === '050.01.04') return {available: false, remaining: 0, claimed: limit};
  if (!status.ok || count === null) return {available: null};
  const remaining = limit === null ? null : Math.max(0, limit - count);
  return {available: remaining === null || remaining > 0, remaining, claimed: count, amount: numeric(plan?.money)};
}

const rewardErrors = {
  '050.01.04': 'Ya has reclamado todas las recompensas de hoy en esta liga.',
  '050.01.05': 'La recompensa diaria todavía no está disponible.',
};

async function claimDailyReward(member, session, fetcher) {
  const {id, teamId} = member;
  const path = competition + '/league/' + id + '/team/daily-reward';
  const response = await official(path, session, fetcher, {
    method: 'POST',
    body: {rewardedAdType: 'dailyreward', rewardedAd: 1, teamId},
  }).catch(() => {
    throw fail(502, 'No se pudo confirmar la recompensa. Comprueba el saldo antes de reintentarlo.');
  });
  if (response.status === 401) throw fail(401, 'Tu acceso ha caducado. Conecta de nuevo tu cuenta.');
  if (!response.ok) {
    const error = await upstreamJson(response);
    throw fail(409, rewardErrors[String(error?.errorCode ?? '')] ||
      'LALIGA no ha aceptado la recompensa. Inténtalo de nuevo más tarde.');
  }
}

function bidRecord(listing) {
  const detail = listing.bid ?? listing.myBid ?? listing.offer ?? listing.myOffer;
  if (['cancelled', 'rejected', 'expired', 'outdated'].includes(detail?.status)) return '';
  return String(detail?.id ?? listing.bidId ?? listing.myBidId ?? '');
}

async function marketAction(input, member, session, fetcher) {
  const {id, teamId} = member;
  const {action, listingId, playerId, amount, previousBidId} = input;
  if (!validId(listingId) || (previousBidId !== undefined && !validId(previousBidId))) {
    throw fail(400, 'No se ha identificado el anuncio o la puja.');
  }
  const marketPath = competition + '/league/' + id + '/market';
  const market = list(await gameRead(marketPath, session, fetcher));
  const listing = market.find(row => String(row.id) === listingId && String(masterOf(row).id ?? '') === playerId);
  if (!listing || Date.parse(listing.expirationDate) <= Date.now()) {
    throw fail(409, 'El anuncio ya no está disponible. Actualiza el mercado.');
  }
  if (String(listing.sellerTeam?.id ?? listing.sellerTeamId ?? '') === teamId) {
    throw fail(400, 'El jugador está en tu equipo.');
  }

  const previous = bidRecord(listing);
  if (action === 'offer') {
    if (listing.discr !== 'marketPlayerTeam') throw fail(409, 'El anuncio ya no admite ofertas.');
    if (previous) throw fail(409, 'Ya tienes una oferta pendiente por este jugador.');
    return {path: marketPath + '/' + listingId + '/offer', method: 'POST', body: {money: amount}};
  }

  if (listing.discr !== 'marketPlayerLeague') throw fail(409, 'El anuncio ya no admite pujas.');
  if ((previousBidId ?? '') !== previous) throw fail(409, 'Tu puja ha cambiado. Actualiza el mercado antes de repetirla.');
  const minimum = Math.max(numeric(listing.salePrice) ?? 0, numeric(masterOf(listing).marketValue) ?? 0);
  if (amount < minimum) throw fail(409, 'El importe es inferior al mínimo actual de ' + minimum.toLocaleString('es-ES') + ' €.');
  const path = marketPath + '/' + listingId + '/bid';
  return {path: previous ? path + '/' + previous : path, method: previous ? 'PUT' : 'POST', body: {money: amount}};
}

async function clauseAction(input, member, session, fetcher) {
  const {id, teamId} = member;
  const {sellerId, slotId, playerId, amount} = input;
  if (!validId(sellerId) || !validId(slotId)) throw fail(400, 'Falta el equipo rival o la ficha del jugador.');
  if (sellerId === teamId) throw fail(400, 'El jugador ya está en tu equipo.');
  const leaguePath = competition + '/leagues/' + id;
  const [standings, roster, money] = await Promise.all([
    gameRead(leaguePath + '/standing', session, fetcher),
    gameRead(leaguePath + '/teams/' + sellerId, session, fetcher),
    gameRead(competition + '/teams/' + teamId + '/money', session, fetcher),
  ]);
  if (!list(standings).some(row => standingTeamId(row) === sellerId)) {
    throw fail(409, 'El equipo del jugador ya no figura en esta liga.');
  }
  const player = list(roster).find(row => {
    const slot = row.playerTeam ?? row;
    return String(slot.playerTeamId ?? slot.id ?? '') === slotId && String(masterOf(row).id ?? row.playerId ?? '') === playerId;
  });
  const slot = player?.playerTeam ?? player;
  const currentPrice = numeric(slot?.buyoutClause ?? slot?.releaseClause ?? slot?.clauseValue);
  if (!positiveAmount(currentPrice) || currentPrice !== amount) {
    throw fail(409, 'La propiedad o el importe de la cláusula ha cambiado. Vuelve a abrir la plantilla rival.');
  }
  if ([true, 'true', 1, '1'].includes(slot.isShielded) || Date.parse(slot.shieldedEndDate) > Date.now()) {
    throw fail(409, 'El jugador está blindado.');
  }
  if (Date.parse(slot.buyoutClauseLockedEndTime) > Date.now()) {
    throw fail(409, 'La cláusula todavía está bloqueada.');
  }
  const balance = numeric(money.teamMoney ?? money.balance ?? money.money ?? money.availableMoney);
  if (balance === null) throw fail(502, 'No se ha podido comprobar el saldo de tu equipo.');
  if (balance < amount) throw fail(409, 'Tu saldo actual no cubre la cláusula.');
  return {
    path: competition + '/league/' + id + '/buyout/' + slotId + '/pay',
    method: 'POST',
    body: {buyoutClauseToPay: amount},
  };
}

const writeErrors = {
  '030.01.17': 'Los clausulazos se reabren cuando empieza la jornada.',
  '030.01.99': 'Ya tienes una oferta pendiente por este jugador.',
};

async function submitLeagueAction(input, session, fetcher) {
  const {action, leagueId, playerId, amount} = input ?? {};
  const reward = action === 'reward';
  if (!['bid', 'offer', 'clause', 'reward'].includes(action) || !validId(leagueId) ||
      (!reward && (!validId(playerId) || !positiveAmount(amount)))) {
    throw fail(400, 'Operación, jugador o importe no válido.');
  }
  const member = await leagueMember(leagueId, session, fetcher);
  const lock = leagueId + '/' + member.teamId;
  if (leagueActionsInFlight.has(lock)) throw fail(409, 'Ya hay una operación en curso en esta liga.');
  leagueActionsInFlight.add(lock);
  try {
    if (reward) {
      await claimDailyReward(member, session, fetcher);
      return;
    }
    const {path, method, body} = action === 'clause'
      ? await clauseAction(input, member, session, fetcher)
      : await marketAction(input, member, session, fetcher);
    const response = await official(path, session, fetcher, {method, body})
      .catch(() => { throw fail(502, 'No se pudo confirmar la operación. Actualiza tu liga para comprobar el resultado.'); });
    if (response.status === 401) throw fail(401, 'Tu acceso ha caducado. Conecta de nuevo tu cuenta.');
    if (response.status >= 500) throw fail(502, 'LALIGA no confirmó la operación. Actualiza tu liga para comprobar el resultado.');
    if (!response.ok) {
      const error = await upstreamJson(response);
      throw fail(409, writeErrors[String(error?.errorCode)] ||
        'LALIGA rechazó la operación. Revisa el saldo, el estado del jugador y las reglas de la liga.');
    }
  } finally {
    leagueActionsInFlight.delete(lock);
  }
}

async function leagueEndpoint(request, url, session, fetcher, headers) {
  if (request.method === 'GET') {
    const leagueId = url.searchParams.get('id');
    if (!validId(leagueId)) throw fail(400, 'Selecciona una liga válida.');
    const member = await leagueMember(leagueId, session, fetcher);
    return new Response(JSON.stringify({teamId: member.teamId, reward: await leagueReward(member, session, fetcher)}), {headers});
  }

  let body;
  try {
    body = await request.json();
  } catch {
    throw fail(400, 'Envía una operación en formato JSON.');
  }
  await submitLeagueAction(body, session, fetcher);
  return new Response(JSON.stringify({ok: true}), {headers});
}

export async function handleApi(request,env,fetcher=fetch){const url=new URL(request.url);const headers=new Headers({'cache-control':'no-store','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff'});try{
 const origin=request.headers.get('origin');if(!['GET','HEAD'].includes(request.method)&&origin!==url.origin)return json({error:'La solicitud debe proceder de esta página.'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204});
 if(url.pathname==='/api/health')return json({ok:true,version:'2.0.0',authConfigured:!!env.SESSION_SECRET});
 if(url.pathname==='/api/auth/start'){
  if(request.method!=='GET')return json({error:'Método no admitido.'},405);
  const state=random(24),verifier=random(48);const challenge=b64(await crypto.subtle.digest('SHA-256',encoder.encode(verifier)));const pending={state,verifier,until:Date.now()+900000,remember:url.searchParams.get('remember')==='1',owner:request.headers.get('oai-authenticated-user-id')||''};
  headers.append('set-cookie',cookie('__Secure-lg_p',await seal(pending,env),900));const params=new URLSearchParams({p:POLICY,client_id:CLIENT,response_type:'code',redirect_uri:REDIRECT,scope:'openid offline_access',code_challenge:challenge,code_challenge_method:'S256',state,nonce:state});headers.set('location',IDP+'authorize?'+params);return new Response(null,{status:302,headers});
 }
 if(url.pathname==='/api/auth'&&request.method==='POST'){
  if(Number(request.headers.get('content-length'))>20000)return json({error:'La URL de autorización es demasiado larga.'},413);
  const body=await request.json();const pending=await unseal(cookies(request)['__Secure-lg_p'],env);if(!pending)return json({error:'El acceso ha caducado. Vuelve a abrir el login oficial.'},400);
  if(pending.owner!==(request.headers.get('oai-authenticated-user-id')||''))return json({error:'El acceso pertenece a otra sesión.'},403);
  let redirect;try{redirect=new URL(String(body.redirect||'').trim())}catch{return json({error:'Pega la URL authredirect completa, con code y state.'},400)}
  if(redirect.protocol!=='authredirect:'||redirect.hostname!=='com.lfp.laligafantasy'||!redirect.searchParams.get('code')||redirect.searchParams.get('state')!==pending.state)return json({error:'La URL no corresponde a este acceso. Comprueba code y state o inicia de nuevo.'},400);
  const raw=await tokenRequest({grant_type:'authorization_code',code:redirect.searchParams.get('code'),redirect_uri:REDIRECT,code_verifier:pending.verifier},fetcher);const user=identity(raw);const nonce=claims(raw.id_token||'').nonce;if(nonce&&nonce!==pending.state)return json({error:'No se pudo verificar la autorización. Inicia de nuevo.'},401);
  const s={access:raw.access_token||raw.id_token,refresh:raw.refresh_token||null,expires:expiry(raw),until:Date.now()+(pending.remember?604800000:86400000),owner:pending.owner,managerName:user.name||'Mánager',userId:user.userId,remember:pending.remember};
  const verify=await official('/v1/competition/1/leagues',s,fetcher);if(!verify.ok)return json({error:'La cuenta se ha autorizado, pero LALIGA Fantasy no reconoce la sesión. Vuelve a conectar.'},401);
  await setSession(headers,s,env);return new Response(JSON.stringify(sessionInfo(s)),{headers});
 }
 if(url.pathname==='/api/auth'&&request.method==='DELETE'){clearSession(headers);return new Response(JSON.stringify({authenticated:false}),{headers})}
 if(url.pathname==='/api/auth'&&request.method==='GET'){const s=await sessionFrom(request,env,fetcher,headers);return new Response(JSON.stringify(sessionInfo(s)),{headers})}
 if(url.pathname==='/api/league'){
  if(!['GET','POST'].includes(request.method))return json({error:'Método no admitido.'},405);
  const session=await sessionFrom(request,env,fetcher,headers);
  if(!session)return new Response(JSON.stringify({error:'Conecta tu cuenta para gestionar tu liga.'}),{status:401,headers});
  try{return await leagueEndpoint(request,url,session,fetcher,headers)}
  catch(error){if(error.status===401)clearSession(headers);throw error}
 }
 if(url.pathname==='/api/ff'&&url.searchParams.has('team')){
  if(request.method!=='GET')return json({error:'Método no admitido.'},405);
  const slug=url.searchParams.get('team');
  if(!/^[a-z0-9-]{1,70}$/.test(slug))return json({error:'Equipo no válido.'},400);
  const stats=await footballFantasyTeam(slug,fetcher);
  if(!stats)return json({error:'FútbolFantasy no publica datos de ese equipo para la jornada.'},404);
  return json(stats,200,{'cache-control':'public, max-age=300, stale-while-revalidate=300'});
 }
 if(url.pathname==='/api/ff'){
  if(request.method!=='GET')return json({error:'Método no admitido.'},405);const r=await fetcher('https://laguia-fantasy.vercel.app/api/titularidad',{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});if(!r.ok)return json({error:'FútbolFantasy no está disponible. Se conservan los últimos datos con su fecha.'},502);headers.set('cache-control','public, max-age=300');return new Response(r.body,{headers});
 }
 if(url.pathname!=='/api/data')return json({error:'Ruta no encontrada.'},404);
 const path=url.searchParams.get('path')||'';const publicPath=/^\/v1\/competition\/1\/(players|player\/[\w-]+(?:\/market-value)?|week\/current|calendar)$/.test(path)||path==='/v3/teams-master';
 const privateRead=/^\/v1\/competition\/1\/(leagues|leagues\/[\w-]+\/(standing|teams\/[\w-]+|activity\/0)|league\/[\w-]+\/market|teams\/[\w-]+\/(money|lineup))$/.test(path);
 const lineup=path.match(/^\/v1\/competition\/1\/teams\/([\w-]+)\/lineup$/);
 if(!publicPath&&!privateRead)return json({error:'Consulta no admitida.'},400);
 const s=publicPath?null:await sessionFrom(request,env,fetcher,headers);if(!publicPath&&!s)return new Response(JSON.stringify({error:'Tu acceso ha caducado. Vuelve a conectar tu cuenta.',authenticated:false}),{status:401,headers});
 let options={};
 if(request.method==='PUT'&&lineup){
  const selectedLeague=url.searchParams.get('leagueId');
  if(selectedLeague!==null&&!validId(selectedLeague))return json({error:'Liga no válida.'},400);
  const member=selectedLeague?await leagueMember(selectedLeague,s,fetcher):null;
  if(member&&member.teamId!==lineup[1])return json({error:'Selecciona tu equipo de esta liga.'},403);
  const own=member?.league??await verifyOwnTeam(lineup[1],s,fetcher);const body=await request.json();const formation=body.tactical_formation;const permitted=['3-4-3','3-5-2','4-3-3','4-4-2','4-5-1','5-3-2','5-4-1'];if(!Array.isArray(formation)||!permitted.includes(formation.join('-')))return json({error:'Formación no válida.'},400);
  const groups=[['goalkeeper',1],['defender',formation[0]],['midfield',formation[1]],['striker',formation[2]]];const ids=[];for(const [g,count]of groups){const selected=g==='goalkeeper'?[body[g]]:body[g];if(!Array.isArray(selected)||selected.length!==count||selected.some(id=>!safeId(id)))return json({error:'Selecciona once jugadores en sus posiciones.'},400);ids.push(...selected.map(String))}if(new Set(ids).size!==11)return json({error:'Los once jugadores deben ser distintos.'},400);
  const leagueId=selectedLeague??String(own.leagueId??own.id);const rosterResponse=await official('/v1/competition/1/leagues/'+leagueId+'/teams/'+lineup[1],s,fetcher);if(!rosterResponse.ok)return json({error:'No se pudo verificar tu plantilla actual.'},502);const roster=list(await rosterResponse.json());const rosterById=new Map(roster.map(p=>[String(p.playerTeamId??p.id),p]));if(ids.some(id=>!rosterById.has(id)))return json({error:'Alguno de los jugadores ya no está en tu plantilla. Actualiza antes de guardar.'},409);
  for(let pos=0;pos<groups.length;pos++){const group=groups[pos][0];const chosen=group==='goalkeeper'?[body[group]]:body[group];for(const id of chosen){const row=rosterById.get(String(id));const master=row.playerMaster||row.player?.playerMaster||row.player||row;if(Number(master.positionId)!==pos+1)return json({error:'La posición de algún jugador no coincide con el puesto seleccionado.'},400)}}
  options={method:'PUT',body:Object.fromEntries(['goalkeeper','defender','midfield','striker','tactical_formation'].map(k=>[k,body[k]]))};
 }else if(request.method!=='GET')return json({error:'Método no admitido.'},405);
 const week=url.searchParams.get('weekNumber');const route=path+(week&&/^\d{1,2}$/.test(week)?'?weekNumber='+week:'');const response=await official(route,s,fetcher,options);if(!response.ok){if(response.status===401&&s){clearSession(headers);return new Response(JSON.stringify({error:'LALIGA ha revocado la sesión. Conecta de nuevo tu cuenta.'}),{status:401,headers})}return new Response(JSON.stringify({error:response.status>=500?'LALIGA no está disponible temporalmente.':'LALIGA no ha aceptado la consulta ('+response.status+').'}),{status:response.status,headers})}
 if(publicPath)headers.set('cache-control','public, max-age=180');return new Response(response.body,{status:response.status,headers});
 }catch(error){return new Response(JSON.stringify({error:error.status?error.message:'No se pudo conectar con el servicio. Vuelve a intentarlo.'}),{status:error.status||502,headers})}}
