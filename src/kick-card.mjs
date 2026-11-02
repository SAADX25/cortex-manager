import { renderWelcomeCard } from './welcome-card.mjs';
import { defaultCardStyle } from './welcome-card-style.mjs';
import { kickCopy } from './notification-locales.mjs';
// Reuse the server's farewell background and text palette. Full details also accompany the PNG.
export function renderKickCard(details, options) {
  const words = kickCopy[details.language] ?? kickCopy.en;
  const displayName = (value) => String(value).replace(/ · \d{16,22}$/, '');
  const rows = [
    words.member + ': ' + displayName(details.member),
    words.moderator + ': ' + displayName(details.moderator),
    words.reason + ': ' + details.reason,
  ];
  return renderWelcomeCard(
    {
      title: words.title,
      message: rows.join(' · '),
      color: '#ed4245',
      card: { ...(details.style?.card ?? defaultCardStyle()), mode: 'image' },
    },
    { user: details.member, server: details.server, rows },
    options,
  );
}
