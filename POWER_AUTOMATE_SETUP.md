# Configuración: Power Automate + Office Scripts → Shopify

## Arquitectura

```
Excel (botón) → Office Script → Power Automate → Shopify GraphQL
                                     ↓
                             ← [{varianteId, estado}]
                ↓
         Escribe Estado en cada fila
```

---

## Paso 1: Importar el flujo en Power Automate

1. Ve a [make.powerautomate.com](https://make.powerautomate.com)
2. **My flows → Import → Import Package (Legacy)**
3. Sube `power_automate_flow.json`
   - Si el portal pide formato `.zip`, empaqueta el JSON primero en un zip
   - Alternativamente: crea un **Instant cloud flow** con trigger **When an HTTP request is received** y copia manualmente cada acción

---

## Paso 2: Configurar parámetros del flujo

Una vez importado, edita los 3 parámetros del flujo:

| Parámetro | Valor de ejemplo |
|---|---|
| `SHOPIFY_STORE` | `ilafiu.myshopify.com` |
| `SHOPIFY_TOKEN` | `shpat_xxxxxxxxxxxxxxxxxxxx` |
| `SHOPIFY_API_VERSION` | `2026-04` |

> El token se guarda como **Secure String** — Power Automate lo oculta en los logs.

---

## Paso 3: Obtener la URL del flujo

1. Abre el flujo → clic en el trigger **When an HTTP request is received**
2. Copia la **HTTP POST URL** (aparece después de guardar el flujo)
   - Formato: `https://prod-XX.westus.logic.azure.com:443/workflows/abc.../triggers/manual/paths/invoke?...`

---

## Paso 4: Configurar Excel

En la hoja **Parametros**, tabla **Configuracion**, agrega esta fila:

| Parametro | Valor |
|---|---|
| `FlowURL` | `https://prod-XX.westus.logic.azure.com:443/...` |

Si usas `build.py` para regenerar el Excel, agrega `FlowURL` a los defaults en `build.py`.

---

## Paso 5: Agregar el Office Script en Excel Online

1. Abre `ShopifyExport.xlsx` en **Excel Online**
2. **Automatizar → Nuevo Script**
3. Copia el contenido de `update_prices.ts` y guarda el script
4. (Opcional) Crea un botón: **Insertar → Botón** → asigna el script

---

## Paso 6: Prueba end-to-end

1. Llena 2-3 filas en `ActualizarPrecios`:
   - `Variante_ID`: GID completo (`gid://shopify/ProductVariant/12345`)
   - `Precio_Nuevo`: nuevo precio (ej: `99.99`)
2. Ejecuta el script desde Excel
3. Verifica que la columna `Estado` muestra `OK` o `ERROR: ...`
4. Confirma el precio actualizado en Shopify Admin

---

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `ERROR: Falta el parámetro 'FlowURL'` | No existe la fila FlowURL en Configuracion | Agregar la fila (Paso 4) |
| `ERROR HTTP: 401` | Token de Shopify incorrecto | Verificar `SHOPIFY_TOKEN` en el flujo |
| `ERROR HTTP: 404` | URL del flujo incorrecta o flujo desactivado | Verificar que el flujo esté activo y la URL sea correcta |
| `ERROR: ...` en Estado | `userErrors` de Shopify | Revisar el mensaje — puede ser ID de variante inválido o precio con formato incorrecto |
| `SIN_RESPUESTA` | El flujo no devolvió ese varianteId | Revisar los logs del flujo en Power Automate |
