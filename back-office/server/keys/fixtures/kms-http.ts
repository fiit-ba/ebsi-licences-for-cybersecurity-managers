import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import {
  CreateKeyCommand,
  DescribeKeyCommand,
  GetPublicKeyCommand,
  ListResourceTagsCommand,
  SignCommand,
} from '@aws-sdk/client-kms';
import { kmsCeremonyFixture } from './kms-ceremony.ts';

/**
 * Expose the synthetic EC ceremony through the real AWS SDK's loopback JSON protocol.
 * @returns An owned HTTP endpoint, fake key inventory and asynchronous cleanup operation.
 * @throws Local listener errors if the fixture cannot bind a loopback port.
 * @remarks No requests are forwarded to AWS and test private keys remain in memory.
 */
export async function kmsHttpFixture() {
  const fixture = kmsCeremonyFixture();
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const action = String(request.headers['x-amz-target']).split('.').at(-1)!;
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const command =
        action === 'CreateKey'
          ? new CreateKeyCommand(input)
          : action === 'DescribeKey'
            ? new DescribeKeyCommand(input)
            : action === 'GetPublicKey'
              ? new GetPublicKeyCommand(input)
              : action === 'ListResourceTags'
                ? new ListResourceTagsCommand(input)
                : action === 'Sign'
                  ? new SignCommand({ ...input, Message: Buffer.from(input.Message, 'base64') })
                  : undefined;
      if (!command) throw new Error('Unexpected KMS fixture action.');
      const result: { PublicKey?: Uint8Array; Signature?: Uint8Array } = await fixture.client.send(
        command as GetPublicKeyCommand,
      );
      const body = result.PublicKey
        ? { ...result, PublicKey: Buffer.from(result.PublicKey).toString('base64') }
        : result.Signature
          ? {
              ...result,
              KeyId: input.KeyId,
              Signature: Buffer.from(result.Signature).toString('base64'),
            }
          : result;
      response.writeHead(200, { 'content-type': 'application/x-amz-json-1.1' });
      response.end(JSON.stringify(body));
    })().catch(() => {
      response.writeHead(500, { 'content-type': 'application/x-amz-json-1.1' });
      response.end(
        JSON.stringify({ __type: 'KMSInternalException', message: 'Synthetic KMS failure' }),
      );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    ...fixture,
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    /**
     * Stop the owned loopback KMS protocol fixture.
     * @returns Completion after its HTTP listener closes.
     */
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
