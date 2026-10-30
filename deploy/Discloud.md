# Cortex Social Bot — Discloud

## العربية

النشر اليدوي في لوحة ويندوز يجلب ثمنيل منشور Instagram تلقائيًا عند المعاينة، دون اختيار صورة من جهازك. يُقرأ الثمنيل العام من بيانات المنشور ثم يُرفع كصورة مرفقة بعد تأكيدك؛ يلزم Attach Files. إذا كان المنشور خاصًا أو حجب إنستغرام الوصول، تظهر حالة واضحة بأن المعاينة تحتوي رابطًا فقط. الحد الأقصى للصورة 2MB، ولا يُستخدم تسجيل دخول أو كوكيز أو خدمات وسيطة. التنبيهات التلقائية المستضافة تبقى روابط نصية.

هذه خدمة بوت مستقلة للإشعارات والحضور Online. لوحة ويندوز تبقى محلية؛ إغلاق جهازك لا يوقف النسخة المستضافة. لا ترفع برنامج EXE أو توكن ويندوز المحفوظ. لا تشغّل نسختين من خدمة الإشعارات لنفس الإعدادات؛ أوقف اتصال نسخة ويندوز عند الاعتماد على المستضافة.

1. افتح «البثوث والمقاطع» في Cortex Manager. أضف المصادر، اختر غرفة نصية لكل مصدر، واختر لغة الرسالة. تفعيل المصدر يحتاج موافقة على النشر التلقائي. حفظ الإعدادات محلي فقط.
2. نزّل حزمة Discloud من القسم. ZIP يحتوي إعدادات المصادر المحفوظة فقط، بلا توكن أو بيانات جهازك.
3. في https://discloud.com/dashboard/app/create ارفع ZIP كما هو. ملف discloud.config موجود في جذر الأرشيف، النوع bot، الذاكرة 100MB، Node حديث >=22.4. لا يحتاج البوت منفذ ويب.
4. أضف DISCORD_BOT_TOKEN إلى متغيرات بيئة الاستضافة. لا تنشره في GitHub. KICK_CLIENT_ID وKICK_CLIENT_SECRET مطلوبان لـ Kick، عبر تطبيق في https://dev.kick.com . إنستغرام يحتاج INSTAGRAM_USER_ID وINSTAGRAM_ACCESS_TOKEN لحساب Business/Creator مصرح لتطبيقك بصلاحية instagram_business_basic. لا يدعم مراقبة حسابات شخصية عشوائية. إذا انتهى التوكن جدده في الاستضافة.
5. تأكد أن البوت عضو في السيرفر ويملك View Channel وSend Messages في الغرف المختارة. لا يحتاج Administrator أو صلاحيات طرد أو حظر أو إدارة رتب.
6. شغّل التطبيق في Discloud، وراجع Logs: gateway online، ثم baseline لكل مصدر. الفحص كل دقيقتين تقريبًا، مع إبطاء عند الأخطاء وحدود الطلبات. أول فحص ناجح يتجاهل المحتوى القديم والبث الجاري، ثم يرسل الأحداث الجديدة فقط.
7. تغيير الإعدادات في لوحة ويندوز يتطلب تنزيل ZIP محدث وإعادة رفعه/تحديث ملف config/social-feeds.json في الاستضافة ثم إعادة التشغيل. لا يوجد اتصال تحكم عن بعد أو مزامنة سرية بين الجهاز والاستضافة.

يوتيوب: أدخل Channel ID يبدأ بـ UC أو رابط /channel/UC…؛ يدعم الفيديوهات وShorts عبر RSS الرسمي. بدء البث المباشر على يوتيوب ليس مضمونًا عبر RSS. Kick: تنبيه بدء بث جديد؛ المقاطع تُنشر يدويًا. إنستغرام: منشورات/Reels للحساب المهني المصرح فقط؛ ليس تنبيهات البث/Stories.

احفظ مجلد data بين عمليات إعادة التشغيل والتحديث/النقل. يحتوي سجل منع التكرار وآخر محاولة إرسال؛ حذفه يبدأ baseline جديدًا ويؤدي لتجاهل الأحداث الحالية. الحالة unknown تعني عدم إعادة المحاولة تلقائيًا: افحص الغرفة أولًا قبل النشر اليدوي. بعد انقطاع طويل تُنشر أحدث خمسة أحداث جديدة كحد أقصى لكل مصدر، ويُتجاوز الأقدم. المعرفات والسجل محليان للنسخة؛ لا ينسقان نسختين متزامنتين.

الخطة المجانية ليست ضمانًا لـ 24/7؛ قد توقف المنصة تطبيقات غير نشطة. AUTORESTART متاح بحسب الخطة (توثيق Discloud يشترط Platinum فأعلى). راجع متطلبات خطتك قبل الاعتماد على توفر دائم. هذه الحزمة لا تطلب اشتراكًا ولا تنشر شيئًا بمجرد تنزيلها.

## English

### TikTok

TikTok is available as a source and for manual video/live-link sharing. Automatic notifications cover newly published public videos from the account authorized by TIKTOK_ACCESS_TOKEN, with video.list permission and an approved TikTok Display API application. The configured @username must match the returned videos' official share URLs. Refresh expired tokens at the host; no credentials are stored in the desktop social configuration. Live-start detection is not supported. Official reference: https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list

تيك توك: أضف اسم الحساب أو رابط tiktok.com/@username. الإشعارات التلقائية للمقاطع الجديدة تحتاج TIKTOK_ACCESS_TOKEN لحساب مصرح لتطبيق Display API مع صلاحية video.list. الاسم يجب أن يطابق صاحب المقاطع. جدّد التوكن عند انتهاء صلاحيته في الاستضافة. روابط المقاطع والبث تُنشر يدويًا بمعاينة وتأكيد؛ لا توجد تنبيهات بدء بث تلقائية.

This is a standalone background bot, not the Windows control panel. Upload the exported ZIP at https://discloud.com/dashboard/app/create, keep discloud.config at the archive root, and set DISCORD_BOT_TOKEN in hosting environment variables. Node >=22.4 is required; no web port or desktop credentials are used. Run only one notification instance for this configuration.

Configure sources and text destinations in the desktop Social section; save with explicit automatic-posting consent, then export. Desktop edits are local: upload a fresh configuration and restart the hosted bot to apply them. Manual posts use the existing desktop preview and confirmation flow and require the desktop connection.

- YouTube: official channel RSS, UC channel ID required. New videos/Shorts; live-start detection is not guaranteed.
- Kick: official API live-start notifications; requires KICK_CLIENT_ID and KICK_CLIENT_SECRET from your Kick developer application. Clips can be posted manually.
- Instagram: authorized Business/Creator account only, using INSTAGRAM_USER_ID and INSTAGRAM_ACCESS_TOKEN with instagram_business_basic. Posts/Reels only, not arbitrary personal accounts, Stories or live streams. Refresh expiring credentials at the host.

Grant the Discord bot View Channel and Send Messages in selected text/announcement channels. Administrator is unnecessary. No member intents, moderation operations or server redesign actions run in the hosted service. All outbound mentions are disabled.

Polling is sequential, roughly every two minutes, with provider backoff. The first successful fetch records a baseline without sending existing items, including an already-live stream. Keep data/social-deliveries.json across restarts and deployments. Each message is durably reserved before sending; uncertain attempts are not retried. Check Discord before manually reposting an unknown delivery. Catch-up is capped at the newest five events per source. State is per instance, not a distributed lock; never deploy two copies for the same destinations.

The free plan does not guarantee uninterrupted operation. Check current Discloud plan limits; automatic restart requires a supported plan. Downloading the package performs no deployment and sends no Discord messages.

Official references:
- https://docs.discloud.com/en/configurations/discloud.config
- https://docs.discloud.com/en/how-to-host
- https://docs.discloud.com/en/faq/troubleshooting-solutions/diagnosing-offline-applications
- https://developers.google.com/youtube/data/guides/push_notifications
- https://docs.kick.com/apis/channels
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/
