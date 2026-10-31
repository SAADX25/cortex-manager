'use strict';
(() => {
  const aliases = new Map([
    ['الإدارة', 'Administrator'],
    ['ادارة', 'Administrator'],
    ['كبير المشرفين', 'Head Moderator'],
    ['مشرف', 'Moderator'],
    ['فريق الدعم', 'Support Team'],
    ['منظم فعاليات', 'Event Host'],
    ['صانع محتوى', 'Content Creator'],
    ['مميز', 'VIP'],
    ['لاعب', 'Gamer'],
    ['موثق', 'Verified'],
    ['عضو', 'Member'],
    ['مقيد', 'Muted'],
  ]);
  const normalize = (value) =>
    value.normalize('NFKC').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ');
  const canonical = (value) => normalize(value).toLowerCase();
  /** Propose name-only changes; unknown names, existing drafts and collisions are retained. */
  function propose(roles, { blockedIds = [], limit = 25 } = {}) {
    const blocked = new Set(blockedIds),
      occupied = new Set(roles.map((role) => canonical(role.name)));
    let accepted = 0;
    return roles
      .filter((role) => /\p{Script=Arabic}/u.test(role.name))
      .map((role) => {
        const phrases = [
          ...role.name.matchAll(
            /\p{Script=Arabic}[\p{Script=Arabic}\p{M}]*(?:[ \t]+\p{Script=Arabic}[\p{Script=Arabic}\p{M}]*)*/gu,
          ),
        ];
        let target = role.name,
          status =
            role.readOnlyReason || role.managed
              ? 'protected'
              : blocked.has(role.id)
                ? 'draft'
                : 'unknown';
        if (status === 'unknown' && phrases.length === 1) {
          const match = phrases[0],
            english = aliases.get(normalize(match[0]));
          if (english) {
            target =
              role.name.slice(0, match.index) +
              english +
              role.name.slice(match.index + match[0].length);
            status = occupied.has(canonical(target))
              ? 'duplicate'
              : accepted >= limit
                ? 'limit'
                : 'ready';
            if (status === 'ready') {
              accepted++;
              occupied.add(canonical(target));
            }
          }
        }
        return { id: role.id, from: role.name, to: target, revision: role.revision, status };
      });
  }
  const t = (key) => window.CortexI18n.text('role_translation.' + key);
  async function open() {
    if (busy() || !inventory()) return;
    const id = guildId();
    persistEditorDraft();
    try {
      await draftStore.load(id);
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    if (busy() || guildId() !== id || !inventory()) return;
    const entries = draftStore.list(id),
      remaining = Math.max(
        0,
        Math.min(25 - entries.filter((e) => e.staged).length, 100 - entries.length),
      );
    const rows = propose(inventory().roles, {
        blockedIds: entries.filter((e) => e.request.kind === 'role').map((e) => e.request.id),
        limit: remaining,
      }),
      ready = rows.filter((row) => row.status === 'ready');
    showDialog(
      '<div class="dialog-symbol">' +
        icon('shield') +
        '</div><h2>' +
        t('title') +
        '</h2><p>' +
        t('description') +
        '</p><div class="review-summary role-translation-list">' +
        (rows.length
          ? rows
              .map(
                (row) =>
                  '<div class="role-translation-row"><div><del translate="no" dir="auto">' +
                  esc(row.from) +
                  '</del>' +
                  (row.status === 'ready'
                    ? '<ins translate="no" dir="auto">' + esc(row.to) + '</ins>'
                    : '') +
                  '</div><small>' +
                  t(row.status) +
                  '</small></div>',
              )
              .join('')
          : '<p>' + t('empty') + '</p>') +
        '</div><div class="dialog-actions"><button type="button" id="cancelRoleTranslation" class="btn btn-ghost">' +
        t('cancel') +
        '</button><button type="button" id="queueRoleTranslation" class="btn btn-primary" ' +
        (!ready.length ? 'disabled' : '') +
        '>' +
        icon('check') +
        t('queue') +
        ' (' +
        ready.length +
        ')</button></div>',
    );
    $('#cancelRoleTranslation').onclick = () => $('#confirmDialog').close();
    $('#queueRoleTranslation').onclick = () => {
      const inv = inventory();
      if (busy() || guildId() !== id || !inv) return;
      const current = draftStore.list(id);
      const refreshed = propose(inv.roles, {
        blockedIds: current.filter((e) => e.request.kind === 'role').map((e) => e.request.id),
        limit: Math.max(
          0,
          Math.min(25 - current.filter((e) => e.staged).length, 100 - current.length),
        ),
      });
      if (
        current.filter((e) => e.staged).length + ready.length > 25 ||
        current.length + ready.length > 100 ||
        ready.some((row) => {
          const role = inv.roles.find((r) => r.id === row.id);
          return (
            !refreshed.some(
              (candidate) =>
                candidate.id === row.id && candidate.status === 'ready' && candidate.to === row.to,
            ) ||
            !role ||
            role.revision !== row.revision ||
            role.readOnlyReason ||
            draftStore.get(id, 'role:' + row.id)
          );
        })
      ) {
        toast(t('changed'), 'error');
        return;
      }
      for (const row of ready)
        draftStore.put(id, {
          key: 'role:' + row.id,
          request: {
            kind: 'role',
            action: 'update',
            id: row.id,
            revision: row.revision,
            values: { name: row.to },
          },
          tab: 'general',
          overwriteRole: '',
          staged: true,
        });
      $('#confirmDialog').close();
      model.editor = null;
      go('changes');
    };
  }
  window.CortexRoleTranslation = { propose, open };
})();
