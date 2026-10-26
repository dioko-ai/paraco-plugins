# Cron Time Machine

See the [collection guide](https://github.com/dioko-ai/paraco-plugins#readme) for workflows, data limits and configuration.

## Install

```sh
paraco marketplace install cron-time-machine --version 0.1.0 --output ./cron-time-machine
```

Use a Paraco build whose catalog includes this release.

## Run

Save this as `server.json` beside the installed app directory, then run `paraco serve --config ./server.json`:

```json
{
  "apps": [
    {
      "path": "cron-time-machine",
      "taskAuthoring": true,
      "taskNetwork": []
    }
  ]
}
```

Requested capabilities: `tasks`, `storage`. No records are seeded. Assets are included locally.

## License

Apache-2.0; see `LICENSE`.
