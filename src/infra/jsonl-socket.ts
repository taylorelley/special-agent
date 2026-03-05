import net from "node:net";

const MAX_BUFFER_BYTES = 1024 * 1024;

export async function requestJsonlSocket<T>(params: {
  socketPath: string;
  payload: string;
  timeoutMs?: number;
  accept: (value: unknown) => T | undefined;
}): Promise<T | null> {
  const { socketPath, payload, timeoutMs = 15_000 } = params;
  return await new Promise((resolve) => {
    const client = new net.Socket();
    let settled = false;
    let buffer = "";
    const finish = (value: T | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        client.destroy();
      } catch {
        // ignore
      }
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    client.on("error", () => finish(null));
    client.on("end", () => finish(null));
    client.on("close", () => finish(null));
    client.connect(socketPath, () => {
      client.write(`${payload}\n`);
    });
    client.on("data", (data: Buffer) => {
      buffer += data.toString("utf8");
      if (buffer.length > MAX_BUFFER_BYTES) {
        finish(null);
        return;
      }
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf("\n");
        if (!line) {
          continue;
        }
        try {
          const msg: unknown = JSON.parse(line);
          const result = params.accept(msg);
          if (result !== undefined) {
            finish(result);
            return;
          }
        } catch {
          // ignore
        }
      }
    });
  });
}
