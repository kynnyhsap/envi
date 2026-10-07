---
title: "Logs and traces"
description: "The debug logs of the CLI, the log file, and the OpenTelemetry traces and logs over OTLP."
---

# Logs and traces

The CLI writes its logs to stderr. It also sends its spans and its logs to an OpenTelemetry
collector, and it writes its logs to a file, when you ask for them. A log or a span never holds a
secret value. Telemetry never fails a command and never changes its output.

## Debug logs

`--debug` shows every log on stderr. Without it, stderr shows only the logs of the level `INFO`
and above. `ENVI_DEBUG=true` does the same as `--debug`, and the flag wins:
`ENVI_DEBUG=true envi check --debug=false` shows no debug log.

A debug log names each step and its duration, the configs that Envi found, the stage and its
source, the settings of each resolution, the cache, and each provider batch with its references.

```sh
envi check --debug
envi check --debug --log-format json
```

## Log file

`ENVI_LOG_FILE=<file>` appends every log, including the debug logs, to the file as JSON lines. The
file does not change stderr. Each run appends to the same file.

```sh
ENVI_LOG_FILE=/tmp/envi.log envi sync
```

## OpenTelemetry

The CLI sends its spans and its logs over OTLP, to the collector of the standard OpenTelemetry
variables. Without an endpoint, the CLI sends nothing.

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 envi sync
```

| Variable                             | Does                                                                |
| ------------------------------------ | ------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | The base URL. Envi adds `/v1/traces` and `/v1/logs`.                |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | The full URL of the spans. It wins over the base URL.               |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`   | The full URL of the logs. It wins over the base URL.                |
| `OTEL_EXPORTER_OTLP_PROTOCOL`        | `http/protobuf` or `http/json`. Default: `http/protobuf`.           |
| `OTEL_EXPORTER_OTLP_HEADERS`         | Headers for each request, such as `authorization=Bearer%20<token>`. |
| `OTEL_TRACES_EXPORTER`               | `none` sends no spans. Default: `otlp`.                             |
| `OTEL_LOGS_EXPORTER`                 | `none` sends no logs. Default: `otlp`.                              |
| `OTEL_SDK_DISABLED`                  | `true` sends nothing.                                               |

- The service name of every span and log is `envi`, with the version of Envi.
- The root span of a command is `envi <command>`, such as `envi sync`. Its children are the steps:
  the config search, the config import, the cache read, the provider batch, each `custom()`
  resolution, and the cache write.
- A span of a failed step holds the tag and the safe message of the error. A throw in user code
  shows only its class name, as on stderr.
- Envi sends the last batch before it exits. A collector that does not answer delays the exit by 2
  seconds at most.
- The CLI supports only OTLP over HTTP. Another protocol, such as `grpc`, sends nothing and warns.
- A variable that does not parse turns off its part with a warning on stderr.

## Trace context

When `TRACEPARENT` holds a W3C trace context, the root span of the command continues that trace.
A parent process, such as a test runner or a CI step, sets it.

While the CLI sends its spans, `envi run` sets `TRACEPARENT` of the child to the span of the
command. A child that reads it continues the trace. Without an export, the child inherits
`TRACEPARENT` unchanged. A var named `TRACEPARENT` in the config wins.

## SDK

The SDK sets up no logger and no tracer. Its steps are Effect spans and Effect logs, so an Effect
program that provides a tracer and a logger receives them. See [Effect](../sdk/effect.md).
