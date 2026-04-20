#!/usr/bin/env python3
"""
update_prices.py — Actualiza precios de variantes en Shopify.

Lee la tabla ActualizarPrecios de ShopifyExport.xlsx, obtiene un token OAuth
con las credenciales de la hoja Parametros, y llama la mutación
productVariantUpdate por cada fila que tenga Precio_Nuevo relleno.
La columna Estado se escribe con OK o ERROR:<msg>.

Uso:
    python update_prices.py
    python update_prices.py --file ruta/otro.xlsx
    python update_prices.py --dry-run   # muestra cambios sin llamar a Shopify
"""

import argparse
import sys
import time
from pathlib import Path
from typing import Optional

DEFAULT_FILE  = Path(__file__).parent / "ShopifyExport.xlsx"
PARAMS_TABLE  = "Configuracion"
UPDATES_TABLE = "ActualizarPrecios"

MUTATION = """
mutation UpdateVariantPrice($input: ProductVariantInput!) {
  productVariantUpdate(input: $input) {
    productVariant {
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


# ── Helpers de openpyxl ──────────────────────────────────────────────────────

def find_table(wb, table_name: str):
    """Devuelve (worksheet, WorksheetTable) para la tabla con el nombre dado."""
    for ws in wb.worksheets:
        for tbl in ws.tables.values():
            if tbl.name == table_name:
                return ws, tbl
    raise ValueError(
        f"Tabla '{table_name}' no encontrada en el archivo.\n"
        "¿Ejecutaste build.py para generarlo?"
    )


def table_cells(ws, tbl):
    """Devuelve (headers: list[str], rows: list[tuple[Cell]])."""
    all_rows = list(ws[tbl.ref])
    headers  = [c.value for c in all_rows[0]]
    data     = all_rows[1:]
    return headers, data


# ── API de Shopify ───────────────────────────────────────────────────────────

def shopify_gql(store: str, token: str, query: str, variables: dict, api_version: str = "2024-10") -> dict:
    import requests
    resp = requests.post(
        f"https://{store}/admin/api/{api_version}/graphql.json",
        json={"query": query, "variables": variables},
        headers={
            "X-Shopify-Access-Token": token,
            "Content-Type":           "application/json",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


# ── Lógica principal ─────────────────────────────────────────────────────────

def update_prices(file_path: Path, dry_run: bool = False) -> None:
    try:
        import openpyxl
        import requests  # noqa: F401
    except ImportError as e:
        print(f"ERROR: {e}\nEjecuta: pip install -r requirements.txt", file=sys.stderr)
        sys.exit(1)

    import openpyxl

    # openpyxl no puede escribir si Excel tiene el archivo abierto (Windows lock)
    try:
        wb = openpyxl.load_workbook(file_path)
    except PermissionError:
        print(
            "ERROR: No se puede abrir el archivo — está abierto en Excel.\n"
            "Cierra Excel y vuelve a ejecutar el script.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Leyendo: {file_path}")

    # Credenciales desde la hoja Parametros
    ws_p, tbl_p    = find_table(wb, PARAMS_TABLE)
    p_headers, p_rows = table_cells(ws_p, tbl_p)

    def get_param(key: str) -> Optional[str]:
        ki, vi = p_headers.index("Parametro"), p_headers.index("Valor")
        for row in p_rows:
            if row[ki].value == key:
                v = row[vi].value
                return str(v).strip() if v is not None else None
        return None

    store        = get_param("Tienda")
    access_token = get_param("AccessToken")
    api_version  = get_param("API_Version") or "2024-10"

    if not store or not access_token:
        print(
            "ERROR: Rellena Tienda y AccessToken en la hoja Parametros.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Tabla de actualizaciones
    ws_u, tbl_u    = find_table(wb, UPDATES_TABLE)
    u_headers, u_rows = table_cells(ws_u, tbl_u)

    try:
        col_id    = u_headers.index("Variante_ID")
        col_sku   = u_headers.index("SKU")
        col_price = u_headers.index("Precio_Nuevo")
        col_cmp   = u_headers.index("Precio_Comparacion_Nuevo")
        col_state = u_headers.index("Estado")
    except ValueError as e:
        print(f"ERROR: Columna faltante en tabla ActualizarPrecios — {e}", file=sys.stderr)
        sys.exit(1)

    # Filas con Precio_Nuevo relleno
    to_update = [
        row for row in u_rows
        if row[col_price].value is not None
        and str(row[col_price].value).strip() != ""
    ]

    if not to_update:
        print("No hay filas con Precio_Nuevo relleno. Nada que actualizar.")
        return

    prefix = "[DRY-RUN] " if dry_run else ""

    token = "dry-run-token" if dry_run else access_token

    print(f"{prefix}Actualizando {len(to_update)} variante(s)...")

    ok_count = err_count = 0

    for row_cells in to_update:
        variant_id = row_cells[col_id].value
        sku        = row_cells[col_sku].value
        price_new  = str(row_cells[col_price].value).strip()
        cmp_new    = row_cells[col_cmp].value
        label      = str(variant_id or sku or "fila desconocida")

        if not variant_id:
            msg = "ERROR: Variante_ID vacío — fila ignorada"
            print(f"  ✗ {sku or '?'} — {msg}")
            row_cells[col_state].value = msg
            err_count += 1
            continue

        mutation_input: dict = {"id": str(variant_id), "price": price_new}
        if cmp_new is not None and str(cmp_new).strip() != "":
            mutation_input["compareAtPrice"] = str(cmp_new).strip()

        if dry_run:
            cmp_info = f", comparación: {cmp_new}" if cmp_new else ""
            print(f"  ~ {label[:60]} → precio: {price_new}{cmp_info}")
            row_cells[col_state].value = "DRY-RUN"
            ok_count += 1
            continue

        try:
            result      = shopify_gql(store, token, MUTATION, {"input": mutation_input}, api_version)
            pv_data     = result.get("data", {}).get("productVariantUpdate", {})
            user_errors = pv_data.get("userErrors", [])

            if user_errors:
                msg = "; ".join(f"{e['field']}: {e['message']}" for e in user_errors)
                print(f"  ✗ {label[:60]} — {msg}")
                row_cells[col_state].value = f"ERROR: {msg}"
                err_count += 1
            else:
                updated = pv_data["productVariant"]
                print(f"  ✓ {label[:60]} → {updated['price']}")
                row_cells[col_state].value = "OK"
                ok_count += 1

        except Exception as e:
            msg = str(e)
            print(f"  ✗ {label[:60]} — {msg}")
            row_cells[col_state].value = f"ERROR: {msg}"
            err_count += 1

        # ~4 req/s para respetar el rate limit de Shopify
        time.sleep(0.25)

    # Guardar workbook con los estados actualizados
    try:
        wb.save(file_path)
    except PermissionError:
        print(
            "\nADVERTENCIA: No se pudo guardar el archivo (¿Excel lo abriste mientras corría el script?).\n"
            f"Guarda manualmente los resultados o vuelve a correr con Excel cerrado.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"\n{prefix}Listo: {ok_count} OK, {err_count} error(es).")
    print("Columna 'Estado' actualizada en la hoja Actualizar_Precios.")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Actualiza precios de variantes Shopify desde la hoja Actualizar_Precios"
    )
    parser.add_argument(
        "--file", type=Path, default=DEFAULT_FILE,
        metavar="PATH", help="Ruta al .xlsx (default: ShopifyExport.xlsx)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Muestra los cambios sin llamar a la API de Shopify",
    )
    args = parser.parse_args()

    if not args.file.exists():
        print(f"ERROR: No se encontró el archivo: {args.file}", file=sys.stderr)
        print("Ejecuta primero: python build.py", file=sys.stderr)
        sys.exit(1)

    update_prices(args.file, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
