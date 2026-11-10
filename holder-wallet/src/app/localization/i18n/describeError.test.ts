// Errors are described by their cause. React Native's fetch on Android words a
// failed connection after Java's exceptions; it must read as "the server is
// unreachable", not as a generic failure.
import { describeError } from './describeError'

const network = describeError(new TypeError('Network request failed'))
const timeout = describeError(new Error('timeout of 30000ms exceeded'))
const generic = describeError(new Error('Something unexpected'))

describe('describing an error', () => {
  it('reads an Android connection failure as an unreachable server', () => {
    expect(network).not.toBe(generic)
    for (const message of [
      'fetch failed: java.net.ConnectException: Failed to connect to /192.168.100.6:8000',
      'java.net.ConnectException: Connection refused',
      'java.net.UnknownHostException: Unable to resolve host "registry.example"',
      'java.net.NoRouteToHostException: No route to host',
    ])
      expect(describeError(new Error(message))).toBe(network)
  })

  it("reads Java's socket timeout as a timeout", () => {
    expect(timeout).not.toBe(network)
    expect(describeError(new Error('fetch failed: java.net.SocketTimeoutException: timeout'))).toBe(timeout)
  })
})
