(url as text, token as text, gqlQuery as text, variables as record) as any =>
let
    body     = Json.FromValue([query = gqlQuery, variables = variables]),
    response = Web.Contents(url, [
        Headers = [
            #"X-Shopify-Access-Token" = token,
            #"Content-Type"           = "application/json",
            #"Accept"                 = "application/json"
        ],
        Content                  = body,
        ManualStatusHandlingList = {400, 401, 403, 404, 422, 429, 500, 503}
    ]),
    httpStatus = Value.Metadata(response)[Response.Status],
    parsed     = Json.Document(response),
    result     =
        if httpStatus >= 400 then
            error Error.Record(
                "HTTP_" & Text.From(httpStatus),
                "Shopify devolvió HTTP " & Text.From(httpStatus),
                parsed
            )
        else if Record.HasFields(parsed, {"errors"}) and parsed[errors] <> null then
            error Error.Record(
                "ShopifyGQL",
                parsed[errors]{0}[message],
                parsed[errors]
            )
        else
            parsed[data]
in
    result
