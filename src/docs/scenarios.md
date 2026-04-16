# WhatsApp SAP Asistanı – Kullanıcı Senaryoları

## Genel Kullanım Kuralları

- Kullanıcı doğal Türkçe ile yazabilir, komut bilmesi gerekmez
- Claude isteği analiz eder, doğru SAP sorgusunu oluşturur
- Sonuçlar WhatsApp'a uygun kısa ve öz formatlanır
- Kullanıcı yetki seviyesine göre bazı işlemler kısıtlıdır

---

## Senaryo Kategorileri

1. [Nakit Akışı Sorguları](#nakit-akışı-sorguları)
2. [Cari Sorguları](#cari-sorguları)
3. [Fatura Sorguları](#fatura-sorguları)
4. [Stok Sorguları](#stok-sorguları)
5. [Satın Alma / Onay](#satın-alma--onay)
6. [SAP Destek / Hata Çözümü](#sap-destek--hata-çözümü)
7. [Genel Yönetim Sorguları](#genel-yönetim-sorguları)
8. [CRM — Aktivite / Fırsat / Aday Müşteri](#crm)

---

## Nakit Akışı Sorguları

### Senaryo 1 – Günlük Nakit Durumu
**Kullanıcı:** "Bugün ne kadar tahsilat bekliyoruz?"
**Claude yapacağı:**
- `Invoices` → bugün vadesi gelen açık faturaları sorgula
- Toplam tutarı hesapla, cari bazında listele

**Örnek Yanıt:**
```
📊 Bugün Vadesi Gelen Tahsilatlar

• ABC Ltd → 45.000 TL
• XYZ AŞ → 12.500 TL
• DEF Ltd → 8.200 TL

💰 Toplam: 65.700 TL
```

---

### Senaryo 2 – Bu Hafta Ödemeler
**Kullanıcı:** "Bu hafta hangi ödemeleri yapmamız lazım?"
**Claude yapacağı:**
- `PurchaseInvoices` → bu hafta vadesi gelen açık alış faturalarını sorgula
- Tedarikçi bazında listele

---

### Senaryo 3 – Cari Nakit Pozisyonu
**Kullanıcı:** "C001 carisinin durumu nedir?" veya "ABC Ltd ne kadar borçlu?"
**Claude yapacağı:**
- `BusinessPartners` → cari bakiyesi
- `Invoices` → açık faturaları
- Özet sunmak

---

### Senaryo 4 – Vadesi Geçmiş Alacaklar (Fatura Bazlı)
**Kullanıcı:** "Vadesi geçmiş alacaklarımız ne kadar?" / "Vadesi geçenler" / "Gecikmiş faturalar"
**Claude yapacağı:**
- `Invoices?$filter=DocDueDate lt 'BUGÜN' and DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'`
- `$select=DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,PaidToDate`
- `$orderby=DocDueDate asc`
- Toplam tutarı hesapla, cari bazında özetle, kaç gün geciktiğini göster

**Örnek Yanıt:**
```
⚠️ Vadesi Geçmiş Alacaklar

• ABC Ltd   Fatura #1234  Vade: 01.03  45.000 TL  (46 gün)
• XYZ AŞ   Fatura #1289  Vade: 15.03  30.000 TL  (32 gün)
• DEF Ltd   Fatura #1301  Vade: 20.03  12.500 TL  (27 gün)

💰 Toplam: 87.500 TL  |  3 fatura
```

> ⚠️ Bu sorgu Invoices tablosuna dayanır, hızlı çalışır.
> Tek bir cari için detaylı waterfall bakiye hesabı istiyorsan "C001 carisinin altın ok bakiyesi" de.

---

### Senaryo 4b – Tüm Carilerin Bakiye Özeti
**Kullanıcı:** "Bakiyesi olan müşterileri listele" / "En çok borçlu müşteriler"
**Claude yapacağı:**
- `BusinessPartners?$filter=Balance gt 0 and CardType eq 'cCustomer'`
- `$orderby=Balance desc&$top=20`
- NOT: $select KULLANMA (Balance $select ile istenemez)
- Bu SAP'ın anlık bakiyesidir, waterfall hesabı DEĞİLDİR

> ⚠️ Tüm cariler için waterfall (altın ok) hesabı YAPMA — çok ağır, sistem yorulur.
> Waterfall hesabı sadece tek cari için yapılır (Senaryo 6b).

---

## Cari Sorguları

### Senaryo 5 – Cari Arama
**Kullanıcı:** "Yıldız firmasının kodu ne?" veya "Yıldız cari kartı"
**Claude yapacağı:**
- `BusinessPartners` → `contains(CardName,'Yıldız')` ile ara

---

### Senaryo 6 – Cari Bakiye (Anlık)
**Kullanıcı:** "S002 tedarikçisine ne kadar borcumuz var?"
**Claude yapacağı:**
- `BusinessPartners('S002')` → Balance alanını getir ($select KULLANMA)

---

### Senaryo 6b – Cari Hesap Ekstresi (Tarihe Göre — Altın Ok Mantığı)
**Kullanıcı:** "MB00006 carisinin 31.03.2025 tarihine kadar bakiyesini hesapla"
**Kullanıcı (tarihsiz):** "C001 carisinin bugünkü bakiyesi" / "altın ok bakiyesi"

**Claude yapacağı:**
1. Tarih belirtilmişse onu kullan, belirtilmemişse BUGÜNÜN tarihini kullan
2. **Sorgu 1 (Borçlar)**: `Invoices?$filter=CardCode eq 'CARDCODE' and DocDate le 'YYYY-MM-DD'&$orderby=DocDueDate asc`
3. **Sorgu 2 (Tahsilatlar)**: `IncomingPayments?$filter=CardCode eq 'CARDCODE' and DocDate le 'YYYY-MM-DD'&$orderby=DocDate asc`
4. **Çek kuralı**: IncomingPayments içindeki PaymentChecks dizisinde DueDate > HedefTarih olan çek tutarlarını bakiyeye KATMA
5. **Eşleştirme (Waterfall)**: Her tahsilatı en eski açık faturadan düş, kalan = bakiye
6. Sonucu vade tarihine göre sıralı listele, toplam bakiye + bekleyen çekleri ayrıca göster
> NOT: `JournalEntries?$expand=JournalEntryLines` bu SAP versiyonunda ÇALIŞMIYOR, kullanma

**Örnek Yanıt:**
```
📊 MB00006 Cari Ekstresi (31.03.2025)

📋 Açık Hareketler (Vadeye Göre):
• 05.01 Fatura #1234  Vade: 05.02  45.000 TL
• 15.02 Fatura #1289  Vade: 15.03  30.000 TL

💰 Toplam Bakiye: 75.000 TL (Borçlu)
⏳ Vadesi geçmemiş çek: 18.000 TL (vade: 15.04.2025 — henüz düşülmedi)
```

---

### Senaryo 7 – En Büyük Müşteriler
**Kullanıcı:** "En çok alışveriş yapan 10 müşterimiz kimler?"
**Claude yapacağı:**
- `BusinessPartners` → CardType eq 'cCustomer', Balance'a göre sırala

---

## Fatura Sorguları

### Senaryo 8 – Fatura Detayı
**Kullanıcı:** "1234 numaralı fatura ne durumda?"
**Claude yapacağı:**
- `Invoices` → DocNum eq 1234 ile sorgula
- Durum, tutar, vade bilgisini döndür

---

### Senaryo 9 – Belirli Dönem Faturaları
**Kullanıcı:** "Bu ay kestiğimiz faturaların toplamı nedir?"
**Claude yapacağı:**
- `Invoices` → DocDate bu ay filtresi
- Toplam tutarı hesapla

---

### Senaryo 10 – Açık Faturalar
**Kullanıcı:** "ABC Ltd'ye kesilmiş açık faturalarımız var mı?"
**Claude yapacağı:**
- `Invoices` → CardCode + DocumentStatus eq 'bost_Open' filtresi

---

## Stok Sorguları

### Senaryo 11 – Stok Durumu
**Kullanıcı:** "vida ürününün stoğu ne kadar?"
**Claude yapacağı:**
- `Items` → `contains(ItemName,'vida')` ile ara
- QuantityOnStock döndür

---

### Senaryo 12 – Kritik Stok
**Kullanıcı:** "Stoğu azalan ürünler hangileri?"
**Claude yapacağı:**
- `Items` → QuantityOnStock lt 10 (veya minimum stok eşiği)
- Liste halinde döndür

---

### Senaryo 13 – Ürün Fiyatı
**Kullanıcı:** "IT-001 ürününün satış fiyatı nedir?"
**Claude yapacağı:**
- `Items('IT-001')` → SalesPrice, AvgStdPrice döndür

---

## Teknik Servis

### Senaryo S1 – Müşteri Servis Çağrıları
**Kullanıcı:** "MB00001 müşterisinin servis çağrıları" / "MB00001'in teknik servisleri"
**Claude yapacağı:**
- endpoint: SQL_HIZMET, params: { cardCode: "MB00001" }
- Çağrı no, ürün, durum, tarih bilgisini listele

---

### Senaryo S2 – Seri No ile Sorgula
**Kullanıcı:** "4607123S10190 seri nolu cihazın durumu nedir?"
**Claude yapacağı:**
- endpoint: SQL_HIZMET, params: { serialNo: "4607123S10190" }
- Cihaza ait tüm servis geçmişini getir

---

### Senaryo S3 – Çağrı Numarası ile Sorgula
**Kullanıcı:** "14 numaralı servis çağrısı nerede?"
**Claude yapacağı:**
- endpoint: SQL_HIZMET, params: { callId: "14" }
- Durum, çözüm, teslimat bilgisini göster

---

### Senaryo S4 – Açık Servis Çağrıları
**Kullanıcı:** "Açık servis çağrıları neler?" / "Bekleyen teknik servisler"
**Claude yapacağı:**
- endpoint: SQL_HIZMET, params: { statusFilter: "open", top: "20" }
- Müşteri, seri no, ürün, açılış tarihi, durum listele

---

### Senaryo S5 – Müşterinin Açık Servisleri
**Kullanıcı:** "MB00001'in açık servis çağrıları var mı?"
**Claude yapacağı:**
- endpoint: SQL_HIZMET, params: { cardCode: "MB00001", statusFilter: "open" }

**Örnek Yanıt:**
```
🔧 MB00001 Açık Servis Çağrıları

📋 Çağrı #6 — A-DATA SSD 240GB
   Seri: 2J3720104038
   Açılış: 04 Ocak 2022
   Durum: Müşteriye Sevk
   Teslimat: ENT2022000000081

📋 Çağrı #14 — AMD CPU RYZEN 3
   Seri: 4607123S10190
   Açılış: 10 Ocak 2022
   Durum: Müşteriye Sevk

Toplam: 2 açık çağrı
```

---

## Satın Alma / Onay

### Senaryo 14 – Bekleyen Onaylar
**Kullanıcı:** "Onayımı bekleyen siparişler var mı?"
**Claude yapacağı:**
- `PurchaseOrders` → ApprovalStatus eq 'asPendingApproval'
- Kullanıcının yetkisi dahilindeki siparişleri listele

---

### Senaryo 15 – Sipariş Onaylama
**Kullanıcı:** "456 numaralı siparişi onayla"
**Claude yapacağı:**
- Kullanıcının onay yetkisi var mı kontrol et
- `PurchaseOrders(DocEntry)/Approve` aksiyonu çalıştır
- Onay sonucunu bildir

---

### Senaryo 16 – Sipariş Reddetme
**Kullanıcı:** "456 numaralı siparişi reddet, fiyat yüksek"
**Claude yapacağı:**
- Kullanıcının yetkisini kontrol et
- `PurchaseOrders(DocEntry)/Reject` aksiyonu çalıştır
- Red gerekçesini kaydet

---

### Senaryo 17 – Sipariş Detayı
**Kullanıcı:** "456 numaralı satın alma siparişini göster"
**Claude yapacağı:**
- `PurchaseOrders(DocEntry)` → tüm detayları getir
- Kalemler dahil formatla

---

## SAP Destek / Hata Çözümü

### Senaryo 18 – Stok Hatası
**Kullanıcı:** "Satış siparişi girerken -10 hatası aldım"
**Claude yapacağı:**
- `sap-errors.md` dosyasından -10 hatasını bul
- Adım adım çözüm yolunu açıkla

---

### Senaryo 19 – Yetki Hatası
**Kullanıcı:** "Fatura iptal edemiyorum, 'authorized değilsiniz' yazıyor"
**Claude yapacağı:**
- Hata açıklaması ve çözüm yolunu döndür
- Yöneticiye nasıl başvurulacağını anlat

---

### Senaryo 20 – Genel SAP Sorusu
**Kullanıcı:** "SAP'ta kredi notu nasıl oluşturulur?"
**Claude yapacağı:**
- SAP B1 bilgi tabanından adımları açıkla
- Menü yollarını ver

---

### Senaryo 21 – Dönem Kapama Hatası
**Kullanıcı:** "Geçen aya fatura giremiyorum, dönem kapalı diyor"
**Claude yapacağı:**
- `sap-errors.md` → "Posting period is closed" çözümünü sun
- Adımları açıkla

---

## Genel Yönetim Sorguları

### Senaryo 22 – Günlük Özet
**Kullanıcı:** "Bugünkü durumu özetle"
**Claude yapacağı:**
- Bugün vadesi gelen tahsilatlar
- Bugün vadesi gelen ödemeler
- Net nakit pozisyonu
- Bekleyen onaylar

---

### Senaryo 23 – Aylık Performans
**Kullanıcı:** "Bu ayki satışlarımız geçen aya göre nasıl?"
**Claude yapacağı:**
- `Invoices` → bu ay ve geçen ay karşılaştırması
- Fark ve yüzdesel değişim

---

### Senaryo 24 – Raporlama
**Kullanıcı:** "En çok borçlu 5 müşterimizi listele"
**Claude yapacağı:**
- `BusinessPartners` → Balance'a göre sıralı top 5 müşteri

---

## Yanıt Formatı Kuralları

### WhatsApp için kısa formatla
```
✅ Başarılı işlem için
❌ Hata için
⚠️ Uyarı için
📊 Rapor/liste için
💰 Para/finansal için
📦 Stok için
👤 Cari için
📋 Belge için
```

### Sayıları formatla
- Para: `45.000 TL` veya `1.250,50 USD`
- Tarih: `15 Ocak 2024` veya `15.01.2024`
- Uzun listeler: Max 10 satır, fazlası için "ve X tane daha..."

### Belirsiz sorgular için soru sor
- "Hangi cari için?" → CardCode bilgisi eksikse
- "Hangi tarih aralığı?" → Dönem belirtilmemişse
- "Hangi şirket?" → Çoklu DB varsa

---

## Yetki Matrisi

| İşlem | Normal Kullanıcı | Onay Yetkilisi | Yönetici |
|-------|-----------------|----------------|----------|
| Bakiye sorgulama | ✅ | ✅ | ✅ |
| Fatura görüntüleme | ✅ | ✅ | ✅ |
| Stok sorgulama | ✅ | ✅ | ✅ |
| Sipariş onaylama | ❌ | ✅ | ✅ |
| Sipariş reddetme | ❌ | ✅ | ✅ |
| Tüm cariler | ❌ | ❌ | ✅ |
| CRM aktivite ekleme | ✅ | ✅ | ✅ |
| Aday müşteri ekleme | ✅ | ✅ | ✅ |
| Satış fırsatları | ✅ | ✅ | ✅ |

---

## CRM

### Senaryo C1 – Aktivite Sorgulama
**Kullanıcı:** "MB00001 müşterisinin son aktiviteleri" / "MB00001 ile ne zaman görüştük"
**Claude yapacağı:**
```json
{ "endpoint": "Activities", "method": "GET",
  "params": { "$filter": "CardCode eq 'MB00001'", "$orderby": "ActivityDate desc", "$top": "10",
              "$select": "ActivityCode,ActivityDate,Subject,Notes,Action,Closed" } }
```

---

### Senaryo C2 – Yeni Aktivite Ekle
**Kullanıcı:** "MB00001'e aktivite ekle: bugün telefon görüşmesi yaptık, fiyat teklifi istediler"
**Claude yapacağı:**
```json
{ "endpoint": "Activities", "method": "POST", "params": {},
  "body": { "CardCode": "MB00001", "ActivityDate": "BUGÜN", "Subject": "Telefon görüşmesi",
            "Notes": "Fiyat teklifi istediler", "Action": "phn", "Closed": "tNO" } }
```

**Örnek Yanıt:**
```
✅ Aktivite kaydedildi

👤 MB00001
📞 Telefon görüşmesi — 16 Nisan 2026
📝 Fiyat teklifi istediler
```

---

### Senaryo C3 – Yeni Aday Müşteri (Lead) Ekle
**Kullanıcı:** "Yeni aday müşteri ekle: ABC Teknoloji, telefon 05321234567, ERP arıyor"
**Claude yapacağı:**
```json
{ "endpoint": "BusinessPartners", "method": "POST", "params": {},
  "body": { "CardName": "ABC Teknoloji", "CardType": "cLead",
            "Phone1": "05321234567", "Notes": "ERP arıyor" } }
```

**Örnek Yanıt:**
```
✅ Aday müşteri oluşturuldu

👤 ABC Teknoloji
📞 05321234567
📝 ERP arıyor
🔑 Kod: L00042 (SAP tarafından atandı)
```

---

### Senaryo C4 – Aday Müşterileri Listele
**Kullanıcı:** "Aday müşterilerimiz kimler" / "Son leadler"
**Claude yapacağı:**
```json
{ "endpoint": "BusinessPartners", "method": "GET",
  "params": { "$filter": "CardType eq 'cLead'", "$orderby": "CardCode desc",
              "$select": "CardCode,CardName,Phone1,EmailAddress", "$top": "20" } }
```

---

### Senaryo C5 – Satış Fırsatları
**Kullanıcı:** "Açık satış fırsatları neler" / "Bu ayki fırsatlar"
**Claude yapacağı:**
```json
{ "endpoint": "SalesOpportunities", "method": "GET",
  "params": { "$filter": "Status eq 'fn_Open'", "$orderby": "OpeningDate desc",
              "$select": "SequentialNo,CardCode,CardName,OpportunityName,Potential,PredictedClosingDate",
              "$top": "20" } }
```

---

### Senaryo C6 – Yeni Satış Fırsatı Ekle
**Kullanıcı:** "MB00001 için yeni fırsat ekle: Yazılım lisans yenileme, 50000 TL, Mayıs sonuna kadar"
**Claude yapacağı:**
```json
{ "endpoint": "SalesOpportunities", "method": "POST", "params": {},
  "body": { "CardCode": "MB00001", "OpportunityName": "Yazılım lisans yenileme",
            "OpeningDate": "BUGÜN", "PredictedClosingDate": "2026-05-31",
            "Status": "fn_Open", "Potential": 50000 } }
```

---

### Senaryo C7 – Adayı Müşteriye Dönüştür
**Kullanıcı:** "L00042 adayını müşteriye dönüştür"
**Claude yapacağı:**
```json
{ "endpoint": "BusinessPartners('L00042')", "method": "PATCH", "params": {},
  "body": { "CardType": "cCustomer" } }
```
