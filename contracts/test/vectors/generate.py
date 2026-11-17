#!/usr/bin/env python3
"""Write hashes.json: known answers for contracts/libraries/Hashes.sol.

The answers come from this file's own ABI encoder and Python's hashlib, not
from the contracts or any other implementation under test, so a mistake shared
by those cannot hide here. Only the standard library is used.

    python3 test/vectors/generate.py          # from the package root

The cases catch encoding disagreements: diacritics, a DID and an id that would
concatenate alike, strings longer than one ABI word, an empty note, a note that
ends in a space.
"""

import hashlib
import json
from pathlib import Path

ISSUER = "did:ebsi:zvHWX359A3CvfJnCYaAiAde"

STATUS_KEYS = [
    ("a credential's id", ISSUER, "urn:uuid:3f1a9c2b-7e4d-4056-a1b3-c5d7e9f02134"),
    ("an id with diacritics", ISSUER, "urn:uuid:č-17"),
    ("a DID and an id that concatenate alike", ISSUER + "2", "48"),
    ("a DID longer than one ABI word", "did:ebsi:" + "z" * 80, "7"),
    ("an id longer than one ABI word", ISSUER, "PLR-" * 20),
]

REASONS = [
    ("a category alone", "conditions_not_met", "", "ee" * 32),
    ("a note with diacritics", "other", "Doklady o vzdelaní boli sfalšované", "ff" * 32),
    ("a note longer than one ABI word", "supervisory_decision", "rozhodnutie " * 12, "11" * 32),
    ("a reinstatement without a reason", "none", "", "22" * 32),
]


def word(number: int) -> bytes:
    return number.to_bytes(32, "big")


def encode(strings: list[str], last_word: bytes | None = None) -> bytes:
    """Solidity's abi.encode of some strings, then optionally one bytes32."""
    tails = []
    for value in strings:
        data = value.encode("utf-8")
        tails.append(word(len(data)) + data + b"\0" * (-len(data) % 32))
    offset = 32 * (len(strings) + (last_word is not None))
    heads = []
    for tail in tails:
        heads.append(word(offset))
        offset += len(tail)
    if last_word is not None:
        heads.append(last_word)
    return b"".join(heads) + b"".join(tails)


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def hex32(data: bytes) -> str:
    return "0x" + data.hex()


def status_key(name: str, issuer_did: str, certificate_id: str) -> dict:
    id_hash = sha256(encode(["PLR-CERTIFICATE-ID-V1", certificate_id]))
    key = sha256(encode(["PLR-CERTIFICATE-V4", issuer_did], id_hash))
    return {
        "name": name,
        "issuerDid": issuer_did,
        "certificateId": certificate_id,
        "certificateIdHash": hex32(id_hash),
        "statusKey": hex32(key),
    }


def reason(name: str, code: str, note: str, salt: str) -> dict:
    commitment = sha256(encode(["PLR-REASON-V1", code, note], bytes.fromhex(salt)))
    return {"name": name, "code": code, "note": note, "salt": "0x" + salt, "reasonHash": hex32(commitment)}


def main() -> None:
    vectors = {
        "_description": (
            "Known answers for contracts/libraries/Hashes.sol, written by test/vectors/generate.py. "
            'certificateIdHash = SHA-256(abi.encode("PLR-CERTIFICATE-ID-V1", certificateId)); '
            'statusKey = SHA-256(abi.encode("PLR-CERTIFICATE-V4", issuerDid, certificateIdHash)); '
            'reasonHash = SHA-256(abi.encode("PLR-REASON-V1", code, note, salt)). Strings are UTF-8, '
            "used exactly as given (a trailing space included). test/HashVectors.t.sol checks the contracts "
            "against them; any other implementation of these hashes should check itself against the same file."
        ),
        "statusKeys": [status_key(*case) for case in STATUS_KEYS],
        "reasons": [reason(*case) for case in REASONS],
    }
    target = Path(__file__).with_name("hashes.json")
    target.write_text(json.dumps(vectors, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
