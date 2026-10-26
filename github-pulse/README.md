# GitHub Pulse

See the [collection guide](https://github.com/dioko-ai/paraco-plugins#readme) for workflows, data limits and configuration.

## Install

```sh
paraco marketplace install github-pulse --version 0.1.0 --output ./github-pulse
```

Use a Paraco build whose catalog includes this release.

## Run

Save this as `server.json` beside the installed app directory, then run `paraco serve --config ./server.json`:

```json
{
  "apps": [
    {
      "path": "github-pulse",
      "taskAuthoring": true,
      "taskNetwork": [
        "api.github.com:443"
      ]
    }
  ]
}
```

Requested capabilities: `tasks`. No records are seeded. Assets are included locally.

## License

Apache-2.0; see `LICENSE`.
