'use strict';
(() => {
  const t = (key) => window.CortexI18n.text(key);
  let data = null,
    loading = false,
    building = false,
    downloading = false,
    error = '',
    appId = '';
  const featureKey = {
    tickets: 'tickets.title',
    join: 'welcome.welcome',
    leave: 'welcome.farewell',
    kick: 'kick.title',
    social: 'ui.streams_videos',
  };
  const label = (key) => t(featureKey[key] ?? 'deployment.social');
  const validApp = () => /^\d{5,22}$/.test(appId);
  async function load() {
    if (loading || building) return;
    loading = true;
    error = '';
    try {
      data = await api('/api/deployment');
      appId ||= data.appId;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
      if (model.page === 'deployment') draw();
    }
  }
  const size = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';
  function draw() {
    if (!data && !loading && !error) void load();
    const last = data?.lastBuild;
    const current = last && !last.stale && last.appId === appId;
    const disabled = loading || building;
    const rows = (data?.features ?? [])
      .map(
        (f) =>
          `<tr><td>${esc(label(f.key))}</td><td>${f.saved}</td><td>${f.enabled}</td><td><button class="btn btn-ghost btn-small" data-deployment-go="${f.page}">${t('deployment.edit')}</button></td></tr>`,
      )
      .join('');
    $('#main').innerHTML = `<div class="welcome-page deployment-page" translate="no">
      <section class="panel"><div class="panel-header"><h2>${icon('log')}${t('deployment.title')}</h2><span class="pill purple">Discloud</span></div>
      <div class="panel-body"><p>${t('deployment.intro')}</p><div class="welcome-room-toolbar"><span class="pill ${current ? 'green' : 'purple'}">${current ? t('deployment.current') : last ? t('deployment.changed') : t('deployment.not_built')}</span>
      <button class="btn btn-ghost btn-small" id="refreshDeployment" ${disabled ? 'disabled' : ''}>${icon('refresh')}${t('deployment.refresh')}</button></div>
      ${loading ? `<p role="status">${t('deployment.loading')}</p>` : ''}${error ? `<p role="alert" class="danger-text">${esc(error)}</p>` : ''}
      ${data?.demo ? `<p class="field-help">${t('deployment.demo')}</p>` : ''}</div></section>
      <section class="panel"><div class="panel-header"><h2>${t('deployment.included')}</h2></div><div class="panel-body">
      <p class="field-help">${t('deployment.save_first')}</p><div class="deployment-table-wrap"><table class="deployment-table"><thead><tr><th>${t('deployment.feature')}</th><th>${t('deployment.saved')}</th><th>${t('deployment.enabled')}</th><th>${t('deployment.settings')}</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>
      <section class="panel"><div class="panel-header"><h2>${t('deployment.direct_title')}</h2></div><div class="panel-body"><p>${t('deployment.direct_help')}</p><div class="dialog-actions">${[
        ['channels', 'ui.categories_channels'],
        ['roles', 'ui.roles_permissions'],
        ['changes', 'deployment.changes'],
        ['redesign', 'deployment.redesign'],
      ]
        .map(
          ([page, key]) =>
            `<button class="btn btn-ghost btn-small" data-deployment-go="${page}">${t(key)}</button>`,
        )
        .join('')}</div></div></section>
      <section class="panel"><div class="panel-header"><h2>${t('deployment.prepare')}</h2></div><div class="panel-body">
      <div class="field"><label for="deploymentAppId">${t('deployment.app_id')}</label><input id="deploymentAppId" dir="ltr" inputmode="numeric" maxlength="22" value="${esc(appId)}" ${building ? 'disabled' : ''}></div>
      <p class="field-help">${t('deployment.target_help')}</p>
      <div class="dialog-actions"><button class="btn btn-primary" id="buildDeployment" ${disabled || !data?.canBuild || !validApp() ? 'disabled' : ''}>${icon('log')}${building ? t('deployment.building') : t('deployment.build')}</button>
      <button class="btn btn-ghost" id="downloadDeployment" ${!current || disabled || downloading ? 'disabled' : ''}>${icon('check')}${downloading ? t('deployment.downloading') : t('deployment.download')}</button>
      <a class="btn btn-ghost" id="deploymentDashboard" href="${validApp() ? 'https://discloud.com/dashboard/app/' + appId : 'https://discloud.com/dashboard'}" target="_blank" rel="noopener noreferrer">${icon('link')}${t('deployment.open_dashboard')}</a></div>
      ${data && !data.demo && !data.canBuild ? `<p role="status" class="field-help">${t(data.runtimeAvailable ? 'deployment.empty' : 'deployment.missing_files')}</p>` : ''}
      ${last ? `<div class="deployment-result"><p>${t('deployment.last_build')}: <time dir="auto">${esc(new Date(last.builtAt).toLocaleString(window.CortexI18n.language === 'ar' ? 'ar-JO' : 'en-GB'))}</time> · <span dir="ltr">${size(last.bytes)}</span></p><p>${t('deployment.filename')}: <code dir="ltr">cortex-manager.zip</code></p><p class="field-help">${t('deployment.fingerprint')}</p><code class="deployment-hash" dir="ltr">${esc(last.sha256)}</code></div>` : ''}
      </div></section><section class="panel"><div class="panel-header"><h2>${t('deployment.upload_steps')}</h2></div><div class="panel-body"><ol class="deployment-steps"><li>${t('deployment.step_save')}</li><li>${t('deployment.step_build')}</li><li>${t('deployment.step_upload')}</li><li>${t('deployment.step_restart')}</li></ol>
      <p>${t('deployment.environment')}</p><div class="deployment-env" dir="ltr">${(data?.requiredEnvironment ?? []).map((name) => `<code>${esc(name)}</code>`).join(' ')}</div>
      ${data?.serverMembersIntent ? `<p class="field-help">${t('deployment.members_intent')}</p>` : ''}${data?.viewAuditLog ? `<p class="field-help">${t('deployment.audit_log')}</p>` : ''}
      <p class="field-help">${t('deployment.preserve_data')}</p></div></section></div>`;
    $$('[data-deployment-go]').forEach(
      (node) => (node.onclick = () => go(node.dataset.deploymentGo)),
    );
    $('#refreshDeployment').onclick = () => void load();
    $('#deploymentAppId').oninput = (e) => {
      appId = e.target.value.trim();
      $('#buildDeployment').disabled = disabled || !data?.canBuild || !validApp();
      $('#downloadDeployment').disabled = !last || last.stale || last.appId !== appId || disabled;
      $('#deploymentDashboard').href = validApp()
        ? 'https://discloud.com/dashboard/app/' + appId
        : 'https://discloud.com/dashboard';
    };
    $('#buildDeployment').onclick = async () => {
      if (!data?.canBuild || !validApp() || building || loading) return;
      building = true;
      error = '';
      draw();
      try {
        data = await api('/api/deployment/build', { appId, baseRevision: data.revision });
        toast(t('deployment.built'), 'success');
      } catch (e) {
        error = e.message;
      } finally {
        building = false;
        if (model.page === 'deployment') draw();
      }
    };
    $('#downloadDeployment').onclick = async () => {
      if (!current || downloading || building) return;
      downloading = true;
      draw();
      try {
        const result = await fetch(last.downloadURL, { headers: { 'X-Cortex-Key': apiKey } });
        if (!result.ok) {
          const issue = await result.json();
          throw new Error(issue.error || t('welcome.package_download_failed'));
        }
        const link = document.createElement('a');
        link.href = URL.createObjectURL(await result.blob());
        link.download = 'cortex-manager.zip';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      } catch (e) {
        error = e.message;
      } finally {
        downloading = false;
        if (model.page === 'deployment') draw();
      }
    };
  }
  window.CortexDeployment = {
    render: () => {
      if (!loading && !building) void load();
      draw();
    },
  };
  window.addEventListener('cortex-language-changed', () => {
    if (model.page === 'deployment') draw();
  });
})();
