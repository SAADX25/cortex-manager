# Cortex Social Bot — Discloud

## تجهيز الحزمة الموحدة

افتح **تجهيز ملف ZIP** من أدوات البوت في البرنامج. احفظ التعديلات في أقسامها، ثم اضغط **تجهيز ZIP بأحدث الإعدادات** و**تنزيل ملف ZIP الجاهز**. رابط **فتح تطبيقي على Discloud** موجّه افتراضيًا للتطبيق `1793358824529` ويمكن تغيير رقمه. ارفع `cortex-manager.zip` باستخدام تحديث ملفات التطبيق الحالي أو Commit. لا تُنشئ تطبيقًا آخر بدل التطبيق الذي تريد تحديثه. احتفظ بمجلد `data/` ومتغيرات البيئة في الاستضافة. تُظهر الصفحة متغيرات البيئة المطلوبة بأسمائها، وحالة الحزمة مقارنة بآخر الإعدادات المحفوظة.

## العربية

النشر اليدوي في لوحة ويندوز يجلب ثمنيل منشور Instagram تلقائيًا عند المعاينة، دون اختيار صورة من جهازك. يُقرأ الثمنيل العام من بيانات المنشور ثم يُرفع كصورة مرفقة بعد تأكيدك؛ يلزم Attach Files. إذا كان المنشور خاصًا أو حجب إنستغرام الوصول، تظهر حالة واضحة بأن المعاينة تحتوي رابطًا فقط. الحد الأقصى للصورة 2MB، ولا يُستخدم تسجيل دخول أو كوكيز أو خدمات وسيطة. التنبيهات التلقائية المستضافة تبقى روابط نصية.

هذه خدمة بوت مستقلة للإشعارات والحضور Online. لوحة ويندوز تبقى محلية؛ إغلاق جهازك لا يوقف النسخة المستضافة. لا ترفع برنامج EXE أو توكن ويندوز المحفوظ. لا تشغّل نسختين من خدمة الإشعارات لنفس الإعدادات؛ أوقف اتصال نسخة ويندوز عند الاعتماد على المستضافة.

1. افتح «البثوث والمقاطع» في Cortex Manager. أضف المصادر، اختر غرفة نصية لكل مصدر، واختر لغة الرسالة. تفعيل المصدر يحتاج موافقة على النشر التلقائي. حفظ الإعدادات محلي فقط.
2. نزّل حزمة Discloud من القسم. ZIP يحتوي إعدادات المصادر المحفوظة فقط، بلا توكن أو بيانات جهازك.
3. في https://discloud.com/dashboard/app/create ارفع ZIP كما هو. ملف discloud.config موجود في جذر الأرشيف، النوع bot، الذاكرة 100MB، Node حديث >=22.9. لا يحتاج البوت منفذ ويب.
4. أضف DISCORD_BOT_TOKEN إلى متغيرات بيئة الاستضافة. لا تنشره في GitHub. KICK_CLIENT_ID وKICK_CLIENT_SECRET مطلوبان لـ Kick، عبر تطبيق في https://dev.kick.com . إنستغرام عبر رابط RSS.app XML لا يحتاج توكن Meta. عند استخدام API بدل RSS يحتاج INSTAGRAM_USER_ID وINSTAGRAM_ACCESS_TOKEN لحساب Business/Creator مصرح لتطبيقك بصلاحية instagram_business_basic. لا يدعم مراقبة حسابات شخصية عشوائية. إذا انتهى التوكن جدده في الاستضافة.
5. تأكد أن البوت عضو في السيرفر ويملك View Channel وSend Messages في الغرف المختارة. لا يحتاج Administrator أو صلاحيات طرد أو حظر أو إدارة رتب.
6. شغّل التطبيق في Discloud، وراجع Logs: gateway online، ثم baseline لكل مصدر. الفحص كل دقيقتين تقريبًا، مع إبطاء عند الأخطاء وحدود الطلبات. أول فحص ناجح يتجاهل المحتوى القديم والبث الجاري، ثم يرسل الأحداث الجديدة فقط.
7. تغيير الإعدادات في لوحة ويندوز يتطلب تنزيل ZIP محدث وإعادة رفعه/تحديث ملف config/social-feeds.json في الاستضافة ثم إعادة التشغيل. لا يوجد اتصال تحكم عن بعد أو مزامنة سرية بين الجهاز والاستضافة.

يوتيوب: أدخل رابط قناة YouTube بصيغة /@handle أو اسم @handle أو Channel ID يبدأ بـ UC أو رابط /channel/UC…؛ تُحوّل لوحة ويندوز اسم القناة إلى معرّف ثابت قبل الحفظ؛ يدعم الفيديوهات وShorts عبر RSS الرسمي. بدء البث المباشر على يوتيوب ليس مضمونًا عبر RSS. Kick: تنبيه بدء بث جديد؛ المقاطع تُنشر يدويًا. إنستغرام: منشورات/Reels عبر RSS.app لحساب عام أو API لحساب مهني مصرح؛ ليس تنبيهات البث/Stories.

احفظ مجلد data بين عمليات إعادة التشغيل والتحديث/النقل. يحتوي سجل منع التكرار وآخر محاولة إرسال؛ حذفه يبدأ baseline جديدًا ويؤدي لتجاهل الأحداث الحالية. الحالة unknown تعني عدم إعادة المحاولة تلقائيًا: افحص الغرفة أولًا قبل النشر اليدوي. بعد انقطاع طويل تُنشر أحدث خمسة أحداث جديدة كحد أقصى لكل مصدر، ويُتجاوز الأقدم. المعرفات والسجل محليان للنسخة؛ لا ينسقان نسختين متزامنتين.

الخطة المجانية ليست ضمانًا لـ 24/7؛ قد توقف المنصة تطبيقات غير نشطة. AUTORESTART متاح بحسب الخطة (توثيق Discloud يشترط Platinum فأعلى). راجع متطلبات خطتك قبل الاعتماد على توفر دائم. هذه الحزمة لا تطلب اشتراكًا ولا تنشر شيئًا بمجرد تنزيلها.

## English

### TikTok

TikTok is available as a source and for manual video/live-link sharing. Automatic notifications cover newly published public videos from the account authorized by TIKTOK_ACCESS_TOKEN, with video.list permission and an approved TikTok Display API application. The configured @username must match the returned videos' official share URLs. Refresh expired tokens at the host; no credentials are stored in the desktop social configuration. Live-start detection is not supported. Official reference: https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list

تيك توك: أضف اسم الحساب أو رابط tiktok.com/@username. الإشعارات التلقائية للمقاطع الجديدة تحتاج TIKTOK_ACCESS_TOKEN لحساب مصرح لتطبيق Display API مع صلاحية video.list. الاسم يجب أن يطابق صاحب المقاطع. جدّد التوكن عند انتهاء صلاحيته في الاستضافة. روابط المقاطع والبث تُنشر يدويًا بمعاينة وتأكيد؛ لا توجد تنبيهات بدء بث تلقائية.

This is a standalone background bot, not the Windows control panel. Upload the exported ZIP at https://discloud.com/dashboard/app/create, keep discloud.config at the archive root, and set DISCORD_BOT_TOKEN in hosting environment variables. Node >=22.9 is required; no web port or desktop credentials are used. Run only one notification instance for this configuration.

Configure sources and text destinations in the desktop Social section; save with explicit automatic-posting consent, then export. Desktop edits are local: upload a fresh configuration and restart the hosted bot to apply them. Manual posts use the existing desktop preview and confirmation flow and require the desktop connection.

- YouTube: official channel RSS; the desktop accepts /@handle URLs, @handles or UC channel IDs and resolves handles before saving. New videos/Shorts; live-start detection is not guaranteed.
- Kick: official API live-start notifications; requires KICK_CLIENT_ID and KICK_CLIENT_SECRET from your Kick developer application. Clips can be posted manually.
- Instagram: public account posts/Reels through a configured rssURL from RSS.app (no Meta credentials), or an authorized Business/Creator account using INSTAGRAM_USER_ID and INSTAGRAM_ACCESS_TOKEN with instagram_business_basic. Posts/Reels only, not arbitrary personal accounts, Stories or live streams. Refresh expiring credentials at the host.

Grant the Discord bot View Channel and Send Messages in selected text/announcement channels. Administrator is unnecessary. Social-only configurations need no member intents. No moderation operations or server redesign actions run in the hosted service. All outbound mentions are disabled.

Polling is sequential, roughly every two minutes, with provider backoff. The first successful fetch records a baseline without sending existing items, including an already-live stream. Keep data/social-deliveries.json across restarts and deployments. Each message is durably reserved before sending; uncertain attempts are not retried. Check Discord before manually reposting an unknown delivery. Catch-up is capped at the newest five events per source. State is per instance, not a distributed lock; never deploy two copies for the same destinations.

The free plan does not guarantee uninterrupted operation. Check current Discloud plan limits; automatic restart requires a supported plan. Downloading the package performs no deployment and sends no Discord messages.

Official references:

- https://docs.discloud.com/en/configurations/discloud.config
- https://docs.discloud.com/en/how-to-host
- https://docs.discloud.com/en/faq/troubleshooting-solutions/diagnosing-offline-applications
- https://developers.google.com/youtube/data/guides/push_notifications
- https://docs.kick.com/apis/channels
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/

### Instagram RSS.app

Use the direct https://rss.app/feeds/FEED_ID.xml URL, not an rssviewer.app page. Configure it using the RSS button beside the Instagram source, then export and update the existing hosted app. The feed must identify the configured Instagram account. RSS.app is an external service: check its trial/subscription and refresh limits; delivery timing depends on its updates. Existing items establish a silent baseline; only later items are posted. Automatic notifications contain text and the original post link. Keep data/social-deliveries.json and existing environment variables when updating.

لربط حساب عام، افتح زر RSS بجانب مصدر Instagram وأدخل رابط XML المباشر، ثم صدّر الحزمة وحدّث التطبيق المستضاف الحالي. تعتمد سرعة التنبيهات على تحديث RSS.app واستمرار خطته أو اشتراكه؛ لا تتجاوز هذه الميزة انتهاء التجربة. أول فحص يسجّل الموجود دون نشره. احتفظ بمجلد data ومتغيرات البيئة عند التحديث.

### Startup recovery

The entry point installs process error handlers before loading application modules and prints the full error/stack with `console.error`. Missing optional settings use empty disabled configurations. Missing state files are created automatically; empty or corrupt state is moved to a `.corrupt-<id>` backup before safe defaults are written. The active files are `data/social-deliveries.json`, `data/tickets.json`, `data/welcome-deliveries.json` and `data/kick-deliveries.json`; legacy `data/social.json` and `data/welcome.json` are migrated if the active file is missing. A recovered social state establishes a fresh silent baseline. Retain the backups to recover existing ticket records if needed. If storage cannot be recovered, only that feature is disabled instead of sending with volatile state.

Ticket command registration runs in the background and retries after failures. A missing required Discord token or another startup failure logs its cause and waits 120 seconds before retrying; it does not claim that the bot is connected. Run `node scripts/smoke-discloud.mjs` after building to launch the actual entry point from extracted ZIP copies in six startup scenarios, using a fake Gateway and blocking outbound requests. This verifies startup on the local Node runtime, not production credentials or Linux native rendering.

تُنشأ ملفات الحالة المفقودة تلقائياً، وتُحفظ الملفات الفارغة أو التالفة كنسخ `.corrupt-<id>` قبل إنشاء حالة افتراضية آمنة. فشل تسجيل أوامر التذاكر لا يوقف الإقلاع. غياب توكن Discord المطلوب يظهر في السجل مع إعادة المحاولة، ولا يعني نجاح الاتصال.

### Host-requested shutdown

The exported discloud.config starts Node directly (START=node --env-file-if-exists=.env src/hosted-bot.mjs); npm start remains available for local use. A host SIGINT/SIGTERM logs lifecycle stopping/stopped with its exitCode. Exit code 0 means that requested shutdown completed; it does not prove who sent the signal. Terminal Gateway failures stop the session, log the diagnostic code and schedule another startup attempt. If Commit retains the existing start command, review START in the hosting settings to apply the exported command. A dashboard crash label alone cannot identify a code defect: inspect the preceding runtime logs, exit code and memory metrics.

## Welcome and farewell / الترحيب والمغادرة

Open Welcome & farewell in the Windows app, select a text channel for each event, edit its title/message/color and review the local card. {user} inserts the member name and {server} the server name. Use the preset button for Arabic/English text. Confirm saving automatic messages, export the package and update the existing Discloud app. Unsaved edits are not exported. No additional environment variable is needed. Enable Server Members Intent under Developer Portal → your Discord application → Bot before deploying enabled welcome settings. The hosted Gateway requests GUILDS + GUILD_MEMBERS when membership notifications are enabled, and additionally GUILD_MODERATION for enabled kick notifications; desktop presence keeps zero intents. If Discord closes with 4014, check that privileged intent.

Requires View Channel, Send Messages and Embed Links in the selected rooms. Actual messages include the available Discord member avatar. No live test is sent by the preview. Only future GUILD_MEMBER_ADD/REMOVE events trigger delivery; startup member lists are ignored, bot accounts are skipped when identified, and farewell does not claim whether someone left voluntarily, was kicked or banned. Dedupe reserves events before sending; uncertain deliveries are not retried. Keep data/welcome-deliveries.json across updates. Run only one instance with welcome enabled. Existing social notifications remain independent.

من قسم «الترحيب والمغادرة» اختر الغرف وخصّص العنوان والنص واللون. {user} لاسم العضو و{server} لاسم السيرفر. المعاينة محلية ولا ترسل شيئًا. بعد الموافقة والحفظ نزّل الحزمة وحدّث تطبيق Discloud الحالي. قبل التفعيل افتح Discord Developer Portal ثم تطبيق البوت ثم Bot وفعّل Server Members Intent. لا تحتاج متغيرات بيئة جديدة أو Administrator؛ يلزم عرض الغرفة وإرسال الرسائل وتضمين الروابط Embed Links. الرسائل الفعلية تعرض صورة العضو إذا توفرت. يُسجل الخروج برسالة محايدة دون تحديد سبب المغادرة. احتفظ بملف data/welcome-deliveries.json ولا تشغّل نسختين مفعّلتين للترحيب.

Reference: https://docs.discord.com/developers/events/gateway#privileged-intents

Welcome editor: each card has its own Arabic/English template selector; replacing custom text requires confirmation. Refresh channels reloads the selected server without discarding the message draft. Destinations include text/announcement channels and the text chat within voice channels (Connect is additionally required for voice). No voice audio is played.

### Custom background cards

Welcome/farewell can use a PNG card rendered on the bot with a per-server uploaded background, title/text colors and adjustable dark overlay. Choose the image design, preview the final image, then save and export. The package bundles the normalized background, OFL Arabic/emoji fonts and the pinned @napi-rs/canvas dependency; npm install on Discloud installs its Linux binary (do not upload Windows node_modules). Actual cards include the member avatar when the official Discord CDN returns a bounded PNG; otherwise initials are used. Requires Attach Files and Embed Links. Long titles/descriptions are shortened to fit the card; the attachment description includes the message for accessibility. If rendering or attachment permission fails, the bot reports a safe warning and sends the regular embed. Fonts/licenses are under assets/welcome. Preview sends no Discord messages. Native renderer memory varies by host; monitor actual usage after enabling.

البطاقة المصوّرة تستخدم الخلفية المرفقة مع لون مستقل للعنوان والنص وتعتيم قابل للتعديل. اختر نمط الصورة ثم «معاينة الصورة النهائية»، واحفظ قبل تصدير الحزمة. يتضمن التصدير الصورة والخطوط والتراخيص واعتماد الرسم؛ الاستضافة تثبّت نسخة Linux تلقائيًا. لا ترفع node_modules من ويندوز. يلزم Attach Files وEmbed Links. النص الطويل يختصر ليناسب الصورة، وإذا تعذر الرسم يظهر تحذير ويُرسل التصميم العادي.

### Per-server image library and portable names

The welcome editor accepts PNG/JPEG/WebP/GIF uploads up to 8MB and 16 megapixels; animated files use their decoded still frame. Images are normalized to a 1200x510 JPEG and stored in the local per-server library under out/desktop-modern/welcome-images. Duplicate uploads reuse the same image. Only selected images are exported, under assets/welcome/backgrounds; unused history is kept locally. Delete requires confirmation and is blocked while saved settings use that image. The old fixed background is no longer bundled. A solid background is available without any image. Back up your local library if moving the desktop app to another PC.

Arabic, Latin and emoji fonts are bundled with OFL licenses. Names with mathematical/stylized alphabet characters are normalized to equivalent readable letters inside the PNG (NFKC); Discord names themselves are not changed. Rebuild the hosted app after uploading the new package to install dependencies, then test a future member event.

### Readable Discord image layout

Image welcome/farewell cards use a compact 1000x440 canvas with larger title/body text and vertical placement based on the wrapped lines. They are sent as direct PNG attachments, without an additional image Embed wrapper; the regular Embed remains only a fallback. This removes the extra colored outer strip while keeping the user-selected border within the image. Existing posted messages are not edited.

## Quick local package command

Save your settings in the desktop app, then run `npm run discloud:build` from the project folder. The command validates saved settings and hosted JavaScript, packages selected background images, and writes `out/discloud/cortex-manager.zip` plus a nonsecret verification report. It reads no saved token and performs no network requests or deployment. Existing sources and welcome configurations for all saved servers are included.

Upload the ZIP through **Commit** on the existing Discloud application. Preserve environment variables and the persistent `data/` directory. Kick requires `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET` in addition to `DISCORD_BOT_TOKEN`. Welcome events require Server Members Intent. New streams are checked every two minutes; the first successful check establishes a silent baseline, so an already-running stream is not announced as new. Local validation and mocked tests do not verify production credentials or actual Discord delivery.

## Confirmed kick notifications

In Welcome & farewell, enable Kick notifications, choose a private staff text/announcement channel and select Arabic or English. Save explicitly, export a fresh package and deploy to the existing app. Existing settings default to disabled; no room is selected automatically. Grant View Audit Log plus View Channel, Send Messages and Embed Links in the chosen channel. Keep Server Members Intent enabled. Kick Members and Administrator are unnecessary.

Only future Discord audit Gateway events with action type MEMBER_KICK produce the report: member, acting moderator, recorded reason and event time. Failed user lookups fall back to the numeric ID; absent actors are shown as unavailable. Bans and voluntary departures are never labelled as kicks. This is logging only and cannot kick or ban anyone. The ordinary farewell waits up to 2.5 seconds for a matching audit event; unusually late audit events can still produce both messages.

Keep data/kick-deliveries.json with the existing data files across updates. Durable reservations and nonces avoid replaying confirmed or uncertain sends. Run one hosted notification instance. Missing permissions are reported as kick-log warnings; no permissions are granted automatically. No new environment variables are required.

العربي: فعّل «إشعارات الطرد» وحدد غرفة للإدارة ولغة الإشعار ثم احفظ وصدّر حزمة جديدة وارفعها إلى التطبيق الحالي. يلزم View Audit Log وصلاحيات إرسال الرسالة في الغرفة. لا تحتاج صلاحية الطرد. يظهر منفذ الطرد والسبب فقط من حدث سجل التدقيق المؤكد؛ لا ينسب البوت المغادرة العادية لشخص بالتخمين.

Kick notifications now send a PNG using the same server farewell background and text colors, with a red frame and separate member/moderator/reason rows. Grant Attach Files. Long visual rows are shortened; the full recorded reason (up to the supported 1000-character input bound), actor IDs and event time accompany the attachment as text. Missing attachment permission or rendering failure falls back to the existing structured Embed. Preview images use fictional examples and never post to Discord. Export and redeploy after updating.

## Support tickets

طلبات الدعم تبدأ من قناة طلب المساعدة المحددة في البرنامج فقط. يعرض `/ticket` أو زر اللوحة اختيار العربية أو الإنجليزية بشكل خاص للعضو، ثم نموذج الجنس والعمر وموضوع المشكلة وتفاصيلها. تُنشأ التذكرة داخل القسم المحدد وتتابع باللغة المختارة. نشر اللوحة بأمر `/ticket-panel` يتطلب تشغيل الأمر داخل قناة الطلبات نفسها. بعد رفع التحديث أعد فتح أي نموذج قديم؛ خطوات اختيار اللغة تنتهي بعد عشر دقائق أو عند إعادة تشغيل البوت. احتفظ بملف `data/tickets.json`، فهو يتضمن أيضًا لغة وبيانات التذاكر الخاصة، ولا تضعه داخل حزمة التحديث.

Configure and save **Support tickets** in the desktop app before exporting. The package includes `config/tickets.json` and registers `/ticket`, `/ticket-panel`, `/ticket-claim`, `/ticket-close` and `/ticket-resolve` on startup for enabled servers. The bot must be installed with the `bot` and `applications.commands` scopes. No privileged intents are needed for tickets alone. A configured support role or the actual server owner can run `/ticket-panel` to publish the button in the selected request channel. The bot needs Manage Channels, Manage Roles, View Channel, Send Messages, Embed Links and Read Message History. To ping support roles, make them mentionable or grant the relevant mention permission.

Ticket cards are red while waiting, yellow when a staff member claims them and green after explicit resolution confirmation. The same card records who claimed the ticket and who confirmed resolution. Read Message History allows the bot to preserve the original issue while editing its own status card. Preserve `data/tickets.json` to retain message IDs and staff assignments across updates. Existing open cards are upgraded on the next staff action; older closed records do not gain invented resolution metadata.

Keep `data/tickets.json` across deployments and run one instance only. Do not run the local ticket connection simultaneously with the hosted bot. Settings changes require a fresh export/deployment. Ticket close preserves the channel and conversation; this feature does not delete channels or export transcripts.
