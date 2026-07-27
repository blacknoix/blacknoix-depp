import { connect } from "node:net";

export interface RawResponse {
  statusCode: number;
  headers: Record<string, string[]>;
  body: string;
}

/**
 * Sends a hand-built HTTP request over a raw socket.
 *
 * Needed for cases the fetch API cannot express — most importantly duplicate
 * headers, which fetch collapses before they reach the wire.
 */
export function rawRequest(
  url: string,
  requestLine: string,
  headerLines: string[],
  body = "",
): Promise<RawResponse> {
  const { hostname, port } = new URL(url);

  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), hostname, () => {
      const lines = [requestLine, `Host: ${hostname}`, ...headerLines, "Connection: close"];

      if (body.length > 0) {
        lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
      }

      socket.write(`${lines.join("\r\n")}\r\n\r\n${body}`);
    });

    let raw = "";

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (raw += chunk));
    socket.on("error", reject);

    socket.on("close", () => {
      const separator = raw.indexOf("\r\n\r\n");
      const head = separator === -1 ? raw : raw.slice(0, separator);
      const responseBody = separator === -1 ? "" : raw.slice(separator + 4);

      const [statusLine, ...rest] = head.split("\r\n");
      const headers: Record<string, string[]> = {};

      for (const line of rest) {
        const colon = line.indexOf(":");

        if (colon === -1) {
          continue;
        }

        const name = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();

        (headers[name] ??= []).push(value);
      }

      resolve({
        statusCode: Number(statusLine.split(" ")[1]),
        headers,
        body: responseBody,
      });
    });
  });
}
