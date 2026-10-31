import { validateCustomDesign } from './custom-design.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { DiscordAPI, snapshot } from './api.mjs';
import { plan, renderPreview } from './plan.mjs';
import { assertConfirmation, digest } from './safety.mjs';
import { rebuild } from './rebuild.mjs';
const mode = process.argv[2] ?? 'preview';
const guildId = process.env.DISCORD_GUILD_ID?.trim();
const out = path.join(process.cwd(), 'out');
fs.mkdirSync(out, { recursive: true });
const write = (file, data) =>
  fs.writeFileSync(
    path.join(out, file),
    typeof data === 'string' ? data : JSON.stringify(data, null, 2),
  );
const read = (file) => JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
const sourceDigest = () =>
  digest({
    sources: fs
      .readdirSync(new URL('.', import.meta.url))
      .filter((f) => f.endsWith('.mjs'))
      .sort()
      .map((f) => [f, fs.readFileSync(new URL(f, import.meta.url), 'utf8')]),
    workflow: fs.readFileSync(
      new URL('../.github/workflows/discord-setup.yml', import.meta.url),
      'utf8',
    ),
  });
async function main() {
  if (!['snapshot', 'preview', 'rebuild'].includes(mode))
    throw new Error('Choose snapshot, preview, or rebuild.');
  if (mode === 'rebuild') assertConfirmation(process.env, guildId);
  const api = new DiscordAPI(process.env.DISCORD_BOT_TOKEN);
  if (mode === 'snapshot' || mode === 'preview') {
    const s = await snapshot(api, guildId);
    write('snapshot.json', s);
    if (mode === 'snapshot') {
      console.log(
        'Configuration and available member assignments saved. Messages/attachments are not backed up.',
      );
      return;
    }
    const custom = fs.existsSync(path.join(out, 'design-input.json'))
      ? validateCustomDesign(read('design-input.json'))
      : null;
    const p = plan(s, undefined, custom);
    write('design.json', p.design);
    write('plan.json', p);
    write('preview.md', renderPreview(s, p));
    write('approval.json', {
      operation: 'preview',
      guildId,
      approvalHash: p.approvalHash,
      sourceDigest: sourceDigest(),
      commit: process.env.GITHUB_SHA ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
    });
    console.log(renderPreview(s, p));
    if (p.blockers.length)
      throw new Error('Preview contains blockers; resolve them and generate a new preview.');
    return;
  }
  const s = read('snapshot.json'),
    approval = read('approval.json'),
    p = plan(s, undefined, read('design.json'));
  if (
    s.guild.id !== guildId ||
    approval.guildId !== guildId ||
    approval.operation !== 'preview' ||
    approval.approvalHash !== p.approvalHash ||
    approval.sourceDigest !== sourceDigest()
  )
    throw new Error(
      'Reviewed preview does not match this server, source code or plan. Generate a fresh preview.',
    );
  if (
    process.env.GITHUB_ACTIONS === 'true' &&
    (approval.commit !== process.env.GITHUB_SHA || approval.runId !== process.env.PREVIEW_RUN_ID)
  )
    throw new Error('Preview run/revision mismatch.');
  write('plan.json', p);
  write('preview.md', renderPreview(s, p));
  const log = [];
  await rebuild(api, s, p, {
    save: write,
    record: (line) => {
      console.log(line);
      log.push(line);
      write('execution-log.txt', log.join('\n') + '\n');
    },
  });
  console.log(
    'Rebuild completed. Review result.json for preserved roles and migration exceptions.',
  );
}
main().catch((error) => {
  write('failure.json', { success: false, error: error.message });
  console.error(error.message);
  process.exitCode = 1;
});
