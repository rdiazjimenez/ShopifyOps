#!/usr/bin/env python3
"""
build.py — Genera ShopifyExport.xlsx con Power Query preconfigurado.

Uso:
    pip install -r requirements.txt
    python build.py
    python build.py --output ruta/destino.xlsx
"""

import argparse
import sys
from pathlib import Path

QUERIES_DIR    = Path(__file__).parent / "queries"
DEFAULT_OUTPUT = Path(__file__).parent / "ShopifyExport.xlsx"

# Orden en que Excel debe resolver las dependencias entre queries
QUERY_ORDER = ["Parametros", "FnGQLRequest", "FnGetProducts", "Productos"]

# Valores por defecto de la hoja Parámetros
PARAMS_DEFAULT = [
    ("Tienda",        "mi-tienda.myshopify.com"),
    ("ClientID",      ""),
    ("AccessToken",   ""),
    ("API_Version",   "2024-10"),
    ("Tipo_Producto", ""),
    ("Estado",        "active"),
    ("Coleccion",     ""),
    ("Tags",          ""),
    ("Max_Productos", "500"),
]


def load_queries() -> dict:
    """Carga archivos .pq y devuelve {nombre: código_M}."""
    queries = {}
    for f in sorted(QUERIES_DIR.glob("*.pq")):
        try:
            # Intenta extraer el nombre: "01_Parametros" → "Parametros"
            parts = f.stem.split("_", 1)
            name = parts[1] if len(parts) > 1 else parts[0]
            queries[name] = f.read_text(encoding="utf-8")
        except Exception as e:
            print(f"Advertencia: No se pudo cargar {f.name}: {e}")
    if not queries:
        raise FileNotFoundError(f"No se encontraron archivos .pq en {QUERIES_DIR}")
    return queries


def build(output_path: Path) -> None:
    try:
        import win32com.client  # noqa: F401
    except ImportError:
        print(
            "ERROR: pywin32 no está instalado.\n"
            "Ejecuta:  pip install pywin32",
            file=sys.stderr,
        )
        sys.exit(1)

    import win32com.client

    print("Iniciando Excel (puede tardar unos segundos)...")
    excel = win32com.client.Dispatch("Excel.Application")
    excel.Visible       = False
    excel.DisplayAlerts = False
    wb = None

    try:
        wb = excel.Workbooks.Add()

        # Dejar sólo 1 hoja por defecto
        while wb.Sheets.Count > 1:
            wb.Sheets(wb.Sheets.Count).Delete()

        # ── Hoja 1: Parametros ───────────────────────────────────────────────
        ws_params = wb.Sheets(1)
        ws_params.Name = "Parametros"

        ws_params.Cells(1, 1).Value = "Parametro"
        ws_params.Cells(1, 2).Value = "Valor"
        ws_params.Cells(1, 1).Font.Bold = True
        ws_params.Cells(1, 2).Font.Bold = True

        for i, (key, val) in enumerate(PARAMS_DEFAULT, start=2):
            ws_params.Cells(i, 1).Value = key
            ws_params.Cells(i, 2).Value = val

        end_row   = 1 + len(PARAMS_DEFAULT)
        tbl_range = ws_params.Range(f"A1:B{end_row}")
        tbl = ws_params.ListObjects.Add(
            SourceType=1,           # xlSrcRange
            Source=tbl_range,
            XlListObjectHasHeaders=1,  # xlYes
        )
        tbl.Name       = "Configuracion"
        tbl.TableStyle = "TableStyleLight1"
        ws_params.Columns("A:B").AutoFit()

        # ── Hoja 2: Productos ────────────────────────────────────────────────
        ws_prods = wb.Sheets.Add(After=wb.Sheets(wb.Sheets.Count))
        ws_prods.Name = "Productos"

        ws_prods.Range("A1").Value            = "← Rellena la hoja Parametros y presiona Datos → Actualizar todo"
        ws_prods.Range("A1").Font.Italic      = True
        ws_prods.Range("A1").Font.Color       = 0x808080
        ws_prods.Columns("A").AutoFit()

        # ── Hoja 3: Actualizar_Precios ───────────────────────────────────────
        ws_upd = wb.Sheets.Add(After=wb.Sheets(wb.Sheets.Count))
        ws_upd.Name = "Actualizar_Precios"

        upd_cols = ["Variante_ID", "SKU", "Precio_Nuevo", "Precio_Comparacion_Nuevo", "Estado"]
        for j, header in enumerate(upd_cols, start=1):
            ws_upd.Cells(1, j).Value     = header
            ws_upd.Cells(1, j).Font.Bold = True

        # Una fila vacía para que la tabla tenga al menos un registro
        upd_range = ws_upd.Range(f"A1:E2")
        upd_tbl   = ws_upd.ListObjects.Add(
            SourceType=1,           # xlSrcRange
            Source=upd_range,
            XlListObjectHasHeaders=1,  # xlYes
        )
        upd_tbl.Name       = "ActualizarPrecios"
        upd_tbl.TableStyle = "TableStyleLight2"
        ws_upd.Columns("A").ColumnWidth = 42   # Variante_ID es un GID largo
        ws_upd.Columns("B:E").AutoFit()

        # ── Power Query queries ──────────────────────────────────────────────
        print("Cargando queries de Power Query...")
        queries = load_queries()

        # Agregar en orden para que las dependencias se resuelvan bien
        added = []
        for name in QUERY_ORDER:
            if name in queries:
                print(f"  + {name}")
                wb.Queries.Add(Name=name, Formula=queries[name])
                added.append(name)

        # Cualquier query extra no listado en QUERY_ORDER
        for name, formula in queries.items():
            if name not in added:
                print(f"  + {name}")
                wb.Queries.Add(Name=name, Formula=formula)

        # ── Conectar query "Productos" a la hoja Productos ───────────────────
        # Guardamos primero para que Excel registre las queries, luego
        # reabrimos y creamos el ListObject vinculado a la conexión.
        print("Guardando borrador para registrar queries...")
        out_str = str(output_path.resolve())
        wb.SaveAs(out_str, 51)
        wb.Close(False)

        print("Reabriendo para vincular query Productos a la hoja...")
        wb = excel.Workbooks.Open(out_str)
        ws_prods = wb.Sheets("Productos")

        # Limpiar el placeholder de texto
        ws_prods.Range("A1").Clear()
        
        # Forzar actualización de conexiones antes de crear la tabla
        try:
            wb.Queries.FastCombine = True
        except:
            pass

        print("Configurando tabla de resultados...")
        try:
            conn = wb.Connections("Query - Productos")
            list_obj = ws_prods.ListObjects.Add(
                SourceType=0,           # xlSrcQuery
                Source=conn,
                Destination=ws_prods.Range("$A$1"),
            )
            list_obj.Name = "TablaProductos"
            print("  Tabla 'TablaProductos' creada en hoja Productos.")
        except Exception as e:
            print(f"  Nota: la tabla se configurará manualmente ({e})")

        # ── Guardar final ─────────────────────────────────────────────────────
        print(f"\nGuardando: {out_str}")
        wb.Save()
        print("✓ ShopifyExport.xlsx creado exitosamente.\n")

    except Exception as e:
        print(f"\nERROR al construir el archivo: {e}", file=sys.stderr)
        raise

    finally:
        if wb is not None:
            try:
                wb.Close(False)
            except Exception:
                pass
        excel.Quit()

    _print_next_steps()


def _print_next_steps() -> None:
    print("=" * 60)
    print("PRÓXIMOS PASOS")
    print("=" * 60)
    print()
    print("1. Abre ShopifyExport.xlsx en Excel")
    print()
    print("2. Ve a la hoja 'Parametros' y rellena:")
    print("   • Tienda        → tu-tienda.myshopify.com")
    print("   • ClientID      → ID de tu app Shopify (opcional)")
    print("   • AccessToken   → Token de acceso de tu app Shopify")
    print("   • API_Version   → ej. '2024-10' (default si se deja vacío)")
    print("   • Tipo_Producto → ej. 'Camisetas'  (opcional)")
    print("   • Estado        → active | draft | archived  (opcional)")
    print("   • Coleccion     → handle de la colección  (opcional)")
    print("   • Tags          → ej. 'promo,sale'         (opcional)")
    print("   • Max_Productos → límite de filas")
    print()
    print("── ACTUALIZAR PRECIOS ──────────────────────────────────")
    print("   1. Después de refrescar, copia filas de 'Productos'")
    print("      a la hoja 'Actualizar_Precios'")
    print("   2. Rellena 'Precio_Nuevo' (y opcionalmente 'Precio_Comparacion_Nuevo')")
    print("   3. Cierra Excel y ejecuta:")
    print("      python update_prices.py --dry-run   ← previsualizar")
    print("      python update_prices.py              ← aplicar")
    print()
    print("3. Si la tabla no se creó automáticamente:")
    print("   Datos → Obtener datos → Iniciar Editor de Power Query")
    print("   Clic derecho en 'Productos' → 'Cargar en...'")
    print("   → Tabla → Hoja existente → selecciona Productos!A1")
    print()
    print("4. Presiona Datos → Actualizar todo  (Ctrl+Alt+F5)")
    print()
    print("   Si aparece diálogo de credenciales:")
    print("   → selecciona 'Anónimo' (el token va en los headers)")
    print()
    print("   Si pide nivel de privacidad:")
    print("   → 'Ignorar niveles de privacidad' o 'Público'")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Genera ShopifyExport.xlsx con Power Query + Shopify GraphQL"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        metavar="PATH",
        help="Ruta del archivo de salida (default: ShopifyExport.xlsx)",
    )
    args = parser.parse_args()
    build(args.output)


if __name__ == "__main__":
    main()
