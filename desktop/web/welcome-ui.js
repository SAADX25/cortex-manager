'use strict';
(() => {
  let saved = null,
    loading = false,
    saving = false,
    error = '',
    loaded = false;
  let validationIssue = null;
  const drafts = new Map(),
    imagePreviews = new Map();
  let previewBusy = false,
    uploading = false;
  const libraries = new Map();
  async function loadLibrary(id) {
    if (!/^\d{16,22}$/.test(id)) return;
    libraries.set(id, { assets: [], loading: true, error: '' });
    try {
      const result = await api('/api/welcome/assets?guildId=' + id);
      libraries.set(id, { assets: result.assets, loading: false, error: '' });
    } catch (e) {
      libraries.set(id, { assets: [], loading: false, error: e.message });
    } finally {
      if (model.page === 'welcome' && guildId() === id) draw();
    }
  }
  const cardStyle = (v) =>
    v.card ?? {
      mode: 'embed',
      background: 'none',
      titleColor: '#ffffff',
      textColor: '#e4e9f4',
      overlay: 0.66,
    };
  const cardSignature = (type) => JSON.stringify([guildId(), guildName(), draft()[type]]);
  const en = () => window.CortexI18n?.language === 'en',
    t = (key) => window.CortexI18n.text(key);
  const presets = Object.fromEntries(
    ['ar', 'en'].map((language) => [
      language,
      Object.fromEntries(
        ['join', 'leave'].map((type) => [
          type,
          {
            title: window.CortexLocales[language]['welcome.template_' + type + '_title'],
            message: window.CortexLocales[language]['welcome.template_' + type + '_message'],
          },
        ]),
      ),
    ]),
  );
  const templateLanguage = (v, type) =>
    ['ar', 'en'].find(
      (lang) => presets[lang][type].title === v.title && presets[lang][type].message === v.message,
    ) ?? 'custom';
  const defaults = (id) => ({
    guildId: id,
    join: {
      enabled: false,
      channelId: '',
      title: t('welcome.welcome_to_the_community'),
      message: t('welcome.hello_user_welcome_to_server_make_yourself_at_home'),
      color: '#9888ff',
    },
    leave: {
      enabled: false,
      channelId: '',
      title: t('welcome.until_next_time'),
      message: t('welcome.user_has_left_server_wishing_you_all_the_best'),
      color: '#f19b73',
    },
  });
  function validateDraft(d) {
    for (const type of ['join', 'leave']) {
      const value = d[type];
      if (
        typeof value.channelId !== 'string' ||
        (value.channelId !== '' && !/^\d{16,22}$/.test(value.channelId)) ||
        (value.enabled && !/^\d{16,22}$/.test(value.channelId))
      )
        return { type, control: 'Channel', key: 'welcome.validation_channel' };
      if (!value.title?.trim() || value.title.length > 100)
        return { type, control: 'Title', key: 'welcome.validation_title' };
      if (!value.message?.trim() || value.message.length > 1200)
        return { type, control: 'Message', key: 'welcome.validation_message' };
      if (!/^#[a-f0-9]{6}$/i.test(value.color ?? ''))
        return { type, control: 'Color', key: 'welcome.validation_color' };
    }
    if (d.kick?.enabled && !/^\d{16,22}$/.test(d.kick.channelId))
      return { type: 'kick', control: 'Channel', key: 'kick.validation_channel' };
    return null;
  }
  function checkBeforeSave(d) {
    validationIssue = validateDraft(d);
    if (!validationIssue) return true;
    validationIssue.guildId = d.guildId;
    draw();
    const issue = validationIssue;
    const node = $('#welcome' + issue.control + issue.type);
    node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    node?.focus?.();
    toast(
      (issue.type === 'kick'
        ? t('kick.title')
        : issue.type === 'join'
          ? t('welcome.welcome')
          : t('welcome.farewell')) +
        ': ' +
        t(issue.key),
      'error',
    );
    return false;
  }
  function draft() {
    const id = guildId();
    if (!drafts.has(id))
      drafts.set(
        id,
        structuredClone(saved?.config.guilds.find((g) => g.guildId === id) ?? defaults(id)),
      );
    const value = drafts.get(id);
    value.kick ??= { enabled: false, channelId: '', language: en() ? 'en' : 'ar' };
    return value;
  }
  async function load() {
    loading = true;
    error = '';
    try {
      saved = await api('/api/welcome');
      drafts.clear();
      loaded = true;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
      if (model.page === 'welcome') draw();
    }
  }
  const text = (value, language) =>
    String(value)
      .replaceAll('{user}', window.CortexLocales[language]['welcome.preview_member'])
      .replaceAll('{server}', guildName());
  function preview(type) {
    const d = draft()[type],
      language =
        templateLanguage(d, type) === 'custom' ? (en() ? 'en' : 'ar') : templateLanguage(d, type),
      target = $('#welcomePreview' + type);
    if (
      target &&
      cardStyle(d).mode === 'image' &&
      imagePreviews.get(type)?.signature === cardSignature(type)
    ) {
      target.innerHTML =
        '<div class="welcome-preview-label">' +
        t('welcome.final_image_local_preview') +
        '</div><img class="welcome-rendered-image" alt="' +
        t('welcome.welcome_card_preview') +
        '" src="data:image/png;base64,' +
        imagePreviews.get(type).data +
        '">';
      return;
    }
    if (target)
      target.innerHTML = `<div class="welcome-preview-label">${t('welcome.local_preview_no_message_sent')}</div><div class="welcome-card" style="--welcome-color:${/^#[a-f0-9]{6}$/i.test(d.color) ? d.color : '#9888ff'}"><div><strong dir="auto">${esc(text(d.title, language))}</strong><p dir="auto">${esc(text(d.message, language))}</p></div><div class="welcome-avatar">${icon('users')}</div></div>`;
  }
  function kickMarkup(d, rooms) {
    const k = d.kick;
    return (
      '<section class="panel kick-settings"><div class="panel-header"><h2>' +
      icon('shield') +
      t('kick.title') +
      '</h2><label class="welcome-enable"><input type="checkbox" id="kickEnabled" ' +
      (k.enabled ? 'checked' : '') +
      '>' +
      t('ui.enable') +
      '</label></div><div class="panel-body"><p class="field-help">' +
      t('kick.description') +
      '</p><div class="kick-settings-grid"><div class="field"><label for="welcomeChannelkick">' +
      t('kick.channel') +
      '</label><select id="welcomeChannelkick"><option value="">' +
      t('welcome.choose_a_channel') +
      '</option>' +
      (!rooms.some((c) => c.id === k.channelId) && k.channelId
        ? '<option selected value="' + esc(k.channelId) + '"># ' + esc(k.channelId) + '</option>'
        : '') +
      rooms
        .map(
          (c) =>
            '<option value="' +
            esc(c.id) +
            '" ' +
            (c.id === k.channelId ? 'selected' : '') +
            ' translate="no"># ' +
            esc(c.name) +
            '</option>',
        )
        .join('') +
      '</select></div><div class="field"><label for="kickLanguage">' +
      t('kick.language') +
      '</label><select id="kickLanguage"><option value="ar" ' +
      (k.language === 'ar' ? 'selected' : '') +
      '>العربية</option><option value="en" ' +
      (k.language === 'en' ? 'selected' : '') +
      '>English</option></select></div></div><div class="notice">' +
      icon('eye') +
      '<div>' +
      t('kick.permissions') +
      '</div></div></div></section>'
    );
  }
  function draw() {
    if (!saved && !loading && !loaded && !error) {
      void load();
    }
    const d = draft();
    if (validationIssue && validationIssue.guildId !== d.guildId) validationIssue = null;
    if (!libraries.has(d.guildId)) void loadLibrary(d.guildId);
    const library = libraries.get(d.guildId) ?? { assets: [], loading: false, error: '' },
      rooms = inventory()?.channels.filter((c) => [0, 2, 5].includes(Number(c.type))) ?? [];
    $('#main').innerHTML =
      `<div class="welcome-page" translate="no"><section class="panel"><div class="panel-header"><h2>${t('ui.welcome_farewell')}</h2><span class="pill purple">${t('welcome.local_settings')}</span></div><div class="panel-body"><p>${t('welcome.greet_your_community_with_personal_welcome_messages_and_a_separate_farew')}</p>${!inventory() ? `<p>${t('welcome.load_the_server_in_connection_settings_to_choose_channels')}</p><button class="btn btn-ghost" data-go="settings">${t('ui.connection_settings')}</button>` : ''}<div class="welcome-room-toolbar"><span>${esc(guildName())} · ${rooms.length} ${t('welcome.available_channels')}</span><button type="button" class="btn btn-ghost btn-small" id="refreshWelcomeRooms" ${saving || busy() ? 'disabled' : ''}>${icon('refresh')}${t('welcome.refresh_channels')}</button></div>${inventory() && !rooms.length ? '<p class="field-help">' + t('welcome.no_message_channels_in_current_data_refresh_channels_and_check_view_chan') + '</p>' : ''}${loading ? `<p role="status">${t('welcome.loading_settings')}</p>` : ''}${error ? `<p class="danger-text" role="alert">${esc(error)}</p><button class="btn btn-ghost" id="retryWelcome">${t('ui.retry')}</button>` : ''}</div></section><div class="welcome-grid">${[
        'join',
        'leave',
      ]
        .map((type) => {
          const v = d[type];
          return `<section class="panel welcome-editor"><div class="panel-header"><h2>${icon(type === 'join' ? 'spark' : 'users')}${type === 'join' ? t('welcome.on_join') : t('welcome.on_leave')}</h2><label class="welcome-enable"><input type="checkbox" id="welcomeEnabled${type}" ${v.enabled ? 'checked' : ''}>${t('ui.enable')}</label></div><div class="panel-body"><div class="welcome-template-language"><label for="welcomeLanguage${type}">${t('ui.template_language')}</label><select id="welcomeLanguage${type}"><option value="ar" lang="ar" ${templateLanguage(v, type) === 'ar' ? 'selected' : ''}>العربية</option><option value="en" lang="en" ${templateLanguage(v, type) === 'en' ? 'selected' : ''}>English</option><option value="custom" ${templateLanguage(v, type) === 'custom' ? 'selected' : ''} disabled>${t('welcome.custom_text')}</option></select></div><div id="welcomePreview${type}"></div><div class="field"><label for="welcomeChannel${type}">${t('welcome.destination')}</label><select id="welcomeChannel${type}"><option value="">${t('welcome.choose_a_channel')}</option>${!rooms.some((c) => c.id === v.channelId) && v.channelId ? `<option selected value="${esc(v.channelId)}"># ${esc(v.channelId)}</option>` : ''}${rooms.map((c) => `<option value="${esc(c.id)}" ${v.channelId === c.id ? 'selected' : ''}>${Number(c.type) === 2 ? '🔊' : '#'} ${esc(c.name)}</option>`).join('')}</select></div><div class="field"><label for="welcomeTitle${type}">${t('welcome.title')}</label><input dir="auto" id="welcomeTitle${type}" maxlength="100" value="${esc(v.title)}"></div><div class="field"><label for="welcomeMessage${type}">${t('welcome.message')}</label><textarea dir="auto" id="welcomeMessage${type}" maxlength="1200" rows="5">${esc(v.message)}</textarea><span class="field-help"><code>{user}</code> ${t('welcome.member_name')} · <code>{server}</code> ${t('ui.server_name')}</span></div><div class="welcome-image-options"><div class="field"><label for="welcomeMode${type}">${t('welcome.message_design')}</label><select id="welcomeMode${type}"><option value="embed" ${cardStyle(v).mode === 'embed' ? 'selected' : ''}>${t('welcome.standard_discord_embed')}</option><option value="image" ${cardStyle(v).mode === 'image' ? 'selected' : ''}>${t('welcome.custom_background_card')}</option></select></div>${cardStyle(v).mode === 'image' ? `<div class="welcome-background-library"><label for="welcomeBackground${type}">${t('welcome.this_server_s_images')}</label><select id="welcomeBackground${type}" ${saving || loading || uploading || library.loading ? 'disabled' : ''}><option value="none" ${!library.assets.some((a) => a.id === cardStyle(v).background) ? 'selected' : ''}>${t('welcome.no_image_solid_background')}</option>${library.assets.map((a) => `<option value="${esc(a.id)}" ${a.id === cardStyle(v).background ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select><div class="welcome-background-actions"><button type="button" class="btn btn-ghost btn-small" id="uploadWelcomeBackground${type}" ${uploading || saving || loading ? 'disabled' : ''}>${icon('plus')}${uploading ? t('welcome.uploading_image') : t('welcome.upload_your_image')}</button><button type="button" class="btn btn-ghost btn-small danger-text" id="removeWelcomeBackground${type}" ${uploading || saving || !library.assets.some((a) => a.id === cardStyle(v).background) ? 'disabled' : ''}>${icon('trash')}${t('welcome.delete_from_library')}</button><input type="file" id="welcomeBackgroundFile${type}" accept="image/png,image/jpeg,image/webp,image/gif" hidden></div><small class="field-help">${t('welcome.choices_are_saved_for_this_server_only_png_jpg_webp_gif_up_to_8mb')}</small>${library.error ? `<p class="danger-text">${esc(library.error)}</p>` : ''}</div><div class="welcome-text-colors"><label>${t('welcome.title_color')}<input type="color" id="welcomeTitleColor${type}" value="${esc(cardStyle(v).titleColor)}"></label><label>${t('welcome.text_color')}<input type="color" id="welcomeTextColor${type}" value="${esc(cardStyle(v).textColor)}"></label></div><label class="welcome-overlay-label" for="welcomeOverlay${type}">${t('welcome.background_dimming')} <span>${Math.round(cardStyle(v).overlay * 100)}%</span></label><input type="range" id="welcomeOverlay${type}" min="35" max="90" step="1" value="${Math.round(cardStyle(v).overlay * 100)}"><button type="button" class="btn btn-ghost" id="previewWelcomeImage${type}" ${previewBusy || uploading || saving || loading ? 'disabled' : ''}>${icon('eye')}${previewBusy ? t('welcome.rendering_preview') : t('welcome.preview_final_image')}</button><p class="field-help">${t('welcome.requires_attach_files_and_embed_links_long_text_is_shortened_in_the_imag')}</p>` : ''}</div><div class="welcome-colors"><label for="welcomeColor${type}">${t('welcome.card_color')}</label><input type="color" id="welcomeColor${type}" value="${esc(v.color)}"></div></div></section>`;
        })
        .join(
          '',
        )}</div>${kickMarkup(d, rooms)}<div class="panel welcome-actions">${validationIssue ? '<p class="welcome-validation-error" role="alert">' + esc((validationIssue.type === 'kick' ? t('kick.title') : validationIssue.type === 'join' ? t('welcome.welcome') : t('welcome.farewell')) + ': ' + t(validationIssue.key)) + '</p>' : ''}<p>${t('welcome.preview_sends_nothing_to_discord_settings_apply_on_the_host_after_updati')}</p><button class="btn btn-primary" id="saveWelcome" ${saving || uploading || loading || !saved ? 'disabled' : ''}>${icon('check')}${saving ? t('social.saving') : t('welcome.save_settings')}</button><button class="btn btn-ghost" id="exportWelcome" ${!saved || saving ? 'disabled' : ''}>${icon('log')}${t('social.download_discloud_package')}</button></div></div>`;
    for (const id of ['kickEnabled', 'welcomeChannelkick', 'kickLanguage'])
      $('#' + id).disabled = saving || loading || !saved;
    $('#welcomeChannelkick').setAttribute('aria-invalid', String(validationIssue?.type === 'kick'));
    $('#kickEnabled').onchange = () => {
      d.kick.enabled = $('#kickEnabled').checked;
    };
    $('#welcomeChannelkick').onchange = () => {
      d.kick.channelId = $('#welcomeChannelkick').value;
    };
    $('#kickLanguage').onchange = () => {
      d.kick.language = $('#kickLanguage').value;
    };
    for (const type of ['join', 'leave']) {
      preview(type);
      for (const [key, name] of [
        ['enabled', 'Enabled'],
        ['channelId', 'Channel'],
        ['title', 'Title'],
        ['message', 'Message'],
        ['color', 'Color'],
      ]) {
        const node = $('#welcome' + name + type);
        node.disabled = saving || loading || !saved;
        node.setAttribute(
          'aria-invalid',
          String(validationIssue?.type === type && validationIssue?.control === name),
        );
        node.oninput = () => {
          d[type][key] = key === 'enabled' ? node.checked : node.value;
          preview(type);
          $('#welcomeLanguage' + type).value = templateLanguage(d[type], type);
        };
      }
      const mode = $('#welcomeMode' + type);
      mode.disabled = saving || loading || !saved;
      mode.onchange = () => {
        d[type].card = { ...cardStyle(d[type]), mode: mode.value };
        draw();
      };
      if (cardStyle(d[type]).mode === 'image') {
        const selector = $('#welcomeBackground' + type);
        selector.onchange = () => {
          d[type].card = { ...cardStyle(d[type]), background: selector.value };
          preview(type);
        };
        $('#uploadWelcomeBackground' + type).onclick = () =>
          $('#welcomeBackgroundFile' + type).click();
        $('#welcomeBackgroundFile' + type).onchange = async (e) => {
          const file = e.target.files?.[0];
          if (!file || uploading || saving) return;
          if (file.size > 8 * 1024 * 1024) {
            toast(t('welcome.image_limit_is_8mb'), 'error');
            return;
          }
          const selectedGuild = d.guildId;
          uploading = true;
          draw();
          try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 32768)
              binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
            const result = await api('/api/welcome/assets?guildId=' + selectedGuild, {
              guildId: selectedGuild,
              name: file.name.slice(0, 100),
              data: btoa(binary),
            });
            libraries.set(selectedGuild, { assets: result.assets, loading: false, error: '' });
            d[type].card = { ...cardStyle(d[type]), background: result.asset.id };
            toast(
              t('welcome.image_added_save_card_settings_to_include_it_in_the_package'),
              'success',
            );
          } catch (error) {
            toast(error.message, 'error');
          } finally {
            uploading = false;
            if (model.page === 'welcome') draw();
          }
        };
        $('#removeWelcomeBackground' + type).onclick = () => {
          const id = cardStyle(d[type]).background,
            selectedGuild = d.guildId;
          if (!/^[a-f0-9]{64}$/.test(id) || uploading || saving) return;
          showDialog(
            `<div translate="no"><h2>${t('welcome.delete_this_server_s_library_image')}</h2><p>${t('welcome.if_used_by_saved_settings_select_a_different_background_and_save_first')}</p><div class="dialog-actions"><button class="btn btn-ghost" value="cancel">${t('ui.cancel')}</button><button type="button" class="btn btn-danger" id="confirmDeleteWelcomeImage">${t('welcome.delete_image')}</button></div></div>`,
          );
          $('#confirmDeleteWelcomeImage').onclick = async () => {
            if (uploading) return;
            uploading = true;
            $('#confirmDialog').close();
            draw();
            try {
              const r = await fetch('/api/welcome/assets?guildId=' + selectedGuild, {
                method: 'DELETE',
                headers: { 'X-Cortex-Key': apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ guildId: selectedGuild, id }),
              });
              const result = await r.json();
              if (!r.ok) throw new Error(result.error);
              libraries.set(selectedGuild, { assets: result.assets, loading: false, error: '' });
              for (const draft of drafts.values())
                if (draft.guildId === selectedGuild)
                  for (const kind of ['join', 'leave'])
                    if (draft[kind].card?.background === id) draft[kind].card.background = 'none';
            } catch (error) {
              toast(error.message, 'error');
            } finally {
              uploading = false;
              if (model.page === 'welcome') draw();
            }
          };
        };

        for (const [key, id] of [
          ['titleColor', 'welcomeTitleColor'],
          ['textColor', 'welcomeTextColor'],
          ['overlay', 'welcomeOverlay'],
        ]) {
          const input = $('#' + id + type);
          input.disabled = saving || loading || !saved;
          input.oninput = () => {
            d[type].card = {
              ...cardStyle(d[type]),
              [key]: key === 'overlay' ? Number(input.value) / 100 : input.value,
            };
            preview(type);
          };
        }
        $('#previewWelcomeImage' + type).onclick = async () => {
          if (previewBusy || saving) return;
          const settings = structuredClone(d[type]),
            signature = cardSignature(type);
          previewBusy = true;
          draw();
          try {
            const language =
              templateLanguage(settings, type) === 'custom'
                ? en()
                  ? 'en'
                  : 'ar'
                : templateLanguage(settings, type);
            const result = await api('/api/welcome/preview', {
              settings,
              server: guildName(),
              language,
              guildId: d.guildId,
            });
            if (cardSignature(type) === signature)
              imagePreviews.set(type, { signature, data: result.data });
          } catch (e) {
            toast(e.message, 'error');
          } finally {
            previewBusy = false;
            if (model.page === 'welcome') draw();
          }
        };
      }
      const language = $('#welcomeLanguage' + type);
      language.disabled = saving || loading || !saved;
      language.onchange = () => {
        const next = language.value;
        if (!presets[next]) return;
        const apply = () => {
          Object.assign(d[type], presets[next][type]);
          draw();
        };
        if (templateLanguage(d[type], type) !== 'custom') {
          apply();
          return;
        }
        language.value = 'custom';
        showDialog(
          `<div translate="no"><h2>${t('welcome.replace_custom_text_with_the_preset')}</h2><p>${t('welcome.only_title_and_message_change_channel_color_and_enable_state_are_preserv')}</p><div class="dialog-actions"><button class="btn btn-ghost" id="cancelWelcomePreset" type="button">${t('ui.cancel')}</button><button class="btn btn-primary" id="confirmWelcomePreset" type="button">${t('welcome.apply_preset')}</button></div></div>`,
        );
        $('#cancelWelcomePreset').onclick = () => {
          $('#confirmDialog').close();
          language.value = 'custom';
        };
        $('#confirmWelcomePreset').onclick = () => {
          $('#confirmDialog').close();
          apply();
        };
      };
    }
    $('#refreshWelcomeRooms').onclick = () => {
      if (saving || busy()) return;
      void action('inventory');
    };

    $$('[data-go]', $('#main')).forEach((b) => (b.onclick = () => go(b.dataset.go)));
    $('#retryWelcome')?.addEventListener('click', () => void load());
    $('#saveWelcome').onclick = () => {
      if (saving || uploading || !saved) return;
      if (!checkBeforeSave(d)) return;
      showDialog(
        `<div translate="no"><h2>${t('welcome.save_welcome_and_farewell_messages')}</h2><p>${esc(guildName())}</p>${['join', 'leave'].map((type) => `<p>${type === 'join' ? t('welcome.welcome') : t('welcome.farewell')}: ${d[type].enabled ? '# ' + esc(rooms.find((c) => c.id === d[type].channelId)?.name ?? d[type].channelId) : t('welcome.disabled')}</p>`).join('')}<p>${t('kick.title')}: ${d.kick.enabled ? '# ' + esc(rooms.find((c) => c.id === d.kick.channelId)?.name ?? d.kick.channelId) : t('welcome.disabled')}</p><p>${t('welcome.enabled_messages_will_be_sent_automatically_after_deploying_the_package')}</p><div class="dialog-actions"><button class="btn btn-ghost" value="cancel">${t('ui.cancel')}</button><button type="button" class="btn btn-primary" id="confirmWelcomeSave">${t('social.approve_save')}</button></div></div>`,
      );
      $('#confirmWelcomeSave').onclick = async () => {
        if (saving || uploading) return;
        if (!checkBeforeSave(d)) return;
        const config = {
          version: 1,
          guilds: [
            ...saved.config.guilds.filter((g) => g.guildId !== d.guildId),
            structuredClone(d),
          ],
        };
        saving = true;
        $('#confirmDialog').close();
        draw();
        try {
          saved = await api('/api/welcome', {
            config,
            baseRevision: saved.revision,
            confirmAutomatic: true,
          });
          toast(t('welcome.saved_export_and_update_discloud'), 'success');
        } catch (e) {
          toast(e.message, 'error');
        } finally {
          saving = false;
          if (model.page === 'welcome') draw();
        }
      };
    };
    $('#exportWelcome').onclick = () => {
      const url = '/api/social/package';
      fetch(url, { headers: { 'X-Cortex-Key': apiKey } })
        .then(async (r) => {
          if (!r.ok) throw new Error(t('welcome.package_download_failed'));
          const blob = await r.blob(),
            link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = 'Cortex-Social-Discloud.zip';
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        })
        .catch((e) => toast(e.message, 'error'));
    };
  }
  window.CortexWelcome = { render: draw };
  window.addEventListener('cortex-language-changed', () => {
    if (model.page === 'welcome') draw();
  });
})();
