(store as text, clientId as text, clientSecret as text) as text =>
let
    body = "grant_type=client_credentials"
        & "&client_id="     & clientId
        & "&client_secret=" & clientSecret,
    response = Web.Contents(
        "https://" & store & "/admin/oauth/access_token",
        [
            Headers = [#"Content-Type" = "application/x-www-form-urlencoded"],
            Content = Text.ToBinary(body),
            ManualStatusHandlingList = {400, 401, 403, 422}
        ]
    ),
    httpStatus = Value.Metadata(response)[Response.Status],
    json       = Json.Document(response)
in
    if httpStatus >= 400 then
        error Error.Record(
            "AuthError",
            "No se pudo obtener el token — HTTP " & Text.From(httpStatus)
                & ". Verifica ClientID y ClientSecret.",
            json
        )
    else
        json[access_token]
