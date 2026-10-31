import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { snapshot } from './api.mjs';
import { prepareEdit, editSummary } from './editor.mjs';
import { digest, fingerprint } from './safety.mjs';

const stateHash = (s) => digest({ configuration: fingerprint(s), name: s.guild.name });
function project(s, p) {
  const next = structuredClone(s),
    target =
      p.kind === 'guild'
        ? next.guild
        : (p.kind === 'role' ? next.roles : next.channels).find((x) => x.id === p.id);
  Object.assign(target, structuredClone(p.body));
  if (p.kind === 'role' && p.body.color !== undefined && target.colors)
    target.colors.primary_color = p.body.color;
  return next;
}
export function prepareBatch(s, requests, nonce) {
  if (
    !Array.isArray(requests) ||
    !requests.length ||
    requests.length > 25 ||
    !/^[a-f0-9]{24}$/.test(nonce)
  )
    throw new Error('اجمع من تعديل واحد إلى 25 تعديلًا للمراجعة.');
  let projected = structuredClone(s);
  const seen = new Set(),
    items = [];
  for (const request of requests) {
    if (
      !request ||
      request.action !== 'update' ||
      !['role', 'channel', 'guild'].includes(request.kind)
    )
      throw new Error(
        'مساحة التغييرات تجمع تعديل العناصر الموجودة؛ الإنشاء والنقل لهما معاينة مستقلة.',
      );
    const key = request.kind + ':' + request.id;
    if (seen.has(key)) throw new Error('أضف تعديلًا واحدًا فقط لكل عنصر.');
    seen.add(key);
    const p = prepareEdit(projected, request);
    if (p.kind === 'channel' && p.before.type === 4 && p.request.overwriteChanges?.length)
      throw new Error('راجع أذونات القسم منفردة لأنها قد تتزامن مع قنواته الفرعية.');
    items.push(p);
    projected = project(projected, p);
  }
  const base = {
    guildId: s.guild.id,
    guildName: s.guild.name,
    requests,
    nonce,
    items,
    snapshotHash: fingerprint(s),
  };
  return { ...base, approvalHash: digest(base) };
}
export const batchPublic = (p) => ({
  guildId: p.guildId,
  guildName: p.guildName,
  approvalHash: p.approvalHash,
  count: p.items.length,
  items: p.items.map((item) => ({
    kind: item.kind,
    id: item.id,
    name: item.before.name,
    changes: item.changes,
    permissionChanges: item.request.permissionChanges ?? {},
    summary: editSummary(item),
  })),
});
export const batchSummary = (p) =>
  p.items.map((item, i) => `${i + 1}. ${editSummary(item)}`).join('\n\n');
export async function previewBatch(api, guildId, requests, directory) {
  const s = await snapshot(api, guildId, { includeMembers: false }),
    p = prepareBatch(s, requests, randomBytes(12).toString('hex'));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'batch-plan.json'), JSON.stringify(p, null, 2));
  fs.writeFileSync(path.join(directory, 'batch-snapshot.json'), JSON.stringify(s, null, 2));
  fs.writeFileSync(path.join(directory, 'batch-preview.txt'), batchSummary(p));
  return p;
}
export async function applyBatch(api, guildId, c, directory) {
  if (c?.confirmed !== true || c.guildId !== guildId)
    throw new Error('راجع مساحة التغييرات وأكّد السيرفر نفسه.');
  const reviewed = JSON.parse(fs.readFileSync(path.join(directory, 'batch-plan.json'), 'utf8'));
  if (reviewed.guildId !== guildId || reviewed.approvalHash !== c.approvalHash)
    throw new Error('تأكيد مساحة التغييرات لا يطابق المعاينة.');
  if (
    reviewed.items.some((p) => p.request.permissionChanges?.Administrator === true) &&
    c.acknowledgeAdmin !== true
  )
    throw new Error('أكّد صلاحية Administrator المضافة ضمن الخطة.');
  let expected = await snapshot(api, guildId, { includeMembers: false });
  const fresh = prepareBatch(expected, reviewed.requests, reviewed.nonce);
  if (fresh.approvalHash !== reviewed.approvalHash)
    throw new Error('تغيّر السيرفر أو الكود منذ المعاينة؛ راجع الخطة مجددًا.');
  const history = path.join(directory, 'batch-history', fresh.approvalHash);
  fs.mkdirSync(path.dirname(history), { recursive: true });
  try {
    fs.mkdirSync(history);
  } catch (e) {
    if (e.code === 'EEXIST')
      throw new Error('سبق بدء تنفيذ هذه الخطة؛ راجع التقرير وحدّث السيرفر قبل إعادة المعاينة.');
    throw e;
  }
  fs.writeFileSync(path.join(history, 'snapshot.json'), JSON.stringify(expected, null, 2));
  fs.writeFileSync(path.join(history, 'plan.json'), JSON.stringify(fresh, null, 2));
  const result = {
    guildId,
    approvalHash: fresh.approvalHash,
    status: 'applying',
    success: false,
    completed: [],
    remaining: fresh.items.map((p) => ({ kind: p.kind, id: p.id })),
    uncertain: null,
  };
  const record = () => {
    const data = JSON.stringify(result, null, 2);
    fs.writeFileSync(path.join(directory, 'batch-result.json'), data);
    fs.writeFileSync(path.join(history, 'result.json'), data);
  };
  record();
  try {
    for (const [i, p] of fresh.items.entries()) {
      const current = i === 0 ? expected : await snapshot(api, guildId, { includeMembers: false });
      if (stateHash(current) !== stateHash(expected))
        throw new Error('تغيّر السيرفر أثناء التنفيذ؛ توقفت التعديلات المتبقية.');
      const check = prepareEdit(current, p.request);
      if (digest(check.body) !== digest(p.body) || check.sourceHash !== p.sourceHash)
        throw new Error('تغيّرت صلاحيات العنصر أو الكود؛ توقفت العملية.');
      const route =
        p.kind === 'guild'
          ? `/guilds/${guildId}`
          : p.kind === 'role'
            ? `/guilds/${guildId}/roles/${p.id}`
            : `/channels/${p.id}`;
      result.uncertain = { kind: p.kind, id: p.id };
      record();
      await api.call('PATCH', route, p.body);
      expected = project(expected, p);
      result.completed.push({ kind: p.kind, id: p.id, name: p.before.name });
      result.remaining.shift();
      result.uncertain = null;
      record();
    }
    const verified = await snapshot(api, guildId, { includeMembers: false });
    if (stateHash(verified) !== stateHash(expected))
      throw new Error('أُرسلت التعديلات لكن تغيّرت بيانات السيرفر؛ حدّثه وراجع التقرير.');
    result.status = 'completed';
    result.success = true;
    return result;
  } catch (error) {
    result.status = result.uncertain
      ? 'failed-or-unknown'
      : result.completed.length
        ? 'partial'
        : 'stopped';
    result.error = error.message;
    throw error;
  } finally {
    record();
  }
}
