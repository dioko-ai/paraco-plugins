# Prompt Regression Lab

See the [collection guide](https://github.com/dioko-ai/paraco-plugins#readme) for workflows, data limits and configuration.

## Install

```sh
paraco marketplace install prompt-regression-lab --version 0.1.0 --output ./prompt-regression-lab
```

Use a Paraco build whose catalog includes this release.

## Run

```sh
paraco run ./prompt-regression-lab
```

For AI requests, configure an external host-owned provider/grant file and pass `--ai-config /path/to/ai-config.json`. See [AI routing](https://github.com/dioko-ai/paraco/blob/main/docs/ai-routing.md). Credentials never belong in this app directory.

Requested capabilities: `ai`, `storage`. No records are seeded. Assets are included locally.

## License

Apache-2.0; see `LICENSE`.
