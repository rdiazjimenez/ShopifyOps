let
    rawEdges = FnGetProducts(Parametros),

    // Expande cada producto en N filas (una por variante)
    ProductsWithVariants = List.Combine(
        List.Transform(rawEdges, (edge) =>
            let
                prod     = edge[node],
                variants = List.Transform(prod[variants][edges], each _[node]),
                tags     = if prod[tags] = null then {} else prod[tags]
            in
                List.Transform(variants, (v) => [
                    Producto_ID        = prod[id],
                    Titulo             = prod[title],
                    Vendor             = prod[vendor],
                    Tipo_Producto      = prod[productType],
                    Estado             = prod[status],
                    Tags               = Text.Combine(tags, ", "),
                    Creado_En          = prod[createdAt],
                    Actualizado_En     = prod[updatedAt],
                    Variante_ID        = v[id],
                    Titulo_Variante    = v[title],
                    SKU                = v[sku],
                    Precio             = v[price],
                    Precio_Comparacion = v[compareAtPrice],
                    Inventario         = v[inventoryQuantity],
                    Peso               = v[weight],
                    Unidad_Peso        = v[weightUnit],
                    Codigo_Barras      = v[barcode]
                ])
        )
    ),

    ColNames = {
        "Producto_ID", "Titulo", "Vendor", "Tipo_Producto", "Estado", "Tags",
        "Creado_En", "Actualizado_En",
        "Variante_ID", "Titulo_Variante", "SKU",
        "Precio", "Precio_Comparacion", "Inventario", "Peso", "Unidad_Peso", "Codigo_Barras"
    },

    // Si no hay resultados devuelve tabla vacía con las columnas correctas
    Result =
        if List.IsEmpty(ProductsWithVariants) then
            #table(ColNames, {})
        else
            Table.FromRecords(ProductsWithVariants, ColNames, MissingField.UseNull),

    // Tipado: precios como número, inventario como entero, fechas como datetimezone
    Typed = Table.TransformColumnTypes(Result, {
        {"Precio",             type number},
        {"Precio_Comparacion", type number},
        {"Inventario",         Int64.Type},
        {"Peso",               type number},
        {"Creado_En",          type datetimezone},
        {"Actualizado_En",     type datetimezone}
    })
in
    Typed
