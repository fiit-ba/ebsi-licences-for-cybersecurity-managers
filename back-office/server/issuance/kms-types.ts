import type {
  GetPublicKeyCommand,
  GetPublicKeyCommandOutput,
  SignCommand,
  SignCommandOutput,
} from '@aws-sdk/client-kms';

/** Minimal KMS public-key/signature transport shared by live clients and isolated fixtures. */
export interface KmsSigningClient {
  send(
    command: GetPublicKeyCommand | SignCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Partial<GetPublicKeyCommandOutput & SignCommandOutput>>;
}
