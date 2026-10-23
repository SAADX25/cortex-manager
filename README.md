# Cortex Manager — Discord server layout, GitHub Actions

مجلد جاهز لإنشاء رومات Discord ورتب ملونة مرة واحدة، بدون استضافة دائمة.

## الإعداد

1. أضف بوت Cortex Manager إلى السيرفر مع الصلاحيات التالية: **Manage Channels, Manage Roles, View Channels, Send Messages**.
2. من GitHub repository > **Settings > Secrets and variables > Actions > Secrets** أضف **Repository secret** باسم `DISCORD_BOT_TOKEN` وقيمته التوكن من Discord Developer Portal > Bot. لا تضعه في الكود أو في رسالة لأي شخص.
3. من نفس صفحة GitHub > **Variables** أضف **Repository variable** باسم `DISCORD_GUILD_ID` وقيمته Server ID. للحصول عليه فعّل Developer Mode في Discord، ثم انقر يمينًا على السيرفر > Copy Server ID.
4. ارفع **محتويات هذا المجلد** (بما فيها المجلد المخفي `.github/workflows`) إلى **جذر المستودع** على الفرع الافتراضي main.
5. انتقل إلى **Actions > Cortex Manager - Setup Discord Server > Run workflow**. اختر `preview` أولًا ثم افتح الـrun واقرأ logs في خطوة **Preview or apply server layout**.
6. بعد مراجعة الأسماء والألوان، شغّل workflow مرة ثانية واختر `apply` لإنشاء العناصر الناقصة.

## تخصيص التصميم

عدّل `server-layout.json` **قبل** اختيار apply؛ فيه الرتب والألوان والتصنيفات والرومات النصية والصوتية. أسماء الألوان Hex مثل `#3498DB`. هذا التصميم مجرد بداية ويمكن تعديله ليناسب سيرفرك.

## ما الذي يفعله؟

- `preview` يعرض قائمة الإنشاءات المطلوبة **دون أي تعديل**.
- `apply` ينشئ العناصر المفقودة فقط، ويتجاوز أي عنصر موجود بالفعل بالاسم والنوع؛ لا يحذف ولا ينقل ولا يغير العناصر الموجودة.
- كل الرتب الجديدة تبدأ بـ**صلاحيات صفر** حفاظاً على أمان السيرفر؛ الأسماء والألوان والتصنيف البصري فقط، وليست رتب إدارة جاهزة.
- يحتفظ بالحد الأدنى من الصلاحيات المطلوبة، ويدير Discord عبر REST API، لذلك **لن يصبح البوت Online دائماً**؛ لا داعي لاستضافة طويلة المدى لهذه المهمة.
- لا يحذف أو يعدّل الرومات/الرتب الموجودة، ولا يوزّع الرتب على الأعضاء.

## حل مشكلات شائعة

- 401: توكن غير صحيح أو تم تجديده؛ حدّث GitHub secret.
- 403: البوت لم ينضم للسيرفر أو تنقصه صلاحيات Manage Channels / Manage Roles؛ تحقق من رتبته داخل Discord.
- 404: Server ID غير صحيح أو البوت ليس عضواً في السيرفر.
- Workflow غير ظاهر؟ تأكد من وجود الملف `.github/workflows/discord-setup.yml` في الفرع الافتراضي.

## أمن

مهم: لا تضع Token ضمن ملفات المشروع أو commit. ملفات هذا المشروع لا تطلب صلاحية Administrator ولا تنشئ رتباً بصلاحيات إدارية.
