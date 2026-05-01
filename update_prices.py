#!/usr/bin/env python3
import argparse
import sys
import time
import json
from pathlib import Path
from typing import Optional

DEFAULT_FILE  = Path(__file__).parent / "ShopifyExport.xlsx"
PARAMS_TABLE  = "Configuracion"
UPDATES_TABLE = "ActualizarPrecios"

VARIANT_PRODUCT_QUERY = """
query getVariantProduct($id: ID!) {
  productVariant(id: $id) {
    product { id }
  }
}
"""

MUTATION = """
mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants {
      id
      price
      compareAtPrice
    }
    userErrors {
      field
      message
    }
  }
}
"""

def get_shopify_token(store: str, client_id: str, client_secret: str) -> str:
    import requests
    
    # Limpieza estricta del host
    host = store.replace("https://", "").replace("http://", "").split("/")[0]
    if ".myshopify.com" not in host:
        host = f"{host}.myshopify.com"
        
    url = f"https://{host}/admin/oauth/access_token"

    payload = {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "client_credentials",
    }

    print(f"-> Solicitando nuevo token para {host}...")

    try:
        resp = requests.post(
            url,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15
        )
        
        if resp.status_code != 200:
            # Si falla con 401, imprimimos el detalle para diagnosticar
            print(f"DEBUG - Status: {resp.status_code}")
            print(f"DEBUG - Response: {resp.text}")
            raise Exception(f"Credenciales inválidas (401). Revisa ClientID y AccessToken en Excel.")
            
        data = resp.json()
        token = data.get("access_token")
        if not token:
            raise Exception("No se encontró 'access_token' en la respuesta.")
        return token

    except Exception as e:
        raise Exception(f"Fallo en la conexión: {str(e)}")

def update_prices(file_path: Path, dry_run: bool = False) -> None:
    try:
        import openpyxl
        import requests
        import xlwings as xw
    except ImportError:
        print("ERROR: Instala openpyxl, requests y xlwings", file=sys.stderr)
        sys.exit(1)

    try:
        wb_read = openpyxl.load_workbook(file_path, data_only=True)
    except PermissionError:
        print("ERROR: El archivo está abierto en Excel. Ciérralo.", file=sys.stderr)
        sys.exit(1)

    # 1. Leer Configuración
    ws_p, tbl_p = find_table(wb_read, PARAMS_TABLE)
    p_headers, p_rows = table_cells(ws_p, tbl_p)
    
    def get_p(key: str):
        # Localizamos columnas dinámicamente
        ki = next(i for i, h in enumerate(p_headers) if str(h).strip().upper() == "PARAMETRO")
        vi = next(i for i, h in enumerate(p_headers) if str(h).strip().upper() == "VALOR")
        for r in p_rows:
            if str(r[ki].value).strip().upper() == key.upper():
                val = r[vi].value
                return str(val).strip() if val else None
        return None

    store    = get_p("Tienda")
    c_id     = get_p("ClientID")
    c_secret = get_p("AccessToken") # Este es el que actúa como Secret
    version  = get_p("API_Version") or "2026-04"

    if not all([store, c_id, c_secret]):
        print(f"ERROR: Datos incompletos (Tienda: {store}, ID: {c_id}, Secret: {'Presente' if c_secret else 'Faltante'})")
        sys.exit(1)

    # 2. Obtención del Token
    try:
        active_token = "dry_run" if dry_run else get_shopify_token(store, c_id, c_secret)
    except Exception as e:
        print(f"Error de Autenticación: {e}")
        sys.exit(1)

    # 3. Procesar Actualizaciones
    ws_u, tbl_u = find_table(wb_read, UPDATES_TABLE)
    u_headers, u_rows = table_cells(ws_u, tbl_u)

    app = xw.App(visible=False)
    wb_xw = app.books.open(str(file_path.resolve()))
    ws_xw = wb_xw.sheets[ws_u.title]

    def f_col(target):
        t_up = target.upper()
        for i, h in enumerate(u_headers):
            if str(h).strip().replace(" ", "_").upper() == t_up: return i
        raise ValueError(f"Columna {target} no encontrada.")

    try:
        c_id_v = f_col("Variante_ID")
        c_sku  = f_col("SKU")
        c_prc  = f_col("Precio_Nuevo")
        c_cmp  = f_col("Precio_Comparacion_Nuevo")
        c_st   = f_col("Estado")
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    to_upd = [r for r in u_rows if r[c_prc].value not in (None, "")]
    print(f"Procesando {len(to_upd)} variantes...")

    estado_col = u_rows[0][c_st].column  # número de columna de Estado en Excel

    def write_estado(row, value):
        ws_xw.cells(row[0].row, estado_col).value = value

    for row in to_upd:
        v_id  = row[c_id_v].value
        sku   = row[c_sku].value
        p_new = str(row[c_prc].value).strip()
        c_new = row[c_cmp].value

        if not v_id:
            write_estado(row, "ERROR: Sin ID")
            continue

        gid = str(v_id) if str(v_id).startswith("gid://") else f"gid://shopify/ProductVariant/{v_id}"
        m_input = {"id": gid, "price": p_new}
        if c_new not in (None, ""):
            m_input["compareAtPrice"] = str(c_new).strip()

        try:
            if not dry_run:
                host = store if ".myshopify.com" in store else f"{store}.myshopify.com"
                url  = f"https://{host}/admin/api/{version}/graphql.json"
                h    = {"X-Shopify-Access-Token": active_token, "Content-Type": "application/json"}
                product_id = _get_product_id(gid, url, h, requests)
                resp = requests.post(url, json={"query": MUTATION, "variables": {"productId": product_id, "variants": [m_input]}}, headers=h, timeout=20)
                if resp.status_code != 200:
                    raise Exception(f"HTTP {resp.status_code}: {resp.text}")
                res = resp.json()
                gql_errs  = res.get("errors", [])
                user_errs = res.get("data", {}).get("productVariantsBulkUpdate", {}).get("userErrors", [])
                if gql_errs:
                    raise Exception(gql_errs[0].get("message", str(gql_errs[0])))
                if user_errs:
                    msg = user_errs[0]["message"]
                    write_estado(row, f"ERROR: {msg}")
                    print(f"  ✗ {sku}: {msg}")
                else:
                    write_estado(row, "OK")
                    print(f"  ✓ {sku}: {p_new}")
            else:
                write_estado(row, "DRY-RUN")
                print(f"  [DRY] {sku}: {p_new}")
        except Exception as e:
            write_estado(row, f"ERROR: {str(e)}")
            print(f"  ✗ {sku}: {e}")

        time.sleep(0.25)

    try:
        wb_xw.save()
    finally:
        wb_xw.close()
        app.quit()
    print("\nProceso terminado. Excel actualizado.")

def _get_product_id(variant_gid: str, url: str, headers: dict, requests) -> str:
    resp = requests.post(url, json={"query": VARIANT_PRODUCT_QUERY, "variables": {"id": variant_gid}}, headers=headers, timeout=20)
    if resp.status_code != 200:
        raise Exception(f"HTTP {resp.status_code} al obtener productId")
    data = resp.json()
    errs = data.get("errors", [])
    if errs:
        raise Exception(errs[0].get("message", str(errs[0])))
    return data["data"]["productVariant"]["product"]["id"]

def find_table(wb, t_name):
    for ws in wb.worksheets:
        for tbl in ws.tables.values():
            if tbl.name == t_name: return ws, tbl
    raise ValueError(f"Tabla {t_name} no encontrada.")

def table_cells(ws, tbl):
    all_rows = list(ws[tbl.ref])
    return [c.value for c in all_rows[0]], all_rows[1:]

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=Path, default=DEFAULT_FILE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    update_prices(args.file, args.dry_run)