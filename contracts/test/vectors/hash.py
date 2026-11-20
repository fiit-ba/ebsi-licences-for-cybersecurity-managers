#!/usr/bin/env python3
"""One hash of contracts/libraries/Hashes.sol, for test/fuzz/HashesFfi.t.sol.

Like generate.py, it encodes with its own ABI encoder and hashes with Python's
hashlib, never with the contracts' code, so a mistake shared by those cannot
hide. It takes raw bytes as hex, not text: a fuzzed Solidity string need not
be valid UTF-8, and the chain hashes its bytes as they are.

    python3 test/vectors/hash.py certificate-id <id hex>
    python3 test/vectors/hash.py status-key <issuer DID hex> <certificate id hex>
    python3 test/vectors/hash.py reason <code hex> <note hex> <salt hex>

It prints the hash as 0x-prefixed hex, which Foundry's ffi reads as bytes.
"""

import hashlib
import sys


def word(number: int) -> bytes:
    return number.to_bytes(32, "big")


def encode(values: list[bytes], last_word: bytes | None = None) -> bytes:
    """Solidity's abi.encode of some strings (as their bytes), then optionally one bytes32."""
    tails = [word(len(v)) + v + b"\0" * (-len(v) % 32) for v in values]
    offset = 32 * (len(values) + (last_word is not None))
    heads = []
    for tail in tails:
        heads.append(word(offset))
        offset += len(tail)
    if last_word is not None:
        heads.append(last_word)
    return b"".join(heads) + b"".join(tails)


def raw(value: str) -> bytes:
    return bytes.fromhex(value[2:] if value.startswith("0x") else value)


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def certificate_id_hash(certificate_id: bytes) -> bytes:
    return sha256(encode([b"PLR-CERTIFICATE-ID-V1", certificate_id]))


def main(kind: str, *args: str) -> None:
    if kind == "certificate-id":
        digest = certificate_id_hash(raw(args[0]))
    elif kind == "status-key":
        digest = sha256(encode([b"PLR-CERTIFICATE-V4", raw(args[0])], certificate_id_hash(raw(args[1]))))
    elif kind == "reason":
        digest = sha256(encode([b"PLR-REASON-V1", raw(args[0]), raw(args[1])], raw(args[2])))
    else:
        raise SystemExit(f"unknown hash: {kind}")
    print("0x" + digest.hex())


if __name__ == "__main__":
    main(*sys.argv[1:])
