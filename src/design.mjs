// Cortex Manager PRO — declarative layout. Change names/roles here before preview.
export const ROLES = [
  {key:'admin',name:'🛡️・Administrator',color:0xE74C3C,permissions:['ViewChannel','SendMessages','ReadMessageHistory','ManageChannels','ManageRoles','ManageMessages','KickMembers','BanMembers','ModerateMembers']},
  {key:'headmod',name:'⚔️・Head Moderator',color:0xD35400,permissions:['ViewChannel','SendMessages','ReadMessageHistory','KickMembers','BanMembers','ModerateMembers','ManageMessages','ManageNicknames','ManageThreads']},
  {key:'mod',name:'🔨・Moderator',color:0x3498DB,permissions:['ViewChannel','SendMessages','ReadMessageHistory','KickMembers','ModerateMembers','ManageMessages','ManageThreads']},
  {key:'support',name:'🎫・Support Team',color:0x1ABC9C,permissions:['ViewChannel','SendMessages','ReadMessageHistory']},
  {key:'event',name:'🎯・Event Host',color:0x9B59B6,permissions:['ViewChannel','SendMessages','ReadMessageHistory','ManageEvents','MoveMembers']},
  {key:'creator',name:'🎨・Content Creator',color:0xFF78B2,permissions:['ViewChannel','SendMessages','ReadMessageHistory','AttachFiles','EmbedLinks']},
  {key:'vip',name:'💎・VIP',color:0x13D9D4,permissions:['ViewChannel','SendMessages','ReadMessageHistory']},
  {key:'gamer',name:'🎮・Gamer',color:0x5865F2,permissions:['ViewChannel','SendMessages','ReadMessageHistory','Connect','Speak','AddReactions','CreatePublicThreads','SendMessagesInThreads']},
  {key:'verified',name:'✅・Verified',color:0x57F287,permissions:['ViewChannel','SendMessages','ReadMessageHistory','Connect','Speak']},
  {key:'member',name:'🌿・Member',color:0x95A5A6,permissions:['ViewChannel','SendMessages','ReadMessageHistory','Connect','Speak']},
  {key:'muted',name:'🔇・Muted',color:0x555C68,permissions:[]},
];

// IMPORTANT: These are channels, not live features such as ticket bots, automatic verification, or leveling.
export const CATEGORIES = [
  {key:'start',name:'╔═ ✦ 01 • البداية',access:'public',channels:[
    {key:'welcome',name:'👋・أهلاً-وسهلاً',type:'text',readonly:true,topic:'أهلاً بك في مجتمع Real Friends',message:'**أهلاً وسهلاً في Real Friends!** ✨\nابدأ بقراءة القوانين، وشاركنا في الدردشة، وخليك جزء من المجتمع. نتمنى لك أوقات ممتعة!'},
    {key:'rules',name:'📜・القوانين',type:'text',readonly:true,topic:'قوانين المجتمع وآداب التعامل',message:'**📜 قوانين السيرفر**\n1. الاحترام واجب على الجميع، ويُمنع التنمّر أو خطاب الكراهية.\n2. ممنوع السبام أو نشر الروابط الضارة والاحتيالية.\n3. حافظ على الخصوصية ولا تنشر معلومات شخصية للآخرين.\n4. التزم بتعليمات الإدارة ومشرفي المجتمع.\n5. استخدم كل روم حسب غرضه.\n6. يمنع التحايل على أنظمة Discord وشروط الخدمة.\n**التواجد في السيرفر يعني الموافقة على هذه القوانين.**'},
    {key:'news',name:'📢・الإعلانات',type:'text',readonly:true,topic:'الإعلانات الرسمية والتحديثات'},
    {key:'roles',name:'🏷️・دليل-الرتب',type:'text',readonly:true,topic:'معاني الرتب ومن يملك كل صلاحية',message:'**🏷️ دليل الرتب**\n★ OWNER ★ و ★ CO_OWNER ★: القيادة الحالية محفوظة دون تعديل.\n🛡️ Administrator: إدارة السيرفر.\n⚔️ Head Moderator / 🔨 Moderator: الإشراف.\n🎫 Support Team: مساعدة الأعضاء.\n🎯 Event Host: تنظيم الفعاليات.\n🎨 Content Creator: صناع المحتوى.\n💎 VIP: الأعضاء المميزون.\n🎮 Gamer / ✅ Verified / 🌿 Member: رتب مجتمعية.\n🔇 Muted: تقييد التواصل للأعضاء العاديين.\n**ملاحظة:** توزيع الرتب يتم من إدارة السيرفر؛ هذا الروم ليس نظام رتب تلقائي.'},
    {key:'faq',name:'❓・الأسئلة-الشائعة',type:'text',readonly:true,topic:'دليل الاستخدام والإجابات الشائعة'},
  ]},
  {key:'community',name:'╠═ ✦ 02 • المجتمع',access:'public',channels:[
    {key:'general',name:'💬・الدردشة-العامة',type:'text',topic:'دردشة المجتمع للجميع',slowmode:2},
    {key:'introductions',name:'🙋・تعارف',type:'text',topic:'عرّف عن نفسك واهتماماتك'},
    {key:'media',name:'📸・صور-ومقاطع',type:'text',topic:'شارك الصور واللقطات'},
    {key:'memes',name:'😂・ميمز',type:'text',topic:'زاوية الضحك والميمز'},
    {key:'suggestions',name:'💡・اقتراحات',type:'text',topic:'اقتراحات لتطوير المجتمع'},
    {key:'polls',name:'🗳️・تصويتات',type:'text',topic:'استطلاعات المجتمع'},
  ]},
  {key:'gaming',name:'╠═ ✦ 03 • ساحة الألعاب',access:'public',channels:[
    {key:'games',name:'🎮・الألعاب',type:'text',topic:'نقاشات الألعاب'},
    {key:'cs2',name:'🔫・كاونتر-سترايك',type:'text',topic:'أخبار CS2 واللاعبين والبطولات'},
    {key:'pubg',name:'🪖・ببجي-موبايل',type:'text',topic:'PUBG Mobile والفرق'},
    {key:'fortnite',name:'🏝️・فورتنايت',type:'text',topic:'Fortnite'},
    {key:'squad',name:'🤝・تجميع-سكواد',type:'text',topic:'ابحث عن فريق أو أعضاء للعب'},
    {key:'clips',name:'🏆・لقطات-احترافية',type:'text',topic:'شارك أفضل اللقطات والإنجازات'},
  ]},
  {key:'voice',name:'╠═ ✦ 04 • الجلسات الصوتية',access:'public',channels:[
    {key:'lobby',name:'🔊・المجلس العام',type:'voice',userLimit:0},
    {key:'squad1',name:'🎮・فريق الألعاب 01',type:'voice',userLimit:5},
    {key:'squad2',name:'🎮・فريق الألعاب 02',type:'voice',userLimit:5},
    {key:'chatvoice',name:'☕・جلسة هادئة',type:'voice',userLimit:0},
    {key:'vipvoice',name:'💎・مجلس المميزين',type:'voice',userLimit:10,vipOnly:true},
    {key:'afk',name:'🌙・استراحة',type:'voice',userLimit:0},
  ]},
  {key:'support',name:'╠═ ✦ 05 • مركز المساعدة',access:'public',channels:[
    {key:'help',name:'🎫・طلب-مساعدة',type:'text',topic:'اطرح سؤالك؛ هذا ليس نظام تذاكر تلقائي'},
    {key:'reports',name:'🚨・إرشادات-البلاغات',type:'text',readonly:true,topic:'تواصل مع الإدارة بشكل خاص لإبلاغات الأعضاء',message:'**🚨 الإبلاغات**\nلحماية خصوصيتك، لا تنشر معلومات حساسة أو تفاصيل عن الأعضاء علناً. تواصل مباشرة مع فريق الإشراف أو استخدم نظام التذاكر عند إضافته لاحقاً.'},
    {key:'supportfaq',name:'📚・مساعدة-السيرفر',type:'text',topic:'حلول وأجوبة المجتمع'},
  ]},
  {key:'staff',name:'╠═ ✦ 06 • مقر الإدارة',access:'staff',staffKeys:['admin','headmod','mod','support'],channels:[
    {key:'staffChat',name:'🛡️・دردشة-الإدارة',type:'text',topic:'نقاشات الطاقم الخاصة'},
    {key:'staffTasks',name:'📋・مهام-الإدارة',type:'text',topic:'المهام والتنظيم'},
    {key:'staffVoice',name:'🎙️・اجتماع الإدارة',type:'voice',userLimit:12},
  ]},
  {key:'logs',name:'╚═ ✦ 07 • سجلات الإدارة',access:'staff',staffKeys:['admin','headmod'],channels:[
    {key:'logs',name:'📊・ملاحظات-الإشراف',type:'text',topic:'ملاحظات الإدارة (ليست سجلات تلقائية)'},
    {key:'audit',name:'🔐・ملاحظات-الأمان',type:'text',topic:'ملاحظات الأمان والبلاغات الداخلية'},
  ]},
];

// Explicit source role ID -> new role key. Review these in preview before rebuild.
// Example: '123456789012345678': 'member'. Never map OWNER/CO_OWNER.
// Unmapped assigned roles are retained; names alone never grant staff powers.
export const ROLE_MIGRATIONS = Object.freeze({});
