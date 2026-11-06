import { randomBytes } from 'node:crypto';

export function createTicketIntake({ now = Date.now, ttl = 10 * 60 * 1000, limit = 1000 } = {}) {
  const sessions = new Map();
  const key = (i) => `${i.guild_id}:${i.member.user.id}`;
  function prune() {
    for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id);
  }
  function find(i, g, id) {
    prune();
    const session = sessions.get(key(i));
    return session &&
      session.id === id &&
      session.channelId === i.channel_id &&
      session.panelChannelId === g.panelChannelId &&
      session.categoryId === g.categoryId
      ? session
      : null;
  }
  return {
    begin(i, g) {
      prune();
      if (sessions.get(key(i))?.phase === 'submitting') return { error: 'requestProcessing' };
      if (!sessions.has(key(i)) && sessions.size >= limit) return { error: 'queued' };
      const session = {
        id: randomBytes(12).toString('hex'),
        key: key(i),
        channelId: i.channel_id,
        panelChannelId: g.panelChannelId,
        categoryId: g.categoryId,
        expiresAt: now() + ttl,
        phase: 'language',
      };
      sessions.set(session.key, session);
      return { session };
    },
    select(i, g, id, language) {
      const session = find(i, g, id);
      if (!session || session.phase !== 'language' || !['ar', 'en'].includes(language))
        return { error: 'formExpired' };
      session.language = language;
      session.phase = 'form';
      return { session };
    },
    submit(i, g, id, language) {
      const session = find(i, g, id);
      if (!session || session.phase !== 'form' || session.language !== language)
        return { error: 'formExpired' };
      session.phase = 'submitting';
      return { session: { ...session } };
    },
    release(session) {
      if (session && sessions.get(session.key)?.id === session.id) sessions.delete(session.key);
    },
  };
}

export function ticketIntakeModal(copy, language, sessionId) {
  const input = (custom_id, label, style, max_length, placeholder) => ({
    type: 18,
    label,
    component: {
      type: 4,
      custom_id,
      style,
      min_length: 1,
      max_length,
      required: true,
      ...(placeholder ? { placeholder } : {}),
    },
  });
  return {
    custom_id: `cortex:ticket:submit:${language}:${sessionId}`,
    title: copy.modal,
    components: [
      {
        type: 18,
        label: copy.genderLabel,
        description: copy.profileHelp,
        component: {
          type: 3,
          custom_id: 'gender',
          placeholder: copy.genderPlaceholder,
          min_values: 1,
          max_values: 1,
          options: [
            { label: copy.genderMale, value: 'male' },
            { label: copy.genderFemale, value: 'female' },
          ],
        },
      },
      input('age', copy.ageLabel, 1, 3, copy.agePlaceholder),
      input('subject', copy.subject, 1, 100),
      input('description', copy.description, 2, 1500),
    ],
  };
}

export function readTicketIntake(data) {
  if (
    !Array.isArray(data?.components) ||
    data.components.length !== 4 ||
    data.components.some((row) => !row || typeof row !== 'object')
  )
    return { error: 'invalidForm' };
  const fields = data.components.flatMap((row) =>
    row.component ? [row.component] : Array.isArray(row.components) ? row.components : [],
  );
  const expected = ['gender', 'age', 'subject', 'description'];
  if (
    fields.length !== 4 ||
    new Set(fields.map((f) => f?.custom_id)).size !== 4 ||
    fields.some(
      (f) =>
        !f ||
        typeof f !== 'object' ||
        !expected.includes(f.custom_id) ||
        f.type !== (f.custom_id === 'gender' ? 3 : 4),
    )
  )
    return { error: 'invalidForm' };
  const get = (id) => fields.find((f) => f.custom_id === id);
  const gender = get('gender');
  if (
    !Array.isArray(gender.values) ||
    gender.values.length !== 1 ||
    !['male', 'female'].includes(gender.values[0])
  )
    return { error: 'invalidGender' };
  const rawAge = get('age').value;
  if (typeof rawAge !== 'string' || rawAge.trim().length > 3) return { error: 'invalidAge' };
  const ageText = rawAge
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0));
  const age = Number(ageText);
  if (!/^\d{1,3}$/.test(ageText) || !Number.isInteger(age) || age < 1 || age > 120)
    return { error: 'invalidAge' };
  const subject = get('subject').value,
    description = get('description').value;
  if (
    typeof subject !== 'string' ||
    !subject.trim() ||
    subject.length > 100 ||
    typeof description !== 'string' ||
    !description.trim() ||
    description.length > 1500
  )
    return { error: 'invalidForm' };
  return {
    gender: gender.values[0],
    age,
    subject: subject.trim(),
    description: description.trim(),
  };
}
