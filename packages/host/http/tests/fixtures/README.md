# HTTPS test identity

`localhost-key.pem` and `localhost-cert.pem` are a public, test-only identity for loopback unit tests.
They must never be loaded by a runtime, release bundle, or production configuration.
