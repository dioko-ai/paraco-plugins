# Local Uptime Sentry

See the [collection guide](https://github.com/dioko-ai/paraco-plugins#readme) for workflows, data limits and configuration.

## Install

```sh
paraco marketplace install local-uptime-sentry --version 0.1.0 --output ./local-uptime-sentry
```

Use a Paraco build whose catalog includes this release.

## Run

Save this as `server.json` beside the installed app directory, then run `paraco serve --config ./server.json`:

```json
{
  "apps": [
    {
      "path": "local-uptime-sentry",
      "taskAuthoring": true,
      "taskNetwork": []
    }
  ]
}
```

Add each service host and port (for example `127.0.0.1:8080`) to `taskNetwork` before starting a monitor. Restart the host after editing grants.

Requested capabilities: `tasks`. No records are seeded. Assets are included locally.

## License

Apache-2.0; see `LICENSE`.
