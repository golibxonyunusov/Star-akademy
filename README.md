# Ovoz Xonasi

Anime ovoz berish darslari uchun sayt: **ovozli chat** (WebRTC) va **yozuv chati** (Firebase Firestore).

- Kirishda ustoz yoki o'quvchi tanlanadi. Ustoz **kod** kiritadi.
- O'quvchilar darsga ovozi **yopiq** holda kiradi. Ustoz har birini ochadi yoki yopadi, yoki hammasini birdan.
- Ustoz: dars yaratadi, o'quvchini darsdan chiqaradi, chatni qulflaydi, xabarlarni o'chiradi, topshiriq/maslahat/fikr yuboradi, darsni arxivga oladi.
- Chatda ovoz belgilari: `/` `//` `↑` `↓` `~` `*urg'u*` `(izoh)`.
- **Navbat:** ustoz navbat yaratadi, o'quvchilar o'zlariga xohlagan katakchani (tartib raqamini) tanlaydi. Katakchalar soni darsdagi o'quvchilar soniga teng. Ustoz **Tayyor** bosganda bo'sh qolgan katakchalar olib tashlanadi va navbatlar ketma-ket tartibga keladi. Keyin ustoz **Keyingi** bilan navbatni yuritadi. Yaratishda «ovozni avtomatik ochish» yoqilgan bo'lsa, navbati kelgan o'quvchining ovozi ochiladi, qolganlariniki yopiladi.
- **Dars vaqti:** yangi dars yaratishda boshlanish vaqtini belgilash mumkin (keyinroq dars ichida ham o'zgartiriladi). O'sha vaqtgacha o'quvchilar kutish holatida bo'ladi: yozolmaydi va ovozga ulana olmaydi. Vaqt kelganda chat va ovoz o'zi ochiladi. Ustoz **Hozir boshlash** bilan darsni oldinroq ochishi mumkin. Cheklov: bu server funksiyasi emas, vaqtni brauzer va Firestore qoidalari tekshiradi. Ovozga ulanish tugmasini o'quvchi baribir o'zi bosadi (brauzer mikrofonni avtomatik yoqmaydi).

Fayllar: `index.html`, `styles.css`, `app.js`, `firebase-config.js`, `firestore.rules`, `firebase.json`. Build qadami yo'q, oddiy statik sayt.

## 1. Firebase loyihasini sozlash

1. https://console.firebase.google.com ichida yangi loyiha yarating.
2. **Build -> Authentication -> Sign-in method** ichida **Anonymous** ni yoqing.
3. **Build -> Firestore Database** ichida baza yarating (production mode).
4. **Project settings -> General -> Your apps -> Web (</>)** bilan veb-ilova qo'shing va chiqqan `firebaseConfig` ni `firebase-config.js` fayliga ko'chiring.
5. **Firestore -> Rules** bo'limiga `firestore.rules` faylining butun matnini qo'ying va **Publish** bosing.
6. **Ustoz kodini o'rnating.** Firestore -> Data ichida `private` kolleksiyasini yarating, hujjat ID si `teacherCode`, bitta maydon: `value` (string) = o'zingiz tanlagan maxfiy kod. Bu hujjatni mijozlar o'qiy olmaydi, faqat qoidalar kodni solishtiradi.

Kodni keyinroq almashtirsangiz, avval ustoz bo'lib kirganlar ustoz bo'lib qolaveradi. Ustozlikni olib qo'yish uchun Firestore -> `teachers` ichidagi hujjatni o'chiring.

## 2. Joylashtirish (HTTPS shart)

Mikrofon faqat **HTTPS** (yoki `localhost`) da ishlaydi.

Firebase Hosting bilan:

```
npm install -g firebase-tools
firebase login
firebase init        # Hosting va Firestore ni tanlang, mavjud fayllarni ustiga yozmang
firebase deploy
```

Yoki shu papkani istalgan statik hostingga (Netlify, Cloudflare Pages, GitHub Pages) yuklang. Mahalliy sinash: `npx serve .` va `http://localhost:3000`.

Firebase Authentication -> Settings -> **Authorized domains** ichiga saytingiz domenini qo'shing (Firebase Hosting domeni avtomatik bor).

## 3. Ovozli chat haqida

- Ovoz brauzerlar orasida to'g'ridan-to'g'ri (WebRTC) uzatiladi, Firestore faqat ulanish signallari uchun ishlatiladi. Har bir qatnashchi boshqalar bilan alohida ulanadi, shuning uchun **taxminan 6 dan 8 kishigacha** yaxshi ishlaydi. Kattaroq sinf uchun SFU server (LiveKit, mediasoup) kerak bo'ladi.
- Ba'zi tarmoqlarda (mobil operatorlar, korxona Wi-Fi) faqat STUN yetmaydi. Shunda `firebase-config.js` ichiga TURN server qo'shing.
- **Yopish/ochish** ikki joyda bajariladi: o'quvchining o'z mikrofoni o'chiriladi va boshqa qatnashchilarning brauzerlari uning ovozini jim qiladi. Bu sinf uchun yetarli, lekin SFU yo'qligi sababli o'zgartirilgan brauzer kodi bilan chetlab o'tish nazariy jihatdan mumkin. Chat yozish, o'quvchini chiqarish va ustoz huquqlari esa Firestore qoidalari bilan server tomonda himoyalangan.
- O'quvchi chiqarilgandan keyin shu brauzerdan qayta kira olmaydi (`kicked` belgisi qoidalar bilan qulflangan).

## 4. Ma'lumotlar tuzilmasi

```
teachers/{uid}                      ustoz hujjati (kod bilan yaratiladi)
private/teacherCode                 { value }  mijozlarga yopiq
rooms/{rid}                         dars: title, level, description, archived, chatLocked, startsAt (ms, 0 = darhol)
rooms/{rid}/members/{uid}           qatnashchi: role, muted, micOff, hand, kicked, inVoice, lastSeen
rooms/{rid}/messages/{id}           yozuv chati
rooms/{rid}/queues/{id}             navbat: title, status (open | running | done), order, current, autoMic
rooms/{rid}/queues/{id}/slots/{n}   tanlangan katakcha: uid, name, n (hujjat ID si = tartib raqami)
rooms/{rid}/signals/{id}            WebRTC signallari (qabul qilingach o'chiriladi)
```



git add .
git commit -m "tayyor"
git push
