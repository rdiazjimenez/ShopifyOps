let
    tbl = Excel.CurrentWorkbook(){[Name="Configuracion"]}[Content],
    Get = (key as text) as any =>
        let
            row = Table.SelectRows(tbl, each _[Parametro] = key)
        in
            if Table.IsEmpty(row) then null else row{0}[Valor],
    tienda      = Get("Tienda"),
    clientId    = Get("ClientID"),
    accessToken = Get("AccessToken"),
    apiVersion  = let v = Get("API_Version") in if v = null or v = "" then "2024-10" else v,
    result = [
        Tienda        = tienda,
        ClientID      = clientId,
        Token         = accessToken,
        API_Version   = apiVersion,
        Tipo_Producto = Get("Tipo_Producto"),
        Estado        = Get("Estado"),
        Coleccion     = Get("Coleccion"),
        Tags          = Get("Tags"),
        Max_Productos = Get("Max_Productos")
    ]
in
    result
