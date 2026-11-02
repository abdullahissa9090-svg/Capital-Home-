# إعداد نظام صور العقارات

## 1) توكن GitHub (مرة واحدة)
GitHub ← Settings ← Developer settings ← Personal access tokens ← **Fine-grained tokens** ← Generate:
- Repository access: **Only select repositories** ← Capital-Home- بس
- Permissions: **Contents = Read and write** (والباقي سيبه)
- انسخ التوكن (بيظهر مرة واحدة).

## 2) Environment Variables على Vercel
Project ← Settings ← Environment Variables (علّم Production و Preview):
| الاسم | القيمة |
|---|---|
| ADMIN_PASSWORD | كلمة سر قوية (8+ حروف) |
| SESSION_SECRET | نص عشوائي طويل (32+ حرف) |
| GITHUB_TOKEN | التوكن من الخطوة 1 |
| GITHUB_REPO | abdullahissa9090-svg/Capital-Home- |
| GITHUB_BRANCH | main  (للتجربة: اسم فرع تجريبي) |
بعد الإضافة اعمل Redeploy.

## 3) التجربة على Preview قبل الموقع الحي
1. اعمل فرع اسمه `photos-test` على GitHub وارفع عليه كل الملفات.
2. على Vercel هيطلع Preview Deployment للفرع.
3. حط `GITHUB_BRANCH=photos-test` في متغيرات الـ Preview بس.
4. افتح `<رابط-الـPreview>/admin` وجرّب على عقار، وتأكد إن الصور بتظهر بعد النشر.
5. لما تتأكد: ادمج الفرع في main.

## 4) الاستخدام من الموبايل
افتح `capital-home.vercel.app/admin` ← ادخل ← اكتب كود العقار واضغط "تحقق" ← اختار الصور ← رتّب/امسح ← "حفظ الصور". الصور بتظهر بعد ما فيرسل يخلّص النشر (أقل من دقيقتين).
لو الرفع فشل دوس "إعادة المحاولة" (اللي اترفع مش بيترفع تاني).

## ملاحظات
- كل حفظ بيعمل commit واحد (الصور + photo-gallery.json). الصور القديمة بتفضل في GitHub (مبتتمسحش).
- لو عقار ملوش معرض، بيعرض صورته القديمة زي ما هي.
- حماية إضافية للدخول: فعّل Rate Limiting من Vercel Firewall على /api/admin/login.
