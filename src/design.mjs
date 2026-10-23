// Cortex Manager PRO — declarative layout. Change names/roles here before preview.
export const ROLES = [
  {key:'founder',name:'👑・Founder',color:0xF5C542,permissions:[]},
  {key:'coowner',name:'♛・Co Owner',color:0xEA9B24,permissions:['ViewChannel','SendMessages','ReadMessageHistory','ManageGuild','ManageChannels','ManageRoles','ManageMessages','KickMembers','BanMembers','ModerateMembers','ViewAuditLog','ManageEvents']},
  {key:'admin',name:'🛡️・Administrator',color:0xE74C3C,permissions:['ViewChannel','SendMessages','ReadMessageHistory','ManageChannels','ManageRoles','ManageMessages','KickMembers','BanMembers','ModerateMembers']},
  {key:'headmod',name:'⚔️・Head Moderator',color:0xD35400,permissions:['ViewChannel','SendMessages','ReadMessageHistory','KickMembers','BanMembers','ModerateMembers','ManageMessages','ManageNicknames','ManageThreads']},
  {key:'mod',name:'🔨・Moderator',color:0x3498DB,permissions:['ViewChannel','SendMessages','ReadMessageHistory','KickMembers','ModerateMembers','ManageMessages','ManageThreads']},
  {key:'support',name:'🎫・Support Team',color:0x1ABC9C,permissions:['ViewChannel','SendMessages','ReadMessageHistory']},
  {key:'event',name:'🎯・Event Host',color:0x9B59B6,permissions:['ViewChannel','SendMessages','ReadMessageHistory','ManageEvents','MoveMembers']},
  {key:'creator',name:'🎨・Content Creator',color:0xFF78B2,permissions:['ViewChannel','SendMessages','ReadMessageHistory','AttachFiles','EmbedLinks']},
  {key:'vip',name:'💎・VIP',color:0x13D9D4,permissions:['ViewChannel','SendMessages','ReadMessageHistory']},
  {key:'gamer',name:'🎮・Gamer',color:0x5865F2,permissions:['ViewChannel','SendMessages','ReadMessageHistory']},
  {key:'verified',name:'✅・Verified',color:0x57F287,permissions:['ViewChannel','SendMessages','ReadMessageHistory']},
  {key:'member',name:'🌿・Member',color:0x95A5A6,permissions:['ViewChannel','SendMessages','ReadMessageHistory']},
  {key:'muted',name:'🔇・Muted',color:0x555C68,permissions:[]},
];

// IMPORTANT: These are channels, not live features such as ticket bots, automatic verification, or leveling.
export const CATEGORIES = [
  {key:'start',name:'╔═ ✦ 01 • START HERE',access:'public',channels:[
    {key:'welcome',name:'👋・أهلاً-وسهلاً',type:'text',readonly:true,topic:'أهلاً بك في مجتمع Real Friends',message:'**أهلاً وسهلاً في Real Friends!** ✨\nابدأ بقراءة القوانين، وشاركنا في الدردشة، وخليك جزء من المجتمع. نتمنى لك أوقات ممتعة!'},
    {key:'rules',name:'📜・القوانين',type:'text',readonly:true,topic:'قوانين المجتمع وآداب التعامل',message:'**📜 قوانين السيرفر**\n1. الاحترام واجب على الجميع، ويُمنع التنمّر أو خطاب الكراهية.\n2. ممنوع السبام أو نشر الروابط الضارة والاحتيالية.\n3. حافظ على الخصوصية ولا تنشر معلومات شخصية للآخرين.\n4. التزم بتعليمات الإدارة ومشرفي المجتمع.\n5. استخدم كل روم حسب غرضه.\n6. يمنع التحايل على أنظمة Discord وشروط الخدمة.\n**التواجد في السيرفر يعني الموافقة على هذه القوانين.**'},
    {key:'news',name:'📢・الإعلانات',type:'text',readonly:true,topic:'الإعلانات الرسمية والتحديثات'},
    {key:'roles',name:'🏷️・دليل-الرتب',type:'text',readonly:true,topic:'معاني الرتب ومن يملك كل صلاحية',message:'**🏷️ دليل الرتب**\n👑 Founder: لقب المالك الفعلي.\n♛ Co Owner / 🛡️ Administrator: إدارة السيرفر.\n⚔️ Head Moderator / 🔨 Moderator: الإشراف.\n🎫 Support Team: مساعدة الأعضاء.\n🎯 Event Host: تنظيم الفعاليات.\n🎨 Content Creator: صناع المحتوى.\n💎 VIP: الأعضاء المميزون.\n🎮 Gamer / ✅ Verified / 🌿 Member: رتب مجتمعية.\n🔇 Muted: تقييد التواصل للأعضاء العاديين.\n**ملاحظة:** توزيع الرتب يتم من إدارة السيرفر؛ هذا الروم ليس نظام رتب تلقائي.'},
    {key:'faq',name:'❓・الأسئلة-الشائعة',type:'text',readonly:true,topic:'دليل الاستخدام والإجابات الشائعة'},
  ]},
  {key:'community',name:'╠═ ✦ 02 • COMMUNITY',access:'public',channels:[
    {key:'general',name:'💬・الدردشة-العامة',type:'text',topic:'دردشة المجتمع للجميع',slowmode:2},
    {key:'introductions',name:'🙋・تعارف',type:'text',topic:'عرّف عن نفسك واهتماماتك'},
    {key:'media',name:'📸・صور-ومقاطع',type:'text',topic:'شارك الصور واللقطات'},
    {key:'memes',name:'😂・ميمز',type:'text',topic:'زاوية الضحك والميمز'},
    {key:'suggestions',name:'💡・اقتراحات',type:'text',topic:'اقتراحات لتطوير المجتمع'},
    {key:'polls',name:'🗳️・تصويتات',type:'text',topic:'استطلاعات المجتمع'},
  ]},
  {key:'gaming',name:'╠═ ✦ 03 • GAMING ZONE',access:'public',channels:[
    {key:'games',name:'🎮・الألعاب',type:'text',topic:'نقاشات الألعاب'},
    {key:'cs2',name:'🔫・counter-strike-2',type:'text',topic:'أخبار CS2 واللاعبين والبطولات'},
    {key:'pubg',name:'🪖・pubg-mobile',type:'text',topic:'PUBG Mobile والفرق'},
    {key:'fortnite',name:'🏝️・fortnite',type:'text',topic:'Fortnite'},
    {key:'squad',name:'🤝・تجميع-سكواد',type:'text',topic:'ابحث عن فريق أو أعضاء للعب'},
    {key:'clips',name:'🏆・لقطات-احترافية',type:'text',topic:'شارك أفضل اللقطات والإنجازات'},
  ]},
  {key:'voice',name:'╠═ ✦ 04 • VOICE LOUNGE',access:'public',channels:[
    {key:'lobby',name:'🔊・General Lounge',type:'voice',userLimit:0},
    {key:'squad1',name:'🎮・Gaming Room 01',type:'voice',userLimit:5},
    {key:'squad2',name:'🎮・Gaming Room 02',type:'voice',userLimit:5},
    {key:'chatvoice',name:'☕・Chill Room',type:'voice',userLimit:0},
    {key:'vipvoice',name:'💎・VIP Lounge',type:'voice',userLimit:10,vipOnly:true},
    {key:'afk',name:'🌙・AFK',type:'voice',userLimit:0},
  ]},
  {key:'support',name:'╠═ ✦ 05 • HELP DESK',access:'public',channels:[
    {key:'help',name:'🎫・طلب-مساعدة',type:'text',topic:'اطرح سؤالك؛ هذا ليس نظام تذاكر تلقائي'},
    {key:'reports',name:'🚨・إرشادات-البلاغات',type:'text',readonly:true,topic:'تواصل مع الإدارة بشكل خاص لإبلاغات الأعضاء',message:'**🚨 الإبلاغات**\nلحماية خصوصيتك، لا تنشر معلومات حساسة أو تفاصيل عن الأعضاء علناً. تواصل مباشرة مع فريق الإشراف أو استخدم نظام التذاكر عند إضافته لاحقاً.'},
    {key:'supportfaq',name:'📚・مساعدة-السيرفر',type:'text',topic:'حلول وأجوبة المجتمع'},
  ]},
  {key:'staff',name:'╠═ ✦ 06 • STAFF HQ',access:'staff',staffKeys:['founder','coowner','admin','headmod','mod','support'],channels:[
    {key:'staffChat',name:'🛡️・staff-chat',type:'text',topic:'نقاشات الطاقم الخاصة'},
    {key:'staffTasks',name:'📋・staff-tasks',type:'text',topic:'المهام والتنظيم'},
    {key:'staffVoice',name:'🎙️・Staff Meeting',type:'voice',userLimit:12},
  ]},
  {key:'logs',name:'╚═ ✦ 07 • STAFF LOGS',access:'staff',staffKeys:['founder','coowner','admin','headmod'],channels:[
    {key:'logs',name:'📊・mod-notes',type:'text',topic:'ملاحظات الإدارة (ليست سجلات تلقائية)'},
    {key:'audit',name:'🔐・security-notes',type:'text',topic:'ملاحظات الأمان والبلاغات الداخلية'},
  ]},
];

export const ROLE_ASSIGNMENT_NOTE = 'The real Discord server owner retains native owner rights; the Founder role is decorative. New privileged roles are NOT automatically assigned to other members.';
