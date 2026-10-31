'use strict';
// Dynamic interface counters; user content is never translated.
window.CortexLocales.patterns = Object.freeze([
  [
    /^(\d+) أقسام · (\d+) غرفة · (\d+) رتب$/u,
    (_, c, ch, r) => `${c} categories · ${ch} channels · ${r} roles`,
  ],
  [/^(\d+) تعديل$/u, (_, n) => `${n} edits`],
  [/^مكتمل: (\d+) · متبقٍ: (\d+)$/u, (_, done, left) => `Completed: ${done} · Remaining: ${left}`],
  [
    /^تتأثر صلاحيات حاملي هذه الرتبة؛ عددهم حسب آخر تحديث:$/u,
    () => 'These permissions affect role holders; count at last refresh:',
  ],
  [/^\. توزيع الرتب يبقى كما هو\.$/u, () => '. Role assignments stay unchanged.'],
  [/^عضو تجريبي: (\d+)$/u, (_, id) => `Demo member: ${id}`],
  [
    /^(\d+) رتبة · (\d+) قسم · (\d+) غرفة$/u,
    (_, r, c, ch) => `${r} roles · ${c} categories · ${ch} channels`,
  ],
  [/^أهلًا بك في (.*)$/u, (_, name) => `Welcome to ${name}`],
  [/^(\d+) أقسام منظمة$/u, (_, n) => `${n} categories`],
  [/^(\d+) رتب محفوظة$/u, (_, n) => `${n} preserved roles`],
  [/^(\d+) رتبة$/u, (_, n) => `${n} roles`],
  [/^(\d+) عنصر$/u, (_, n) => `${n} items`],
  [/^آخر تحديث (.*)$/u, (_, time) => `Updated ${time}`],
  [/^تعديل القسم (.*)$/u, (_, name) => `Edit category ${name}`],
  [/^(\d+) صلاحية متاحة من أصل (\d+)$/u, (_, n, total) => `${n} of ${total} permissions granted`],
  [/^معاينة الرسالة · (.*)$/u, (_, name) => `Message preview · ${name}`],
  [/^رسالة إلى: (.*)$/u, (_, name) => `Message to: ${name}`],
  [/^(.+) · متصل ببيانات (.*)$/u, (_, bot, name) => `${bot} · Loaded ${name}`],
  [/^السيرفر:$/u, () => 'Server:'],
  [/^الغرفة:$/u, () => 'Channel:'],
  [/^رقم السيرفر:$/u, () => 'Server ID:'],
  [
    /^([٠-٩]{2}:[٠-٩]{2}) ([صم])$/u,
    (_, time, period) =>
      time.replace(/[٠-٩]/g, (n) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(n))) +
      (period === 'ص' ? ' AM' : ' PM'),
  ],
  [/^(.*)المنشن التلقائي معطّل\.$/u, (_, prefix) => `${prefix}Automatic mentions disabled.`],
]);
