<div dir="rtl" align="center">

<img src="assets/logo.png" alt="شعار كنانة" width="128" height="128" />

# كِنانة (Kinana)

**مدير كلمات مرور محلي وآمن لسطح المكتب**

مبني بلغة Rust وإطار العمل Tauri 2 مع واجهة React.

[![GitHub Release](https://img.shields.io/github/v/release/A-ALOSIME/kinana?style=flat-square)](https://github.com/A-ALOSIME/kinana/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/A-ALOSIME/kinana/ci.yml?branch=main&style=flat-square)](https://github.com/A-ALOSIME/kinana/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

[English](README.md) | [العربية](README.ar.md)

</div>

---

<div dir="rtl">

كنانة هو تطبيق مكتبي سريع ومستقل لإدارة كلمات المرور والبيانات الحساسة، مصمم لحماية الخصوصية والأمان الفائق. يعمل التطبيق محلياً بالكامل على جهازك ويشفر جميع البيانات بخوارزميتي AES-256-GCM و Argon2id دون أي اتصال بخوادم سحابية أو جمع لأي بيانات أو إحصائيات.

---

## تنزيل التطبيق

حمّل أحدث إصدار مخصص لنظام تشغيلك:

| نظام التشغيل | المعمارية | صيغة الحزمة | رابط التنزيل | الحالة |
|---|---|---|---|---|
| **ويندوز (Windows)** | x86_64 (64-bit) | مثبت NSIS (`.exe`) | [kinana-windows-x64-setup.exe](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-windows-x64-setup.exe) | مستقر (Stable) |
| **ماك (macOS)** | معالجات Apple Silicon (M1/M2/M3/M4) | صورة قرص (`.dmg`) | [kinana-macos-arm64.dmg](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-arm64.dmg) | تجريبي (Preview) |
| **ماك (macOS)** | معالجات Intel (x86_64) | صورة قرص (`.dmg`) | [kinana-macos-x64.dmg](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-x64.dmg) | تجريبي (Preview) |
| **لينكس (Linux)** | x86_64 | حزمة دبيان / أوبونتو (`.deb`) | [kinana-linux-x64.deb](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-linux-x64.deb) | تجريبي (Preview) |
| **لينكس (Linux)** | x86_64 | حزمة مستقلة شاملة (`.AppImage`) | [kinana-linux-x64.AppImage](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-linux-x64.AppImage) | تجريبي (Preview) |

للتحقق من سلامة وصحة الملفات المحملة، يمكنك مطابقة بصمة SHA-256 عبر ملف البصمات الرسمي:  
[SHA256SUMS.txt](https://github.com/A-ALOSIME/kinana/releases/latest/download/SHA256SUMS.txt)

> ملاحظة: إصدارات نظامي ماك ولينكس مصنفة حالياً كإصدارات تجريبية (Preview). للاطلاع على إرشادات التثبيت وتجاوز تنبيهات Windows SmartScreen أو Gatekeeper على ماك، يرجى مراجعة [دليل التثبيت](docs/installation.md).

---

## أبرز المزايا

- **محلي بالكامل (100% Offline)**: لا يعتمد التطبيق على أي خوادم سحابية، ولا يفتح أي منافذ شبكية، ولا يرسل أي بيانات إلى الخارج. تظل بياناتك ومفاتيح تشفيرك على جهازك الشخصي فقط.
- **تشفير قياسي متين**: تشفير البيانات بالكامل باستخدام AES-256-GCM واشتقاق المفاتيح عبر Argon2id بمعايير أمان عالية لسطح المكتب (64 ميجابايت ذاكرة، 3 تكرارات، 4 خيوط معالجة).
- **مفتاح استرداد الطوارئ**: توليد مفتاح استرداد مشفر غير متصل بالإنترنت أثناء إنشاء الخزنة، للتمكن من استعادة بياناتك في حال نسيان كلمة المرور الرئيسية.
- **واجهة عربية أصيلة**: تصميم عصري داكن يدعم الاتجاه من اليمين إلى اليسار (RTL) مع خط ثمانية، بالإضافة إلى دعم الواجهة باللغة الإنجليزية.
- **إدارة الحسابات والبطاقات البنكية**: إدارة تفاصيل المواقع والخدمات والبطاقات المصرفية (مدى، فيزا، ماستركارد) مع حقول مموهة قابلة للكشف والنسخ بنقرة واحدة.
- **قفل تلقائي ذكي عند الخمول**: قفل الخزنة تلقائياً بعد فترة عدم استخدام تحددها حسب رغبتك، مع تعليق المؤقت تلقائياً أثناء الكتابة النشطة لتفادي فقدان البيانات.
- **دفتر معاملات آمن ضد الانهيار**: يعتمد التطبيق على نظام دفتر معاملات ذري (Write-Ahead Journal) يحمي الخزنة من التلف في حالات انقطاع الطاقة المفاجئ أو إغلاق النظام غير المتوقع.
- **كفاءة واستهلاك خفيف للموارد**: نواة مكتوبة بلغة Rust مع نظام إخلاء الذاكرة الخاملة التلقائي على ويندوز، مما يهبط باستهلاك الرام في الخلفية إلى قرابة 42 ميجابايت فقط.
- **تصدير واستيراد مشفر**: إمكانية إنشاء نسخ احتياطية محمولة بصيغة `.dat` مشفرة لنقل الخزنة بأمان بين أجهزتك المختلفة دون الحاجة للإنترنت.

---

## إرشادات التثبيت السريعة

### ويندوز (Windows)
1. حمّل المثبت [kinana-windows-x64-setup.exe](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-windows-x64-setup.exe).
2. شغّل ملف التثبيت. إذا ظهر تنبيه Windows SmartScreen، اضغط على **More info** ثم **Run anyway** (كنانة مشروع مفتوح المصدر مستقل ولا يستخدم شهادات EV تجارية باهظة).
3. اتبع معالج التثبيت لإتمام العملية.

### ماك (macOS - تجريبي)
1. حمّل ملف `.dmg` المتوافق مع معالج جهازك ([Apple Silicon](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-arm64.dmg) أو [Intel](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-x64.dmg)).
2. افتح صورة القرص واسحب أيقونة **Kinana** إلى مجلد **Applications**.
3. عند التشغيل لأول مرة، انقر بزر الفأرة الأيمن على التطبيق في Finder واختر **Open**، أو نفّذ الأمر التالي في Terminal:
   ```bash
   xattr -cr /Applications/kinana.app
   ```

### لينكس (Linux - تجريبي)
- **أنظمة دبيان وأوبونتو**:
  ```bash
  sudo apt install ./kinana-linux-x64.deb
  ```
- **حزمة AppImage المستقلة**:
  ```bash
  chmod +x kinana-linux-x64.AppImage
  ./kinana-linux-x64.AppImage
  ```

للاطلاع على التعليمات الكاملة، راجع [دليل التثبيت](docs/installation.md).

---

## الوثائق والأدلة التقنية

- [دليل التثبيت (Installation Guide)](docs/installation.md) - تعليمات التثبيت وحل المشكلات لجميع المنصات.
- [دليل البدء السريع (Getting Started)](docs/getting-started.md) - الإعداد لأول مرة، إضافة الحسابات، ومفتاح الاسترداد.
- [معمارية الأمان والتهديدات (Security Architecture)](docs/security.md) - خوارزميات التشفير، بنية ملف الخزنة، ونموذج التهديدات.
- [الأسئلة الشائعة (FAQ)](docs/faq.md) - إجابات الأسئلة المتكررة حول الأمان والاستخدام.
- [الأداء وقياسات الموارد (Performance & Benchmarks)](docs/benchmarks.md) - قياسات استهلاك الذاكرة وتخفيف الحزم.
- [سجل التغييرات (Changelog)](CHANGELOG.md) - تاريخ الإصدارات وسجل التحديثات.

---

## البناء من المصدر (Building from Source)

### المتطلبات الأساسية
- [Rust](https://www.rust-lang.org/tools/install) (الإصدار المستقر Stable)
- [Node.js](https://nodejs.org/) (الإصدار 18 أو أحدث) مع مدير الحزم `npm`
- أدوات البناء البرمجية الخاصة بنظامك (Visual Studio Build Tools على ويندوز، أو أدوات Xcode على ماك، أو `build-essential` على لينكس)

### خطوات البناء

1. استنساخ المستودع:
   ```bash
   git clone https://github.com/A-ALOSIME/kinana.git
   cd kinana
   ```

2. تثبيت حزم الواجهة الأمامية:
   ```bash
   cd ui
   npm install
   cd ..
   ```

3. التشغيل في وضع التطوير:
   ```bash
   npm --prefix ui run dev
   ```

4. تجميع النسخة النهائية للمنصة الحالية:
   ```bash
   npm --prefix ui run build
   cargo tauri build
   ```

---

## الإبلاغ عن الثغرات الأمنية

نولي أمان وخصوصية البيانات الأولوية القصوى. في حال اكتشافك لأي ثغرة أمنية، يرجى الإبلاغ عنها بسرية ومسؤولية باتباع الإرشادات الموضحة في [SECURITY.md](SECURITY.md)، وعدم فتح بلاغ عام على GitHub Issues.

---

## المساهمة في المشروع

نرحب بمساهمات المطورين واقتراحات التحسين والتبليغ عن الأخطاء البرمجية. يرجى قراءة [CONTRIBUTING.md](CONTRIBUTING.md) قبل فتح أي طلب سحب (Pull Request).

---

## الترخيص

هذا المشروع مرخص تحت رخصة [MIT](LICENSE).

</div>
