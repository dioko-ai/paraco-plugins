# System Vitals + Port Scout

See the [collection guide](https://github.com/dioko-ai/paraco-plugins#readme) for workflows, data limits and configuration.

## Install

```sh
paraco marketplace install system-vitals --version 0.1.0 --output ./system-vitals
```

Use a Paraco build whose catalog includes this release.

## Run

```sh
paraco run ./system-vitals
```

Requires Linux and a Paraco build supporting the `system` capability. This grants read-only host metrics and socket discovery. It does not grant process control.

Requested capabilities: `system`. No records are seeded. Assets are included locally.

## License

Apache-2.0; see `LICENSE`.
