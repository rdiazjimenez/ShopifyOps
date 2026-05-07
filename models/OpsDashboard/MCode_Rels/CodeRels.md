# M Query Relationship Map — OpsDashboard

## Architecture Overview

Four independent data source chains feed the dashboard:

| Chain | API | Root Function |
|-------|-----|---------------|
| Shopify Sales | ShopifyQL REST | `fnGetShopifyQLData` |
| Google Ads | Google Ads API | `fnGoogleAdsOperationByPeriod` |
| Meta Ads | Meta Marketing API | `fnMetaAdsOperationByPeriod` |
| Accounting | Siigo API (via LibPQ) | `TrialBalanceApi` |

---

## Dependency Layers

```
PARAMS (Excel tables)
  │
  ├─ ParamShopName, ParamAccessToken, ParamApiVersion
  │     └─► fnGetShopifyQLData
  │               └─► fnGetSalesBreakdownByPeriod ─► SalesBreakdownDaily/Weekly/Monthly
  │               │                                       └─► SummaryDaily, SummaryMonthly
  │               ├─► fnSalesBySourceByPeriod     ─► SalesBySourceDaily/Weekly/Monthly
  │               │                                       └─► SalesBySourceToColsDaily/Weekly/Monthly
  │               │                                               └─► SummaryDaily, SummaryMonthly
  │               ├─► fnSalesNewReturningByPeriod ─► SalesNewReturningDaily/Weekly/Monthly
  │               │                                       └─► SummaryDaily, SummaryMonthly
  │               ├─► fnSalesQSortBySourceProduct ─► SalesQSortBySourceProductDaily/Weekly/Monthly
  │               ├─► fnConversionRateByReferral  ─► ConversionRateByReferralDaily/Weekly/Monthly
  │               │                                       └─► ConversionRateToColsDaily/Weekly/Monthly
  │               │                                               └─► SummaryDaily, SummaryMonthly
  │               └─► fnSalesByUTMByPeriod        ─► SalesByUTMDaily, SalesByUTMMonthly
  │
  ├─ ParamDiaSemanaReporte
  │     └─► fnGetDatesInPeriod (called by all 6 Shopify business fns above)
  │
  ├─ ParamFechaInicioReporte, ParamFechaFinReporte, ParamGoogleReportSource
  │     └─► fnGoogleAdsOperationByPeriod ─► GoogleAdsOperationDaily/Monthly
  │                                               └─► SummaryDaily, SummaryMonthly
  │
  ├─ ParamFechaInicioReporte, ParamFechaFinReporte, ParamMetaAccountID, ParamMetaSystemToken
  │     └─► fnMetaAdsOperationByPeriod   ─► MetaAdsOperationDaily/Monthly
  │                                               └─► SummaryDaily, SummaryMonthly
  │
  └─ (no params)
        LibPQPath ─► LibPQ ─► TrialBalanceApi ──────────────────────────► AccountingReport
                                    │          └─► COAApi                      ▲
                                    └─► SiigoEndpoint, TablaSIIGOParam  DataByClass
                                                                              ▲
                                                                    TrialBalanceApi + COALocal

SUMMARY COMPOSITES (top of Shopify chain)
  SummaryDaily        ← SalesBreakdownDaily + SalesNewReturningDaily + SalesBySourceToColsDaily
                         + ConversionRateToColsDaily + GoogleAdsOperationDaily + MetaAdsOperationDaily
  SummaryMonthly      ← same (Monthly variants)
  SummaryMonthlyData  ← SummaryMonthly (appends rows to Excel history table)
```

---

## Core Functions

### `fnGetShopifyQLData(ShopifyQL_Query)`
Executes a ShopifyQL query against the store REST API.

**Calls:** —  
**Params:** `ParamShopName`, `ParamAccessToken`, `ParamApiVersion`  
**Called by:** `fnGetSalesBreakdownByPeriod`, `fnSalesBySourceByPeriod`, `fnSalesNewReturningByPeriod`, `fnSalesQSortBySourceProduct`, `fnConversionRateByReferral`, `fnSalesByUTMByPeriod`

---

### `fnGetDatesInPeriod(FechaInicioReporte, FechaFinReporte, FechaRefrescoReporte, Tipo, ParamDiaSemanaReporte, [NombreTablaHistorica])`
Builds the date spine for a period, merging with historical Excel table when provided.

**Calls:** `Excel.CurrentWorkbook()` (historical table lookup)  
**Params:** —  
**Called by:** `fnGetSalesBreakdownByPeriod`, `fnSalesBySourceByPeriod`, `fnSalesNewReturningByPeriod`, `fnSalesQSortBySourceProduct`, `fnConversionRateByReferral`, `fnSalesByUTMByPeriod`, `fnTest`

---

### `fnGetSalesBreakdownByPeriod(GroupByField, FechaInicio, FechaFin, FechaRefresco, [NombreTablaHistorica])`
Sales breakdown (revenue, orders, AOV) grouped by period.

**Calls:** `fnGetDatesInPeriod`, `fnGetShopifyQLData`  
**Params:** `ParamDiaSemanaReporte`  
**Called by:** `SalesBreakdownDaily`, `SalesBreakdownWeekly`, `SalesBreakdownMonthly`, `SummaryDaily`, `SummaryMonthly`

---

### `fnSalesBySourceByPeriod(GroupByField, FechaInicio, FechaFin, FechaRefresco, [NombreTablaHistorica])`
Sales by traffic source grouped by period.

**Calls:** `fnGetDatesInPeriod`, `fnGetShopifyQLData`  
**Params:** `ParamDiaSemanaReporte`  
**Called by:** `SalesBySourceDaily`, `SalesBySourceWeekly`, `SalesBySourceMonthly`  
**Downstream:** → `SalesBySourceToColsDaily/Weekly/Monthly` → `SummaryDaily`, `SummaryMonthly`

---

### `fnSalesNewReturningByPeriod(GroupByField, FechaInicio, FechaFin, FechaRefresco, [NombreTablaHistorica])`
New vs. returning customer split by period.

**Calls:** `fnGetDatesInPeriod`, `fnGetShopifyQLData`  
**Params:** `ParamDiaSemanaReporte`  
**Called by:** `SalesNewReturningDaily`, `SalesNewReturningWeekly`, `SalesNewReturningMonthly`, `SummaryDaily`, `SummaryMonthly`

---

### `fnSalesQSortBySourceProduct(GroupByField, FechaInicio, FechaFin, FechaRefresco, [NombreTablaHistorica])`
Sales quick-sort by source × product.

**Calls:** `fnGetDatesInPeriod`, `fnGetShopifyQLData`  
**Params:** `ParamDiaSemanaReporte`  
**Called by:** `SalesQSortBySourceProductDaily`, `SalesQSortBySourceProductWeekly`, `SalesQSortBySourceProductMonthly`

---

### `fnConversionRateByReferral(GroupByField, FechaInicio, FechaFin, FechaRefresco, [NombreTablaHistorica])`
Conversion rate by referral source grouped by period.

**Calls:** `fnGetDatesInPeriod`, `fnGetShopifyQLData`  
**Params:** `ParamDiaSemanaReporte`  
**Called by:** `ConversionRateByReferralDaily`, `ConversionRateByReferralWeekly`, `ConversionRateByReferralMonthly`  
**Downstream:** → `ConversionRateToColsDaily/Weekly/Monthly` → `SummaryDaily`, `SummaryMonthly`

---

### `fnSalesByUTMByPeriod(GroupByFieldInput, FechaInicio, FechaFin, FechaRefresco, [NombreTablaHistorica])`
Sales by UTM parameters grouped by period.

**Calls:** `fnGetDatesInPeriod`, `fnGetShopifyQLData`  
**Params:** — *(no ParamDiaSemanaReporte)*  
**Called by:** `SalesByUTMDaily`, `SalesByUTMMonthly`

---

### `fnGoogleAdsOperationByPeriod(Agrupacion)`
Google Ads spend, impressions, clicks, conversions for a period.

**Calls:** Google Ads API directly  
**Params:** `ParamFechaInicioReporte`, `ParamFechaFinReporte`, `ParamGoogleReportSource`  
**Called by:** `GoogleAdsOperationDaily`, `GoogleAdsOperationMonthly`, `SummaryDaily`, `SummaryMonthly`

---

### `fnMetaAdsOperationByPeriod(Agrupacion)`
Meta (Facebook/Instagram) Ads spend and performance for a period.

**Calls:** Meta Marketing API directly  
**Params:** `ParamMetaSystemToken`, `ParamMetaAccountID`, `ParamFechaInicioReporte`, `ParamFechaFinReporte`  
**Called by:** `MetaAdsOperationDaily`, `MetaAdsOperationMonthly`, `SummaryDaily`, `SummaryMonthly`

---

### `fnTest(FechaInicioReporte, FechaFinReporte, FechaRefrescoReporte, Tipo, ParamDiaSemanaReporte, [NombreTablaHistorica])`
Mirror of `fnGetDatesInPeriod` with hard limits (≤365 days / ≤12 weeks). Used for dev/testing.

**Calls:** `fnGetDatesInPeriod`  
**Params:** `ParamNombreTablaHistMensual`  
**Called by:** `Test`

---

## Parameter Reference

| Parameter | Consumed By |
|-----------|-------------|
| `ParamShopName` | `fnGetShopifyQLData` |
| `ParamAccessToken` | `fnGetShopifyQLData` |
| `ParamApiVersion` | `fnGetShopifyQLData` |
| `ParamDiaSemanaReporte` | `fnGetSalesBreakdownByPeriod`, `fnSalesBySourceByPeriod`, `fnSalesNewReturningByPeriod`, `fnSalesQSortBySourceProduct`, `fnConversionRateByReferral` |
| `ParamFechaInicioReporte` | `fnGoogleAdsOperationByPeriod`, `fnMetaAdsOperationByPeriod`, `TrialBalanceApi`, `Test` |
| `ParamFechaFinReporte` | `fnGoogleAdsOperationByPeriod`, `fnMetaAdsOperationByPeriod`, `TrialBalanceApi`, `Test` |
| `ParamFechaRefrescarHistorico` | All 6 Shopify business fns (passed as FechaRefresco arg), `Test` |
| `ParamGoogleReportSource` | `fnGoogleAdsOperationByPeriod` |
| `ParamMetaAccountID` | `fnMetaAdsOperationByPeriod` |
| `ParamMetaSystemToken` | `fnMetaAdsOperationByPeriod` |
| `ParamNombreTablaHistDiario` | `ConversionRateByReferralDaily`, `SalesBreakdownDaily`, `SalesBySourceDaily`, `SalesByUTMDaily`, `SalesNewReturningDaily`, `SalesQSortBySourceProductDaily` |
| `ParamNombreTablaHistSemanal` | `ConversionRateByReferralWeekly`, `SalesBreakdownWeekly`, `SalesBySourceWeekly`, `SalesNewReturningWeekly`, `SalesQSortBySourceProductWeekly` |
| `ParamNombreTablaHistMensual` | `ConversionRateByReferralMonthly`, `SalesBreakdownMonthly`, `SalesBySourceMonthly`, `SalesByUTMMonthly`, `SalesNewReturningMonthly`, `SalesQSortBySourceProductMonthly`, `fnTest`, `SummaryMonthlyData` |

---

## Data Table Matrix

Each row = a mid-tier function. Each cell = the table query that calls it with that period argument.

| Function | Daily | Weekly | Monthly |
|----------|-------|--------|---------|
| `fnGetSalesBreakdownByPeriod` | `SalesBreakdownDaily` | `SalesBreakdownWeekly` | `SalesBreakdownMonthly` |
| `fnSalesBySourceByPeriod` | `SalesBySourceDaily` | `SalesBySourceWeekly` | `SalesBySourceMonthly` |
| `fnSalesNewReturningByPeriod` | `SalesNewReturningDaily` | `SalesNewReturningWeekly` | `SalesNewReturningMonthly` |
| `fnSalesQSortBySourceProduct` | `SalesQSortBySourceProductDaily` | `SalesQSortBySourceProductWeekly` | `SalesQSortBySourceProductMonthly` |
| `fnConversionRateByReferral` | `ConversionRateByReferralDaily` | `ConversionRateByReferralWeekly` | `ConversionRateByReferralMonthly` |
| `fnSalesByUTMByPeriod` | `SalesByUTMDaily` | — | `SalesByUTMMonthly` |
| `fnGoogleAdsOperationByPeriod` | `GoogleAdsOperationDaily` | — | `GoogleAdsOperationMonthly` |
| `fnMetaAdsOperationByPeriod` | `MetaAdsOperationDaily` | — | `MetaAdsOperationMonthly` |

**Pivot transforms** (depend on base table, not the fn directly):

| Base Table | Pivot Output |
|------------|-------------|
| `SalesBySourceDaily` | `SalesBySourceToColsDaily` |
| `SalesBySourceWeekly` | `SalesBySourceToColsWeekly` |
| `SalesBySourceMonthly` | `SalesBySourceToColsMonthly` |
| `ConversionRateByReferralDaily` | `ConversionRateToColsDaily` |
| `ConversionRateByReferralWeekly` | `ConversionRateToColsWeekly` |
| `ConversionRateByReferralMonthly` | `ConversionRateToColsMonthly` |

---

## Summary Composites

### `SummaryDaily`
Joins 6 daily tables into a single daily KPI view:
- `SalesBreakdownDaily`
- `SalesNewReturningDaily`
- `SalesBySourceToColsDaily`
- `ConversionRateToColsDaily`
- `GoogleAdsOperationDaily`
- `MetaAdsOperationDaily`

### `SummaryMonthly`
Same as above with Monthly variants.

### `SummaryMonthlyData`
Appends `SummaryMonthly` rows into the Excel history table named by `ParamNombreTablaHistMensual`.

---

## Accounting Branch

Separate chain — no dependency on any Shopify function.

```
LibPQPath
  └─► LibPQ
        └─► TrialBalanceApi (calls LibPQ("Siigo.getBalancePruebaTercero"))
              │   uses: SiigoEndpoint, TablaSIIGOParam
              │   params: ParamFechaInicioReporte, ParamFechaFinReporte
              │
              ├─► COAApi (reads TrialBalanceApi account codes)
              │
              └─► DataByClass (joins TrialBalanceApi + COALocal on account code)
                        └─► AccountingReport (column reorder + sort)

COALocal ─────────────────────────────────────────────────┘
  (reads COALocal Excel table directly via Excel.CurrentWorkbook())

TablePUC — standalone Excel reference, filtered for non-null classification
```
