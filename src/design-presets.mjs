import { designTemplate, validateCustomDesign } from './custom-design.mjs';
const layouts = [
  {
    id: '02',
    ar: 'ساحة المنافسة',
    en: 'Esports Arena',
    icon: '🎯',
    colors: [0x38bdf8, 0x8b5cf6, 0xf59e0b],
    roles: ['admin', 'headmod', 'mod', 'event', 'vip', 'gamer', 'member', 'muted'],
    groups: [
      [
        '🏁',
        'بوابة البطولة',
        'Tournament Gate',
        'public',
        [
          ['📜', 'قوانين-المنافسة', 'competition-rules', 'text', true],
          ['📢', 'أخبار-البطولات', 'tournament-news', 'text', true],
        ],
      ],
      [
        '🎯',
        'ساحة المنافسة',
        'Competitive Hub',
        'public',
        [
          ['🎮', 'نقاش-المنافسات', 'competitive-chat', 'text'],
          ['🤝', 'البحث-عن-فريق', 'team-finder', 'text'],
          ['🏆', 'نتائج-المباريات', 'match-results', 'text'],
          ['🎬', 'أفضل-اللقطات', 'best-plays', 'text'],
        ],
      ],
      [
        '🔊',
        'اتصالات الفرق',
        'Team Comms',
        'public',
        [
          ['🔵', 'الفريق الأزرق', 'Blue Team', 'voice', false, 5],
          ['🔴', 'الفريق الأحمر', 'Red Team', 'voice', false, 5],
          ['🎙️', 'قاعة التعليق', 'Caster Lounge', 'voice', false, 4],
        ],
      ],
      [
        '🛡️',
        'إدارة البطولة',
        'Tournament Staff',
        'staff',
        [
          ['📋', 'تنظيم-المباريات', 'match-planning', 'text'],
          ['🔒', 'اجتماع الحكام', 'Referee Meeting', 'voice', false, 8],
        ],
      ],
    ],
  },
  {
    id: '03',
    ar: 'استوديو المبدعين',
    en: 'Creator Studio',
    icon: '🎬',
    colors: [0xec4899, 0xa78bfa, 0x22d3ee],
    roles: ['admin', 'mod', 'support', 'creator', 'vip', 'member', 'muted'],
    groups: [
      [
        '✨',
        'ابدأ هنا',
        'Start Here',
        'public',
        [
          ['👋', 'ترحيب-بالمجتمع', 'community-welcome', 'text', true],
          ['📜', 'قوانين-المجتمع', 'community-rules', 'text', true],
        ],
      ],
      [
        '📡',
        'مركز المحتوى',
        'Content Hub',
        'public',
        [
          ['🔴', 'تنبيهات-البث', 'stream-alerts', 'text', true],
          ['🎥', 'فيديوهات-جديدة', 'new-videos', 'text', true],
          ['📸', 'منشورات-المجتمع', 'community-posts', 'text'],
          ['💡', 'أفكار-المحتوى', 'content-ideas', 'text'],
        ],
      ],
      [
        '💬',
        'خلف الكواليس',
        'Backstage',
        'public',
        [
          ['💬', 'دردشة-المتابعين', 'fan-chat', 'text'],
          ['🎨', 'أعمال-المبدعين', 'creator-showcase', 'text'],
          ['🎙️', 'جلسة المتابعين', 'Fan Lounge', 'voice', false, 0],
        ],
      ],
      [
        '🛡️',
        'فريق الإنتاج',
        'Production Team',
        'staff',
        [
          ['📋', 'خطة-المحتوى', 'content-planning', 'text'],
          ['🎧', 'غرفة الإنتاج', 'Production Room', 'voice', false, 6],
        ],
      ],
    ],
  },
  {
    id: '04',
    ar: 'نادي المجتمع',
    en: 'Community Club',
    icon: '☕',
    colors: [0x14b8a6, 0xfbbf24, 0xfb7185],
    roles: ['admin', 'mod', 'support', 'event', 'vip', 'member', 'muted'],
    groups: [
      [
        '🌿',
        'الاستقبال',
        'Reception',
        'public',
        [
          ['👋', 'أهلا-بك', 'welcome-desk', 'text', true],
          ['📜', 'القوانين', 'club-rules', 'text', true],
          ['📢', 'أخبار-النادي', 'club-news', 'text', true],
        ],
      ],
      [
        '💬',
        'ملتقى الأصدقاء',
        'Friends Corner',
        'public',
        [
          ['💬', 'حديث-اليوم', 'daily-chat', 'text'],
          ['🙋', 'تعرف-علينا', 'meet-the-community', 'text'],
          ['📸', 'يوميات-وصور', 'daily-photos', 'text'],
          ['🗳️', 'صوت-المجتمع', 'community-polls', 'text'],
        ],
      ],
      [
        '☕',
        'مجالس النادي',
        'Club Lounges',
        'public',
        [
          ['☕', 'المقهى', 'Coffee Lounge', 'voice', false, 0],
          ['🎲', 'جلسة ألعاب', 'Game Night', 'voice', false, 8],
          ['🌙', 'جلسة هادئة', 'Quiet Lounge', 'voice', false, 4],
        ],
      ],
      [
        '🔒',
        'مكتب الإدارة',
        'Staff Office',
        'staff',
        [
          ['🛡️', 'تنسيق-الإدارة', 'staff-coordination', 'text'],
          ['🎫', 'متابعة-الدعم', 'support-followup', 'text'],
        ],
      ],
    ],
  },
  {
    id: '05',
    ar: 'البداية الأنيقة',
    en: 'Essential Space',
    icon: '⚡',
    colors: [0x818cf8, 0x94a3b8, 0x34d399],
    roles: ['admin', 'mod', 'member', 'muted'],
    groups: [
      [
        '📌',
        'الأساسيات',
        'Essentials',
        'public',
        [
          ['📜', 'القوانين', 'rules', 'text', true],
          ['📢', 'الإعلانات', 'announcements', 'text', true],
        ],
      ],
      [
        '💬',
        'المساحة العامة',
        'Community Space',
        'public',
        [
          ['💬', 'الدردشة', 'general', 'text'],
          ['🎮', 'تجمع-اللاعبين', 'looking-for-group', 'text'],
          ['🔊', 'المجلس', 'Lounge', 'voice', false, 0],
        ],
      ],
      ['🔒', 'الإدارة', 'Staff', 'staff', [['🛡️', 'دردشة-الإدارة', 'staff-chat', 'text']]],
    ],
  },
];
function build(layout, language) {
  const d = designTemplate(language);
  d.roles = d.roles.filter((r) => layout.roles.includes(r.key));
  d.migrations = {};
  const palette = [
    ...new Set([...layout.colors, 0xf97316, 0x84cc16, 0xe879f9, 0xfb7185, 0x60a5fa]),
  ];
  d.roles.forEach((r, i) => {
    r.color = r.key === 'muted' ? 0x64748b : palette[i];
    r.hoist = ['admin', 'headmod', 'mod', 'creator', 'vip'].includes(r.key);
    r.mentionable = false;
  });
  d.categories = layout.groups.map(([emoji, ar, en, access, rows], i) => ({
    key: 'preset' + layout.id + '_group' + i,
    name: emoji + '・' + String(i + 1).padStart(2, '0') + ' • ' + (language === 'ar' ? ar : en),
    access,
    ...(access === 'staff'
      ? {
          staffKeys: d.roles
            .filter((r) => ['admin', 'headmod', 'mod', 'support'].includes(r.key))
            .map((r) => r.key),
        }
      : {}),
    channels: rows.map(([symbol, a, e, type, readonly = false, limit = 0], j) => ({
      key: 'preset' + layout.id + '_room' + i + '_' + j,
      name: symbol + '・' + (language === 'ar' ? a : e),
      type,
      ...(type === 'text' ? { readonly, slowmode: readonly ? 0 : 2 } : { userLimit: limit }),
    })),
  }));
  return validateCustomDesign(d);
}
export function designPresets() {
  return [
    {
      id: '01',
      ar: 'مجتمع الألعاب المتكامل',
      en: 'Gaming Community',
      icon: '🎮',
      colors: [0x5865f2, 0x13d9d4, 0xff78b2],
      templates: { ar: designTemplate('ar'), en: designTemplate('en') },
    },
    ...layouts.map((layout) => ({
      id: layout.id,
      ar: layout.ar,
      en: layout.en,
      icon: layout.icon,
      colors: layout.colors,
      templates: { ar: build(layout, 'ar'), en: build(layout, 'en') },
    })),
  ];
}
