export type LogSink = (message: string) => void;

export function createTimestampedLogger(
  sink: LogSink = (message) => console.error(message),
  now: () => Date = () => new Date(),
): LogSink {
  return (message) => sink(`${now().toISOString()} ${message}`);
}

export const logToStderr = createTimestampedLogger();
