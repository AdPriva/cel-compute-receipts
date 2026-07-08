# Security Policy

CEL is experimental research software.

Do not use this implementation as the sole protection for critical systems.
Direct verification is intentionally simple, but it can make verifiers spend as
much CPU as provers. Production deployments should enforce:

- strict maximum depths
- short epoch windows
- context binding
- request size limits
- cheap rejection before expensive verification
- ordinary rate limits around CEL verification

To report a vulnerability, open a private advisory on GitHub or contact the
maintainer directly.
