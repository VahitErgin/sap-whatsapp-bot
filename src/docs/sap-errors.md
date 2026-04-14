# SAP Business One – Yaygın Hatalar ve Çözümleri

## Hata Kategorileri

1. [Stok Hataları](#stok-hataları)
2. [Muhasebe / Hesap Hataları](#muhasebe--hesap-hataları)
3. [Belge / Fatura Hataları](#belge--fatura-hataları)
4. [Onay / Yetki Hataları](#onay--yetki-hataları)
5. [Bağlantı / Sistem Hataları](#bağlantı--sistem-hataları)
6. [Cari Hataları](#cari-hataları)
7. [Vergi Hataları](#vergi-hataları)

---

## Stok Hataları

### Hata: "Item has no price in the selected price list"
**Açıklama:** Ürünün seçili fiyat listesinde fiyatı tanımlı değil.
**Çözüm:**
- Stok → Fiyat Listesi menüsüne gir
- İlgili ürünü bul, fiyatını tanımla
- Veya belge oluştururken farklı fiyat listesi seç

### Hata: "This item is not managed by warehouse"
**Açıklama:** Ürün, hedef depoda tanımlı değil.
**Çözüm:**
- Stok → Ürün Kartı → Stok Verileri sekmesine gir
- İlgili depoyu aktif hale getir

### Hata: "Quantity is not sufficient"
**Açıklama:** Yeterli stok yok.
**Çözüm:**
- Stok → Stok Raporları → Stok Durumu ile mevcut miktarı kontrol et
- Satın alma siparişi oluştur veya stok girişi yap
- Negatif stoka izin veriliyorsa: Yönetim → Sistem Ayarları → Belge Ayarları

### Hata: "-10 Stok miktarı yetersiz"
**Açıklama:** SAP B1'de en yaygın stok hatasıdır. Stok hareketi sırasında stok sıfırın altına düşüyor.
**Çözüm:**
- Stok → Stok Raporları → Stok Hareketleri ile geçmişe bak
- Açık satış siparişlerini kontrol et
- Gerekirse stok düzeltme girişi yap (Stok → Stok Girişleri)

### Hata: "Cannot print - no default printer"
**Açıklama:** Yazıcı tanımlı değil.
**Çözüm:** Yönetim → Kurulum → Yazıcı Yönetimi

---

## Muhasebe / Hesap Hataları

### Hata: "Account is inactive"
**Açıklama:** Kullanılan muhasebe hesabı pasife alınmış.
**Çözüm:**
- Muhasebe → Hesap Planı'na gir
- İlgili hesabı bul, "Aktif" olarak işaretle

### Hata: "No matching records found (ODBC -2028)"
**Açıklama:** Kayıt bulunamadı. Genellikle silinmiş veya yanlış kodlanmış bir kayıt referansı.
**Çözüm:**
- İlgili alandaki kodu kontrol et
- Kayıt silinmiş olabilir, yeni kayıt oluştur
- SQL sorgusuyla kaydın varlığını doğrula

### Hata: "Unbalanced transaction"
**Açıklama:** Yevmiye kaydında borç-alacak dengesi tutmuyor.
**Çözüm:**
- Yevmiye satırlarının toplamlarını kontrol et
- Borç toplamı = Alacak toplamı olmalı
- Dövizli işlemlerde kur farkı satırı gerekebilir

### Hata: "Fiscal year is closed"
**Açıklama:** Kapatılmış hesap dönemine kayıt girmeye çalışıyorsun.
**Çözüm:**
- Muhasebe → Dönem Sonu İşlemleri → Dönem Durumu
- Dönemi yeniden aç (yetkili onayı gerekir)
- Veya doğru döneme kayıt gir

### Hata: "No G/L account defined for this transaction"
**Açıklama:** İlgili işlem tipi için muhasebe hesabı tanımlanmamış.
**Çözüm:**
- Yönetim → Kurulum → Muhasebe → G/L Hesap Belirleme
- İlgili kategori için hesap tanımla

---

## Belge / Fatura Hataları

### Hata: "Document is already closed"
**Açıklama:** Kapatılmış bir belgeyi düzenlemeye çalışıyorsun.
**Çözüm:**
- Kapatılmış belge düzenlenemez
- İptal edip yeni belge oluştur
- Veya kredi notu / iade belgesi oluştur

### Hata: "Cannot cancel - document has been copied to"
**Açıklama:** Belge başka bir belgeye (irsaliye, fatura) kopyalanmış, iptal edilemiyor.
**Çözüm:**
- Önce hedef belgeyi iptal et
- Sonra kaynak belgeyi iptal et
- Belge zincirini ters sırada çöz

### Hata: "Posting period is closed"
**Açıklama:** Belge tarihi kapalı bir döneme denk geliyor.
**Çözüm:**
- Muhasebe → Dönem Yönetimi → Dönem Durumu
- İlgili dönemi aç veya belge tarihini değiştir

### Hata: "Base document has already been fully copied"
**Açıklama:** Referans alınan belge tamamen kullanılmış.
**Çözüm:**
- Kaynak belgede kalan miktar/tutar kalmamış
- Yeni bir sipariş veya temel belge oluştur

---

## Onay / Yetki Hataları

### Hata: "You are not authorized to perform this action"
**Açıklama:** Kullanıcının yetkisi yok.
**Çözüm:**
- Yönetim → Kurulum → Yetkiler → Genel Yetkiler
- İlgili kullanıcıya gerekli yetkiyi ver
- Veya yöneticiden yetki talep et

### Hata: "Document requires approval"
**Açıklama:** Belge onay prosedürüne girmiş, onay bekleniyor.
**Çözüm:**
- Yetkili onaylayana bildir
- SAP → Onay Prosedürleri → Bekleyen Onaylar
- WhatsApp üzerinden ONAY komutu ile de onaylanabilir

### Hata: "Approval procedure - deviation from price"
**Açıklama:** Fiyat sapması onay limitini aştı.
**Çözüm:**
- Fiyatı gözden geçir
- Veya yetkili onayını bekle

---

## Bağlantı / Sistem Hataları

### Hata: "Cannot connect to the company database"
**Açıklama:** SAP B1 şirket veritabanına bağlanılamıyor.
**Çözüm:**
- SAP B1 servislerinin çalıştığını kontrol et
- SQL Server servisi aktif mi?
- Ağ bağlantısını kontrol et
- Şirket veritabanı adını doğrula

### Hata: "Session expired" / "401 Unauthorized"
**Açıklama:** Oturum süresi dolmuş (SAP Service Layer 30 dk sonra oturumu kapatır).
**Çözüm:**
- Otomatik yeniden login yapılır
- Sorun devam ederse SAP sunucusunu kontrol et

### Hata: "License server is not available"
**Açıklama:** SAP lisans sunucusuna ulaşılamıyor.
**Çözüm:**
- SAP License Manager servisini yeniden başlat
- Lisans sunucusu IP/hostname ayarını kontrol et
- Lisans süresi dolmuş olabilir, SAP ile iletişime geç

### Hata: "Maximum number of concurrent users reached"
**Açıklama:** Aynı anda açık kullanıcı sayısı lisans limitini aştı.
**Çözüm:**
- Aktif kullanıcıları kontrol et: Yönetim → Lisans → Kullanıcı Aktivitesi
- Kullanılmayan oturumları kapat
- Veya ek lisans satın al

---

## Cari Hataları

### Hata: "Business partner not found"
**Açıklama:** Girilen cari kodu sistemde yok.
**Çözüm:**
- Cari kodunu doğru girdiğini kontrol et
- İş Ortakları → İş Ortağı Ara ile ara
- Cari silinmiş veya pasife alınmış olabilir

### Hata: "Credit limit exceeded"
**Açıklama:** Müşterinin kredi limiti aşılmış.
**Çözüm:**
- Cari kartında kredi limitini artır
- Veya mevcut bakiyeyi tahsil et
- Yönetici onayıyla devam et

### Hata: "Dunning letter - customer is blocked"
**Açıklama:** Müşteri bloke edilmiş, işlem yapılamıyor.
**Çözüm:**
- Cari kartında "Bloke" işaretini kaldır
- Önce vadesi geçmiş alacakları tahsil et

---

## Vergi Hataları

### Hata: "Tax code not defined"
**Açıklama:** Vergi kodu tanımlı değil veya geçersiz.
**Çözüm:**
- Muhasebe → Vergi → Vergi Kodları
- İlgili vergi kodunu tanımla veya düzelt
- Ürün/cari kartındaki vergi kodu atamasını kontrol et

### Hata: "Tax group mismatch"
**Açıklama:** Cari ve ürün vergi grupları uyuşmuyor.
**Çözüm:**
- Cari kartında vergi grubunu kontrol et
- Ürün kartında vergi grubunu kontrol et
- Tutarlı hale getir

---

## Hızlı Referans – Hata Kodu Tablosu

| Kod | Açıklama |
|-----|----------|
| -10 | Stok miktarı yetersiz |
| -2028 | Eşleşen kayıt bulunamadı (ODBC) |
| -1029 | Dönem kapalı |
| -1035 | Hesap tanımlanmamış |
| -5002 | Yetki hatası |
| -5003 | Lisans hatası |
| 301 | Onay prosedürü gerekli |
| 401 | Oturum süresi dolmuş |
