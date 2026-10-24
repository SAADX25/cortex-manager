'use strict';

// Only interface text is localized. Names, drafts, JSON, reviewed payloads and
// reports remain original data. Existing DOM nodes and form values are retained.
(() => {
const en = {
'مساحة الإدارة':'Workspace','اختر سيرفرك':'Choose your server','اربط البوت للبدء':'Connect your bot to get started',
'إدارة المجتمع':'Community','أدوات البوت':'Bot tools','التنقل الرئيسي':'Main navigation','نظرة عامة':'Overview',
'الأقسام والقنوات':'Categories & channels','الرتب والصلاحيات':'Roles & permissions','تصميم السيرفر':'Server redesign',
'فحص الصلاحيات':'Permission check','سجل النشاط':'Activity log','إعدادات الاتصال':'Connection settings','جديد':'New',
'يعمل محليًا على جهازك':'Runs locally on your device','معاينة توضيحية':'Demo preview','صُمّم لمجتمعك':'Made for your community',
'جاهز للاتصال بالسيرفر':'Ready to connect','جارٍ تنفيذ العملية…':'Operation in progress…','تحتاج العملية إلى المراجعة':'Review required',
'الخدمة المحلية غير متصلة':'Local service disconnected','إغلاق':'Close','إلغاء':'Cancel','متابعة':'Continue',
'تحديث':'Refresh','إضافة مساحة':'Add space','إنشاء رتبة':'Create role','فحص الآن':'Check now','السجل':'Log',
'سيرفر استثنائي يبدأ من هنا':'An exceptional server starts here','أهلًا بك في':'Welcome to',
'قنواتك ورتبك الحالية أمامك. خصّص كل تفصيلة، راجع التغييرات، واجعل تجربة مجتمعك أفضل.':'Your channels and roles, all in one place. Customize the details, review changes and improve your community.',
'لوحة احترافية لإدارة قنواتك، ترتيب رتبك، وتشغيل بوتك. كل شيء واضح، من المعاينة حتى التأكيد.':'Manage channels, organize roles and run your bot. Review every change before confirming.',
'استكشف قنوات السيرفر':'Explore channels','ابدأ ربط السيرفر':'Connect your server','ربط السيرفر':'Connect server',
'حماية القيادة مفعّلة دائمًا':'Leadership protection is always active','القنوات النصية':'Text channels','القنوات الصوتية':'Voice channels',
'رتب المجتمع':'Community roles','حماية السيرفر':'Server protection','مفعّلة':'Active','آمنة':'Protected',
'مساحات للعب والتواصل':'Spaces to play and connect','القيادة والتكاملات محفوظة':'Leadership and integrations preserved',
'جاهزة للمحادثات':'Ready for conversation','تواصل بصوتك':'Connect by voice','صلاحيات لكل دور':'Permissions for every role','تأكيد قبل كل تعديل':'Confirm every change',
'مساحات مجتمعك':'Community spaces','لمحة عن الأقسام والقنوات الموجودة':'Your current categories and channels','عرض الكل':'View all',
'أضف بيانات الاتصال لعرض قنوات السيرفر الحقيقية.':'Connect to see your actual server channels.',
'بيانات توضيحية للتصميم؛ غير متصلة بسيرفرك':'Demo data; not connected to your server','لا اتصال بديسكورد':'No Discord connection',
'قنوات حقيقية من السيرفر المحدد':'Actual channels from the selected server','لا تُعرض بيانات سيرفر قبل الاتصال':'Connect to load server data',
'حالة مساحة العمل':'Workspace activity','كل خطوة واضحة وتحت تحكمك':'Every step under your control',
'تم تحميل بيانات السيرفر':'Server loaded','مساحة العمل جاهزة للاتصال':'Workspace ready to connect','الآن':'Now',
'بيانات توضيحية · دون اتصال بديسكورد':'Demo data · No Discord connection','القنوات والرتب متاحة للعرض والتحرير':'Channels and roles ready to browse and edit',
'أدخل التوكن ورقم السيرفر للبدء':'Enter your bot token and server ID to get started','حماية القيادة والتكاملات مفعّلة':'Leadership and integration protection active',
'OWNER وCO_OWNER لا تتغيران':'OWNER and CO_OWNER remain unchanged','المعاينة تسبق التنفيذ دائمًا':'Preview before every action',
'أي تعديل يحتاج مراجعتك وتأكيدك':'Changes require your review and confirmation','قناة المجتمع':'Community channel','لا توجد قنوات في السيرفر.':'No channels in this server.',
'سيرفرك… في مكان واحد':'Your server, in one place',
'اربط البوت بسيرفرك لعرض الأقسام والقنوات والرتب الحالية، ثم عدّل كل عنصر بمعاينة واضحة قبل الحفظ.':'Connect your bot to browse categories, channels and roles, then review each edit before saving.',
'إعداد الاتصال':'Set up connection','رتب تعكس هوية مجتمعك':'Roles that reflect your community',
'شاهد الرتب الحالية، خصّص ألوانها، واضبط الصلاحيات لكل دور.':'Browse roles, customize their colors and set permissions for each one.',
'ابحث عن رتبة…':'Search roles…','ابحث عن قناة أو قسم…':'Search channels or categories…','البحث في الرتب':'Search roles','البحث في القنوات':'Search channels',
'رتب السيرفر':'Server roles','هيكل السيرفر':'Server structure','قابلة للتعديل':'Editable',
'لا توجد رتبة بهذا الاسم.':'No matching roles.','لا توجد قناة بهذا الاسم.':'No matching channels.',
'اختر عنصرًا من القائمة':'Select an item','رتبة جديدة':'New role','مساحة جديدة':'New space','رتبة في السيرفر':'Server role',
'قناة نصية':'Text channel','قناة صوتية':'Voice channel','قسم':'Category','قناة':'Channel',
'محمية · للعرض فقط':'Protected · Read only','مسودة جديدة':'New draft','إعدادات العنصر':'Item settings',
'تعذّرت العملية؛ راجع السبب قبل المحاولة مجددًا':'Operation failed; review the reason before retrying','تحديث بيانات السيرفر':'Refresh server data',
'تفاصيل الرتبة':'Role details','صلاحيات الرتبة':'Role permissions','إعدادات القناة':'Channel settings','أذونات الوصول':'Access permissions',
'رسائل البوت':'Bot messages','رسالة باسم البوت':'Message as bot','تمت معاينة التعديل':'Edit reviewed',
'هذه البيانات للعرض فقط':'Read only','وضع العرض · الحفظ الحقيقي معطّل':'Demo mode · Saving disabled',
'الخطة جاهزة. الحفظ يتطلب تأكيدك.':'Plan ready. Confirm to save.','مسودة محلية · راجع التعديل قبل الحفظ':'Local draft · Review before saving',
'معاينة التعديل':'Review edit','حفظ التغيير':'Save changes','اسم القناة':'Channel name','اسم القسم':'Category name','اسم الرتبة':'Role name',
'اختر اسمًا واضحًا. يمكنك تخصيص الإيموجي من زر مكتبة الإيموجي.':'Choose a clear name. Use the emoji library to customize it.',
'اسم مميز مع إيموجي يجعل أعضاء مجتمعك يتعرفون على دورهم بسرعة.':'A distinctive name and emoji help members recognize the role.',
'القسم الرئيسي':'Parent category','بدون قسم':'No category','نقل القناة يحافظ على أذوناتها الحالية.':'Moving the channel preserves its current permissions.',
'وصف القناة':'Channel topic','اختياري':'Optional','ماذا يحدث في هذه المساحة؟':'What happens in this space?',
'تهدئة الرسائل (ثانية)':'Slowmode (seconds)','0 لتعطيل وضع التهدئة. الحد الأقصى 21600.':'0 disables slowmode. Maximum: 21600.',
'الحد الأقصى للأعضاء':'User limit','0 يسمح بعدد غير محدود. الحد الأقصى 99.':'0 means unlimited. Maximum: 99.',
'التعديل يبدأ بمعاينة':'Review first','لن يتغير أي شيء في السيرفر حتى تراجع التفاصيل وتؤكد الحفظ.':'Nothing changes on the server until you review the details and confirm.',
'لون الرتبة':'Role color','اختيار لون الرتبة':'Choose role color','لون الرتبة HEX':'Role color HEX',
'يظهر هذا اللون على أسماء الأعضاء في ديسكورد.':'This color appears on members’ names in Discord.',
'طريقة الظهور':'Display','عرض الرتبة بشكل منفصل':'Display role separately','تجميع أعضائها في قائمة الأعضاء':'Group members in the member list',
'السماح بمنشن الرتبة':'Allow role mentions','يمكن للجميع الإشارة إلى هذه الرتبة':'Everyone can mention this role',
'الصلاحيات تتطبق على جميع أعضاء الرتبة. يتم حفظ الصلاحيات الأخرى وتوزيع الأعضاء كما هما.':'Permissions apply to all role members. Other permissions and member assignments are preserved.',
'حدّد رتبة واضبط وصولها لهذه القناة. أذونات الأعضاء والقيادة والتكاملات تبقى محفوظة.':'Select a role and set its channel access. Member, leadership and integration overwrites are preserved.',
'الرتبة المراد ضبط وصولها':'Role to configure','لا توجد رتب متاحة للتحرير.':'No editable roles available.',
'وراثة':'Inherit','سماح ✓':'Allow ✓','منع ×':'Deny ×',
'عرض القنوات':'View channels','إرسال الرسائل':'Send messages','قراءة سجل الرسائل':'Read message history','إضافة تفاعلات':'Add reactions',
'تضمين الروابط':'Embed links','إرفاق الملفات':'Attach files','دخول القنوات الصوتية':'Connect to voice','التحدث صوتيًا':'Speak',
'نقل الأعضاء صوتيًا':'Move members','إدارة الرسائل':'Manage messages','إدارة القنوات':'Manage channels','إدارة الرتب':'Manage roles',
'إدارة السيرفر':'Manage server','عرض سجل التدقيق':'View audit log','مدير كامل':'Administrator','طرد الأعضاء':'Kick members',
'حظر الأعضاء':'Ban members','إسكات الأعضاء مؤقتًا':'Timeout members','إدارة الأسماء المستعارة':'Manage nicknames',
'تغيير الاسم المستعار':'Change nickname','منشن الجميع':'Mention everyone','إنشاء دعوة':'Create invite','إدارة Webhooks':'Manage webhooks',
'إدارة المواضيع':'Manage threads','إنشاء مواضيع عامة':'Create public threads','إنشاء مواضيع خاصة':'Create private threads',
'إرسال رسائل في المواضيع':'Send messages in threads','إدارة الفعاليات':'Manage events','إنشاء فعاليات':'Create events',
'إدارة التعبيرات':'Manage expressions','إيموجي خارجية':'Use external emoji','ملصقات خارجية':'Use external stickers',
'كتم الأعضاء صوتيًا':'Mute members','إسكات الصوت للأعضاء':'Deafen members','بث مباشر':'Stream','استخدام النشاط الصوتي':'Use voice activity',
'أولوية التحدث':'Priority speaker','طلب التحدث':'Request to speak','استخدام أوامر التطبيقات':'Use application commands','إرسال رسائل صوتية':'Send voice messages',
'يلزم رفع رتبة البوت في Discord':'Move the bot role higher in Discord','هذه الرتبة محفوظة':'This role is protected','هذا العنصر محفوظ':'This item is protected',
'رتب القيادة محفوظة دائمًا، ولا يمكن تعديل صلاحياتها أو أعضائها أو ترتيبها من البرنامج.':'Leadership roles are permanently protected. Their permissions, members and position cannot be changed by this app.',
'رتبة الجميع محفوظة وفق سياسة هذا المشروع.':'The @everyone role is preserved by this project.',
'هذه رتبة يديرها Discord أو أحد التكاملات؛ تُدار من إعدادات التكامل نفسه.':'Discord or an integration manages this role. Use that integration’s settings.',
'هذه رتبة يحملها البوت؛ لا يعدّل البرنامج رتبه الخاصة.':'The bot has this role. The app does not edit its own roles.',
'Discord يمنع البوت من تعديل رتبة أعلى من أعلى رتبة يحملها أو مساوية لها، حتى مع Administrator.':'Discord blocks edits to roles at or above the bot’s highest role, even with Administrator.',
'من Discord افتح':'In Discord, open','إعدادات السيرفر ← الرتب':'Server Settings → Roles','، ثم ارفع رتبة البوت':'and move the bot role',
'فوق الرتب التي تريد إدارتها، مع بقائها أسفل OWNER وCO_OWNER. لا تحرّك رتب القيادة.':'above roles you want to manage, keeping it below OWNER and CO_OWNER. Leave leadership roles in place.',
'بعد ذلك اضغط تحديث لتفعيل الصلاحيات المتاحة.':'Then refresh to load the available permissions.','تحديث صلاحية إدارة الرتبة':'Refresh role access',
'إعداد الاتصال بالسيرفر':'Server connection','احفظ بيانات الاتصال على جهازك بتشفير حساب ويندوز، أو استخدمها لهذه الجلسة فقط.':'Save connection details encrypted for your Windows account, or use them for this session only.',
'هذه معاينة توضيحية للواجهة':'This is a UI demo','لا يوجد اتصال بديسكورد، ولا تُنفّذ عمليات على أي سيرفر.':'No Discord connection or server operations.',
'توكن البوت':'Bot token','رقم السيرفر':'Server ID','إظهار أو إخفاء التوكن':'Show or hide token',
'التوكن محفوظ بتشفير ويندوز؛ اتركه فارغًا لاستخدامه':'Token encrypted with Windows; leave blank to use it',
'التوكن متاح في ذاكرة الجلسة الحالية':'Token available in session memory','أدخل توكن البوت من Discord Developer Portal':'Enter your bot token from the Discord Developer Portal',
'لا تشارك التوكن مع أي شخص. لا يُحفظ في التخزين المحلي للمتصفح.':'Keep your token private. It is not stored in browser local storage.',
'لتغييره: انسخ رقم السيرفر من ديسكورد بعد تفعيل وضع المطوّر.':'Copy the server ID from Discord with Developer Mode enabled.',
'حفظ بيانات الاتصال':'Save connection details','حذف البيانات المحفوظة':'Forget saved details',
'التعديلات الحالية غير محفوظة':'Current changes are not saved','محفوظة على هذا الجهاز بتشفير ويندوز':'Saved on this device with Windows encryption',
'الحفظ اختياري · الاتصال يبدأ بضغطك فقط':'Saving is optional · Connect when you choose',
'جارٍ تحميل السيرفر…':'Loading server…','اتصال وتشغيل البوت':'Connect & start bot','إيقاف الاتصال':'Disconnect',
'جارٍ العمل…':'Working…','● البوت متصل والسيرفر جاهز':'● Bot online and server ready','جارٍ الاتصال بالبوت…':'Connecting to bot…',
'مدة تشغيل البوت':'Bot uptime',
'تحميل السيرفر وتشغيل الحضور بخطوة واحدة':'Load the server and start bot presence in one step',
'اتصال محلي':'Local connection','بياناتك لا تمر بخادم خارجي للتطبيق.':'Your data does not pass through an external app server.',
'حماية ثابتة':'Built-in protection','رتب القيادة والتكاملات محفوظة.':'Leadership and integration roles are preserved.',
'مراجعة قبل التنفيذ':'Review before execution','التحميل والفحص لا يغيّران السيرفر.':'Loading and checks do not change the server.',
'صلاحيات البوت، أمامك بوضوح':'Your bot’s permissions, clearly explained',
'اعرف ما يستطيع البوت إدارته، وما يحتاج تعديلًا من إعدادات السيرفر.':'See what the bot can manage and what needs updating in Discord settings.',
'تُقرأ الصلاحيات من ديسكورد. رفع رتبة البوت أو تعديل صلاحياته يتم من إعدادات السيرفر.':'Permissions are read from Discord. Change the bot’s role position or permissions in Server Settings.',
'صلاحيات الوصول والإدارة':'Access & management permissions','متاحة':'Granted','غير ممنوحة':'Not granted','قنوات لا يستطيع البوت إدارتها':'Channels the bot cannot manage',
'نوع الرسالة':'Message format','نص عادي':'Plain text','بطاقات مصمّمة · Embed JSON':'Designed cards · Embed JSON',
'قالب قوانين عربي / English':'Arabic / English rules template','نص الرسالة / التعليق':'Message / comment','كود تصميم الرسالة · JSON':'Message design · JSON',
'ستظهر باسم البوت بعد المعاينة والتأكيد.':'Sent as the bot after review and confirmation.',
'عدّل نصوص القالب داخل علامات الاقتباس. color رقم اللون؛ fields فقرات القوانين. الكود يتحوّل إلى بطاقات عند المعاينة، ولا يُنشر كنص كود.':'Edit the quoted text. color is a numeric color; fields are rule sections. Preview converts JSON into cards; the code itself is not posted.',
'أضف قالب القوانين أو أدخل كود البطاقات…':'Load the rules template or enter card JSON…','اكتب الرسالة التي تريد نشرها…':'Write your message…',
'حتى 10 بطاقات ومجموع 6000 حرف في نصوصها.':'Up to 10 cards and 6,000 characters in total.',
'المنشن التلقائي معطّل.':'Automatic mentions are disabled.','المنشن التلقائي للأعضاء والرتب و@everyone معطّل.':'Automatic user, role and @everyone mentions are disabled.',
'معاينة تقريبية؛ الخط والمسافات قد تختلف في Discord.':'Approximate preview; fonts and spacing may differ in Discord.',
'معاينة الرسالة':'Preview message','إرسال باسم البوت':'Send as bot','تأكيد إرسال الرسالة':'Confirm message','تأكيد الإرسال':'Confirm send',
'ستظهر باسم البوت. الإشارات التلقائية معطّلة.':'Sent as the bot. Automatic mentions are disabled.',
'تم إرسال الرسالة بنجاح.':'Message sent successfully.','تم إرسال الرسالة باسم البوت.':'Message sent as the bot.',
'لم يتأكد الإرسال. راجع الغرفة قبل إعداد رسالة أخرى.':'Delivery is unconfirmed. Check the channel before preparing another message.',
'وضع العرض التوضيحي: الإرسال الحقيقي معطّل.':'Demo mode: sending is disabled.',
'استبدال كود التصميم؟':'Replace design code?','سيُستبدل كود المسودة بقالب القوانين. لن تُرسل أي رسالة.':'Replace the draft code with the rules template. No message will be sent.',
'استخدام القالب':'Use template','اكتب الرسالة أولًا.':'Write a message first.','صيغة JSON غير صحيحة؛ راجع الفواصل وعلامات الاقتباس.':'Invalid JSON. Check commas and quotation marks.',
'مكتبة الإيموجي':'Emoji library','اختر من المكتبة أو أضف إيموجي من عندك':'Browse the library or paste your own emoji',
'لمسة تعبّر عن مجتمعك':'A touch of personality','مكتبة إيموجي لأسماء الغرف والأقسام والرتب':'Emoji for channel, category and role names',
'البحث في مكتبة الإيموجي':'Search emoji library','ابحث بالعربي أو English…':'Search in Arabic or English…',
'تصنيفات الإيموجي':'Emoji categories','اختيار إيموجي':'Choose emoji','الكل':'All','الألعاب':'Gaming','المجتمع':'Community','الإدارة':'Staff',
'لمسات مميزة':'Highlights','إضافاتي':'My additions','إيموجي من عندك':'Your own emoji','اختيار':'Select',
'الصق إيموجي هنا مثل 🐉':'Paste an emoji, e.g. 🐉',
'للأسماء استخدم إيموجي Unicode. صور وإيموجيات Discord المخصصة لا تظهر كصور داخل اسم القناة؛ يمكن استخدامها في الرسائل.':'Use Unicode emoji for names. Custom Discord emoji images do not render inside channel names; use them in messages.',
'معاينة الاسم':'Name preview','استخدام الإيموجي':'Use emoji',
'الإيموجيات التي تضيفها تظهر هنا طوال الجلسة.':'Your added emoji appear here for this session.',
'لا توجد نتائج. جرّب كلمة أخرى أو الصق إيموجي من عندك.':'No results. Try another word or paste your own emoji.',
'الصق إيموجي واحدًا؛ الصور وأكواد مثل <:name:id> غير مدعومة في الأسماء.':'Paste one Unicode emoji. Images and codes such as <:name:id> are not supported in names.',
'جاهز للاستخدام. سيظهر ضمن «إضافاتي» طوال هذه الجلسة.':'Ready to use. It will appear in My additions for this session.',
'أضف مساحة لمجتمعك':'Add a community space','اختر نوع المساحة. ستراجع إعداداتها قبل إنشائها في السيرفر.':'Choose a space type. Review its settings before creating it.',
'نوع المساحة':'Space type','💬 قناة نصية':'💬 Text channel','🎙️ قناة صوتية':'🎙️ Voice channel','📁 قسم للقنوات':'📁 Channel category',
'تأكيد حفظ التعديل':'Confirm changes','سيُحفظ هذا التغيير في':'This change will be saved in',
'راجع التفاصيل قبل المتابعة.':'Review the details before continuing.','العودة للمراجعة':'Back to review','تأكيد وحفظ':'Confirm & save',
'امنح مجتمعك بداية أجمل':'Give your community a fresh start',
'تصميم ألعاب عربي منظّم، مع مراجعة كاملة لكل ما سيُنشأ وما سيُحفظ وما سيُزال.':'An organized Arabic gaming layout, with a full review of everything created, preserved or removed.',
'مسار إعادة التصميم':'Redesign workflow','ثلاث خطوات واضحة، وتأكيد قبل أي حذف':'Three clear steps, confirmation before deletion',
'ابدأ من السيرفر الحالي':'Start with your current server','حمّل القنوات والرتب وافحص صلاحيات البوت قبل إنشاء أي خطة.':'Load channels and roles and check bot permissions before planning.',
'أنشئ الخطة وراجع التفاصيل':'Create and review the plan',
'معاينة منفصلة تعرض الإنشاء والتحديث والحذف، مع الرتب والقنوات المحفوظة وتوزيع الأعضاء.':'A separate preview shows creations, updates, deletions, preserved items and role assignments.',
'إنشاء معاينة كاملة':'Create full preview','نفّذ بعد موافقتك الصريحة':'Run after explicit confirmation',
'يُنشأ الجديد أولًا. لا يبدأ حذف القديم إلا بعد التحقق من الخطة وتأكيد رقم السيرفر وعبارة الحذف.':'New items are created first. Cleanup requires a verified plan, the server ID and the deletion phrase.',
'مراجعة تأكيد التنفيذ':'Review execution confirmation','تصميم احترافي. أساس آمن.':'Professional design. Safe foundations.',
'قواعد ثابتة ترافق كل خطة':'Safeguards for every plan','★ OWNER ★ و★ CO_OWNER ★ محفوظتان بالصلاحيات والترتيب والأعضاء.':'★ OWNER ★ and ★ CO_OWNER ★ keep their permissions, position and members.',
'@everyone ورتب البوتات والتكاملات لا تُحذف.':'@everyone, bot and integration roles are preserved.',
'قنوات Community المحمية مثل rules وmoderator-only محفوظة.':'Protected Community channels such as rules and moderator-only are preserved.',
'الرتب الموزعة تُحفظ عندما لا يوجد نقل آمن لتوزيعها.':'Assigned roles are kept when assignments cannot be safely migrated.',
'لا طرد، لا حظر، ولا حذف للسيرفر.':'No kicks, bans or server deletion.',
'تنفيذ تدريجي يحترم حدود Discord API ويمنع التكرار.':'Sequential execution respects Discord API limits and prevents duplicates.',
'الخطة تُبنى على حالة السيرفر الحالية. أي تغيّر مؤثر يستلزم معاينة جديدة.':'Plans use the current server configuration. Relevant changes require a fresh preview.',
'تقرير الخطة المقترحة':'Proposed plan report','راجع جميع التفاصيل قبل إتاحة زر التنفيذ':'Review all details before enabling execution','تنزيل التقرير':'Download report',
'راجعت تقرير الإنشاء والحذف والرتب المحفوظة، وأرغب في فتح خطوة التأكيد الإضافي.':'I reviewed the creation, deletion and preservation report and want to open the final confirmation.',
'تأكيد إعادة بناء السيرفر':'Confirm server rebuild','تأكيد وتنفيذ إعادة البناء':'Confirm & rebuild',
'ستُنشأ عناصر التصميم الجديد أولًا، ثم تُزال العناصر القديمة المسموح بحذفها حسب الخطة. قد يُفقد محتوى القنوات المحذوفة. لا تنفّذ إلا بعد مراجعة التقرير.':'New design items are created first, then eligible old items are removed according to the plan. Deleted channel content may be lost. Review the report before proceeding.',
'اكتب العبارة التالية كما هي':'Type the following phrase exactly','عبارة التأكيد':'Confirmation phrase','تأكيد وبدء التنفيذ':'Confirm & execute',
'تحتاج منح صلاحيات البوت؟':'Need to grant bot permissions?','فتح دعوة الصلاحيات المطلوبة':'Open required-permissions invite',
'دعوة Administrator…':'Administrator invite…','دعوة بصلاحية Administrator':'Invite with Administrator',
'تمنح هذه الدعوة البوت صلاحية إدارة كاملة في السيرفر. استخدمها فقط إذا كنت تريد ذلك. يمكنك منح الصلاحيات المطلوبة من الدعوة العادية.':'This invite grants the bot full Administrator permission. Use it only if intended. The regular invite grants the required permissions.',
'سيفتح رابط ديسكورد الرسمي؛ راجع صفحة الموافقة هناك.':'An official Discord link will open. Review the authorization page there.',
'فتح الدعوة الرسمية':'Open official invite','استكشف التصميم بأمان':'Explore the design safely',
'هذه بيانات توضيحية فقط. يمكنك إنشاء معاينة ورؤية التقارير؛ الحفظ وإعادة البناء الحقيقيان معطّلان.':'This is demo data. You can preview plans and reports; saving and rebuilding are disabled.',
'بيانات توضيحية للتصميم؛ غير متصلة بسيرفرك · لا اتصال بديسكورد':'Demo data; not connected to your server · No Discord connection',
'تم إنشاء الخطة. افتح التقرير لمراجعة التفاصيل.':'Plan created. Open the report to review details.',
'تعذّر تنزيل التقرير. قد لا يكون متاحًا في هذه الجلسة.':'Could not download the report. It may not be available in this session.',
'اكتب رقم السيرفر المحدد للتأكيد':'Enter the selected server ID to confirm','اكتب عبارة التأكيد التالية حرفيًا:':'Type the following confirmation phrase exactly:',
'كل خطوة لها سجل':'Every step recorded','تابع عمليات الاتصال والفحص والمراجعة والتنفيذ من مكان واحد.':'Track connections, checks, reviews and execution in one place.',
'تنزيل السجل':'Download log','سجل مساحة العمل':'Workspace log','سجل محلي لعمليات هذه الجلسة':'Local activity for this session',
'مساحة جديدة، وسجل واضح':'A fresh workspace, a clear record','ستظهر هنا عمليات هذه الجلسة بمجرد اتصالك بالسيرفر.':'Session activity will appear here after connecting.',
'ملفات التقارير والنسخ المحلية':'Reports & local backups','تنزيل التفاصيل الكاملة للخطط والعمليات في هذه الجلسة':'Download full plans and operation details for this session',
'تنزيل':'Download','ستظهر هنا ملفات المعاينة ونتائج التنفيذ عندما تُنشأ.':'Preview files and execution results will appear here when created.',
'معاينة رسالة البوت':'Bot message preview','خطة إرسال الرسالة':'Message plan','نتيجة إرسال الرسالة':'Message result','سبب تعارض الحفظ مع المعاينة':'Edit conflict details',
'تقرير معاينة إعادة البناء':'Rebuild preview report','خطة الإنشاء والحذف الكاملة':'Full creation & deletion plan','بيانات اعتماد الخطة':'Plan approval',
'نسخة حالة السيرفر قبل التنفيذ':'Server configuration backup','نتيجة إعادة البناء':'Rebuild result','سجل خطوات التنفيذ':'Execution log',
'تفاصيل العملية غير المكتملة':'Incomplete operation details','تقرير مراجعة التعديل':'Edit review','خطة التعديل الكاملة':'Full edit plan',
'حالة السيرفر قبل التعديل':'Configuration before edit','نتيجة حفظ التعديل':'Edit result',
'تم تحديث بيانات العرض التوضيحي.':'Demo data refreshed.','تم تحديث بيانات السيرفر بنجاح.':'Server data refreshed.',
'تم حفظ التوكن ورقم السيرفر بتشفير ويندوز.':'Token and server ID saved with Windows encryption.',
'تم حذف البيانات المحفوظة. بيانات الجلسة تبقى حتى إغلاق البرنامج.':'Saved details removed. Session credentials remain until the app closes.',
'تم حفظ التعديل. جارٍ تحديث بيانات السيرفر.':'Changes saved. Refreshing server data.',
'تم تحديث العنصر من السيرفر. راجع القيم الحالية.':'Item refreshed from the server. Review its current values.',
'توجد تقارير جديدة جاهزة للتنزيل في سجل النشاط.':'New reports are available in the activity log.',
'تعذّر الاتصال بالخدمة المحلية. افتح CortexManager.exe مجددًا.':'Cannot connect to the local service. Reopen CortexManager.exe.',
'تعذّرت العملية.':'Operation failed.','أدخل اسم العنصر أولًا.':'Enter a name first.','الاسم يجب ألا يتجاوز 100 حرف.':'Names must be 100 characters or fewer.',
'الاسم مع الإيموجي يتجاوز 100 حرف. اختصر الاسم أولًا.':'The name with emoji exceeds 100 characters. Shorten it first.',
'أدخل لونًا صحيحًا مثل #9888FF.':'Enter a valid color, e.g. #9888FF.',
'حد الأعضاء يجب أن يكون بين 0 و99.':'The user limit must be from 0 to 99.','التهدئة يجب أن تكون بين 0 و21600 ثانية.':'Slowmode must be from 0 to 21600 seconds.',
'اختر الغرفة المراد النشر فيها.':'Choose the destination channel.','اكتب رسالة من 1 إلى 2000 حرف أو أضف بطاقة Embed.':'Write 1–2000 characters or add an embed.',
'يحتاج البوت صلاحيتَي عرض القناة وإرسال الرسائل داخل هذه الغرفة.':'The bot needs View Channel and Send Messages in this channel.',
'يحتاج البوت صلاحية الاتصال بهذه الغرفة الصوتية.':'The bot needs Connect in this voice channel.',
'يحتاج البوت صلاحية تضمين الروابط (Embed Links) لنشر البطاقات في هذه الغرفة.':'The bot needs Embed Links to post cards in this channel.',
'الاسم':'Name','الغرفة':'Channel','السيرفر':'Server','البوت':'Bot',
};
const patterns = [
 [/^أهلًا بك في (.*)$/u, (_,name)=>`Welcome to ${name}`],
 [/^(\d+) أقسام منظمة$/u, (_,n)=>`${n} categories`],
 [/^(\d+) رتب محفوظة$/u, (_,n)=>`${n} preserved roles`],
 [/^(\d+) رتبة$/u, (_,n)=>`${n} roles`],[/^(\d+) عنصر$/u, (_,n)=>`${n} items`],
 [/^آخر تحديث (.*)$/u, (_,time)=>`Updated ${time}`],
 [/^تعديل القسم (.*)$/u, (_,name)=>`Edit category ${name}`],
 [/^(\d+) صلاحية متاحة من أصل (\d+)$/u, (_,n,total)=>`${n} of ${total} permissions granted`],
 [/^معاينة الرسالة · (.*)$/u, (_,name)=>`Message preview · ${name}`],
 [/^رسالة إلى: (.*)$/u, (_,name)=>`Message to: ${name}`],
 [/^(.+) · متصل ببيانات (.*)$/u, (_,bot,name)=>`${bot} · Loaded ${name}`],
 [/^السيرفر:$/u, ()=> 'Server:'],[/^الغرفة:$/u, ()=> 'Channel:'],[/^رقم السيرفر:$/u, ()=> 'Server ID:'],
 [/^([٠-٩]{2}:[٠-٩]{2}) ([صم])$/u, (_,time,period)=>time.replace(/[٠-٩]/g,n=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(n)))+(period==='ص'?' AM':' PM')],
 [/^(.*)المنشن التلقائي معطّل\.$/u, (_,prefix)=>`${prefix}Automatic mentions disabled.`],
];
let language='ar', observer;
const originals=new WeakMap(), attributes=new WeakMap();
const skip='script,style,textarea,input,code,[translate="no"],.emoji,.entity-title strong,#sidebarGuildName,#sidebarGuildId,#emojiNamePreview,#editParent option,#overwriteRole option,.message-bubble,.discord-embed,.review-summary,.report-content,.message-confirm-preview';
function translate(value){
  if(language!=='en')return value;
  const trimmed=value.trim();let translated=Object.hasOwn(en,trimmed)?en[trimmed]:undefined;
  if(translated===undefined){for(const [pattern,format] of patterns){const m=trimmed.match(pattern);if(m){translated=format(...m);break;}}}
  if(translated===undefined)return value;
  return value.slice(0,value.indexOf(trimmed))+translated+value.slice(value.indexOf(trimmed)+trimmed.length);
}
function localize(){
  observer?.disconnect();
  try{
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())){
      if(!node.parentElement||node.parentElement.closest(skip)||!node.data.trim())continue;
      let entry=originals.get(node);if(!entry||node.data!==entry.rendered)entry={source:node.data};
      entry.rendered=translate(entry.source);if(node.data!==entry.rendered)node.data=entry.rendered;originals.set(node,entry);
    }
    document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(element=>{
      if(element.closest('[translate="no"]'))return;
      const saved=attributes.get(element)??{};
      for(const name of ['placeholder','aria-label','title']){
        if(!element.hasAttribute(name)||element.matches('[data-entity-id]')&&name==='title')continue;
        const value=element.getAttribute(name);let entry=saved[name];if(!entry||value!==entry.rendered)entry={source:value};
        entry.rendered=translate(entry.source);
        if(language==='en'&&element.dataset.nameEmoji){const english=(saved.title?.source??element.getAttribute('title')??'').replace(/\p{Script=Arabic}+/gu,'').trim()||'Custom emoji';entry.rendered=english+(name==='aria-label'?' '+element.dataset.nameEmoji:'');}
        if(value!==entry.rendered)element.setAttribute(name,entry.rendered);saved[name]=entry;
      }
      attributes.set(element,saved);
    });
  } finally {observer?.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','aria-label','title']});}
}
function apply(next){
  language=next;document.documentElement.lang=next;document.documentElement.dir=next==='ar'?'rtl':'ltr';
  document.title=next==='ar'?'Cortex Manager 6 | لوحة التحكم الحديثة':'Cortex Manager 6 | Dashboard';
  const button=document.querySelector('#languageSwitch'),label=document.querySelector('#languageSwitchLabel');
  label.textContent=next==='ar'?'English':'العربية';button.setAttribute('aria-label',next==='ar'?'Switch to English':'التبديل إلى العربية');button.title=button.getAttribute('aria-label');
  localize();window.dispatchEvent(new CustomEvent('cortex-language-changed',{detail:next}));
}
window.CortexI18n={get language(){return language;},translate,refresh:localize};
const button=document.querySelector('#languageSwitch');
const fragment=location.hash.slice(1),key=fragment.startsWith('key=')?new URLSearchParams(fragment).get('key'):decodeURIComponent(fragment);
async function preference(method='GET',value){const response=await fetch('/api/preferences',{method,cache:'no-store',headers:{'X-Cortex-Key':key,...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify({language:value})}:{})});if(!response.ok)throw new Error('Language preference could not be saved.');return response.json();}
observer=new MutationObserver(localize);
apply('ar');
preference().then(p=>{if(['ar','en'].includes(p.language))apply(p.language);}).catch(()=>{}).finally(()=>{button.disabled=false;});
button.onclick=async()=>{const previous=language;button.disabled=true;apply(language==='ar'?'en':'ar');try{await preference('POST',language);}catch{apply(previous);window.dispatchEvent(new CustomEvent('cortex-language-error'));}finally{button.disabled=false;}};
})();
