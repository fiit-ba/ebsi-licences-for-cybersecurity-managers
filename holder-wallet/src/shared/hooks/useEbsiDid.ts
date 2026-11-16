// The wallet's EBSI DID, created by the button that leads on.
// Certificates are issued to this DID, so the wallet needs it before anything
// else. It used to be made on a screen of its own (NetworkAuth), which showed
// for a moment and moved on to the certificates: the DID is derived on the
// device from the key the security phrase secures (infrastructure/identity/ebsi/createDid.ts),
// with nothing to choose and nothing to wait for. The setup flow, the sign-in
// and the DID list now create it where the holder already is.
import { useCallback, useContext } from 'react'
import { MessageContext } from '@app/context/UserMessage.context'
import { createDidEbsi } from '@infrastructure/identity/ebsi/createDid'
import { withCause } from '@app/localization/i18n/describeError'
import openIdI18nKeys from '@app/localization/i18n/keys'

/** Creates the EBSI DID unless the wallet has it; false, and a message shown, if that fails. */
const useEbsiDid = (): (() => Promise<boolean>) => {
  const { showMessage } = useContext(MessageContext)
  return useCallback(async () => {
    try {
      await createDidEbsi()
      return true
    } catch (error) {
      showMessage({ content: withCause(openIdI18nKeys.ERROR_CREATING_DID, error), type: 'error' })
      return false
    }
  }, [showMessage])
}

export default useEbsiDid
