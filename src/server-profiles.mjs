import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const validId = (value) => typeof value === 'string' && /^\d{16,22}$/.test(value);
const fail = () => {
  throw new Error('بيانات السيرفر المحفوظ غير صالحة.');
};
function profile(value) {
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !['id', 'name', 'iconURL'].includes(k)) ||
    !validId(value.id)
  )
    fail();
  const name = value.name ?? '',
    iconURL = value.iconURL ?? '';
  if (
    typeof name !== 'string' ||
    name.length > 100 ||
    typeof iconURL !== 'string' ||
    iconURL.length > 256
  )
    fail();
  if (
    iconURL &&
    !new RegExp(
      '^https://cdn\\.discordapp\\.com/icons/' +
        value.id +
        '/(?:a_)?[a-f0-9]{32}\\.(png|gif|webp)(\\?size=(64|128|256|512|1024))?$',
    ).test(iconURL)
  )
    fail();
  return { id: value.id, name: name.trim(), iconURL };
}

// Non-secret server bookmarks only. Bot tokens remain in the Windows vault.
export function createServerProfileStore({ root, demo = false } = {}) {
  const file = path.join(
    root,
    'out',
    'desktop-modern',
    demo ? 'demo-servers.json' : 'servers.json',
  );
  const isNew = !fs.existsSync(file);
  let data = { version: 1, selectedId: '', servers: [] };
  if (fs.existsSync(file)) {
    if (fs.statSync(file).size > 65536) fail();
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (
      raw.version !== 1 ||
      !Array.isArray(raw.servers) ||
      raw.servers.length > 50 ||
      (raw.selectedId !== '' && !validId(raw.selectedId))
    )
      fail();
    const servers = raw.servers.map(profile);
    if (
      new Set(servers.map((s) => s.id)).size !== servers.length ||
      (raw.selectedId && !servers.some((s) => s.id === raw.selectedId))
    )
      fail();
    data = { version: 1, selectedId: raw.selectedId, servers };
  }
  const persist = (next) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, file);
      data = next;
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  };
  return {
    isNew,
    list: () => structuredClone(data),
    save(value, { select = false } = {}) {
      const item = profile(value),
        old = data.servers.find((s) => s.id === item.id);
      if (!old && data.servers.length >= 50) throw new Error('يمكن حفظ 50 سيرفرًا كحد أقصى.');
      const merged = {
        ...item,
        name: item.name || old?.name || '',
        iconURL: value.iconURL === undefined ? (old?.iconURL ?? '') : item.iconURL,
      };
      persist({
        ...data,
        selectedId: select ? item.id : data.selectedId,
        servers: old
          ? data.servers.map((s) => (s.id === item.id ? merged : s))
          : [...data.servers, merged],
      });
    },
    select(id) {
      if (!data.servers.some((s) => s.id === id)) fail();
      persist({ ...data, selectedId: id });
    },
    remove(id) {
      if (!validId(id)) fail();
      persist({
        ...data,
        selectedId: data.selectedId === id ? '' : data.selectedId,
        servers: data.servers.filter((s) => s.id !== id),
      });
    },
  };
}
