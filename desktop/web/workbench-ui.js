'use strict';
(() => {
  const staged = () => draftStore.list(guildId()).filter((e) => e.staged);
  const signature = () => JSON.stringify(staged().map((e) => e.request));
  function entityFor(entry) {
    const inv = inventory(),
      r = entry.request;
    return r.kind === 'guild'
      ? inv?.guildProfile
      : (r.kind === 'role' ? inv?.roles : inv?.channels)?.find((item) => item.id === r.id);
  }
  function stale(entry) {
    return (
      entry.request.action === 'update' &&
      (!entityFor(entry) ||
        entityFor(entry).revision !== entry.request.revision ||
        !!entityFor(entry).readOnlyReason)
    );
  }
  function incomplete(entry) {
    const v = entry.request.values;
    return (
      (typeof v.name === 'string' && !v.name.trim()) ||
      ['color', 'rate_limit_per_user', 'user_limit'].some(
        (k) =>
          k in v &&
          (v[k] === null ||
            !Number.isInteger(v[k]) ||
            v[k] < 0 ||
            v[k] > (k === 'user_limit' ? 99 : k === 'rate_limit_per_user' ? 21600 : 0xffffff)),
      )
    );
  }
  const display = (value) =>
    value === null
      ? '—'
      : typeof value === 'boolean'
        ? value
          ? 'نعم'
          : 'لا'
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  const labels = {
    name: 'الاسم',
    color: 'اللون',
    hoist: 'عرض منفصل',
    mentionable: 'قابلة للمنشن',
    parent_id: 'القسم',
    topic: 'الوصف',
    rate_limit_per_user: 'تهدئة الرسائل (ثانية)',
    user_limit: 'الحد الأقصى للأعضاء',
    type: 'نوع الغرفة',
  };
  function diffs(entry) {
    const before = entityFor(entry),
      r = entry.request;
    return Object.entries(r.values)
      .filter(
        ([key, value]) =>
          key !== 'type' &&
          JSON.stringify(value) !==
            JSON.stringify(
              before?.[key] ??
                (key === 'parent_id'
                  ? null
                  : ['color', 'rate_limit_per_user', 'user_limit'].includes(key)
                    ? 0
                    : ['hoist', 'mentionable'].includes(key)
                      ? false
                      : ''),
            ),
      )
      .map(([field, after]) => ({ field, before: before?.[field] ?? null, after }));
  }
  function fieldValue(field, value) {
    if (field === 'parent_id' && value)
      return inventory()?.channels.find((c) => c.id === value)?.name ?? value;
    if (field === 'color' && value !== null) return colorHex(value);
    return display(value);
  }
  function changeRows(changes) {
    return changes
      .filter((c) => !['permissions', 'permission_overwrites'].includes(c.field))
      .map(
        (c) =>
          `<div class="change-diff-row"><span>${esc(labels[c.field] ?? c.field)}</span><del dir="auto" ${['name', 'parent_id', 'topic'].includes(c.field) ? 'translate="no"' : ''}>${esc(fieldValue(c.field, c.before))}</del><span class="change-direction" aria-hidden="true">←</span><ins dir="auto" ${['name', 'parent_id', 'topic'].includes(c.field) ? 'translate="no"' : ''}>${esc(fieldValue(c.field, c.after))}</ins></div>`,
      )
      .join('');
  }
  function permissionDiffs(entry) {
    const r = entry.request;
    return (
      Object.entries(r.permissionChanges ?? {})
        .map(
          ([name, value]) =>
            `<span class="change-permission ${name === 'Administrator' ? 'sensitive' : ''}"><span>${esc(permissionLabel(name))}</span>: <span>${value ? 'تفعيل' : 'إيقاف'}</span></span>`,
        )
        .join('') +
      (r.overwriteChanges ?? [])
        .flatMap((change) =>
          Object.entries(change.permissions).map(
            ([name, state]) =>
              `<span class="change-permission"><span translate="no">${esc(inventory()?.roles.find((role) => role.id === change.roleId)?.name ?? change.roleId)}</span> · <span>${esc(permissionLabel(name))}</span>: <span>${esc({ allow: 'سماح', deny: 'منع', inherit: 'وراثة' }[state])}</span></span>`,
          ),
        )
        .join('')
    );
  }
  function openEntry(entry, rebase = false) {
    if (busy() || !inventory()) return;
    const item = entityFor(entry),
      r = entry.request;
    if (r.action === 'update' && !item) {
      toast('العنصر لم يعد موجودًا في السيرفر؛ تبقى مسودته محفوظة.', 'error');
      return;
    }
    if (item?.readOnlyReason) {
      toast('هذا العنصر محمي أو أصبح غير قابل للتعديل.', 'error');
      return;
    }
    if (stale(entry) && !rebase) {
      showDialog(
        `<div class="dialog-symbol">${icon('info')}</div><h2>تغيّر العنصر منذ حفظ المسودة</h2><p>راجع الفرق قبل تحميل مسودتك فوق البيانات الحالية. يلزم بعدها إجراء معاينة جديدة.</p><div class="change-diff-list">${changeRows(diffs(entry))}</div><div class="dialog-actions"><button class="btn btn-ghost" value="cancel">إلغاء</button><button class="btn btn-primary" id="rebaseWorkspaceDraft" type="button">تحميل المسودة للمراجعة</button></div>`,
      );
      $('#rebaseWorkspaceDraft').onclick = () => {
        $('#confirmDialog').close();
        openEntry(entry, true);
      };
      return;
    }
    captureView();
    rememberEditor();
    setEditor(r.kind, item ?? null, r.action, Number(r.values.type ?? 0));
    model.editor.values = { ...model.editor.values, ...structuredClone(r.values) };
    model.editor.permissionChanges = structuredClone(r.permissionChanges ?? {});
    model.editor.overwriteChanges = Object.fromEntries(
      (r.overwriteChanges ?? []).map((c) => [c.roleId, structuredClone(c.permissions)]),
    );
    model.tab = entry.tab;
    model.overwriteRole = entry.overwriteRole;
    model.page = r.kind === 'guild' ? 'profile' : r.kind === 'role' ? 'roles' : 'channels';
    model.query = '';
    if (rebase) {
      model.editor.draftConflict = false;
      model.editor.conflictNotified = false;
      editorDrafts.delete(editorKey(model.editor));
      draftStore.put(guildId(), { ...entry, request: editorRequest(), staged: false });
      model.editor.approval = null;
    }
    render();
  }
  function renderChanges() {
    const id = guildId();
    if (!/^\d{16,22}$/.test(id)) {
      $('#main').innerHTML = noInventory();
      bindEmpty();
      return;
    }
    const entries = draftStore.list(id),
      queued = staged(),
      info = draftStore.info(id),
      p = model.batchSignature === signature() ? model.state.batchPreview : null,
      result = model.state.batchResult?.guildId === id ? model.state.batchResult : null;
    $('#main').innerHTML =
      heading(
        'تغييراتك، في مساحة واحدة',
        'احفظ مسوداتك تلقائيًا، واجمع تعديلات الغرف والرتب في مراجعة واحدة.',
        'CHANGE WORKSPACE',
        button('تصدير المسودات', 'exportWorkspace', 'btn-ghost', 'log', !entries.length),
      ) +
      `<section class="workspace-summary panel"><div><span>${icon('log')} للمراجعة</span><strong>${queued.length}</strong></div><div><span>${icon('folder')} مسودات محلية</span><strong>${entries.length}</strong></div><div class="workspace-save"><span id="workspaceSaveStatus" role="status"></span>${button('حفظ الآن', 'flushWorkspace', 'btn-ghost', 'check', busy())}</div></section><p class="field-help">التجميع للعناصر الموجودة. الإنشاء والنقل لهما معاينة مستقلة. تعديل أذونات قسم كامل يُراجع منفردًا.</p>${info.error ? `<div class="notice yellow" role="alert"><div><strong>المسودات تحتاج مراجعة</strong>${esc(info.error)}<br>صدّر مسودتك للاحتفاظ بنسخة قبل إعادة تحميل النافذة.</div></div>` : ''}${!inventory() ? `<div class="notice">${icon('info')}<div>المسودات محفوظة محليًا. حمّل السيرفر للتحقق منها وإتاحة المعاينة.${button('إعداد الاتصال', 'workspaceConnect', 'btn-ghost', 'link', busy())}</div></div>` : ''}` +
      `<div class="workspace-list">${
        entries.length
          ? entries
              .map((entry) => {
                const item = entityFor(entry),
                  r = entry.request,
                  old = stale(entry),
                  memberCount =
                    r.kind === 'role' && Object.keys(r.permissionChanges ?? {}).length
                      ? item?.memberCount
                      : null;
                return `<article class="panel workspace-entry ${old ? 'is-stale' : ''}"><header><label class="workspace-select"><input type="checkbox" data-workspace-stage="${esc(entry.key)}" ${entry.staged ? 'checked' : ''} ${busy() || old || incomplete(entry) || r.action !== 'update' || (!entry.staged && queued.length >= 25) ? 'disabled' : ''}><span><strong translate="no">${esc(r.values.name || item?.name || 'مسودة بلا اسم')}</strong><small><span>${r.kind === 'role' ? 'رتبة' : r.kind === 'guild' ? 'اسم السيرفر' : 'غرفة / قسم'}</span> · <span>${r.action === 'create' ? 'عنصر جديد' : old ? 'تحتاج بيانات حديثة' : incomplete(entry) ? 'مسودة غير مكتملة' : entry.staged ? 'ضمن المراجعة' : 'مسودة محلية'}</span></small></span></label><div class="workspace-entry-actions"><button class="icon-button" type="button" data-workspace-open="${esc(entry.key)}" title="فتح المسودة" aria-label="فتح المسودة" ${busy() || !inventory() ? 'disabled' : ''}>${icon('settings')}</button><button class="icon-button danger-text" type="button" data-workspace-remove="${esc(entry.key)}" title="حذف المسودة المحلية" aria-label="حذف المسودة المحلية" ${busy() ? 'disabled' : ''}>${icon('trash')}</button></div></header><div class="workspace-entry-body">${old ? '<p class="workspace-stale-note">تغيّر العنصر أو لم تُحمّل بياناته بعد. افتح المسودة لمراجعتها قبل ضمّها للخطة.</p>' : ''}<div class="change-diff-list">${changeRows(diffs(entry))}</div><div class="change-permissions">${permissionDiffs(entry)}</div>${r.kind === 'role' && Object.keys(r.permissionChanges ?? {}).length ? `<p class="field-help">تتأثر صلاحيات حاملي هذه الرتبة؛ عددهم حسب آخر تحديث: <strong>${memberCount ?? 'غير متاح'}</strong>. توزيع الرتب يبقى كما هو.</p>` : ''}</div></article>`;
              })
              .join('')
          : `<section class="panel empty-state"><div class="empty-illustration">${icon('log')}</div><h2>ابدأ بتعديل غرفة أو رتبة</h2><p>تُحفظ المسودة تلقائيًا. اضغط إضافة للمراجعة لجمع التعديلات هنا.</p><button class="btn btn-primary" data-go="channels">فتح الغرف</button></section>`
      }</div>` +
      `${p ? `<section class="panel batch-review"><div class="panel-header"><h2>المراجعة المعتمدة</h2><span class="pill purple">${p.count} تعديل</span></div><div class="panel-body">${p.items.map((item) => `<details class="batch-reviewed-item" open><summary translate="no">${esc(item.name)}</summary><div class="change-diff-list">${changeRows(item.changes)}</div><pre class="review-summary">${esc(item.summary)}</pre></details>`).join('')}</div></section>` : ''}` +
      `${result ? `<section class="panel batch-result"><div class="panel-body"><h2>${result.success ? 'اكتملت التعديلات' : 'توقفت العملية؛ راجع ما اكتمل'}</h2><p>مكتمل: ${result.completed?.length ?? 0} · متبقٍ: ${result.remaining?.length ?? 0}</p>${result.uncertain ? '<p class="danger-text">نتيجة التعديل الأخير غير مؤكدة. حدّث السيرفر قبل أي محاولة جديدة.</p>' : ''}${result.error ? `<p>${esc(result.error)}</p>` : ''}${button('تنزيل تقرير التنفيذ', 'downloadBatchResult', 'btn-ghost', 'log')}</div></section>` : ''}` +
      `<div class="workspace-actionbar"><span>${model.state.demo ? 'عرض توضيحي · التنفيذ الحقيقي معطّل' : 'راجع كل تغيير قبل تأكيد حفظه في السيرفر.'}</span><div>${button('معاينة التغييرات', 'previewWorkspace', 'btn-ghost', 'eye', busy() || !inventory() || !queued.length || queued.some((e) => stale(e) || incomplete(e)))}${button('تأكيد التغييرات', 'applyWorkspace', 'btn-primary', 'check', busy() || !p || model.state.demo)}</div></div>`;
    $('#exportWorkspace').onclick = () =>
      downloadText(
        JSON.stringify({ version: 1, guildId: id, entries }, null, 2),
        'cortex-drafts-' + id + '.json',
      );
    $('#flushWorkspace').onclick = async () => {
      try {
        await draftStore.flush(id);
        render();
      } catch (error) {
        toast(error.message, 'error');
        render();
      }
    };
    const connect = $('#workspaceConnect');
    if (connect) connect.onclick = () => go('settings');
    $$('[data-workspace-stage]').forEach(
      (input) =>
        (input.onchange = () => {
          const entry = draftStore.get(id, input.dataset.workspaceStage);
          draftStore.put(id, { ...entry, staged: input.checked });
          render();
        }),
    );
    $$('[data-workspace-open]').forEach(
      (b) => (b.onclick = () => openEntry(draftStore.get(id, b.dataset.workspaceOpen))),
    );
    $$('[data-workspace-remove]').forEach(
      (b) =>
        (b.onclick = () => {
          const entry = draftStore.get(id, b.dataset.workspaceRemove);
          showDialog(
            `<div class="dialog-symbol">${icon('folder')}</div><h2>حذف المسودة المحلية</h2><p>تُحذف هذه المسودة من الجهاز فقط. لن يتغير شيء في Discord.</p><div class="dialog-actions"><button class="btn btn-ghost" value="cancel">إلغاء</button><button class="btn btn-danger" id="deleteLocalDraft" type="button">حذف المسودة المحلية</button></div>`,
          );
          $('#deleteLocalDraft').onclick = () => {
            draftStore.remove(id, entry.key);
            const key =
              id +
              '|' +
              entry.request.kind +
              '|' +
              (entry.request.id ?? 'new-' + (entry.request.values.type ?? 0));
            editorDrafts.delete(key);
            if (model.editor && workspaceKey(editorRequest()) === entry.key) model.editor = null;
            $('#confirmDialog').close();
            render();
          };
        }),
    );
    $('#previewWorkspace').onclick = async () => {
      if (busy()) return;
      model.workspacePreparing = true;
      render();
      try {
        await draftStore.flush(id);
        model.batchSignature = signature();
        model.workspacePreparing = false;
        await action('batch-preview', { batchRequests: staged().map((e) => e.request) });
      } catch (error) {
        model.workspacePreparing = false;
        toast(error.message, 'error');
        render();
      }
    };
    $('#applyWorkspace').onclick = () => confirmBatch(p);
    const download = $('#downloadBatchResult');
    if (download) download.onclick = () => downloadReport('batch-result.json');
    $$('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
    updateDraftIndicators();
  }
  function confirmBatch(p) {
    if (!p || busy() || model.state.demo) return;
    const admin = p.items.some((item) => item.permissionChanges?.Administrator === true);
    showDialog(
      `<div class="dialog-symbol">${icon('check')}</div><h2>تأكيد التغييرات المجمعة</h2><p><strong translate="no">${esc(p.guildName)}</strong> · ${p.count} تعديل</p><p>تُنفّذ بالتسلسل، وتتوقف التعديلات المتبقية عند الخطأ. يُحفظ تقرير بما اكتمل.</p><div class="field"><label for="confirmBatchGuild">اكتب رقم السيرفر للتأكيد</label><input class="ltr" id="confirmBatchGuild" autocomplete="off" inputmode="numeric"></div>${admin ? '<label class="grant-admin-ack"><input type="checkbox" id="batchAdminAck">أوافق على منح صلاحية Administrator ضمن التغييرات المعروضة.</label>' : ''}<div class="dialog-actions"><button class="btn btn-ghost" value="cancel">العودة للمراجعة</button><button class="btn btn-primary" id="confirmBatchApply" type="button" disabled>تأكيد وحفظ التغييرات</button></div>`,
    );
    const validate = () =>
      ($('#confirmBatchApply').disabled =
        $('#confirmBatchGuild').value !== p.guildId || (admin && !$('#batchAdminAck').checked));
    $('#confirmBatchGuild').oninput = validate;
    if (admin) $('#batchAdminAck').onchange = validate;
    $('#confirmBatchApply').onclick = () => {
      model.applyingBatchHash = p.approvalHash;
      $('#confirmDialog').close();
      action('batch-apply', {
        batchConfirmation: {
          guildId: p.guildId,
          approvalHash: p.approvalHash,
          confirmed: true,
          acknowledgeAdmin: $('#batchAdminAck')?.checked === true,
        },
      });
    };
  }
  function handleResult(data) {
    const r = data.batchResult;
    if (
      data.busy ||
      !r ||
      r.guildId !== guildId() ||
      r.approvalHash !== model.applyingBatchHash ||
      model.handledBatch === r.approvalHash
    )
      return;
    model.handledBatch = r.approvalHash;
    for (const item of r.completed ?? []) {
      draftStore.remove(r.guildId, item.kind + ':' + item.id);
      editorDrafts.delete(r.guildId + '|' + item.kind + '|' + item.id);
      if (model.editor?.item?.id === item.id && model.editor.kind === item.kind)
        model.editor = null;
    }
    model.batchSignature = null;
    toast(
      r.success ? 'اكتملت التغييرات المجمعة.' : 'توقفت العملية. راجع تقرير التغييرات قبل المتابعة.',
      r.success ? 'success' : 'error',
    );
    setTimeout(() => {
      if (guildId() === r.guildId && !busy()) action('inventory');
    }, 150);
  }
  const simText = (key) => window.CortexI18n.text('simulator.' + key);
  const stageLabels = {
    base: 'base',
    everyone: 'everyone',
    roles: 'roleStage',
    member: 'memberStage',
    owner: 'owner',
    administrator: 'administrator',
    timeout: 'timeout',
    dependency: 'dependency',
  };
  function simulationEmpty(changed = false) {
    return `<section class="panel simulation-empty" aria-live="polite"><div class="sim-empty-mark">${icon('eye')}</div><h2>${simText('emptytitle')}</h2><p>${simText(changed ? 'refresh' : 'emptytext')}</p><div class="sim-steps">${['step1', 'step2', 'step3'].map((key, i) => `<div><span>0${i + 1}</span><strong>${simText(key)}</strong></div>`).join('')}</div></section>`;
  }
  function simulationResult(p) {
    const allowed = p.results.filter((r) => r.allowed).length;
    const quick = p.results.filter((r) =>
      ['ViewChannel', 'SendMessages', 'Connect', 'Speak'].includes(r.name),
    );
    return `<section class="panel simulation-result"><div class="panel-header"><div><h2 translate="no">${esc(p.memberName ?? p.channelName)}</h2><small><span translate="no"># ${esc(p.channelName)}</span> · ${shortTime(p.capturedAt)}</small></div><span class="pill purple">${simText('readonly')}</span></div><div class="panel-body"><div class="sim-stats"><div><span>${simText('permissions')}</span><strong>${p.results.length}</strong></div><div class="is-allowed"><span>${simText('allowed')}</span><strong>${allowed}</strong></div><div class="is-denied"><span>${simText('denied')}</span><strong>${p.results.length - allowed}</strong></div></div><div class="sim-quick">${quick.map((r) => `<div class="${r.allowed ? 'is-allowed' : 'is-denied'}">${icon(r.allowed ? 'check' : 'lock')}<span>${esc(permissionLabel(r.name))}</span><strong>${simText(r.allowed ? 'allowed' : 'denied')}</strong></div>`).join('')}</div><div class="simulation-role-chips">${p.roles.map((r) => `<span translate="no">${esc(r.name)}</span>`).join('')}</div>${p.owner || p.administrator || p.timedOut ? `<div class="notice ${p.timedOut ? 'yellow' : 'green'}"><div>${simText(p.owner ? 'ownernote' : p.administrator ? 'adminnote' : 'timeoutnote')}</div></div>` : ''}<div class="sim-results-toolbar"><div class="sim-filter-tabs" role="group" aria-label="${simText('permissions')}">${['all', 'allowed', 'denied'].map((filter, i) => `<button type="button" class="btn btn-small ${i === 0 ? 'btn-primary' : 'btn-ghost'}" data-simulation-filter="${filter}" aria-pressed="${i === 0}">${simText(filter)}</button>`).join('')}</div><input type="search" id="simulationPermissionSearch" aria-label="${simText('filter')}" placeholder="${simText('filter')}"></div><div class="simulation-results">${p.results.map((result) => `<details class="simulation-permission ${result.allowed ? 'allowed' : 'denied'}" data-simulation-result="${result.allowed ? 'allowed' : 'denied'}" data-permission-search="${esc(permissionLabel(result.name) + ' ' + result.name)}"><summary><span class="sim-decision-icon">${icon(result.allowed ? 'check' : 'lock')}</span><div class="sim-permission-label"><strong>${esc(permissionLabel(result.name))}</strong><small>${simText(stageLabels[result.trace.at(-1)?.stage] ?? 'base')}</small></div><span class="pill ${result.allowed ? 'green' : 'red'}">${simText(result.allowed ? 'allowed' : 'denied')}</span>${icon('chevron')}</summary><div class="sim-trace-heading">${simText('why')} <code>${esc(result.name)}</code></div><ol>${result.trace.map((trace) => `<li><strong>${simText(stageLabels[trace.stage] ?? 'base')}</strong><span>${simText(trace.allowed ? 'allowed' : 'denied')}${trace.permission ? ' · ' + esc(permissionLabel(trace.permission)) : ''}</span>${trace.allow.length ? `<small>${simText('allowSources')}: <span translate="no">${trace.allow.map((x) => esc(x.name)).join(' · ')}</span></small>` : ''}${trace.deny.length ? `<small>${simText('denySources')}: <span translate="no">${trace.deny.map((x) => esc(x.name)).join(' · ')}</span></small>` : ''}</li>`).join('')}</ol></details>`).join('')}</div><p id="simulationNoResults" hidden>${simText('noresults')}</p></div></section>`;
  }
  function renderSimulator() {
    const inv = inventory();
    if (!inv) {
      $('#main').innerHTML = noInventory();
      bindEmpty();
      return;
    }
    model.simulatorForms ??= {};
    const channels = inv.channels.filter((c) => [0, 2, 5].includes(c.type));
    const form = (model.simulatorForms[guildId()] ??= {
      mode: 'member',
      memberId: '',
      channelId: channels[0]?.id ?? '',
      roleIds: [],
      query: '',
    });
    if (!channels.some((c) => c.id === form.channelId)) form.channelId = channels[0]?.id ?? '';
    form.roleIds = [...new Set(form.roleIds)].filter(
      (id) => id !== inv.guildId && inv.roles.some((r) => r.id === id),
    );
    const candidate = model.state.simulation;
    const sameRoles =
      candidate?.roles
        ?.filter((r) => r.id !== inv.guildId)
        .map((r) => r.id)
        .sort()
        .join(',') === [...form.roleIds].sort().join(',');
    const p =
      candidate?.guildId === guildId() &&
      candidate.channelId === form.channelId &&
      candidate.mode === form.mode &&
      (form.mode === 'member' ? candidate.memberId === form.memberId : sameRoles)
        ? candidate
        : null;
    $('#main').innerHTML =
      `<div class="simulator-header"><div><h1>${simText('title')}</h1><p>${simText('subtitle')}</p></div><span class="pill purple">${icon('eye')} ${simText('readonly')}</span></div><div class="simulator-layout"><section class="panel simulator-form"><div class="panel-body"><div class="field"><label for="simulationMode">${simText('mode')}</label><select id="simulationMode" ${busy() ? 'disabled' : ''}><option value="member" ${form.mode === 'member' ? 'selected' : ''}>${simText('member')}</option><option value="roles" ${form.mode === 'roles' ? 'selected' : ''}>${simText('roles')}</option></select></div><div class="field"><label for="simulationChannel">${simText('channel')}</label><select id="simulationChannel" ${busy() ? 'disabled' : ''}>${channels.map((c) => `<option value="${esc(c.id)}" ${c.id === form.channelId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>${
        form.mode === 'member'
          ? `<div class="field"><label for="simulationMember">${simText('memberid')}</label><input class="ltr" id="simulationMember" inputmode="numeric" maxlength="22" value="${esc(form.memberId)}" ${busy() ? 'disabled' : ''}><small class="field-help">${simText('memberhelp')}</small>${model.state.demo ? '<code>900000000000001005</code>' : ''}</div>`
          : `<div class="field"><div class="sim-role-heading"><span class="field-label">${simText('selected')} <b id="simulationSelectedCount">${form.roleIds.length}</b></span><button type="button" class="btn btn-ghost btn-small" id="simulationClearRoles" ${busy() ? 'disabled' : ''}>${simText('clear')}</button></div><input type="search" id="simulationRoleSearch" aria-label="${simText('searchroles')}" placeholder="${simText('searchroles')}" value="${esc(form.query ?? '')}"><div class="simulation-role-picker">${inv.roles
              .filter((r) => r.id !== inv.guildId)
              .map(
                (r) =>
                  `<label class="simulation-role-option" data-role-search="${esc(r.name)}"><input type="checkbox" data-simulation-role="${esc(r.id)}" ${form.roleIds.includes(r.id) ? 'checked' : ''} ${busy() ? 'disabled' : ''}><span class="sim-role-dot" style="--role-color:${Number.isInteger(r.color) && r.color > 0 && r.color <= 0xffffff ? '#' + r.color.toString(16).padStart(6, '0') : '#9888ff'}"></span><span translate="no">${esc(r.name)}</span></label>`,
              )
              .join(
                '',
              )}</div><p id="simulationNoRoles" hidden>${simText('noroles')}</p><small class="field-help">${simText('rolehelp')}</small></div>`
      }<button type="button" class="btn btn-primary" id="runPermissionSimulation" ${busy() || !form.channelId ? 'disabled' : ''}>${icon('eye')} ${simText(busy() ? 'running' : 'run')}</button><p class="field-help">${simText('scope')}</p>${model.state.error ? `<div class="notice yellow" role="alert"><div>${esc(model.state.error)}</div></div>` : ''}</div></section><div class="simulation-output" id="simulationOutput">${p ? simulationResult(p) : simulationEmpty()}</div></div>`;
    const invalidate = () => {
      model.state.simulation = null;
      $('#simulationOutput').innerHTML = simulationEmpty(true);
    };
    $('#simulationMode').onchange = (e) => {
      form.mode = e.target.value;
      invalidate();
      renderSimulator();
    };
    $('#simulationChannel').onchange = (e) => {
      form.channelId = e.target.value;
      invalidate();
    };
    const member = $('#simulationMember');
    if (member)
      member.oninput = () => {
        form.memberId = member.value.replace(/\D/g, '');
        member.value = form.memberId;
        invalidate();
      };
    const updateCount = () => {
      $('#simulationSelectedCount').textContent = form.roleIds.length;
    };
    $$('[data-simulation-role]').forEach(
      (input) =>
        (input.onchange = () => {
          form.roleIds = input.checked
            ? [...new Set([...form.roleIds, input.dataset.simulationRole])]
            : form.roleIds.filter((id) => id !== input.dataset.simulationRole);
          updateCount();
          invalidate();
        }),
    );
    const search = $('#simulationRoleSearch');
    if (search) {
      const filterRoles = () => {
        const q = (form.query ?? '').toLocaleLowerCase();
        let count = 0;
        $$('[data-role-search]').forEach((row) => {
          row.hidden = !row.dataset.roleSearch.toLocaleLowerCase().includes(q);
          if (!row.hidden) count++;
        });
        $('#simulationNoRoles').hidden = count > 0;
      };
      search.oninput = () => {
        form.query = search.value;
        filterRoles();
      };
      filterRoles();
      $('#simulationClearRoles').onclick = () => {
        form.roleIds = [];
        $$('[data-simulation-role]').forEach((input) => (input.checked = false));
        updateCount();
        invalidate();
      };
    }
    $('#runPermissionSimulation').onclick = () => {
      if (busy() || !form.channelId) return;
      if (form.mode === 'member' && !/^\d{16,22}$/.test(form.memberId)) {
        toast(simText('validmember'), 'error');
        member?.focus();
        return;
      }
      action('permission-simulate', {
        simulationRequest: {
          channelId: form.channelId,
          ...(form.mode === 'member'
            ? { memberId: form.memberId }
            : { roleIds: [...form.roleIds] }),
        },
      });
    };
    if (p) {
      let filter = 'all';
      const applyFilter = () => {
        const q = $('#simulationPermissionSearch').value.toLocaleLowerCase();
        let count = 0;
        $$('[data-simulation-result]').forEach((row) => {
          row.hidden =
            (filter !== 'all' && row.dataset.simulationResult !== filter) ||
            !row.dataset.permissionSearch.toLocaleLowerCase().includes(q);
          if (!row.hidden) count++;
        });
        $('#simulationNoResults').hidden = count > 0;
      };
      $('#simulationPermissionSearch').oninput = applyFilter;
      $$('[data-simulation-filter]').forEach(
        (button) =>
          (button.onclick = () => {
            filter = button.dataset.simulationFilter;
            $$('[data-simulation-filter]').forEach((b) => {
              const selected = b === button;
              b.classList.toggle('btn-primary', selected);
              b.classList.toggle('btn-ghost', !selected);
              b.setAttribute('aria-pressed', String(selected));
            });
            applyFilter();
          }),
      );
    }
  }
  window.CortexWorkbench = { renderChanges, renderSimulator, handleResult };
})();
