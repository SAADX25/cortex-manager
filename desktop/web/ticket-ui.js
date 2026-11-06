'use strict';
(() => {
  const t = (key) => window.CortexI18n.text(key);
  const drafts = new Map();
  let saved = null,
    loading = false,
    saving = false,
    error = '';
  const defaults = (id) => ({
    guildId: id,
    enabled: false,
    panelChannelId: '',
    categoryId: '',
    staffRoleIds: [],
    requesterRoleIds: [],
    language: 'ar',
  });
  function draft() {
    const id = guildId();
    if (!drafts.has(id))
      drafts.set(
        id,
        structuredClone(saved?.config.guilds.find((g) => g.guildId === id) ?? defaults(id)),
      );
    return drafts.get(id);
  }
  async function load() {
    loading = true;
    error = '';
    try {
      saved = await api('/api/tickets');
      drafts.clear();
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
      if (model.page === 'tickets') draw();
    }
  }
  function options(items, selected) {
    const values = [...items];
    if (selected && !values.some((item) => item.id === selected))
      values.push({ id: selected, name: selected + ' · ' + t('tickets.unavailable') });
    return (
      `<option value="">${t('tickets.choose')}</option>` +
      values
        .map(
          (item) =>
            `<option value="${esc(item.id)}" ${selected === item.id ? 'selected' : ''}>${esc(item.name)}</option>`,
        )
        .join('')
    );
  }
  function rolesMarkup(roles, d, field) {
    const values = [...roles];
    for (const id of d[field])
      if (!values.some((role) => role.id === id))
        values.push({ id, name: id + ' · ' + t('tickets.unavailable') });
    return `<div class="ticket-role-list">${
      values
        .map(
          (role) =>
            `<label class="ticket-role"><input type="checkbox" data-ticket-role="${field}" value="${esc(role.id)}" ${d[field].includes(role.id) ? 'checked' : ''}><span dir="auto">${esc(role.name)}</span></label>`,
        )
        .join('') || `<p>${t('tickets.load_server')}</p>`
    }</div>`;
  }
  function validation(d) {
    if (!/^\d{16,22}$/.test(d.guildId)) return 'tickets.load_server';
    if (d.enabled && (!d.panelChannelId || !d.categoryId || !d.staffRoleIds.length))
      return 'tickets.required';
    if (d.staffRoleIds.length > 20 || d.requesterRoleIds.length > 20) return 'tickets.role_limit';
    return null;
  }
  function draw() {
    if (!saved && !loading && !error) void load();
    const d = draft(),
      inv = inventory();
    const channels = inv?.channels.filter((c) => c.type === 0) ?? [];
    const categories = inv?.channels.filter((c) => c.type === 4) ?? [];
    const roles = inv?.roles.filter((r) => r.id !== d.guildId && !r.managed) ?? [];
    const dirty =
      JSON.stringify(d) !==
      JSON.stringify(saved?.config.guilds.find((g) => g.guildId === d.guildId));
    $('#main').innerHTML = `<div class="welcome-page" translate="no">
      <section class="panel"><div class="panel-header"><h2>${icon('log')}${t('tickets.title')}</h2><span class="pill purple">${t('welcome.local_settings')}</span></div>
      <div class="panel-body"><p>${t('tickets.intro')}</p><div class="welcome-room-toolbar"><strong dir="auto">${esc(guildName())}</strong>
      <button class="btn btn-ghost btn-small" id="refreshTicketRooms" ${saving || busy() ? 'disabled' : ''}>${icon('refresh')}${t('welcome.refresh_channels')}</button></div>
      ${!inv ? `<p>${t('tickets.load_server')}</p><button class="btn btn-ghost" id="ticketSettings">${t('ui.connection_settings')}</button>` : ''}
      ${loading ? `<p role="status">${t('welcome.loading_settings')}</p>` : ''}
      ${error ? `<p role="alert" class="danger-text">${esc(error)}</p><button class="btn btn-ghost" id="retryTickets">${t('ui.retry')}</button>` : ''}</div></section>
      <section class="panel"><div class="panel-header"><h2>${t('tickets.settings')}</h2><label class="welcome-enable"><input type="checkbox" id="ticketsEnabled" ${d.enabled ? 'checked' : ''}>${t('ui.enable')}</label></div>
      <div class="panel-body"><div class="form-grid"><div class="field"><label for="ticketPanelChannel">${t('tickets.panel_channel')}</label><select id="ticketPanelChannel">${options(channels, d.panelChannelId)}</select></div>
      <div class="field"><label for="ticketCategory">${t('tickets.category')}</label><select id="ticketCategory">${options(categories, d.categoryId)}</select></div>
      <div class="field"><label for="ticketLanguage">${t('tickets.language')}</label><select id="ticketLanguage"><option value="ar" ${d.language === 'ar' ? 'selected' : ''}>العربية</option><option value="en" ${d.language === 'en' ? 'selected' : ''}>English</option></select></div></div>
      <div class="notice">${icon('eye')}<div>${t('tickets.intake_help')}</div></div>
      <fieldset class="ticket-role-fieldset"><legend>${t('tickets.staff_roles')}</legend><p class="field-help">${t('tickets.staff_help')}</p>${rolesMarkup(roles, d, 'staffRoleIds')}</fieldset>
      <fieldset class="ticket-role-fieldset"><legend>${t('tickets.requester_roles')}</legend><p class="field-help">${t('tickets.requester_help')}</p>${rolesMarkup(roles, d, 'requesterRoleIds')}</fieldset>
      <p class="field-help">${t('tickets.privacy')}</p><p class="field-help">${t('tickets.permissions')}</p>
      <div class="notice">${icon('eye')}<div>${t('tickets.activation')}</div></div></div></section>
      <section class="panel"><div class="panel-header"><h2>${t('tickets.status_title')}</h2><span class="pill purple">${t('tickets.status_preview')}</span></div><div class="panel-body">
      <p>${t('tickets.status_help')}</p><div class="ticket-status-preview">
      <div class="ticket-status-sample ticket-status-waiting"><strong>${t('tickets.status_waiting')}</strong><p>${t('tickets.status_waiting_help')}</p></div>
      <div class="ticket-status-sample ticket-status-claimed"><strong>${t('tickets.status_claimed')}</strong><p>${t('tickets.status_claimed_help')}</p></div>
      <div class="ticket-status-sample ticket-status-resolved"><strong>${t('tickets.status_resolved')}</strong><p>${t('tickets.status_resolved_help')}</p></div>
      </div><p class="field-help">${t('tickets.no_read_receipts')}</p></div></section>
      <section class="panel"><div class="panel-header"><h2>${t('tickets.commands')}</h2></div><div class="panel-body">
      <div class="ticket-command"><code dir="ltr">/ticket</code><span>${t('tickets.command_open')}</span></div>
      <div class="ticket-command"><code dir="ltr">/ticket-panel</code><span>${t('tickets.command_panel')}</span></div>
      <div class="ticket-command"><code dir="ltr">/ticket-claim</code><span>${t('tickets.command_claim')}</span></div>
      <div class="ticket-command"><code dir="ltr">/ticket-close</code><span>${t('tickets.command_close')}</span></div>
      <div class="ticket-command"><code dir="ltr">/ticket-resolve</code><span>${t('tickets.command_resolve')}</span></div></div></section>
      <section class="panel"><div class="panel-body"><p>${t('tickets.export_saved')}</p><div class="dialog-actions">
      <button class="btn btn-primary" id="saveTickets" ${!saved || saving || loading ? 'disabled' : ''}>${icon('check')}${saving ? t('social.saving') : t('welcome.save_settings')}</button>
      <button class="btn btn-ghost" id="exportTickets" ${!saved || saving || dirty || model.state.demo ? 'disabled' : ''}>${icon('log')}${t('deployment.title')}</button>
      <button class="btn btn-ghost" id="reloadTickets" ${saving || loading ? 'disabled' : ''}>${t('tickets.reload')}</button></div></div></section></div>`;
    $('#ticketSettings')?.addEventListener('click', () => go('settings'));
    $('#refreshTicketRooms').onclick = () => {
      if (!saving && !busy()) void action('inventory');
    };
    $('#retryTickets')?.addEventListener('click', () => void load());
    $('#reloadTickets').onclick = () => {
      if (!saving) void load();
    };
    $('#ticketsEnabled').onchange = (e) => {
      d.enabled = e.target.checked;
      draw();
    };
    for (const [id, field] of [
      ['ticketPanelChannel', 'panelChannelId'],
      ['ticketCategory', 'categoryId'],
      ['ticketLanguage', 'language'],
    ])
      $('#' + id).onchange = (e) => {
        d[field] = e.target.value;
        draw();
      };
    $$('[data-ticket-role]').forEach(
      (input) =>
        (input.onchange = () => {
          const field = input.dataset.ticketRole;
          d[field] = input.checked
            ? [...d[field], input.value]
            : d[field].filter((id) => id !== input.value);
          draw();
        }),
    );
    $('#saveTickets').onclick = () => {
      if (!saved || saving) return;
      const issue = validation(d);
      if (issue) return toast(t(issue), 'error');
      const label = (items, id) => items.find((item) => item.id === id)?.name ?? id;
      const roleNames = (ids) => ids.map((id) => label(roles, id)).join('، ');
      showDialog(`<div translate="no"><h2>${t('tickets.confirm')}</h2><p dir="auto">${esc(guildName())}</p><p>${d.enabled ? t('ui.enable') : t('welcome.disabled')}</p>
        <p>${t('tickets.panel_channel')}: ${esc(label(channels, d.panelChannelId))}</p><p>${t('tickets.category')}: ${esc(label(categories, d.categoryId))}</p>
        <p>${t('tickets.staff_roles')}: ${esc(roleNames(d.staffRoleIds))}</p><p>${t('tickets.requester_roles')}: ${esc(roleNames(d.requesterRoleIds) || t('tickets.everyone'))}</p>
        <p>${t('tickets.activation')}</p><div class="dialog-actions"><button class="btn btn-ghost" value="cancel">${t('ui.cancel')}</button><button type="button" class="btn btn-primary" id="confirmTicketSave">${t('social.approve_save')}</button></div></div>`);
      const candidate = structuredClone(d);
      $('#confirmTicketSave').onclick = async () => {
        if (saving) return;
        saving = true;
        $('#confirmDialog').close();
        draw();
        try {
          saved = await api('/api/tickets', {
            baseRevision: saved.revision,
            confirmAutomatic: true,
            config: {
              version: 1,
              guilds: [
                ...saved.config.guilds.filter((g) => g.guildId !== candidate.guildId),
                candidate,
              ],
            },
          });
          toast(t('tickets.saved'), 'success');
        } catch (e) {
          toast(e.message, 'error');
        } finally {
          saving = false;
          if (model.page === 'tickets') draw();
        }
      };
    };
    $('#exportTickets').onclick = () => go('deployment');
  }
  window.CortexTickets = { render: draw };
  window.addEventListener('cortex-language-changed', () => {
    if (model.page === 'tickets') draw();
  });
})();
