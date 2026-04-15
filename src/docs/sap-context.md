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
| CurrentAccountBalance | Cari hesap bakiyesi (⚠️ $select ile istenemez) |
| Phone1 | Telefon |
| EmailAddress | E-posta |
| Currency | Para birimi |
| CreditLimit | Kredi limiti |
| DNoteBalance | İrsaliye bakiyesi |
| OrdersBal | Sipariş bakiyesi |

> ⚠️ ÖNEMLİ: Balance ve CurrentAccountBalance alanları $select parametresinde kullanılamaz.
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

### Endpoint: `Items`

#### Önemli alanlar
| Alan | Açıklama |
|------|----------|
| ItemCode | Ürün kodu (PK) |
| ItemName | Ürün adı |
| QuantityOnStock | Stok miktarı |
| QuantityOnOrder | Siparişteki miktar |
| AvgStdPrice | Ortalama maliyet |
| SalesPrice | Satış fiyatı |
| ItemType | itItems / itLabor / itTravel |
| Frozen | tYES / tNO (pasif mi?) |

#### Stokta azalan ürünler
```
GET /Items?$filter=QuantityOnStock lt 10 and Frozen eq 'tNO'
  &$select=ItemCode,ItemName,QuantityOnStock,AvgStdPrice
  &$orderby=QuantityOnStock asc
```

#### Ürün ara
```
GET /Items?$filter=contains(ItemName,'vida')
```

---

## Muhasebe / Yevmiye

### Endpoint: `JournalEntries`

#### Önemli alanlar
| Alan | Açıklama |
|------|----------|
| JdtNum | Yevmiye numarası |
| ReferenceDate | Tarih |
| Memo | Açıklama |
| JournalEntryLines | Satırlar (array) |
| JournalEntryLines.AccountCode | Hesap kodu |
| JournalEntryLines.Debit | Borç |
| JournalEntryLines.Credit | Alacak |

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
GET /BusinessPartners('C001')?$select=CardName,Balance,CurrentAccountBalance
```
