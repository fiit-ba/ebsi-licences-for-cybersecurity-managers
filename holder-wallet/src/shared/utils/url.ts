// The credential offer URI is matched over http as well as https, and a miss is reported (project documentation).
type ConfigParamsURL = {
  startParamToken?: string
  splitParamToken?: string
}

const getParamsUrl = (url: string, config?: ConfigParamsURL) => {
  const queryString = url
    .split(config?.startParamToken ?? '?')
    .filter((_, index) => index !== 0)
    .join(config?.startParamToken ?? '?')

  const queryParams: any = {}
  queryString.split(config?.splitParamToken ?? '&').forEach((query) => {
    const [key, value] = query.split('=')
    queryParams[key] = value
  })
  return queryParams
}

const convertParamsToObject = (params: any) => {
  const result = {}
  Object.entries(params).forEach(([key, value]) => {
    const parts = key.split('[').map((obj) => obj.replace(']', ''))
    parts.reduce((obj: any, part, index) => {
      const nextPart = parts[index + 1]
      const isNextPartInt = !isNaN(parseInt(nextPart))

      obj[part] = obj[part] ?? (isNextPartInt ? [] : {})

      if (!isNaN(parseInt(part))) {
        const indexPart = parseInt(part)
        if (parts.length - 1 === index) obj[indexPart] = value
        return obj[indexPart]
      } else {
        if (parts.length - 1 === index) obj[part] = value
        return obj[part]
      }
    }, result)
  })
  return result
}

export const convertUriToObject = (uri: string, startParamToken?: ConfigParamsURL | undefined) => {
  const decodedUri = decodeURIComponent(uri)
  const queryParams = getParamsUrl(decodedUri, startParamToken)
  const object = convertParamsToObject(queryParams)
  return object
}

export const extractCredentialOfferUri = (data: string) => {
  const uri = decodeURIComponent(data)
  // `http` is accepted as well as `https` because the registry's development
  // stack is served over plain HTTP on the LAN. An offer pointing at
  // http://<lan-ip>:8000 matched nothing, and the non-null assertion then
  // surfaced it as Hermes' "Cannot convert null value to object" from a
  // property access three frames away from the cause.
  // This must be narrowed back to https before a pilot. A credential offer
  // carries a pre-authorized code, and following one over plain HTTP hands
  // that code to anyone on the path.
  const match = uri.match(/https?:\/\/[^\s]+/)
  if (!match) {
    // A key the display layer shows in Slovak (app/localization/i18n/describeError.ts).
    throw new Error('ERROR_NO_OFFER_IN_QR')
  }
  return match[0]
}

export const processAuthorizationResponse = (url: string): { code: string; state: string } => {
  const params = {
    code: '',
    state: '',
  }

  const queryString = url.split(/[?&]/).slice(1)
  queryString.forEach((param) => {
    const [key, value] = param.split('=')
    if (key === 'code') {
      params.code = value || ''
    } else if (key === 'state') {
      params.state = value || ''
    }
  })

  return params
}
