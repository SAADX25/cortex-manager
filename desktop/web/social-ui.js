'use strict';
(() => {
  let saved = null,
    loading = false,
    error = '',
    saving = false,
    dirty = false,
    savedLinks = null;
  const drafts = new Map();
  const en = () => window.CortexI18n?.language === 'en';
  const t = (key) => window.CortexI18n.text(key);
  const platforms = { youtube: 'YouTube', kick: 'Kick', instagram: 'Instagram', tiktok: 'TikTok' };
  function sourceLinkURL(feed) {
    const stored = savedLinks?.links.find(
      (link) => link.feedId === feed.id && link.guildId === feed.guildId,
    );
    if (stored) return stored.url;
    const source = encodeURIComponent(feed.source);
    return (
      {
        youtube: `https://www.youtube.com/channel/${source}`,
        kick: `https://kick.com/${source}`,
        instagram: `https://www.instagram.com/${source}/`,
        tiktok: `https://www.tiktok.com/@${source}`,
      }[feed.platform] ?? '#'
    );
  }
  const platformIcon = (key) =>
    key === 'youtube'
      ? '<svg class="icon social-youtube-logo" viewBox="0 0 24 24" aria-hidden="true"><rect class="youtube-body" x="2" y="5" width="20" height="14" rx="4.5"/><path class="youtube-play" d="M10 8.5 16 12l-6 3.5Z"/></svg>'
      : key === 'kick'
        ? 'K'
        : key === 'instagram'
          ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/></svg>'
          : '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3v12a4 4 0 1 1-4-4M14 3c1 4 3 5 6 5"/></svg>';
  const draft = () => {
    const id = guildId();
    if (!drafts.has(id))
      drafts.set(id, {
        platform: 'youtube',
        source: '',
        channelId: '',
        language: 'ar',
        enabled: false,
        rssURL: '',
        url: '',
        caption: '',
        manualChannel: '',
        request: null,
        image: null,
        imageReading: false,
        autoThumbnail: true,
        thumbnail: null,
      });
    return drafts.get(id);
  };
  const rooms = () => inventory()?.channels.filter((c) => [0, 5].includes(c.type)) ?? [];
  const options = (value) =>
    `<option value="">${t('social.choose_a_destination')}</option>` +
    rooms()
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === value ? 'selected' : ''} translate="no"># ${esc(c.name)}</option>`,
      )
      .join('');
  const guard = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  async function load() {
    if (loading) return;
    loading = true;
    error = '';
    try {
      const results = await Promise.all([api('/api/social'), api('/api/social/links')]);
      saved = results[0];
      savedLinks = results[1];
      dirty = false;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
      if (model.page === 'social') render();
    }
  }
  function field(label, id, content) {
    return `<label class="social-field" for="${id}"><span>${label}</span>${content}</label>`;
  }
  function imagePreview(image) {
    return image
      ? `<figure class="social-image-preview"><img src="data:${esc(image.type)};base64,${esc(image.data)}" alt="${t('social.image_attached_to_the_message')}"><figcaption>${t('social.this_image_will_be_uploaded_with_the_link')}</figcaption></figure>`
      : '';
  }
  function renderSocial() {
    const d = draft(),
      id = guildId(),
      inv = inventory(),
      feeds = saved?.config.feeds.filter((f) => f.guildId === id) ?? [],
      p =
        d.request &&
        model.state.messagePreview?.channelId === d.request.channelId &&
        model.state.messagePreview?.content === d.request.content &&
        !model.state.messagePreview?.embeds &&
        model.state.messagePreview?.image?.sha256 === d.request.image?.sha256
          ? model.state.messagePreview
          : null;
    $('#main').innerHTML =
      `<div class="social-page" translate="no"><section class="panel social-hero"><div class="social-hero-icon">${icon('play')}</div><div><h1>${t('ui.streams_videos')}</h1><p>${t('social.your_creators_destinations_and_community_updates_in_one_place')}</p></div><span class="pill purple">${t('social.local_configuration')}</span></section>
 <div class="social-layout"><section class="panel"><div class="panel-header"><h2>${t('social.notification_sources')}</h2><span class="pill">${feeds.length}</span></div><div class="panel-body">
 ${loading ? `<p role="status">${t('social.loading')}</p>` : error ? `<p role="alert">${esc(error)}</p><button class="btn btn-ghost" id="reloadSocial">${t('social.reload')}</button>` : ''}
 ${!inv ? `<p>${t('social.load_the_server_in_connection_settings_to_choose_destinations')}</p><button class="btn btn-ghost" data-go="settings">${t('ui.connection_settings')}</button>` : ''}
 <div class="social-sources">${feeds.length ? feeds.map((f) => `<article class="social-source"><span class="social-platform ${esc(f.platform)}">${esc(platforms[f.platform] ?? f.platform)}</span><div><strong dir="auto">${esc(f.source)}</strong><small dir="auto"># ${esc(rooms().find((c) => c.id === f.channelId)?.name ?? f.channelId)} · ${f.language === 'ar' ? 'العربية' : 'English'}</small><small>${savedLinks?.links.some((link) => link.feedId === f.id) ? t('social.saved_link') : ''}${f.rssURL ? 'RSS · ' : ''}${f.enabled ? t('social.enabled_in_export_configuration') : t('social.paused_in_export_configuration')}</small></div><div class="social-source-actions">${f.platform === 'instagram' ? `<button type="button" class="icon-button social-rss-button ${f.rssURL ? 'is-linked' : ''}" data-social-rss="${esc(f.id)}" title="${t('social.configure_instagram_rss_feed')}" aria-label="${t('social.configure_instagram_rss_feed')}" ${saving ? 'disabled' : ''}>${icon('rss')}</button>` : ''}<a class="icon-button social-source-link ${esc(f.platform)}" href="${esc(sourceLinkURL(f))}" target="_blank" rel="noopener noreferrer" title="${t('social.open_saved_link')}" aria-label="${esc(t('social.open_link_for') + f.source)}">${icon('link')}</a><button type="button" class="icon-button social-source-toggle ${f.enabled ? 'is-active' : 'is-paused'}" aria-pressed="${f.enabled}" title="${f.enabled ? t('social.pause_source_notifications') : t('social.enable_source_notifications')}" data-social-toggle="${esc(f.id)}" aria-label="${f.enabled ? t('social.pause_source') : t('social.enable_source')}" ${saving ? 'disabled' : ''}>${icon(f.enabled ? 'pause' : 'play')}</button><button type="button" class="icon-button danger-text" data-social-remove="${esc(f.id)}" aria-label="${t('social.remove_source_from_configuration')}" ${saving ? 'disabled' : ''}>${icon('trash')}</button></div></article>`).join('') : `<div class="social-empty">${icon('link')}<p>${t('social.add_your_first_creator_and_choose_a_destination')}</p></div>`}</div>
 <form id="socialSourceForm" class="social-form"><div class="social-grid"><div class="social-platform-field"><span>${t('social.platform')}</span><input type="hidden" id="socialPlatform" value="${esc(d.platform)}"><div class="social-platform-picker" role="group" aria-label="${t('social.choose_platform')}">${Object.entries(
   platforms,
 )
   .map(
     ([key, label]) =>
       `<button type="button" class="social-platform-choice ${key}" data-social-platform="${key}" aria-pressed="${d.platform === key}"><span class="social-platform-mark" aria-hidden="true">${platformIcon(key)}</span><span>${label}</span></button>`,
   )
   .join(
     '',
   )}</div></div>${field(t('social.notification_language'), 'socialLanguage', `<select id="socialLanguage"><option value="ar" ${d.language === 'ar' ? 'selected' : ''}>العربية</option><option value="en" ${d.language === 'en' ? 'selected' : ''}>English</option></select>`)}</div>
 ${field(d.platform === 'youtube' ? t('social.youtube_channel_url_handle_or_channel_id') : t('social.username_or_profile_url'), 'socialSource', `<input id="socialSource" dir="ltr" maxlength="200" required value="${esc(d.source)}" placeholder="${d.platform === 'youtube' ? 'https://www.youtube.com/@channel' : d.platform === 'kick' ? 'kick.com/creator' : d.platform === 'tiktok' ? 'tiktok.com/@creator' : 'instagram.com/creator'}">`)}
 ${d.platform === 'instagram' ? field(t('social.rss_app_xml_feed_optional_alternative_to_meta'), 'socialRSS', `<input id="socialRSS" dir="ltr" maxlength="500" type="url" value="${esc(d.rssURL)}" placeholder="https://rss.app/feeds/FEED_ID.xml">`) : ''}
 ${field(t('social.destination_channel'), 'socialChannel', `<select id="socialChannel" required>${options(d.channelId)}</select>`)}
 <label class="social-consent"><input id="socialEnabled" type="checkbox" ${d.enabled ? 'checked' : ''}><span>${t('social.enable_automatic_posting_in_the_hosting_configuration')}</span></label>
 <button class="btn btn-ghost" type="submit" ${!saved || !inv || saving ? 'disabled' : ''}>${icon('plus')}${t('social.add_source')}</button></form>
 <div class="social-save-row"><button type="button" class="icon-button" id="reloadSocialSettings" aria-label="${t('social.reload_saved_settings')}" ${saving ? 'disabled' : ''}>${icon('refresh')}</button><span role="status">${dirty ? t('social.unsaved_changes') : t('social.saved_settings_apply_after_updating_the_host')}</span><button class="btn btn-primary" id="saveSocial" ${!dirty || saving ? 'disabled' : ''}>${icon('check')}${saving ? t('social.saving') : t('social.save_configuration')}</button></div>
 </div></section>
 <div class="social-side"><section id="socialManualPanel" class="panel"><div class="panel-header"><h2>${t('social.share_a_link_manually')}</h2>${icon('link')}</div><form class="panel-body social-form" id="socialManualForm">
 ${field(t('ui.channel'), 'socialManualChannel', `<select id="socialManualChannel" required>${options(d.manualChannel)}</select>`)}
 ${field(t('social.stream_or_video_url'), 'socialURL', `<input id="socialURL" type="url" required dir="ltr" maxlength="500" placeholder="https://…" value="${esc(d.url)}">`)}
 ${field(t('social.optional_caption'), 'socialCaption', `<textarea id="socialCaption" rows="4" maxlength="1200" dir="auto">${esc(d.caption)}</textarea>`)}
 <label class="social-consent"><input type="checkbox" id="socialAutoThumbnail" ${d.autoThumbnail ? 'checked' : ''}><span>${t('social.automatically_fetch_the_instagram_post_thumbnail')}</span></label><p class="field-help">${t('social.no_local_image_needed_if_instagram_makes_the_thumbnail_available_it_appe')}</p>${d.imageReading ? `<p role="status">${t('social.fetching_instagram_thumbnail')}</p>` : imagePreview(d.image)}${d.thumbnail?.status === 'unavailable' ? `<div class="notice yellow" id="socialThumbnailStatus" role="status">${icon('info')}<div><strong>${t('social.thumbnail_unavailable_this_preview_contains_a_link_only')}</strong><p>${t('social.the_post_may_be_private_require_login_or_instagram_may_block_access_noth')}</p></div></div>` : ''}
 <p class="field-help">${t('social.posted_as_the_bot_after_preview_and_confirmation_mentions_are_disabled')}</p>
 <div class="social-actions"><button class="btn btn-ghost" type="submit" ${!inv || busy() || d.imageReading ? 'disabled' : ''}>${icon('eye')}${t('ui.preview_message')}</button><button class="btn btn-primary" type="button" id="socialSend" ${!p || busy() || model.state.demo ? 'disabled' : ''}>${icon('play')}${t('social.send_to_discord')}</button></div>
 ${p ? `<div class="notice social-review-notice" role="status">${icon('eye')}<div><strong>${t('social.preview_ready_message_not_sent_yet')}</strong><p>${t('social.select_send_to_discord_then_confirm_in_the_next_dialog')}</p></div></div><pre class="social-preview" dir="auto">${esc(p.content)}</pre>` : ''}</form></section>
 <section class="panel"><div class="panel-header"><h2>${t('social.run_on_discloud')}</h2><span class="pill">Cloud</span></div><div class="panel-body social-host"><p>${t('social.download_all_saved_sources_upload_the_package_then_set_the_bot_token_in_')}</p><button id="exportSocial" class="btn btn-primary" ${!saved || dirty || saving || model.state.demo ? 'disabled' : ''}>${icon('log')}${t('deployment.title')}</button><p class="field-help">${t('social.the_free_plan_does_not_guarantee_uninterrupted_operation_saves_are_local')}</p><a class="btn btn-ghost" href="https://discloud.com/dashboard/app/1793358824529" target="_blank" rel="noopener noreferrer">${icon('link')}${t('social.open_discloud')}</a></div></section></div></div>
 <section class="panel social-capabilities"><h2>${t('social.automatic_capabilities')}</h2><div class="social-grid"><p><strong>YouTube</strong><span>${t('social.new_videos_and_shorts_via_rss_accepts_a_channel_url_or_handle_live_start')}</span></p><p><strong>Kick</strong><span>${t('social.new_live_streams_via_the_official_api_requires_client_id_and_client_secr')}</span></p><p><strong>Instagram</strong><span>${t('social.use_an_rss_app_feed_for_a_public_account_or_the_api_for_an_authorized_pr')}</span></p><p><strong>TikTok</strong><span>${t('social.new_videos_from_your_authorized_account_via_api_requires_tiktok_access_t')}</span></p></div><p class="field-help">${t('social.the_first_successful_check_skips_existing_content_checks_run_roughly_eve')}</p></section></div>`;
    if (!saved && !loading && !error) void load();
    if (saving)
      $$('input,textarea,select,button[data-social-platform]', $('#main')).forEach(
        (el) => (el.disabled = true),
      );
    $('#reloadSocialSettings').onclick = () => {
      if (!dirty) {
        void load();
        return;
      }
      showDialog(
        `<h2 translate="no">${t('social.discard_unsaved_changes')}</h2><div class="dialog-actions"><button class="btn btn-ghost" value="cancel">${t('ui.cancel')}</button><button type="button" class="btn btn-primary" id="reloadSocialConfirmed">${t('social.reload')}</button></div>`,
      );
      $('#reloadSocialConfirmed').onclick = () => {
        $('#confirmDialog').close();
        void load();
      };
    };
    $('#reloadSocial')?.addEventListener('click', () => void load());
    const capture = () => {
      d.platform = $('#socialPlatform').value;
      d.source = $('#socialSource').value;
      d.channelId = $('#socialChannel').value;
      d.language = $('#socialLanguage').value;
      d.enabled = $('#socialEnabled').checked;
      d.rssURL = $('#socialRSS')?.value ?? d.rssURL;
      d.url = $('#socialURL').value;
      d.caption = $('#socialCaption').value;
      d.manualChannel = $('#socialManualChannel').value;
      d.autoThumbnail = $('#socialAutoThumbnail').checked;
    };
    $$('input,textarea,select', $('#main')).forEach((el) => {
      el.addEventListener('input', () => {
        capture();
        if (
          ['socialURL', 'socialCaption', 'socialManualChannel', 'socialAutoThumbnail'].includes(
            el.id,
          )
        ) {
          d.request = null;
          $('#socialSend').disabled = true;
          if (['socialURL', 'socialAutoThumbnail'].includes(el.id)) {
            d.image = null;
            d.thumbnail = null;
            $('#socialManualForm .social-image-preview')?.remove();
            $('#socialThumbnailStatus')?.remove();
          }
        }
      });
    });
    $$('[data-social-platform]').forEach(
      (b) =>
        (b.onclick = () => {
          capture();
          d.platform = b.dataset.socialPlatform;
          d.source = '';
          d.rssURL = '';
          render();
        }),
    );
    $('#socialSourceForm').onsubmit = (e) => {
      e.preventDefault();
      void guard(async () => {
        capture();
        if (!saved || !inv || saving) return;
        const f = {
          id: crypto.randomUUID(),
          guildId: id,
          channelId: d.channelId,
          platform: d.platform,
          source: d.source.trim(),
          language: d.language,
          enabled: d.enabled,
          ...(d.platform === 'instagram' && d.rssURL.trim() ? { rssURL: d.rssURL.trim() } : {}),
        };
        saving = true;
        render();
        try {
          const checked = await api('/api/social/validate', {
            version: 1,
            feeds: [...saved.config.feeds, f],
          });
          saved.config = checked.config;
          dirty = true;
          d.source = '';
          toast(t('social.source_added_to_draft_save_settings_then_update_the_host'), 'success');
        } finally {
          saving = false;
          if (model.page === 'social') render();
        }
      })();
    };

    $$('[data-social-rss]').forEach(
      (b) =>
        (b.onclick = () => {
          if (saving) return;
          if (dirty) {
            toast(t('social.save_source_changes_first_then_configure_rss'), 'error');
            return;
          }
          const source = feeds.find((f) => f.id === b.dataset.socialRss);
          if (!source) return;
          showDialog(
            `<div translate="no"><div class="dialog-symbol">${icon('rss')}</div><h2>${t('social.connect_instagram_via_rss')}</h2><p><strong>${esc(source.source)}</strong> → # ${esc(rooms().find((c) => c.id === source.channelId)?.name ?? source.channelId)}</p><div class="social-form">${field('RSS.app XML', 'instagramRSSURL', `<input class="social-rss-input" id="instagramRSSURL" type="url" dir="ltr" maxlength="500" required placeholder="https://rss.app/feeds/FEED_ID.xml" value="${esc(source.rssURL ?? '')}">`)}<label class="social-consent"><input type="checkbox" id="instagramRSSEnabled" ${source.enabled ? 'checked' : ''}><span>${t('social.enable_automatic_posting_of_new_items_to_this_channel')}</span></label><p>${t('social.existing_posts_establish_a_baseline_without_being_sent_save_locally_then')}</p><p id="instagramRSSError" role="alert" class="danger-text"></p><div class="dialog-actions"><button class="btn btn-ghost" value="cancel">${t('ui.cancel')}</button><button type="button" class="btn btn-primary" id="saveInstagramRSS">${t('social.save_rss_feed')}</button></div></div></div>`,
          );
          $('#saveInstagramRSS').onclick = async () => {
            const input = $('#instagramRSSURL');
            if (!input.reportValidity()) return;
            const config = {
              version: 1,
              feeds: saved.config.feeds.map((f) =>
                f.id === source.id
                  ? { ...f, rssURL: input.value.trim(), enabled: $('#instagramRSSEnabled').checked }
                  : f,
              ),
            };
            const button = $('#saveInstagramRSS');
            button.disabled = true;
            saving = true;
            render();
            try {
              saved = await api('/api/social', {
                baseRevision: saved.revision,
                config,
                confirmAutomatic: true,
              });
              $('#confirmDialog').close();
              render();
              toast(t('social.rss_saved_export_the_package_and_update_your_host'), 'success');
            } catch (error) {
              $('#instagramRSSError').textContent = error.message;
              button.disabled = false;
            } finally {
              saving = false;
              render();
            }
          };
        }),
    );
    $$('[data-social-toggle]').forEach(
      (b) =>
        (b.onclick = () => {
          const f = saved.config.feeds.find((f) => f.id === b.dataset.socialToggle);
          f.enabled = !f.enabled;
          dirty = true;
          render();
        }),
    );
    $$('[data-social-remove]').forEach(
      (b) =>
        (b.onclick = () => {
          if (saving) return;
          const source = saved.config.feeds.find((f) => f.id === b.dataset.socialRemove);
          if (!source) return;
          showDialog(
            `<div translate="no"><div class="dialog-symbol danger-text">${icon('trash')}</div><h2>${t('social.do_you_want_to_delete_this_source')}</h2><p><strong>${esc(source.source)}</strong> · ${esc(platforms[source.platform])}</p><p>${t('social.it_will_be_removed_from_notification_settings_save_your_settings_after_d')}</p><div class="dialog-actions"><button type="button" class="btn btn-ghost" id="cancelSocialRemove" autofocus>${t('ui.cancel')}</button><button type="button" class="btn btn-danger" id="confirmSocialRemove">${icon('trash')}${t('social.yes_delete_source')}</button></div></div>`,
          );
          $('#cancelSocialRemove').onclick = () => $('#confirmDialog').close();
          $('#confirmSocialRemove').onclick = () => {
            if (saving) return;
            saved.config.feeds = saved.config.feeds.filter((f) => f.id !== source.id);
            dirty = true;
            $('#confirmDialog').close();
            render();
          };
        }),
    );
    $('#saveSocial').onclick = guard(async () => {
      const persist = async () => {
        saving = true;
        render();
        try {
          saved = await api('/api/social', {
            baseRevision: saved.revision,
            config: saved.config,
            confirmAutomatic: true,
          });
          dirty = false;
          toast(t('social.saved_update_the_host_to_apply_these_settings'), 'success');
        } finally {
          saving = false;
          render();
        }
      };
      if (saved.config.feeds.some((f) => f.enabled)) {
        showDialog(
          `<h2 translate="no">${t('social.confirm_automatic_posting')}</h2><p translate="no">${t('social.after_uploading_this_configuration_and_starting_the_host_the_bot_will_po')}</p><ul translate="no">${saved.config.feeds
            .filter((f) => f.enabled)
            .map(
              (f) =>
                `<li>${esc(f.platform)} · ${esc(f.source)} → ${esc(rooms().find((c) => c.id === f.channelId && f.guildId === id)?.name ?? f.channelId)} (${esc(f.guildId)})</li>`,
            )
            .join(
              '',
            )}</ul><div class="dialog-actions"><button class="btn btn-ghost" value="cancel">${t('ui.cancel')}</button><button class="btn btn-primary" type="button" id="confirmSocialSave">${t('social.approve_save')}</button></div>`,
        );
        $('#confirmSocialSave').onclick = guard(async () => {
          $('#confirmDialog').close();
          await persist();
        });
      } else await persist();
    });
    $('#socialManualForm').onsubmit = (e) => {
      e.preventDefault();
      if (d.imageReading || busy()) return;
      void guard(async () => {
        capture();
        const values = {
            channelId: d.manualChannel,
            url: d.url,
            caption: d.caption,
            language: en() ? 'en' : 'ar',
            captureThumbnail:
              d.autoThumbnail && /^https:\/\/(?:www\.)?instagram\.com\//i.test(d.url),
          },
          signature = JSON.stringify([d.url, d.caption, d.manualChannel, d.autoThumbnail]);
        d.request = null;
        d.image = null;
        d.thumbnail = null;
        d.imageReading = true;
        render();
        try {
          const result = await api('/api/social/manual', values);
          if (signature !== JSON.stringify([d.url, d.caption, d.manualChannel, d.autoThumbnail]))
            return;
          d.image = result.request.image ?? null;
          d.thumbnail = result.thumbnail ?? null;
          d.request = result.request;
          d.imageReading = false;
          await action('message-preview', { messageRequest: d.request });
        } finally {
          d.imageReading = false;
          if (model.page === 'social' && guildId() === id) render();
        }
      })();
    };
    $('#socialSend').onclick = () => {
      if (!p) return;
      showDialog(
        `<h2 translate="no">${t('social.confirm_link_delivery')}</h2><p translate="no">${esc(guildName())} → # ${esc(p.channelName)}</p><pre class="social-preview" dir="auto" translate="no">${esc(p.content)}</pre>${p.image ? imagePreview(d.request.image) : ''}<div class="dialog-actions"><button class="btn btn-ghost" value="cancel">${t('ui.cancel')}</button><button type="button" id="confirmSocialSend" class="btn btn-primary">${t('ui.confirm_send')}</button></div>`,
      );
      $('#confirmSocialSend').onclick = () => {
        $('#confirmDialog').close();
        d.request = null;
        action('message-send', {
          messageConfirmation: {
            confirmed: true,
            guildId: id,
            channelId: p.channelId,
            approvalHash: p.approvalHash,
          },
        });
      };
    };
    $('#exportSocial').onclick = () => go('deployment');
  }
  window.addEventListener('beforeunload', (event) => {
    if (dirty || saving) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  window.addEventListener('cortex-language-changed', () => {
    if (model.page === 'social') render();
  });
  window.CortexSocial = { render: renderSocial };
})();
