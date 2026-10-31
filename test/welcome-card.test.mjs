import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWelcomeCard, fetchWelcomeAvatar } from '../src/welcome-card.mjs';
import { validateCardStyle } from '../src/welcome-card-style.mjs';
import { welcomeDefaults, validateWelcome } from '../src/welcome-config.mjs';
const settings = () => ({
  ...welcomeDefaults('111111111111111111').join,
  card: {
    mode: 'image',
    background: 'storm',
    titleColor: '#ffffff',
    textColor: '#d5e0ff',
    overlay: 0.66,
  },
});
test('welcome card design rejects arbitrary backgrounds, invalid colors and out-of-range opacity', () => {
  for (const extra of [
    { background: 'https://evil.test/a.png' },
    { titleColor: 'red' },
    { textColor: 'url(evil)' },
    { overlay: 1 },
    { overlay: -1 },
    { mode: 'html' },
    { font: 'file:///secret' },
  ])
    assert.throws(() => validateCardStyle({ ...settings().card, ...extra }));
  const g = welcomeDefaults('111111111111111111');
  g.join = settings();
  assert.ok(validateWelcome({ version: 1, guilds: [g] }));
});
test('background cards render bounded PNGs with portable Arabic/emoji fonts and reject concurrent rendering', async () => {
  const active = renderWelcomeCard(settings(), { user: 'SAAD', server: 'Test Server' });
  await assert.rejects(renderWelcomeCard(settings(), { user: 'other', server: 'Test' }), /busy/);
  const bytes = await active;
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), 1000);
  assert.equal(bytes.readUInt32BE(20), 440);
  assert.ok(bytes.length < 2000000);
  const english = await renderWelcomeCard(
    { ...settings(), title: 'Welcome {user} 👋', message: 'Welcome to {server}' },
    { user: 'Test', server: 'Community' },
  );
  assert.ok(english.length > 10000);
});
test('avatar fetching accepts only bounded official Discord PNG responses and no redirects', async () => {
  let calls = 0;
  assert.equal(
    await fetchWelcomeAvatar(
      { id: 'bad', avatar: 'x' },
      {
        fetchImpl: () => {
          calls++;
        },
      },
    ),
    null,
  );
  assert.equal(calls, 0);
  const user = { id: '888888888888888888', avatar: 'a_' + 'a'.repeat(32) };
  const result = await fetchWelcomeAvatar(user, {
    fetchImpl: async (url, options) => {
      assert.ok(url.startsWith('https://cdn.discordapp.com/avatars/'));
      assert.equal(options.redirect, 'error');
      return new Response('x', { headers: { 'Content-Length': '999999' } });
    },
  });
  assert.equal(result, null);
});

test('decorated Latin server names normalize to readable equivalent glyphs on the rendered card', async () => {
  const normal = await renderWelcomeCard(settings(), { user: 'SAAD', server: 'Abo Aluf Server' }),
    decorated = await renderWelcomeCard(settings(), { user: '𝘚𝘈𝘈𝘋', server: '𝘈𝘣𝘰 𝘈𝘭𝘶𝘧 𝘚𝘦𝘳𝘷𝘦𝘳' });
  assert.ok(normal.equals(decorated));
});
