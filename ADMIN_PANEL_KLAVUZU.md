# SAWBot — Yönetim Paneli Kullanım Kılavuzu

---

## Giriş

Admin paneline tarayıcıdan ulaşın:
```
http://SUNUCU-IP:3000/admin
```

---

## Giriş Ekranı

```
┌─────────────────────────────────────┐
│          🤖 SAP WA Bot              │
│           Yönetim Paneli            │
│                                     │
│  Kullanıcı Adı                      │
│  ┌──────────────────────────────┐   │
│  │ 👤  admin                    │   │
│  └──────────────────────────────┘   │
│                                     │
│  Şifre                              │
│  ┌──────────────────────────────┐   │
│  │ 🔒  ••••••••                 │   │
│  └──────────────────────────────┘   │
│                                     │
│  ┌──────────────────────────────┐   │
│  │      ➤  Giriş Yap           │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

Kurulum sihirbazında belirlediğiniz kullanıcı adı ve şifreyi girin.

---

## Genel Yapı

Giriş yaptıktan sonra her sayfada aynı sol menü görünür:

```
┌──────────────────────┐
│  🤖 SAP WA Bot       │
│  Yönetim Paneli      │
├──────────────────────┤
│ 🏠  Dashboard        │
│ 👥  Kullanıcılar     │
│ ✅  Onay Yetkilileri │
│ 💬  Şablonlar        │
│ 🕐  Zamanlanmış      │
│     Görevler         │
│ 📋  Mesaj Logları    │
│ ⚙️  Ayarlar          │
├──────────────────────┤
│ 🚪  Çıkış Yap        │
└──────────────────────┘
```

---

## 1. Dashboard

Sistemin anlık durumunu gösterir. Giriş yaptıktan sonra ilk açılan sayfadır.

```
┌──────────────────────────────────────────────────────────────┐
│  📊 Dashboard                                    [↺ Yenile]  │
├─────────────────┬──────────────────┬────────────┬────────────┤
│  🟢 Çalışıyor  │  🔵 Bağlı        │  🟠 3      │  🔵 2s 14d │
│  Sunucu         │  SAP Bağlantısı  │  Onay Yet. │  Çalışma   │
│  Durumu         │                  │            │  Süresi    │
├─────────────────────────────────┬──────────────────────────┤
│  🗄️ SAP Veritabanları           │  ℹ️ Sistem Bilgisi        │
│                                 │                           │
│  [ENDEKS] [TEST_DB] [DEMO]      │  Node.js    v20.11.0     │
│                                 │  Varsayılan ENDEKS        │
│                                 │  Webhook    ✅ Aktif      │
└─────────────────────────────────┴──────────────────────────┘
```

**Durum Kartları:**

| Kart | Yeşil | Kırmızı |
|---|---|---|
| Sunucu Durumu | Çalışıyor | Durdu |
| SAP Bağlantısı | Bağlı | Hata |
| Onay Yetkilisi | Kayıtlı sayı | — |
| Çalışma Süresi | Ne kadar süredir açık | — |

> **İpucu:** Sayfa açıldığında SAP bağlantısı otomatik test edilir. "Hata" görünüyorsa `Ayarlar → SAP Service Layer → Test Et` ile kontrol edin.

---

## 2. Kullanıcılar

WhatsApp üzerinden bota bağlanan kişilerin listesi ve lisans yönetimi.

```
┌─────────────────────────────────────────────────────────────┐
│  👥 Kullanıcılar                          [+ Kullanıcı Ekle]│
│  Lisans: 4 / 10 kullanıcı lisansı kullanıldı                │
├──────────────────────────────────────────────────────────────┤
│  🛡️ Lisans                         [📤 Lisans İçe Aktar]    │
│  ✅ Aktif — Maksimum 10 kullanıcı                            │
│  Sistem Parmak İzi: [ABC123XYZ...]  [📋 Kopyala]            │
├──────────────────────────────────────────────────────────────┤
│  📋 Kayıtlı Kullanıcılar                         [↺ Yenile] │
│                                                              │
│  Telefon        Ad Soyad    Eklenme     Durum   İşlem        │
│  ─────────────────────────────────────────────────────────  │
│  905321001122   Ahmet Y.    01.05.2026  🟢Aktif  ⏸️  🗑️    │
│  905321003344   Mehmet K.   03.05.2026  🟢Aktif  ⏸️  🗑️    │
│  905321005566   Ayşe T.     05.05.2026  ⚫Pasif  ▶️  🗑️    │
└──────────────────────────────────────────────────────────────┘
```

### Kullanıcı Ekleme

**[+ Kullanıcı Ekle]** butonuna basın:

```
┌─────────────────────────────────────┐
│  Kullanıcı Ekle                  ✕  │
├─────────────────────────────────────┤
│  Telefon Numarası *                 │
│  ┌───────────────────────────────┐  │
│  │  905001234567                 │  │
│  └───────────────────────────────┘  │
│  Ülke kodu dahil, + olmadan         │
│                                     │
│  Ad Soyad                           │
│  ┌───────────────────────────────┐  │
│  │  Ahmet Yılmaz                 │  │
│  └───────────────────────────────┘  │
│                                     │
│          [İptal]  [+ Ekle]          │
└─────────────────────────────────────┘
```

- **Telefon:** `905XXXXXXXXX` formatında — ülke kodu dahil, `+` işaretsiz
- **Ad Soyad:** İsteğe bağlı

### Kullanıcı İşlemleri

| İkon | İşlev |
|---|---|
| ⏸️ (Durdur) | Kullanıcıyı geçici olarak pasif yapar, bota mesaj gönderemez |
| ▶️ (Başlat) | Pasif kullanıcıyı tekrar aktif eder |
| 🗑️ (Sil) | Kullanıcıyı kalıcı olarak kaldırır |

### Lisans İçe Aktarma

Yeni lisans dosyası alındığında **[📤 Lisans İçe Aktar]** butonuna basın, `.lic` dosyasını seçin.

> **Sistem Parmak İzi:** Lisans dosyası bu sunucuya özel üretilir. Sağlayıcıya bu kodu iletin.

---

## 3. Onay Yetkilileri

Satın alma onaylarını WhatsApp üzerinden yapacak kişilerin listesi.

```
┌─────────────────────────────────────────────────────────────┐
│  ✅ Onay Yetkilileri                          [+ Yeni Ekle] │
├──────────────────────────────────────────────────────────────┤
│  📋 Kayıtlı Yetkililer                              [2]     │
│                                                              │
│  #   Telefon           İsim / Unvan          İşlem          │
│  ────────────────────────────────────────────────────────── │
│  1   📞 905321001122   Ahmet Yıldız           🗑️            │
│  2   📞 905321003344   Ayşe Demir (Müdür)     🗑️            │
│                                                              │
│  ℹ️ Numaralar ülke kodu dahil, + işaretsiz girilmeli.       │
│     Örnek: 905321234567                                      │
└─────────────────────────────────────────────────────────────┘
```

### Yeni Yetkili Ekleme

**[+ Yeni Ekle]** butonuna basın:

```
┌─────────────────────────────────────┐
│  Yeni Yetkili Ekle               ✕  │
├─────────────────────────────────────┤
│  Telefon Numarası                   │
│  ┌──┬────────────────────────────┐  │
│  │📞│  905321234567              │  │
│  └──┴────────────────────────────┘  │
│  Ülke kodu dahil, + olmadan         │
│                                     │
│  İsim / Unvan                       │
│  ┌──┬────────────────────────────┐  │
│  │👤│  Ahmet Yıldız              │  │
│  └──┴────────────────────────────┘  │
│                                     │
│          [İptal]  [✔ Kaydet]        │
└─────────────────────────────────────┘
```

> **Önemli:** Buradaki telefon numarası SAP'taki kullanıcının `Mobile Phone` alanıyla eşleşmelidir. Eşleşmezse onay bildirimleri iletilmez.

---

## 4. WhatsApp Şablonları

Meta'ya gönderilecek mesaj şablonlarını yönetin. Otomatik bildirimler (fatura, servis durum) bu şablonları kullanır.

```
┌─────────────────────────────────────────────────────────────┐
│  💬 WhatsApp Şablonları                    [+ Yeni Şablon]  │
├──────────────────────────────────────────────────────────────┤
│  📋 Kayıtlı Şablonlar [3]                       [↺ Yenile] │
│                                                              │
│  Şablon Adı              Kategori    Dil   Durum    İşlem   │
│  ──────────────────────────────────────────────────────────  │
│  servis_durum_guncelleme  UTILITY    tr    ✅Onaylı  🗑️     │
│  efatura_bildirimi        UTILITY    tr    ✅Onaylı  🗑️     │
│  satin_alma_onay          UTILITY    tr    ⏳Bekliyor 🗑️    │
│                                                              │
│  ℹ️ Meta onay süreci 1–5 iş günü sürebilir.                 │
└─────────────────────────────────────────────────────────────┘
```

**Durum Renkleri:**

| Durum | Anlamı |
|---|---|
| ✅ Onaylı | Kullanıma hazır |
| ⏳ Bekliyor | Meta incelemede |
| ❌ Reddedildi | Meta onaylamadı, içeriği revize edin |
| ⏹️ Durduruldu | Meta tarafından askıya alındı |

### Yeni Şablon Oluşturma

**[+ Yeni Şablon]** butonuna basın:

```
┌──────────────────────────────────────────────────────┐
│  Yeni Şablon Oluştur                              ✕  │
├──────────────────────────────────────────────────────┤
│  Şablon Adı *              Kategori *                │
│  ┌────────────────────┐   ┌────────────────────┐    │
│  │ servis_bildirim    │   │ UTILITY         ▼  │    │
│  └────────────────────┘   └────────────────────┘    │
│  Küçük harf, rakam, _                               │
│                                                      │
│  Dil *                                               │
│  ┌────────────────────┐                             │
│  │ Türkçe (tr)     ▼  │                             │
│  └────────────────────┘                             │
│                                                      │
│  Mesaj Gövdesi *                                     │
│  ┌────────────────────────────────────────────────┐  │
│  │ Sayın {{1}}, {{2}} numaralı servis çağrınızın  │  │
│  │ durumu güncellendi: {{3}}                       │  │
│  └────────────────────────────────────────────────┘  │
│  {{1}}, {{2}} ile değişken ekleyin                   │
│                                                      │
│  Alt Bilgi (isteğe bağlı)                            │
│  ┌────────────────────────────────────────────────┐  │
│  │ SAP Business One – Otomatik bildirim           │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│              [İptal]  [📤 Meta'ya Gönder]            │
└──────────────────────────────────────────────────────┘
```

> **Not:** Şablon adı onaylandıktan sonra değiştirilemez. `Ayarlar` sayfasındaki ilgili alana bu adı yazmanız gerekir.

---

## 5. Zamanlanmış Görevler

Belirli saatlerde otomatik rapor veya bildirim gönderir.

```
┌─────────────────────────────────────────────────────────────┐
│  🕐 Zamanlanmış Görevler                     [+ Yeni Görev] │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │ Haftalık Satış Özeti │  │ Günlük Bakiye        │         │
│  │ 🟢 Aktif             │  │ 🟢 Aktif             │         │
│  │ 🏷️ Satış Raporu      │  │ 🏷️ Cari Bakiye       │         │
│  │ 🕗 Her gün 08:00     │  │ 🕗 Her gün 07:30     │         │
│  │ 📞 905321001122      │  │ 📞 905321003344       │         │
│  │    905321003344      │  │                      │         │
│  │ 📅 Haftalık          │  │ 📅 Aylık             │         │
│  ├──────────────────────┤  ├──────────────────────┤         │
│  │ [Düzenle] [⏸️] [🗑️]│  │ [Düzenle] [⏸️] [🗑️]│         │
│  └──────────────────────┘  └──────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### Yeni Görev Oluşturma

**[+ Yeni Görev]** butonuna basın:

```
┌──────────────────────────────────────────────────────────┐
│  Yeni Görev                                           ✕  │
├──────────────────────────────────────────────────────────┤
│  Görev Tipi *                                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Haftalık Satış Özeti                           ▼  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Görev Adı (opsiyonel)          Gönderim Saati *        │
│  ┌──────────────────────┐       ┌──────────────┐        │
│  │ Pazartesi Raporu     │       │  08:00       │        │
│  └──────────────────────┘       └──────────────┘        │
│                                                          │
│  ☑️ Aktif                                                │
│                                                          │
│  Telefon Numaraları                                      │
│  ┌─────────────────────────────────────┐  [+]           │
│  │ 905...                              │                 │
│  └─────────────────────────────────────┘                 │
│  [📞 905321001122 ✕]  [📞 905321003344 ✕]               │
│                                                          │
│  Rapor Dönemi                                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Haftalık                                       ▼  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│                  [İptal]  [✔ Kaydet]                    │
└──────────────────────────────────────────────────────────┘
```

**Dönem Seçenekleri:** Haftalık / 2 Haftalık / Aylık / 3 Aylık / 6 Aylık / Yıllık

**Özel SQL Görevi:** "Görev Tipi" olarak `Özel SQL Sorgusu` seçilirse SQL kutusu açılır:
```sql
SELECT TOP 10 CardCode, CardName, Balance
FROM OCRD WHERE Balance > 0
ORDER BY Balance DESC
```
Yalnızca `SELECT` ve `WITH` sorguları çalışır. İlk 10 satır gönderilir.

---

## 6. Mesaj Logları

Bot üzerinden geçen tüm mesajları tarih, telefon ve yöne göre filtreleyin.

```
┌─────────────────────────────────────────────────────────────┐
│  📋 Mesaj Logları                                           │
├──────────────────────────────────────────────────────────────┤
│  Başlangıç Tarihi   Bitiş Tarihi    Telefon Filtresi        │
│  ┌───────────────┐  ┌─────────────┐ ┌───────────────────┐  │
│  │  2026-05-01   │  │  2026-05-07 │ │  905...           │  │
│  └───────────────┘  └─────────────┘ └───────────────────┘  │
│  [🔍 Ara]  [📥 CSV İndir]                                   │
├──────────────────────────────────────────────────────────────┤
│  📨 Toplam: 142  📥 Gelen: 98  📤 Giden: 44  👤 Tekil: 12  │
├──────────────────────────────────────────────────────────────┤
│  Zaman              Telefon       Yön     Mesaj             │
│  ──────────────────────────────────────────────────────────  │
│  07.05.2026 09:14   905321001122  🟢Gelen  "bakiye ne"      │
│  07.05.2026 09:14   905321001122  🟡Giden  "Cari bakiyeniz" │
│  07.05.2026 10:32   905321003344  🟢Gelen  "onay listesi"   │
│  07.05.2026 10:33   905321003344  🟡Giden  "Onay bekleyen"  │
└─────────────────────────────────────────────────────────────┘
```

**Kullanım:**
1. Başlangıç ve bitiş tarihi seçin
2. Belirli bir kullanıcıyı aramak için telefon filtresi girin (opsiyonel)
3. **[🔍 Ara]** butonuna basın
4. **[📥 CSV İndir]** ile Excel'e aktarabilirsiniz

---

## 7. Ayarlar

Tüm sistem konfigürasyonu bu sayfadan yönetilir. Her bölümün kendi kaydet butonu vardır.

---

### 7.1 SAP Service Layer Bağlantısı

```
┌──────────────────────────────────────────────────────────────┐
│  🗄️ SAP Service Layer Bağlantısı                            │
├──────────────────────────────────────────────────────────────┤
│  Service Layer URL                                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  https://SAP-SUNUCU:50000/b1s/v2/                      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Varsayılan Şirket DB    Çoklu DB (noktalı virgülle)        │
│  ┌───────────────────┐   ┌──────────────────────────────┐  │
│  │  ENDEKS           │   │  TEST_DB;DEMO_DB              │  │
│  └───────────────────┘   └──────────────────────────────┘  │
│                                                              │
│  SAP Kullanıcı Adı       SAP Şifre                         │
│  ┌───────────────────┐   ┌──────────────────────────────┐  │
│  │  manager          │   │  ••••••••           👁️        │  │
│  └───────────────────┘   └──────────────────────────────┘  │
│                           (boş bırakılırsa değişmez)        │
│                                                              │
│  Test için DB: [ENDEKS ▼]   [▶️ Test Et]   ✅ Bağlantı OK  │
│                                                              │
│                      [💾 SAP SL Ayarlarını Kaydet]          │
└──────────────────────────────────────────────────────────────┘
```

---

### 7.2 WhatsApp Business API

```
┌──────────────────────────────────────────────────────────────┐
│  💬 WhatsApp Business API                                    │
├──────────────────────────────────────────────────────────────┤
│  Phone Number ID                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  104179379317345                                        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Verify Token              Access Token                      │
│  ┌───────────────────┐    ┌──────────────────────────────┐  │
│  │  sawbot-2024      │    │  EAAxxxx...         👁️        │  │
│  └───────────────────┘    └──────────────────────────────┘  │
│                                                              │
│                    [💾 WhatsApp Ayarlarını Kaydet]           │
└──────────────────────────────────────────────────────────────┘
```

> **Phone Number ID** ve **Access Token** Meta Developer Console → WhatsApp → API Setup sayfasından alınır.

---

### 7.3 SAP SQL Veritabanı

```
┌──────────────────────────────────────────────────────────────┐
│  🖥️ SAP SQL Veritabanı (Direkt Bağlantı)                    │
├──────────────────────────────────────────────────────────────┤
│  DB Türü          Sunucu                     Port            │
│  ┌─────────────┐  ┌─────────────────────┐   ┌─────────┐    │
│  │ MSSQL    ▼  │  │  192.168.1.10       │   │  1433   │    │
│  └─────────────┘  └─────────────────────┘   └─────────┘    │
│  (değişince yeniden başlat)                                  │
│                                                              │
│  Veritabanı Adı   Kullanıcı               Şifre             │
│  ┌─────────────┐  ┌─────────────────────┐  ┌─────────────┐ │
│  │  ENDEKS     │  │  sa                 │  │ ••••  👁️    │ │
│  └─────────────┘  └─────────────────────┘  └─────────────┘ │
│                                                              │
│  [▶️ Bağlantıyı Test Et]   ✅ Bağlantı başarılı             │
│                                                              │
│                       [💾 SQL Ayarlarını Kaydet]            │
└──────────────────────────────────────────────────────────────┘
```

---

### 7.4 Claude AI & OpenAI

```
┌──────────────────────────────────────────────────────────────┐
│  🖥️ Claude AI (Anthropic)                                    │
│  API Key  ┌────────────────────────────────────┐  👁️        │
│           │  sk-ant-api03-...                  │            │
│           └────────────────────────────────────┘            │
│  ✅ API Key tanımlı                                          │
│                             [💾 API Key Kaydet]              │
├──────────────────────────────────────────────────────────────┤
│  🎙️ OpenAI (Whisper Sesli Mesaj)                            │
│  Sesli mesajları metne çevirmek için kullanılır.             │
│  API Key  ┌────────────────────────────────────┐  👁️        │
│           │  sk-proj-...                       │            │
│           └────────────────────────────────────┘            │
│  ⚫ Tanımlı değil (sesli mesajlar işlenmez)                  │
│                             [💾 API Key Kaydet]              │
└──────────────────────────────────────────────────────────────┘
```

---

### 7.5 Microsoft Outlook Takvim (isteğe bağlı)

```
┌──────────────────────────────────────────────────────────────┐
│  📅 Microsoft Outlook Takvim (Graph API)    ⚫ Devre Dışı   │
├──────────────────────────────────────────────────────────────┤
│  SAP aktiviteleri Outlook takvimine otomatik eklensin mi?    │
│                                                              │
│  ⬜ Outlook Takvim Entegrasyonu Aktif                        │
│                                                              │
│  Tenant ID           Client ID (Application ID)             │
│  ┌─────────────────┐ ┌──────────────────────────────────┐  │
│  │ xxxx-xxxx-...   │ │ xxxx-xxxx-...                    │  │
│  └─────────────────┘ └──────────────────────────────────┘  │
│                                                              │
│  Client Secret       Kullanıcı Domain                       │
│  ┌─────────────────┐ ┌──────────────────────────────────┐  │
│  │ •••••••    👁️   │ │ @sirket.com                      │  │
│  └─────────────────┘ └──────────────────────────────────┘  │
│                                                              │
│  [▶️ Bağlantıyı Test Et]                                    │
│                    [💾 Graph Ayarlarını Kaydet]              │
└──────────────────────────────────────────────────────────────┘
```

---

### 7.6 CRM & Oturum Ayarları

```
┌──────────────────────────────────────────────────────────────┐
│  👥 CRM & Oturum Ayarları                                    │
├──────────────────────────────────────────────────────────────┤
│  Oturum Süresi (dk)      Maks. Dosya Boyutu (MB)            │
│  ┌────────────────────┐  ┌────────────────────┐             │
│  │  480               │  │  5                 │             │
│  └────────────────────┘  └────────────────────┘             │
│  Varsayılan: 480 dk       Aktivite eki limiti                │
│                                                              │
│  Aktif Aktivite Tipleri                                      │
│  ☑️ Phone Call   ☑️ Meeting   ☑️ Task                        │
│  ☑️ Note         ☑️ Email                                    │
│                                                              │
│  Aktivite Konuları (virgülle ayırın)                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Teklif, Sipariş Takip, Teknik Destek, Şikayet         │ │
│  └────────────────────────────────────────────────────────┘ │
│  Boş bırakılırsa konu sorulmaz                               │
│                                                              │
│                      [💾 CRM Ayarlarını Kaydet]              │
└──────────────────────────────────────────────────────────────┘
```

---

### 7.7 E-Belge Entegrasyonu

```
┌──────────────────────────────────────────────────────────────┐
│  📄 E-Belge Entegrasyonu                                     │
│  {0} → NumAtCard alanı ile değiştirilir                      │
├──────────────────────────────────────────────────────────────┤
│  E-Fatura URL    https://portal.com/einvoice/{0}.pdf         │
│  E-Arşiv URL     https://portal.com/earchive/{0}.pdf         │
│  İrsaliye URL    https://portal.com/delivery/{0}.pdf         │
│                                                              │
│                   [💾 E-Belge Ayarlarını Kaydet]             │
└──────────────────────────────────────────────────────────────┘
```

Müşteriye fatura veya irsaliye bildirimi gönderildiğinde mesajdaki "Görüntüle" linki bu URL'lerden üretilir.

---

### 7.8 Fatura / İrsaliye Bildirim Servisi

```
┌──────────────────────────────────────────────────────────────┐
│  📤 Fatura / İrsaliye WhatsApp Bildirimi    🟢 Aktif         │
├──────────────────────────────────────────────────────────────┤
│  ☑️ Belge Bildirimi Aktif                                    │
│                                                              │
│  e-Fatura Şablon      e-Arşiv Şablon      İrsaliye Şablon   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ efatura_bil  │    │ earsiv_bil   │    │ irsaliye_bil │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│                                                              │
│  Bildirim Gönderilmeyecek Numaralar                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  905321999999                                          │ │
│  │  905322888888                                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Son çalışma: 07.05.2026 11:45      [💾 Kaydet]             │
└──────────────────────────────────────────────────────────────┘
```

---

### 7.9 Bildirim Ayarları

```
┌──────────────────────────────────────────────────────────────┐
│  🔔 Bildirim & Diğer Ayarlar                                 │
├──────────────────────────────────────────────────────────────┤
│  Servis Bildirim Şablonu                                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  servis_durum_guncelleme                               │ │
│  └────────────────────────────────────────────────────────┘ │
│  Meta Business Manager'da onaylı şablon adı                  │
│                                                              │
│  Varsayılan Fiyat Listesi No                                 │
│  ┌──────────────────┐                                       │
│  │  1               │                                       │
│  └──────────────────┘                                       │
│  Stok fiyat sorgularında kullanılacak ITM1 fiyat listesi    │
│                                                              │
│                             [💾 Kaydet]                      │
└──────────────────────────────────────────────────────────────┘
```

---

### 7.10 Panel Şifresi Değiştirme

```
┌──────────────────────────────────────────────────────────────┐
│  🔑 Panel Şifresi                                            │
├──────────────────────────────────────────────────────────────┤
│  Admin Kullanıcı Adı                                         │
│  ┌─────────────────────────────────┐  [💾]                  │
│  │  admin                          │                        │
│  └─────────────────────────────────┘                        │
│                                                              │
│  Mevcut Şifre                                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  ••••••••                                              │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Yeni Şifre              Yeni Şifre (Tekrar)                │
│  ┌───────────────────┐   ┌──────────────────────────────┐  │
│  │  ••••••••         │   │  ••••••••                    │  │
│  └───────────────────┘   └──────────────────────────────┘  │
│                                                              │
│                    [✔ Şifreyi Güncelle]                     │
└──────────────────────────────────────────────────────────────┘
```

---

## Hızlı Başlangıç Kontrol Listesi

Kurulum sonrası sırasıyla yapılması gerekenler:

- [ ] `Dashboard` → SAP Bağlantısı **Bağlı** görünüyor mu?
- [ ] `Ayarlar → SQL` → Bağlantıyı test et → başarılı mı?
- [ ] `Onay Yetkilileri` → Satın alma onaylayanların numaralarını ekle
- [ ] `Şablonlar` → Servis ve fatura bildirim şablonlarını oluştur ve Meta'ya gönder
- [ ] `Ayarlar → Bildirim` → Şablon adlarını ayarla
- [ ] `Ayarlar → E-Belge` → Fatura görüntüleme URL'lerini gir
- [ ] `Kullanıcılar` → Lisansı içe aktar
- [ ] İlk kullanıcıdan WhatsApp mesajı gönder, `Mesaj Logları`'nda görünüyor mu?
