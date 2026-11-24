# إعداد تسجيل طلبات العملاء (Leads)

الفورم "لم تجد عقارك؟" بيفتح واتساب زي ما هو، وكمان بيسجّل الطلب في تاب جديد
اسمه **Leads** في نفس جوجل شيت العقارات، عشان أي طلب ميضيعش لو العميل
ما ضغطش إرسال في واتساب.

الإعداد مرة واحدة، حوالي 10 دقايق.

## 1) سكربت جوجل (Apps Script)
1. افتح شيت العقارات ← من القايمة: **الإضافات (Extensions) ← برمجة التطبيقات (Apps Script)**.
2. امسح أي كود موجود والصق الكود ده:

```javascript
// استقبال طلبات العملاء من الموقع وتسجيلها في تاب Leads.
const SECRET = 'حط_هنا_نص_عشوائي_طويل'; // نفس قيمة LEADS_WEBHOOK_SECRET في فيرسل

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.secret !== SECRET) return out({ ok: false, error: 'bad_secret' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Leads');
    if (!sh) {
      sh = ss.insertSheet('Leads');
      sh.appendRow(['التاريخ', 'الاسم', 'الهاتف', 'الطلب والميزانية', 'الصفحة']);
    }
    sh.appendRow([new Date(), body.name || '', body.phone || '', body.request || '', body.page || '']);
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: 'server' });
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
```

3. بدّل `حط_هنا_نص_عشوائي_طويل` بأي نص عشوائي طويل (32+ حرف، زي باسورد) واحفظه عندك — هتحتاجه في الخطوة الجاية.
4. احفظ (Ctrl+S) ← **نشر (Deploy) ← نشر جديد (New deployment)** ← اختار النوع **تطبيق ويب (Web app)**:
   - Execute as: **Me (أنا)**
   - Who has access: **Anyone (أي شخص)**
   - اضغط **Deploy** ووافق على الصلاحيات (هيطلب تسجيل دخول بحسابك ورسالة تحذير لأن السكربت بتاعك: اضغط Advanced ← Go to project ← Allow).
5. انسخ **رابط تطبيق الويب (Web app URL)** اللي بيبدأ بـ `https://script.google.com/macros/s/...`.

## 2) Environment Variables على Vercel
Project ← Settings ← Environment Variables (علّم Production و Preview):
| الاسم | القيمة |
|---|---|
| LEADS_WEBHOOK_URL | رابط تطبيق الويب من الخطوة 1 |
| LEADS_WEBHOOK_SECRET | النص العشوائي اللي حطيته في السكربت |
بعد الإضافة اعمل **Redeploy**.

## 3) التجربة
- افتح الموقع، املأ فورم "لم تجد عقارك؟" ببيانات تجريبية واضغط إرسال.
- هيتفتح واتساب زي العادة، وفي خلال ثواني هتلاقي صف جديد في تاب **Leads** في الشيت.
- لو التاب ما اتعملش: اتأكد إن الـ SECRET واحد في الاتنين، وإنك عملت Redeploy بعد المتغيرات.

## ملاحظات
- رابط الـ Web App والـ SECRET بيفضلوا على السيرفر (فيرسل) ومبيظهروش في كود الموقع.
- "Who has access: Anyone" معناها إن الرابط يقدر يتنده من غير تسجيل دخول جوجل، بس مفيش حد يقدر يكتب في الشيت من غير الـ SECRET، والرابط نفسه مش متنشر في حتة.
- في حماية من السبام: حقل مصيدة مخفي + حد أقصى 10 طلبات كل 10 دقايق من نفس الـ IP.
- لو عايز توقف التسجيل مؤقتاً: امسح المتغيرين من فيرسل واعمل Redeploy — الفورم هيرجع يشتغل على واتساب بس زي الأول.
