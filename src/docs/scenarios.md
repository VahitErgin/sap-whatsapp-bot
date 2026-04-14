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

### Senaryo 4 – Vadesi Geçmiş Alacaklar
**Kullanıcı:** "Vadesi geçmiş alacaklarımız ne kadar?"
**Claude yapacağı:**
- `Invoices` → `DocDueDate lt bugün` filtresi ile açık faturaları getir
- Toplam ve cari bazında özetle

---

## Cari Sorguları

### Senaryo 5 – Cari Arama
**Kullanıcı:** "Yıldız firmasının kodu ne?" veya "Yıldız cari kartı"
**Claude yapacağı:**
- `BusinessPartners` → `contains(CardName,'Yıldız')` ile ara

---

### Senaryo 6 – Cari Bakiye
**Kullanıcı:** "S002 tedarikçisine ne kadar borcumuz var?"
**Claude yapacağı:**
- `BusinessPartners('S002')` → Balance alanını getir

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
