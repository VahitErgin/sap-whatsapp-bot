# SAP WhatsApp Bot — Kurulum Kılavuzu

## İçindekiler

1. [Gereksinimler](#1-gereksinimler)
2. [Kurulum](#2-kurulum)
3. [WhatsApp Business API Kurulumu](#3-whatsapp-business-api-kurulumu)
4. [SAP B1 Yapılandırması](#4-sap-b1-yapılandırması)
5. [Webhook Yayına Alma](#5-webhook-yayına-alma)
6. [İlk Çalıştırma](#6-i̇lk-çalıştırma)
7. [Yönetim Paneli](#7-yönetim-paneli)
8. [Otomatik Başlatma](#8-otomatik-başlatma)
9. [Sorun Giderme](#9-sorun-giderme)

---

## 1. Gereksinimler

### Sunucu
| Gereksinim | Minimum | Önerilen |
|---|---|---|
| İşletim sistemi | Windows Server 2016 | Windows Server 2019/2022 |
| RAM | 2 GB | 4 GB |
| Disk | 1 GB boş alan | 5 GB |
| Node.js | v18 LTS | v20 LTS |

### Ağ
- SAP B1 Service Layer'a erişim (varsayılan port **50000**)
- SAP SQL Server'a erişim (MSSQL: **1433**, HANA: **30015**)
- İnternet erişimi (Meta API, Anthropic API, OpenAI API)
- Dışarıdan erişilebilir HTTPS endpoint (webhook için)

### Harici Hesaplar
| Servis | Zorunlu | Açıklama |
|---|---|---|
| Meta Developer | ✅ | WhatsApp Business API için |
| Anthropic | ✅ | Claude AI — doğal dil işleme |
| OpenAI | ⬜ | Sesli mesaj desteği için |
| Azure AD | ⬜ | Outlook Takvim entegrasyonu için |

---

## 2. Kurulum

### Node.js Yükleme

1. [nodejs.org](https://nodejs.org) adresinden **LTS** sürümü indirin
2. Kurulumu tamamlayın
3. Doğrulama:
   ```
   node -v
   npm -v
   ```

### Bot Kurulum Sihirbazı

Proje klasörünü açın, `setup.bat` dosyasına **sağ tıklayıp → Yönetici olarak çalıştır** seçin.

Sihirbaz sırayla şunları sorar:

**Adım 1 — SAP Service Layer**
- Service Layer URL: `https://SAP-SUNUCU:50000/b1s/v2/`
- Şirket veritabanı adı (ör: `ENDEKS`)
- Birden fazla veritabanı varsa noktalı virgülle: `DB1;DB2`
- SAP kullanıcı adı ve şifre
- Bağlantı otomatik test edilir

**Adım 2 — SAP SQL Veritabanı**
- Tip: `mssql` (varsayılan) veya `hana`
- SQL Server IP/hostname
- Port (MSSQL: `1433`, HANA: `30015`)
- Veritabanı adı, kullanıcı, şifre
- Bağlantı otomatik test edilir

**Adım 3 — WhatsApp Business API**
- Phone Number ID (Meta Developer Console'dan)
- Access Token (EAAxxxx ile başlar)
- Verify Token: kendi belirlediğiniz herhangi bir kelime

**Adım 4 — Anthropic API**
- [console.anthropic.com](https://console.anthropic.com) adresinden alın
- `sk-ant-api03-...` formatında

**Adım 5 — OpenAI Whisper** *(isteğe bağlı)*
- Sesli mesajları metne çevirmek için
- [platform.openai.com](https://platform.openai.com) adresinden alın

**Adım 6 — Yönetim Paneli**
- Admin kullanıcı adı ve şifre belirleyin
- Session secret otomatik oluşturulur

**Adım 7 — Uygulama Ayarları**
- Port numarası (varsayılan: `3000`)
- SAP oturum süresi (varsayılan: `480` dakika)
- Onay yetkilisi telefon numaraları (virgülle, `905XXXXXXXXX` formatında)

**Adım 8 — Outlook Takvim** *(isteğe bağlı)*
- Azure AD App Registration bilgileri
- `Calendars.ReadWrite` uygulama izni gereklidir

**Adım 9 — Windows Görev Zamanlayıcı** *(isteğe bağlı)*
- Bot'un Windows başlangıcında otomatik başlaması için
- Yönetici yetkisiyle çalıştırılmalıdır

Kurulum tamamlandığında `.env` dosyası oluşturulur.

---

## 3. WhatsApp Business API Kurulumu

### Meta Developer Console

1. [developers.facebook.com](https://developers.facebook.com) adresine gidin
2. **My Apps → Create App → Business** seçin
3. Uygulamaya WhatsApp ürününü ekleyin

### Phone Number ID ve Access Token

1. Sol menü: **WhatsApp → API Setup**
2. **Phone Number ID** değerini kopyalayın → `.env` → `WA_PHONE_NUMBER_ID`
3. **Temporary Access Token** kopyalayın → `.env` → `WA_ACCESS_TOKEN`

> **Not:** Kalıcı token için System User oluşturmanız gerekir:
> **Business Settings → System Users → yeni kullanıcı → WhatsApp hesabına tam erişim**

### Webhook Yapılandırması

Bot çalışır durumdayken:

1. Sol menü: **WhatsApp → Configuration → Webhook**
2. **Edit** butonuna basın:
   - **Callback URL:** `https://ALAN-ADINIZ/webhook`
   - **Verify Token:** `.env` dosyasındaki `WA_VERIFY_TOKEN` değeri
3. **Verify and save**
4. **Webhook fields** bölümünden **messages** kutusunu işaretleyin → **Subscribe**

### WhatsApp Mesaj Şablonları

Servis bildirimleri için şablon onaylatın:

1. **WhatsApp → Message Templates → Create Template**
2. **Category:** Utility
3. **Name:** `servis_durum_guncelleme` (`.env` → `SERVIS_NOTIF_TEMPLATE` ile aynı)
4. Şablon içeriği ve onay süreci Meta tarafından yönetilir (genellikle 24 saat)

---

## 4. SAP B1 Yapılandırması

### Service Layer Aktif Etme

SAP B1 sunucusunda Service Layer kurulu ve çalışır olmalıdır.

Kontrol:
```
https://SAP-SUNUCU:50000/b1s/v2/$metadata
```
Yanıt XML dönüyorsa aktiftir.

### Kullanıcı Telefon Numaraları

Bot'a bağlanacak her SAP kullanıcısı için:

1. SAP → **Administration → Setup → General → Users**
2. İlgili kullanıcıyı açın
3. **Mobile Phone** alanına WhatsApp numarasını girin
4. Format: `905XXXXXXXXX` *(ülke kodu dahil, + işareti olmadan)*

### Müşteri Yetkili İletişim Kişileri

Müşteri portalı için:

1. SAP → **Business Partners → ilgili müşteri → Contact Persons**
2. Her yetkili kişinin **Mobile** alanını doldurun
3. Aynı format: `905XXXXXXXXX`

### Onay Yetkilileri

Satın alma onayları için (`.env` → `APPROVER_PHONES` veya admin panelden):

- Her onay yetkilisinin SAP kullanıcısı olması **şart değildir**
- Sadece telefon numarası tanımlı olması yeterlidir
- Birden fazla yetkili varsa virgülle: `905001112233,905004445566`

### SQL Server İzinleri

Bot sadece **okuma** yapan sorgular çalıştırır. Önerilen izin seti:

```sql
-- SAP veritabanında çalıştırın
CREATE LOGIN sawbot_user WITH PASSWORD = 'GucluBirSifre!';
USE [SIRKET_DB];
CREATE USER sawbot_user FOR LOGIN sawbot_user;
EXEC sp_addrolemember 'db_datareader', 'sawbot_user';
```

---

## 5. Webhook Yayına Alma

WhatsApp webhook **HTTPS** gerektirmektedir. Birkaç seçenek:

### Seçenek A — Cloudflare Tunnel (Önerilen, Ücretsiz)

```bash
# cloudflared.exe indir: https://github.com/cloudflare/cloudflare-warp-installer
cloudflared tunnel --url http://localhost:3000
```

Çıktıdaki `https://xxxx.trycloudflare.com` adresini webhook URL olarak kullanın.  
Kalıcı domain için [Cloudflare Zero Trust](https://one.cloudflare.com) üzerinden tunnel oluşturun.

### Seçenek B — IIS Reverse Proxy

IIS'te **Application Request Routing (ARR)** ve **URL Rewrite** modülleri kurulu olmalıdır.

`web.config` örneği:
```xml
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="SAP WhatsApp Bot" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:3000/{R:1}" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

### Seçenek C — ngrok (Test Amaçlı)

```bash
ngrok http 3000
```

> Her yeniden başlatmada URL değişir, production için uygun değildir.

---

## 6. İlk Çalıştırma

### Başlatma

```bash
node src/index.js
```

veya `start.bat` çift tıklayın.

Başarılı başlangıç çıktısı:
```
[BOT] Sunucu dinleniyor: http://0.0.0.0:3000
[SAP] Service Layer bağlantısı hazır
[DB]  SQL bağlantısı hazır
```

### Bağlantı Testi

```bash
node test-sap.js
```

Bu script SAP Service Layer ve SQL bağlantılarını test eder.

### İlk Mesaj Testi

1. Bot'u başlatın
2. SAP'ta `Mobile Phone` tanımlı bir kullanıcıdan WhatsApp mesajı gönderin
3. Bot "Merhaba" yanıtı dönüyorsa kurulum tamamdır

---

## 7. Yönetim Paneli

Tarayıcıdan erişin:
```
http://SUNUCU-IP:3000/admin
```

### Panel Bölümleri

| Bölüm | Açıklama |
|---|---|
| Dashboard | Anlık durum, bağlı kullanıcı sayısı |
| Kullanıcılar | WhatsApp kullanıcılarını listele / kaldır |
| Onay Yetkilileri | Satın alma onay listesi yönetimi |
| Ayarlar | .env değerlerini arayüzden düzenle |
| WhatsApp Şablonları | Bildirim şablonlarını yönet |
| Görevler | Arka plan job durumları |
| Loglar | Mesaj ve hata kayıtları |

---

## 8. Otomatik Başlatma

### Windows Görev Zamanlayıcı (Kurulum sihirbazından atlandıysa)

PowerShell'i **Yönetici olarak** açın:

```powershell
$action    = New-ScheduledTaskAction -Execute 'node' -Argument '"C:\Bot\src\index.js"' -WorkingDirectory 'C:\Bot'
$trigger   = New-ScheduledTaskTrigger -AtStartup
$settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'SAP WhatsApp Bot' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
```

### Başlatma / Durdurma

```powershell
Start-ScheduledTask  -TaskName 'SAP WhatsApp Bot'
Stop-ScheduledTask   -TaskName 'SAP WhatsApp Bot'
Get-ScheduledTask    -TaskName 'SAP WhatsApp Bot' | Select-Object State
```

---

## 9. Sorun Giderme

### Bot mesajlara yanıt vermiyor

1. `node src/index.js` çalışıyor mu? → `start.bat` ile başlatın
2. Webhook URL erişilebilir mi? → Tarayıcıdan `https://ALANADI/webhook` açın, `200 OK` gelmeli
3. Meta Console → **WhatsApp → Configuration → Webhook** → durum yeşil mi?
4. `data/logs/` klasöründeki log dosyalarını inceleyin

### SAP bağlantı hatası

```
[SAP] Login hatası: ...
```

- Service Layer URL'si doğru mu? (`https://` ile başlamalı, `/b1s/v2/` ile bitmeli)
- SAP kullanıcısı aktif mi? (SAP'ta oturum açarak kontrol edin)
- Sunucu güvenlik duvarı port 50000'e izin veriyor mu?

### SQL bağlantı hatası

```
[DB] Bağlantı hatası: ...
```

- SQL Server IP ve port doğru mu?
- `test-sap.js` çalıştırarak spesifik hatayı görün
- SQL Server'da TCP/IP protokolü aktif mi? (SQL Server Configuration Manager)
- Güvenlik duvarı port 1433'e izin veriyor mu?

### Webhook doğrulama başarısız

- `.env` → `WA_VERIFY_TOKEN` ile Meta Console'daki token birebir aynı mı?
- HTTPS sertifikası geçerli mi?
- Sunucu dışarıdan erişilebilir mi?

### Lisans hatası

```
[LIC] Geçersiz lisans
```

- `data/license.lic` dosyasının mevcut olduğunu kontrol edin
- Sağlayıcıdan aldığınız `.lic` dosyasını `data/` klasörüne kopyalayın

### Log konumları

| Log | Konum |
|---|---|
| Uygulama logları | `data/logs/app-YYYY-MM-DD.log` |
| Mesaj geçmişi | `data/message-log.jsonl` |
| Konsoldan anlık | `node src/index.js` çalıştırın |


# 1. Kodu değiştir, commit et
git archive --format=zip --output=sawbot-v1.1.zip HEAD

# 2. Zip'i müşteriye gönder


1. sawbot-v1.1.zip'i bot klasörüne koy
2. update.bat → Yönetici olarak çalıştır
3. Bitti

update.bat sırasıyla şunları yapar:

Windows servisini durdurur
.env ve data/'ya dokunmaz (zip içinde yok zaten)
Yeni dosyaları üzerine açar
npm install çalıştırır (yeni paket geldiyse kurar)
Servisi yeniden başlatır
Eski ve yeni versiyon numarasını ekranda gösterir
