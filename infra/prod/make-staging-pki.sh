#!/usr/bin/env bash
# This file was written in 2026 by the Faculty of Informatics and Information
# Technologies for the Professional License Registry.
#
# An internal CA and the certificates infra/docker-compose.prod.yml needs,
# for a staging environment or for trying the production layout locally.
#
#   ./make-staging-pki.sh [out-dir] [public-hostname] [console-hostname]
#
# Production does not use this. The internal certificates come from the
# organisation's PKI, with keys generated where they are used and never
# copied; the public certificate from a public CA. What matters is only the
# shape, which this script documents:
#
#   ca.crt                 the internal CA every sidecar trusts
#   backend.crt/.key       CN=plr-backend  server + client  (back-office, worker)
#   edge.crt/.key          CN=plr-edge     client           (public edge)
#   public.crt/.key        the public names, self-signed here
#
# A sidecar admits a peer by its CN (nginx/*-mesh.conf.template), so issue
# these names to nothing else.
set -euo pipefail

out="${1:-./tls}"
public="${2:-registry.plr.test}"
console="${3:-console.plr.test}"
days=90
mkdir -p "$out"
cd "$out"

if [ -e ca.key ]; then
  echo "$out already has a CA; remove it to start over." >&2
  exit 1
fi

openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -x509 -new -key ca.key -sha256 -days "$days" -out ca.crt \
  -subj "/O=PLR staging/CN=PLR internal CA"

leaf() { # name cn san eku
  local name=$1 cn=$2 san=$3 eku=$4
  openssl ecparam -name prime256v1 -genkey -noout -out "$name.key"
  openssl req -new -key "$name.key" -out "$name.csr" -subj "/O=PLR/CN=$cn"
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=%s\nsubjectAltName=%s\n' \
    "$eku" "$san" > "$name.ext"
  openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -sha256 -days "$days" -extfile "$name.ext" -out "$name.crt" 2>/dev/null
  rm -f "$name.csr" "$name.ext"
}

leaf backend plr-backend "DNS:plr-backend,DNS:backend" "serverAuth,clientAuth"
leaf edge    plr-edge    "DNS:plr-edge"                "clientAuth"

openssl ecparam -name prime256v1 -genkey -noout -out public.key
openssl req -x509 -new -key public.key -sha256 -days "$days" -out public.crt \
  -subj "/CN=$public" -addext "subjectAltName=DNS:$public,DNS:$console" 2>/dev/null \
  || openssl req -x509 -new -key public.key -sha256 -days "$days" -out public.crt \
       -subj "/CN=$public" -extensions san \
       -config <(printf '[req]\ndistinguished_name=dn\n[dn]\n[san]\nsubjectAltName=DNS:%s,DNS:%s\n' "$public" "$console")

rm -f ca.srl
# The CA key signs nothing at run time; keep it off the host that runs the stack.
chmod 600 ./*.key
echo "Certificates in $out. Move ca.key somewhere safe: nothing in the stack needs it."
