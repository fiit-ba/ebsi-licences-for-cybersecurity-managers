// The holder's exchange on the Wi-Fi (design decisions D33): a minimal HTTP/1.1
// server on a TCP socket of the phone's, for the one verifier the QR code is
// shown to. One request per connection, a body of at most 256 KiB, and the
// server goes away with the exchange - answered, declined or out of time.
import TcpSocket from 'react-native-tcp-socket'
import * as Network from 'expo-network'
import { ExchangeState, HolderExchange, HttpAnswer, Query } from './session'
import { DECISION_TTL_MS, EXCHANGE_TTL_MS } from './protocol'

const MAX_REQUEST_BYTES = 256 * 1024
const REASONS: Record<number, string> = {
  200: 'OK',
  202: 'Accepted',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
}

export class NoWifiAddress extends Error {}

/** A request line, headers and body, once all of it has arrived; null until then. */
export const parseRequest = (raw: Buffer) => {
  const end = raw.indexOf('\r\n\r\n')
  if (end === -1) return null
  const [line, ...lines] = raw.subarray(0, end).toString('latin1').split('\r\n')
  const [method, path] = line.split(' ')
  const headers: Record<string, string> = {}
  for (const header of lines) {
    const colon = header.indexOf(':')
    if (colon > 0) headers[header.slice(0, colon).trim().toLowerCase()] = header.slice(colon + 1).trim()
  }
  const length = Number(headers['content-length'] ?? 0) || 0
  if (raw.length < end + 4 + length) return null
  return { method, path, headers, body: raw.subarray(end + 4, end + 4 + length).toString('utf8') }
}

export const formatResponse = ({ status, body }: HttpAnswer): string => {
  const text = JSON.stringify(body)
  return (
    `HTTP/1.1 ${status} ${REASONS[status] ?? 'Error'}\r\n` +
    'Content-Type: application/json\r\n' +
    `Content-Length: ${Buffer.byteLength(text, 'utf8')}\r\n` +
    'Cache-Control: no-store\r\n' +
    'Connection: close\r\n\r\n' +
    text
  )
}

export type OpenExchange = {
  exchange: HolderExchange
  close: () => void
}

/**
 * Open an exchange: a server on an unused port of the phone's Wi-Fi address,
 * and the invitation for the QR code. `onRequest` is called with the
 * verifier's request, `onFinished` when the exchange is over.
 */
export const openExchange = async (listeners: {
  onRequest: (query: Query) => void
  onFinished: (state: ExchangeState) => void
}): Promise<OpenExchange> => {
  const address = await Network.getIpAddressAsync().catch(() => '')
  if (!address || address === '0.0.0.0' || address.startsWith('127.')) throw new NoWifiAddress('No Wi-Fi address')

  let server: ReturnType<typeof TcpSocket.createServer> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  // Made once the port is known; nobody can connect before the QR code shows it.
  let session: HolderExchange | undefined
  const close = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const closing = server
    server = undefined
    // A moment, so the last answer reaches the verifier before the socket goes.
    if (closing) setTimeout(() => closing.close(), 500)
  }

  const port = await new Promise<number>((resolve, reject) => {
    server = TcpSocket.createServer((socket) => {
      let raw = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        raw = Buffer.concat([raw, Buffer.from(chunk as any)] as any)
        if (raw.length > MAX_REQUEST_BYTES) {
          socket.end(formatResponse({ status: 413, body: { error: 'too_large' } }))
          return
        }
        const request = parseRequest(raw)
        if (!request) return
        const answer = session
          ? session.handle(request.method, request.path, request.headers, request.body)
          : { status: 410, body: { error: 'closed' } }
        socket.end(formatResponse(answer))
      })
      socket.on('error', () => socket.destroy())
    })
    server.on('error', reject)
    server.listen({ port: 0, host: '0.0.0.0' }, () => {
      const bound = server?.address()
      if (bound && typeof bound === 'object' && bound.port) resolve(bound.port)
      else reject(new Error('The exchange could not listen'))
    })
  })

  const opened = new HolderExchange(`http://${address}:${port}`, {
    // The holder's decision window starts with the request.
    onRequest: (query) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => opened.close(), DECISION_TTL_MS + 1000)
      listeners.onRequest(query)
    },
    onFinished: (state) => {
      close()
      listeners.onFinished(state)
    },
  })
  session = opened
  timer = setTimeout(() => opened.close(), EXCHANGE_TTL_MS + 1000)
  return {
    exchange: opened,
    close: () => {
      opened.close()
      close()
    },
  }
}
