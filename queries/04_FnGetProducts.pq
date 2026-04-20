(params as record) as list =>
let
    url       = "https://" & params[Tienda] & "/admin/api/" & params[API_Version] & "/graphql.json",
    token     = params[Token],
    tipoProd  = if params[Tipo_Producto] = null or params[Tipo_Producto] = "" then null else params[Tipo_Producto],
    estado    = if params[Estado]        = null or params[Estado]        = "" then null else params[Estado],
    coleccion = if params[Coleccion]     = null or params[Coleccion]     = "" then null else params[Coleccion],
    tagsRaw   = if params[Tags]          = null or params[Tags]          = "" then null else params[Tags],
    maxProd   =
        let v = params[Max_Productos]
        in if v = null or v = "" then 500 else Number.FromText(Text.From(v)),

    // Armar filtro de búsqueda GraphQL
    filterParts = List.RemoveNulls({
        if tipoProd <> null then
            "product_type:""" & tipoProd & """"
        else null,
        if estado <> null then
            "status:" & estado
        else null,
        if tagsRaw <> null then
            Text.Combine(
                List.Transform(Text.Split(tagsRaw, ","), each "tag:""" & Text.Trim(_) & """"),
                " "
            )
        else null
    }),
    filterStr = Text.Combine(filterParts, " "),

    // Campos de variante reutilizados en ambas queries
    variantFields  = "id title sku price compareAtPrice inventoryQuantity weight weightUnit barcode",
    productFields  =
        "id title vendor productType status tags createdAt updatedAt " &
        "variants(first:100){edges{node{" & variantFields & "}}}",

    // Query sin colección
    gqlProducts =
        "query($cursor:String,$queryFilter:String)" &
        "{products(first:250,after:$cursor,query:$queryFilter)" &
        "{edges{node{" & productFields & "}}" &
        "pageInfo{hasNextPage endCursor}}}",

    // Query con colección
    gqlCollection =
        "query($handle:String!,$cursor:String,$queryFilter:String)" &
        "{collectionByHandle(handle:$handle)" &
        "{products(first:250,after:$cursor,query:$queryFilter)" &
        "{edges{node{" & productFields & "}}" &
        "pageInfo{hasNextPage endCursor}}}}",

    useCollection = coleccion <> null,

    // Obtiene una página de resultados dada un cursor (null = primera página)
    GetPage = (cursor as nullable text) as record =>
        let
            gql  = if useCollection then gqlCollection else gqlProducts,
            vars = if useCollection then
                       [handle = coleccion, cursor = cursor, queryFilter = filterStr]
                   else
                       [cursor = cursor, queryFilter = filterStr],
            data = FnGQLRequest(url, token, gql, vars),
            prodNode =
                if useCollection then
                    (if data[collectionByHandle] = null then
                        error Error.Record("NotFound", "Colección no encontrada: " & coleccion)
                    else
                        data[collectionByHandle][products])
                else
                    data[products]
        in
            [
                edges       = prodNode[edges],
                hasNextPage = prodNode[pageInfo][hasNextPage],
                endCursor   = prodNode[pageInfo][endCursor]
            ],

    // Paginación cursor-based con List.Generate
    // Estado: [page = resultado_página, done = lógico]
    // - La condición se evalúa sobre el estado actual; al llegar a done=true se detiene
    // - El selector extrae los edges del estado actual
    Pages = List.Generate(
        () => [page = GetPage(null), done = false],
        each not _[done],
        each
            let p = _[page]
            in if p[hasNextPage] then
                   [page = GetPage(p[endCursor]), done = false]
               else
                   [page = p, done = true],
        each _[page][edges]
    ),

    AllEdges     = List.Combine(Pages),
    LimitedEdges = List.FirstN(AllEdges, maxProd)
in
    LimitedEdges
