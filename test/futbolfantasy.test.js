import assert from 'node:assert/strict';
import {test} from 'node:test';
import {footballFantasyTeam} from '../server/futbolfantasy.js';

test('the selected fixture resolves the lineup API for the requested club', async () => {
  const index = `
    <a class="team team-1" href="https://www.futbolfantasy.com/laliga/equipos/athletic" title="Athletic"></a>
    <a class="team team-7" href="https://www.futbolfantasy.com/laliga/equipos/espanyol" title="Espanyol"></a>
    <option selected value="/laliga/posibles-alineaciones/13">J13</option>
    <h3>Posibles onces jornada</h3><ul>
      <li><a href="/partidos/22543-athletic-espanyol">Athletic - Espanyol</a></li>
    </ul>`;
  const html = `
    <div class="jugador_239 jugador tipo_lista d-none"
      data-probabilidad="90%" data-edad="31" data-nacionalidad="ES" data-pie="Derecho"
      data-altura="175" data-totalGoles="0" data-totalMinutosJugados="823"
      data-valor-diff-laliga-fantasy="-11212" data-rival_dificultad="&lt;span class=&quot;id-asequible&quot;&gt;vs&lt;/span&gt;">
      <a class="jugador my-auto"
         href="https://www.futbolfantasy.com/jugadores/alex-berenguer/laliga-26-27">
         <span class="nombre">&#193;lex Berenguer</span>
      </a>
      <div class="datos-col view jerarquias x2"><span class="text-truncate ml-2">Importante</span></div>
      <span class="value c">7</span><span class="fraction"></span><span class="value">34</span>
    </div>`;
  const calls = [];
  const fetcher = url => {
    calls.push(url);
    return new Response(url.includes('/api/alineaciones/') ? html : index);
  };
  const [a, b] = await Promise.all([
    footballFantasyTeam('athletic-club', fetcher),
    footballFantasyTeam('athletic-club', fetcher),
  ]);
  assert.deepEqual(a, b);
  assert.deepEqual(calls, [
    'https://www.futbolfantasy.com/laliga/posibles-alineaciones',
    'https://www.futbolfantasy.com/api/alineaciones/22543/1?ignoreOver=true&lineup_info=1',
  ]);
  assert.equal(a.week, 13);
  assert.equal(a.rival, 'Espanyol');
  const [player] = a.players;
  assert.equal(player.name, 'Álex Berenguer');
  assert.equal(player.goals, 0);
  assert.equal(player.assists, null);
  assert.equal(player.dailyChange, -11212);
  assert.equal(player.rank, 'Importante');
  assert.equal(player.difficulty, 'asequible');
  assert.deepEqual(player.setPieces.c, {accurate: 7, attempted: 34});
  assert.equal(await footballFantasyTeam('unknown-club', fetcher), null);
  assert.equal(calls.length, 2);
});
