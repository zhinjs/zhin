# Test fixtures

`media-test-cert.pem` / `media-test-key.pem` are a self-signed certificate and key **for tests only**
(`network-pinned-transport.test.ts` and the Agent media DNS tests). They are never trusted outside a
test: the tests pass the certificate as `ca` to the internal pinned request. Subject alternative names:
`media.test`, `cdn.example`, `next.example`. Valid for 100 years. Regenerate with:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout media-test-key.pem -out media-test-cert.pem -days 36500 \
  -subj "/CN=media.test" -addext "subjectAltName=DNS:media.test,DNS:cdn.example,DNS:next.example"
```
