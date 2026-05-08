# SAWBot — SAP WhatsApp Bot
## Ürün Tanıtım ve Satış Sunumu

---

## "SAP'ınız artık cebinizde"

SAWBot; SAP Business One kullanıcılarının WhatsApp üzerinden anlık veri sorgulamasını, satın alma onaylarını yönetmesini, servis taleplerini takip etmesini ve CRM aktivitelerini kaydetmesini sağlayan yapay zeka destekli bir kurumsal asistan platformudur.

**Uygulama yok. Eğitim yok. Sadece WhatsApp.**

---

## Neden SAWBot?

| Geleneksel Yöntem | SAWBot ile |
|---|---|
| Ofiste bilgisayar başında SAP açmak | Telefondan WhatsApp ile sormak |
| IT'den rapor beklemek | Anlık yanıt, gerçek zamanlı veri |
| Onay için e-posta zinciri | WhatsApp butonu ile tek dokunuş |
| Saha ekibi bağlanamıyor | İnternet olan her yerden erişim |
| Müşteri "durumu ne oldu?" diye arıyor | Otomatik WhatsApp bildirimi geliyor |

---

## Kimler Kullanır?

### Şirket İçi Kullanıcılar (SAP Kullanıcıları)
- Genel Müdür / Yöneticiler → anlık finansal tablolar
- Muhasebe / Finans → cari ekstre, bakiye, tahsilat
- Satış Ekibi → stok, fiyat, sipariş takibi
- Satın Alma → onay yönetimi
- Teknik Servis → servis talebi açma ve takip
- Saha Temsilcileri → CRM aktivite kaydı, ziyaret notu

### Müşteri Portalı (Harici Kullanıcılar)
- Müşteri yetkilileri → kendi hesap ekstresi, siparişler, servis durumu
- Güvenli erişim: yalnızca kendi verilerini görür

---

## Özellikler ve Kabiliyetler

---

### 1. Doğal Dil ile SAP Sorgusu

Kullanıcı normal Türkçe ile yazar, SAWBot anlar ve SAP'tan cevabı getirir.

**Örnek sorular:**
> "Bu ay ABC Şirketi'nden ne kadar tahsilat yaptık?"
> "Depoda satılmayan ürünler hangileri?"
> "Ahmet Bey'in açık siparişleri var mı?"
> "Geçen haftaki teslimatları göster"
> ""Enter valid federal tax ID"  hatası çözümü nasıl olmalıdır."
> "sap b1 de ithalat süreci nasıl oluyor"

**Desteklenen Sorgular:**

#### Finans & Cari
- Cari ekstre (altın ok / waterfall eşleme ile)
- Vadesi geçen alacaklar (en eski vadeye göre sıralı)
- Tahsilat listesi (nakit, çek, EFT, kredi kartı ayrımıyla)
- Banka ve kasa bakiyeleri (çoklu döviz)
- Müşteri borç/alacak özeti

#### Satış Analitiği
- Ürüne göre satış tutarları
- Kategoriye göre satış
- Markaya göre satış
- Satış temsilcisine göre performans karşılaştırması

#### Stok
- Stoktaki ürünler ve fiyat listesi
- Satışı olmayan ürünler (hareketsiz stok tespiti)
- Seri numaralı stok (müşteri ve depoya göre)
- Açık satış siparişleri (satır bazında)
- Günün teslimatları / irsaliye detayı

#### Teknik Servis
- Servis çağrısı durumu (müşteri, seri no veya çağrı numarasıyla)
- Açık / kapalı filtresi
- Tarih aralığı filtresi

---

### 2. Satın Alma Onay Sistemi

SAP'ta onay bekleyen belgeler otomatik olarak yetkililerin WhatsApp'ına düşer.

**Akış:**
1. SAP'ta bir sipariş/fatura onay sürecine girer
2. SAWBot ilgili onay yetkilisine anında WhatsApp mesajı gönderir
3. Mesajda: belge tipi, tutar, firma, açıklama
4. İki buton: **✅ Onayla** veya **❌ Reddet**
5. Karar SAP'a otomatik işlenir, kayıt oluşur

**Desteklenen Belge Tipleri (23 adet):**
Satış teklifi, satış siparişi, satış faturası, alış siparişi, alış faturası, iade, mutabakat, stok transferi ve daha fazlası.

**Özellikler:**
- Her 2 dakikada bir yeni onay kontrolü
- Aynı belge için tekrar bildirim gönderilmez
- Birden fazla onay yetkilisi tanımlanabilir
- Onay kaydı SAP'ta "WhatsApp üzerinden onaylandı" notu ile saklanır

---

### 3. Otomatik Belge Bildirimleri

Fatura veya irsaliye kesildiğinde müşteriye otomatik WhatsApp gönderilir.

**E-Fatura bildirimi:**
> "Sayın [Müşteri], [tarih] tarihli [tutar] TL tutarlı e-faturanız düzenlenmiştir. Görüntülemek için: [link]"

**İrsaliye bildirimi:**
> "Sayın [Müşteri], [belge no] numaralı sevk irsaliyeniz oluşturulmuştur."

- Her 3 dakikada yeni belge kontrolü
- Müşteri telefonu SAP'taki OCRD kaydından otomatik alınır
- Meta onaylı WhatsApp şablonları kullanılır
- Bildirim gönderilmeyecek numaralar hariç tutulabilir

---

### 4. Servis Çağrısı Takip ve Bildirim

#### Servis Talebi Açma (Wizard)
Kullanıcı adım adım yönlendirilerek SAP'ta servis çağrısı oluşturur:
1. Müşteri seçimi
2. Seri numarası girişi
3. Problem açıklaması
4. Öncelik: Normal / Yüksek / Acil
5. Onay ekranı → SAP'a kayıt

#### Otomatik Durum Bildirimi
Servis çağrısının durumu değiştiğinde ilgili kişiye WhatsApp gönderilir:
> "12345 numaralı servis çağrınızın durumu güncellendi: Teknik incelemede"

- Her 2 dakikada durum değişikliği kontrolü
- Yalnızca gerçek değişiklikte bildirim (spam yok)

---

### 5. CRM — Aktivite ve Müşteri Adayı Yönetimi

Saha ekibi ziyaret dönüşünde veya görüşme anında aktivite kaydeder.

**Desteklenen Aktivite Tipleri:**
Telefon görüşmesi, Toplantı, Ziyaret, E-posta, Not, Görev

**Wizard Adımları:**
1. Firma seçimi
2. Aktivite tipi
3. Kategori
4. Konu / başlık
5. Tarih ve saat
6. Konum (isteğe bağlı)
7. Ek dosya (PDF, Word, Excel, görsel — isteğe bağlı)
8. Kaydet

Tüm kayıtlar SAP'taki Activities tablosuna işlenir.

#### Müşteri Adayı Ekleme
Saha temsilcisi yeni potansiyel müşteriyi anında sisteme ekler:
- Ad, telefon, e-posta, sektör, notlar
- SAP'ta Lead (L00xxx) olarak oluşturulur

---

### 6. Sesli Mesaj Desteği

Yazmak istemeyenler sesli mesaj gönderebilir.

- WhatsApp sesli mesajı OpenAI Whisper ile metne çevrilir
- Türkçe transkripsiyon
- Metin olarak işlenip yanıt verilir

---

### 7. Müşteri Portalı

Harici kullanıcılar (müşteri yetkilileri) sisteme dahil edilebilir.

**Müşteri ne yapabilir:**
- Kendi cari ekstresini sorgular
- Kendi açık siparişlerini görür
- Servis taleplerini takip eder
- Servis talebi açar

**Güvenlik:**
- Müşteri yalnızca kendi verilerine erişir
- Başka firmaları sorgulayamaz (otomatik kilitli)
- SAP'taki ilgili kişi (OCPR) kaydına bağlı çalışır

---

### 8. Çok Dil Desteği

Kullanıcı tercihine göre bot dili değiştirilebilir:
- 🇹🇷 Türkçe
- 🇬🇧 İngilizce
- 🇸🇦 Arapça

---

### 9. Yönetim Paneli

Web tarayıcısından erişilen admin paneli:

| Bölüm | Açıklama |
|---|---|
| Dashboard | Anlık kullanıcı sayısı, bağlantı durumu |
| Kullanıcılar | Kayıtlı WhatsApp kullanıcılarını yönet |
| Onay Yetkilileri | Satın alma onay listesi |
| Ayarlar | Tüm konfigürasyon arayüzden yönetilebilir |
| WhatsApp Şablonları | Bildirim şablonları |
| Görevler | Arka plan job'ları izle |
| Loglar | Mesaj geçmişi ve hata kayıtları |

---

## Teknik Altyapı

| Özellik | Detay |
|---|---|
| Kurulum | Windows Server (mevcut SAP sunucusuna) |
| SAP Entegrasyonu | Service Layer API + Direkt SQL |
| SAP Versiyonu | SAP Business One (MSSQL veya HANA) |
| WhatsApp | Meta Cloud API (resmi) |
| Yapay Zeka | Anthropic Claude (doğal dil anlama) |
| Sesli Mesaj | OpenAI Whisper |
| Uygulama | İstemci tarafında kurulum gerekmez |
| Güncelleme | Merkezi — tüm kullanıcılar aynı anda |
| Lisans | Kullanıcı sayısına göre |

---

## Kurulum ve Onboarding

1. SAP sunucusuna 30 dakikada kurulum (`setup.bat` ile)
2. WhatsApp Business API bağlantısı (Meta Developer Console)
3. SAP kullanıcı telefonlarının tanımlanması (Mobile Phone alanı)
4. Kullanıcılar hemen başlar — uygulama yok, eğitim minimum

---

## Örnek Kullanım Senaryoları

**Genel Müdür — sabah 07:30, ofis yolunda:**
> "Dünkü tahsilatlar ne kadar?"
> → Bot: 3 firma, toplam 485.000 TL, 2 EFT 1 çek

**Muhasebe — müşteri arıyor:**
> "ABC Ltd bakiyesi ne?"
> → Bot: 142.500 TL borç, en eski vade 46 gün önce

**Satın Alma Yöneticisi — toplantıda:**
> WhatsApp: "Akaryakıt alım siparişi onay bekliyor — 85.000 TL — [Onayla] [Reddet]"
> → [Onayla] butonuna basar, SAP'a işlenir

**Saha Temsilcisi — müşteri ziyareti dönüşü:**
> Telefon görüşmesi aktivitesi kaydeder, SAP'a işlenir, yöneticisi görür

**Müşteri — servis durumunu merak ediyor:**
> WhatsApp otomatik mesaj: "Servis çağrınız teknik incelemeye alındı"

---

## Lisanslama

| Paket | Kapsam |
|---|---|
| Başlangıç | 5 dahili kullanıcıya kadar |
| Profesyonel | 20 kullanıcıya kadar + müşteri portalı |
| Kurumsal | Sınırsız kullanıcı + tüm özellikler |

*Fiyatlandırma için iletişime geçin.*

---

## İletişim

**Vahit Ergin**
vahitergin@gmail.com
