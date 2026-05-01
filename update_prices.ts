/**
 * Office Script: Actualización de Precios Shopify vía Power Automate
 * Solución al error de inferencia de tipo en la línea 62.
 */

interface VariantePayload {
  varianteId: string;
  precioNuevo: string;
  precioComparacion: string;
}

interface VarianteResultado {
  varianteId: string;
  estado: string;
}

async function main(workbook: ExcelScript.Workbook) {
  const flowUrl = readConfig(workbook, "FlowURL");
  if (!flowUrl) {
    console.log("ERROR: Falta 'FlowURL' en la tabla Configuracion.");
    return;
  }

  const table = workbook.getTable("ActualizarPrecios");
  const dataRange = table.getRangeBetweenHeaderAndTotal();
  if (!dataRange) return;

  const data = dataRange.getValues() as (string | number | boolean)[][];
  const headers = table.getHeaderRowRange().getValues()[0] as string[];

  const col = (name: string): number => headers.findIndex(h => normalize(String(h)) === normalize(name));
  const cVarianteId = col("Variante_ID");
  const cPrecio = col("Precio_Nuevo");
  const cComparacion = col("Precio_Comparacion_Nuevo");
  const cEstado = col("Estado");

  const filas = data
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => row[cPrecio] !== null && String(row[cPrecio]).trim() !== "");

  if (filas.length === 0) return;

  const payload: VariantePayload[] = filas.map(({ row }) => ({
    varianteId: String(row[cVarianteId] ?? "").trim(),
    precioNuevo: String(row[cPrecio]).trim(),
    precioComparacion: row[cComparacion] ? String(row[cComparacion]).trim() : "",
  }));

  console.log(`Enviando ${payload.length} variante(s) a Power Automate...`);

  try {
    const resp = await fetch(flowUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantes: payload }),
    });

    if (!resp.ok) {
      console.log(`ERROR HTTP ${resp.status}: ${await resp.text()}`);
      return;
    }

    // LINEA 62: Tipado explícito asignado
    const resultados: VarianteResultado[] = (await resp.json()) as VarianteResultado[];

    if (Array.isArray(resultados)) {
      const mapaResultados = new Map(resultados.map(r => [r.varianteId, r.estado]));

      for (const { row, i } of filas) {
        const vid = String(row[cVarianteId] ?? "").trim();
        const estado = mapaResultados.get(vid) ?? "SIN_RESPUESTA";
        dataRange.getCell(i, cEstado).setValue(estado);
      }
      console.log("Proceso finalizado.");
    } else {
      console.log("La respuesta no tiene el formato de lista esperado.");
    }

  } catch (e) {
    console.log(`Error de conexión: ${String(e)}`);
  }
}

function readConfig(workbook: ExcelScript.Workbook, key: string): string {
  const table = workbook.getTable("Configuracion");
  const rows = table.getRangeBetweenHeaderAndTotal().getValues() as string[][];
  const found = rows.find(r => normalize(String(r[0])) === normalize(key));
  return found ? String(found[1]).trim() : "";
}

function normalize(s: string): string { return s ? s.trim().toUpperCase() : ""; }