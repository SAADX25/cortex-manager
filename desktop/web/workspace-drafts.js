'use strict';
(() => {
  function create(api, onChange) {
    const states = new Map();
    const state = (id) => {
      if (!states.has(id))
        states.set(id, {
          entries: new Map(),
          pending: new Map(),
          revision: null,
          loaded: false,
          loading: null,
          flight: null,
          timer: null,
          version: 0,
          savedVersion: 0,
          status: 'loading',
          error: '',
          updatedAt: null,
        });
      return states.get(id);
    };
    const notify = (id, type) => onChange?.(id, type);
    async function load(id) {
      const s = state(id);
      if (s.loaded) return s;
      if (s.loading) return s.loading;
      s.loading = api('/api/workspace?guildId=' + encodeURIComponent(id))
        .then((data) => {
          s.entries = new Map(data.entries.map((e) => [e.key, e]));
          for (const [key, value] of s.pending) {
            if (value === null) s.entries.delete(key);
            else s.entries.set(key, value);
          }
          s.pending.clear();
          s.revision = data.revision;
          s.updatedAt = data.updatedAt;
          s.loaded = true;
          s.error = '';
          s.status = s.version > s.savedVersion ? 'pending' : 'saved';
          notify(id, 'loaded');
          if (s.version > s.savedVersion) schedule(id);
          return s;
        })
        .catch((error) => {
          s.error = error.message;
          s.status = 'error';
          notify(id, 'error');
          throw error;
        })
        .finally(() => (s.loading = null));
      return s.loading;
    }
    function schedule(id) {
      const s = state(id);
      clearTimeout(s.timer);
      s.timer = setTimeout(() => flush(id).catch(() => {}), 650);
    }
    function put(id, entry) {
      const s = state(id),
        copy = structuredClone(entry);
      if (JSON.stringify(s.entries.get(entry.key)) === JSON.stringify(copy)) return;
      s.entries.set(entry.key, copy);
      if (!s.loaded) s.pending.set(entry.key, copy);
      s.version++;
      s.status = 'pending';
      s.error = '';
      notify(id, 'changed');
      schedule(id);
    }
    function remove(id, key) {
      const s = state(id);
      if (!s.entries.has(key)) return;
      s.entries.delete(key);
      if (!s.loaded) s.pending.set(key, null);
      s.version++;
      s.status = 'pending';
      notify(id, 'changed');
      schedule(id);
    }
    async function flush(id, { keepalive = false } = {}) {
      const s = state(id);
      clearTimeout(s.timer);
      await load(id);
      if (s.flight) {
        await s.flight;
        if (s.version > s.savedVersion) return flush(id, { keepalive });
        return;
      }
      if (s.version === s.savedVersion) return;
      const version = s.version,
        entries = [...s.entries.values()];
      s.status = 'saving';
      notify(id, 'saving');
      // keepalive is handled by the app transport; ordinary saves stay serialized.
      s.flight = api(
        '/api/workspace',
        { guildId: id, baseRevision: s.revision, entries },
        { keepalive },
      )
        .then((data) => {
          s.revision = data.revision;
          s.updatedAt = data.updatedAt;
          s.savedVersion = version;
          s.error = '';
          s.status = s.version === version ? 'saved' : 'pending';
          notify(id, 'saved');
        })
        .catch((error) => {
          s.error = error.message;
          s.status = 'error';
          notify(id, 'error');
          throw error;
        })
        .finally(() => {
          s.flight = null;
        });
      await s.flight;
      if (s.version > s.savedVersion) schedule(id);
    }
    return {
      load,
      put,
      remove,
      flush,
      list: (id) => structuredClone([...state(id).entries.values()]),
      get: (id, key) => structuredClone(state(id).entries.get(key) ?? null),
      info: (id) => {
        const s = state(id);
        return {
          loaded: s.loaded,
          status: s.status,
          error: s.error,
          updatedAt: s.updatedAt,
          unsaved: s.version > s.savedVersion,
        };
      },
      hasUnsaved: () => [...states.values()].some((s) => s.version > s.savedVersion),
      flushAll: () =>
        Promise.allSettled([...states.keys()].map((id) => flush(id, { keepalive: true }))),
    };
  }
  window.CortexDrafts = { create };
})();
