# Privacy and security status

## Local storage

SQLite, Agent configuration, uploaded files, conversations, and generated files live under `data/`. API keys are currently stored in plaintext in the Agent JSON and database connection fields; field names do not mean that the values are encrypted. Other accounts or software with access to the machine may read them.

Exclude the entire `data/` directory before publishing source code. If a key is exposed, revoke it with the provider and create a new one.

## Data sent to providers

Remote model calls send your input, relevant history, and attached images or files. CSV uploads, Session creation, and Agent messages make real requests to the configured provider. Downloading a provider artifact may also contact an upstream URL. Provider retention, billing, and data policies apply.

Probe channel connects to the upstream event stream and is not an offline operation.

## Trust boundary

The local backend uses an access token and binds to the loopback interface by default. Qingzhou is a single-user desktop application and should not be exposed to the public internet. Connect only to providers you trust and be careful when opening generated HTML or other active content. There is no independent file sandbox or complete security audit in this release.

The MIT license does not change provider terms and does not guarantee rights to generated content.
