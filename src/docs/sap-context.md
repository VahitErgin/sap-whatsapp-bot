# SAP Business One Service Layer – API Referansı

## Genel Bilgi

- Base URL: `https://<server>:50000/b1s/v1/`
- Protokol: OData v4 (REST/JSON)
- Kimlik doğrulama: Cookie tabanlı session (B1SESSION)
- Tüm tarihler: `YYYY-MM-DD` formatında
- Para birimleri: string olarak gelir (`"TRY"`, `"USD"`, `"EUR"`)

---

## Kimlik Doğrulama

### Login
```
POST /Login
Body: { "CompanyDB": "TESTFKC", "UserName": "manager", "Password": "xxx" }
Response Header: Set-Cookie: B1SESSION=abc123
```

### Logout
```
POST /Logout
Header: Cookie: B1SESSION=abc123
```

---

## Cari (Business Partners)

### Endpoint: `BusinessPartners`

#### Tek cari sorgula (bakiye dahil TÜM alanlar gelir — $select KULLANMA)
```
GET /BusinessPartners('C001')
```

#### Önemli alanlar
| Alan | Açıklama |
|------|----------|
| CardCode | Cari kodu (PK) |
| CardName | Cari adı |
| CardType | cCustomer / cSupplier / cLead |
| Balance | Güncel bakiye (⚠️ $select ile istenemez, $select olmadan gelir) |
| Phone1 | Telefon |
| EmailAddress | E-posta |
| Currency | Para birimi |
| CreditLimit | Kredi limiti |
| DNoteBalance | İrsaliye bakiyesi |
| OrdersBal | Sipariş bakiyesi |

> ⚠️ ÖNEMLİ: Balance alanı $select parametresinde kullanılamaz.
> Bakiye sorgulamak için $select KULLANMA, tüm entity'yi getir.

#### Müşterileri listele (sadece güvenli alanlar $select'te)
```
GET /BusinessPartners?$filter=CardType eq 'cCustomer'&$select=CardCode,CardName,CardType,Currency
```

#### Tedarikçileri listele
```
GET /BusinessPartners?$filter=CardType eq 'cSupplier'&$select=CardCode,CardName,CardType,Currency
```

#### Belirli carinin bakiyesi ($select OLMADAN sorgula)
```
GET /BusinessPartners('C001')
```

#### Bakiyesi olan cariler ($filter'da Balance kullanılabilir, $select'te değil)
```
GET /BusinessPartners?$filter=Balance ne 0&$orderby=Balance desc&$top=20
```

---

## Satış Faturaları (AR)

### Endpoint: `Invoices`

#### Önemli alanlar
| Alan | Açıklama |
|------|----------|
| DocEntry | SAP iç belge numarası (PK) |
| DocNum | Kullanıcı belge numarası |
| CardCode | Cari kodu |
| CardName | Cari adı |
| DocDate | Fatura tarihi |
| DocDueDate | Vade tarihi |
| DocTotal | Toplam tutar |
| PaidToDate | Ödenen tutar |
| DocumentStatus | bost_Open / bost_Close |
| Cancelled | tYES / tNO |
| Comments | Açıklama |
| DocCurrency | Döviz |
| DocumentLines | Fatura kalemleri (array) |

#### Açık faturaları listele
```
GET /Invoices?$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'
  &$select=DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,PaidToDate
  &$orderby=DocDueDate asc
```

#### Belirli cari faturaları
```
GET /Invoices?$filter=CardCode eq 'C001' and DocumentStatus eq 'bost_Open'
```

#### Vadesi geçmiş faturaları
```
GET /Invoices?$filter=DocDueDate lt '2024-01-01' and DocumentStatus eq 'bost_Open'
```

---

## Alış Faturaları (AP)

### Endpoint: `PurchaseInvoices`

#### Önemli alanlar (Invoices ile aynı yapı)
| Alan | Açıklama |
|------|----------|
| DocEntry | SAP iç belge numarası |
| DocNum | Belge numarası |
| CardCode | Tedarikçi kodu |
| CardName | Tedarikçi adı |
| DocDate | Fatura tarihi |
| DocDueDate | Vade tarihi |
| DocTotal | Toplam tutar |
| PaidToDate | Ödenen tutar |
| DocumentStatus | bost_Open / bost_Close |

#### Açık alış faturaları
```
GET /PurchaseInvoices?$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'
  &$select=DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,PaidToDate
  &$orderby=DocDueDate asc
```

---

## Satış Siparişleri

### Endpoint: `Orders`

#### Önemli alanlar
| Alan | Açıklama |
|------|----------|
| DocEntry | SAP iç belge numarası |
| DocNum | Sipariş numarası |
| CardCode | Müşteri kodu |
| CardName | Müşteri adı |
| DocDate | Sipariş tarihi |
| DocDueDate | Teslimat tarihi |
| DocTotal | Toplam tutar |
| DocumentStatus | bost_Open / bost_Close |
| DocumentLines | Sipariş kalemleri |

#### Açık siparişler
```
GET /Orders?$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'
```

---

## Satın Alma Siparişleri

### Endpoint: `PurchaseOrders`

#### Önemli alanlar (Orders ile aynı yapı)
| Alan | Açıklama |
|------|----------|
| DocEntry | SAP iç belge numarası |
| DocNum | Sipariş numarası |
| CardCode | Tedarikçi kodu |
| CardName | Tedarikçi adı |
| DocDate | Sipariş tarihi |
| DocDueDate | Teslim tarihi |
| DocTotal | Toplam tutar |
| DocumentStatus | bost_Open / bost_Close |
| ApprovalStatus | Onay durumu |

#### Onay bekleyen siparişler
```
GET /PurchaseOrders?$filter=DocumentStatus eq 'bost_Open' and ApprovalStatus eq 'asPendingApproval'
```

#### Onay aksiyonları
```
POST /PurchaseOrders(DocEntry)/Approve
POST /PurchaseOrders(DocEntry)/Reject
```

---

## Stok / Ürünler

### Endpoint: `Items` (OITM tablosuna karşılık gelir)

> Stok sorgularında her zaman bu endpoint'i kullan. OITM = Items master.

#### Önemli alanlar
| Alan | Açıklama |
|------|----------|
| ItemCode | Ürün kodu (PK) |
| ItemName | Ürün adı |
| QuantityOnStock | Toplam stok miktarı (tüm depolar) |
| QuantityOnOrder | Açık siparişteki miktar |
| AvgStdPrice | Ortalama maliyet |
| SalesPrice | Satış fiyatı |
| ItemType | itItems / itLabor / itTravel |
| Frozen | tYES / tNO (pasif mi?) |

> ⚠️ `SalesPrice` $select'e eklenebilir ama bazı SAP versiyonlarında hata verebilir.
> Fiyat isteniyorsa sadece `AvgStdPrice` kullan.

#### En yüksek stoktaki ürünler
```
GET /Items?$filter=Frozen eq 'tNO'
  &$select=ItemCode,ItemName,QuantityOnStock
  &$orderby=QuantityOnStock desc
  &$top=10
```

#### Stokta azalan ürünler
```
GET /Items?$filter=QuantityOnStock lt 10 and Frozen eq 'tNO'
  &$select=ItemCode,ItemName,QuantityOnStock,AvgStdPrice
  &$orderby=QuantityOnStock asc
```

#### Ürün ara
```
GET /Items?$filter=contains(ItemName,'vida') and Frozen eq 'tNO'
  &$select=ItemCode,ItemName,QuantityOnStock
```

### Depo Hareketleri: `InventoryGenEntries` (OINM tablosuna karşılık gelir)

OINM = tüm depo giriş/çıkış hareketleri.

| Alan | Açıklama |
|------|----------|
| ItemCode | Ürün kodu |
| Quantity | Hareket miktarı (+ giriş, - çıkış) |
| DocDate | Hareket tarihi |
| WarehouseCode | Depo kodu |
| TransType | İşlem tipi |

---

## Muhasebe / Yevmiye

### Endpoint: `JournalEntries`

OJDT (başlık) ve JDT1 (satırlar) tablolarına karşılık gelir.

#### Başlık alanları (OJDT)
| Alan | Açıklama |
|------|----------|
| JdtNum | Yevmiye numarası |
| ReferenceDate | Belge tarihi |
| DueDate | Vade tarihi |
| Memo | Açıklama |
| TransactionCode | İşlem kodu |
| JournalEntryLines | Satırlar (JDT1, array) |

#### Satır alanları — JournalEntryLines (JDT1)
| Alan | Açıklama |
|------|----------|
| ShortName | **Cari kodu (CardCode)** — cari satırlarını bulmak için kullan |
| AccountCode | Muhasebe hesap kodu |
| Debit | Borç tutarı |
| Credit | Alacak tutarı |
| DueDate | **Vade/çek vadesi** — çek kontrolü için kritik |
| TransType | İşlem tipi (aşağıya bak) |
| LineMemo | Satır açıklaması |
| Ref1 | Referans 1 (belge numarası) |

#### TransType değerleri
| Değer | Açıklama |
|-------|----------|
| 13 | Satış Faturası (A/R Invoice) |
| 14 | Satış İade/Alacak Dekontu |
| 18 | Alış Faturası (A/P Invoice) |
| 19 | Alış İade/Borç Dekontu |
| 24 | Gelen Ödeme / Tahsilat (IncomingPayment) |
| 46 | Giden Ödeme (OutgoingPayment) |
| 30 | Yevmiye Fişi (Manuel) |

---

## Cari Hesap Ekstresi / Bakiye (KRİTİK KURAL)

> ⚠️ Bakiye, ekstre, borç/alacak, yürüyen bakiye sorgularında Service Layer KULLANMA.
> `BusinessPartners`, `Invoices`, `IncomingPayments`, `JournalEntries` endpoint'leri bakiye için YASAK.

### DOĞRU YÖNTEM: SQL_CARI_EKSTRE

Sistem içinde tanımlı özel endpoint — OJDT + JDT1 tablolarını direkt sorgular:

```json
{
  "endpoint": "SQL_CARI_EKSTRE",
  "params": {
    "cardCode": "MB00006",
    "refDate": "2026-04-16"
  }
}
```

**Ne yapar:**
- `OJDT INNER JOIN JDT1` ile cari tüm hareketleri çeker
- Debit = borç, Credit = alacak (TRY); FCDebit/FCCredit = dövizli tutar
- Çek kuralı: TransType=24 + OCHH join → vadesi gelmemiş çekler bakiyeye dahil edilmez
- Waterfall eşleştirme: her alacak en eski borçtan düşülür
- Sonuç: sadece açık kalan kalemler + toplam bakiye + bekleyen çek bilgisi

**Tüm carilerin bakiye özeti için:**
```json
{
  "endpoint": "SQL_VADESI_GECENLER",
  "params": { "refDate": "2026-04-16", "cardType": "C" }
}
```
cardType: C = müşteri, S = tedarikçi

---

## Teknik Servis / Hizmet Çağrıları

### View: `BE1_B2BLASTHIZMETSTATUS` (Direkt SQL)
### SAP Tablosu: `OSCL` (Service Calls)

> Servis çağrısı sorguları için endpoint: `SQL_HIZMET`

#### View alanları
| Alan | Açıklama |
|------|----------|
| customer | Müşteri kodu (CardCode) |
| srvcCallID | Servis çağrı numarası |
| internalSN | Ürün seri numarası |
| itemName | Ürün adı |
| GelenBelge | Gelen belge numarası |
| BelgeTarih | Belge tarihi |
| KargoNo | Gelen kargo numarası |
| AdresSube | Şube/adres |
| createDate | Çağrı açılış tarihi |
| Cozum | Çözüm tipi (Upgrade, Sağlam vb.) |
| Durum | Güncel durum (Müşteriye Sevk, Tamirde vb.) |
| TeslimBelgeNo | Teslimat belge numarası |
| TeslimTarihi | Teslimat tarihi |
| TeslimKargo | Teslimat kargo numarası |
| status | Durum kodu (-1=Açık, 0=Kapalı) |
| Telephone | Müşteri telefonu |
| Aciklama | Notlar/açıklama |

#### Kullanım örnekleri (params)
```json
{ "cardCode": "MB00001" }                          → Müşterinin tüm çağrıları
{ "serialNo": "4607123S10190" }                    → Seri no ile ara
{ "callId": "14" }                                 → Çağrı numarası ile ara
{ "cardCode": "MB00001", "statusFilter": "open" }  → Müşterinin açık çağrıları
{ "statusFilter": "open", "top": "10" }            → Son 10 açık çağrı
```

---

## Hesap Planı

### Endpoint: `ChartOfAccounts`

| Alan | Açıklama |
|------|----------|
| Code | Hesap kodu |
| Name | Hesap adı |
| Balance | Bakiye |
| AccountType | at_Assets / at_Liabilities / at_Revenues / at_Expenses |

---

## Gelen Ödemeler (Tahsilat)

### Endpoint: `IncomingPayments`

| Alan | Açıklama |
|------|----------|
| DocEntry | Belge numarası |
| CardCode | Cari kodu |
| DocDate | Ödeme tarihi |
| DocTotal | Toplam |
| PaymentType | Ödeme türü |

---

## Giden Ödemeler

### Endpoint: `VendorPayments`

| Alan | Açıklama |
|------|----------|
| DocEntry | Belge numarası |
| CardCode | Tedarikçi kodu |
| DocDate | Ödeme tarihi |
| DocTotal | Toplam |

---

## OData Sorgu Parametreleri

| Parametre | Açıklama | Örnek |
|-----------|----------|-------|
| `$filter` | Filtrele | `CardCode eq 'C001'` |
| `$select` | Alan seç | `DocNum,CardName,DocTotal` |
| `$orderby` | Sırala | `DocDueDate asc` |
| `$top` | Kaç kayıt | `$top=10` |
| `$skip` | Atla | `$skip=20` |
| `$expand` | İlişkili veri | `$expand=DocumentLines` |

### Filtre operatörleri
| Operatör | Anlamı |
|----------|--------|
| `eq` | Eşit |
| `ne` | Eşit değil |
| `lt` | Küçük |
| `le` | Küçük eşit |
| `gt` | Büyük |
| `ge` | Büyük eşit |
| `and` | Ve |
| `or` | Veya |
| `contains(alan,'değer')` | İçerir |
| `startswith(alan,'değer')` | İle başlar |

### ⚠️ Tarih Filtreleme — KRİTİK KURAL
SAP Service Layer'da `year()`, `month()`, `day()` OData fonksiyonları **ÇALIŞMAZ**.
Tarih aralığı için her zaman `ge` / `le` kullan:

| İstek | YANLIŞ ❌ | DOĞRU ✅ |
|-------|-----------|----------|
| 2025 yılı | `year(DocDate) eq 2025` | `DocDate ge '2025-01-01' and DocDate le '2025-12-31'` |
| Bu ay | `month(DocDate) eq 4` | `DocDate ge '2025-04-01' and DocDate le '2025-04-30'` |
| Bu hafta | `week(DocDate) eq ...` | `DocDate ge '2025-04-14' and DocDate le '2025-04-20'` |
| Bugün | `DocDate eq today()` | `DocDate eq '2025-04-16'` |

---

## Nakit Akışı İçin Kritik Sorgular

### Bugün vadesi gelenler (Alacak)
```
GET /Invoices?$filter=DocDueDate eq '2024-01-15' and DocumentStatus eq 'bost_Open'
```

### Bu hafta vadesi gelenler (Borç)
```
GET /PurchaseInvoices?$filter=DocDueDate ge '2024-01-15' and DocDueDate le '2024-01-22'
  and DocumentStatus eq 'bost_Open'
```

### Belirli carinin toplam açık alacağı
```
GET /BusinessPartners('C001')
```
