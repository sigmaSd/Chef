// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import { type ChefProvider, runChefProvider } from "../src/sdk.ts";
import { TextLineStream } from "@std/streams/text-line-stream";

Deno.test("Chef SDK - Protocol Test", async () => {
  const { readable: stdin, writable: stdinWriterStream } = new TransformStream<
    Uint8Array,
    Uint8Array
  >();
  const { readable: stdout, writable: stdoutWriterStream } =
    new TransformStream<Uint8Array, Uint8Array>();

  const stdinWriter = stdinWriterStream.getWriter();
  const stdoutReader = stdout
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .getReader();

  const provider: ChefProvider = {
    list: async (_signal: AbortSignal) => {
      return [{ name: "test-app", version: "1.0.0", latestVersion: "1.1.0" }];
    },
    update: async ({ name }: {
      name: string;
      version: string;
      force?: boolean;
      signal: AbortSignal;
    }) => {
      return name === "test-app";
    },
    remove: async (name: string, _signal: AbortSignal) => {
      return name === "test-app";
    },
  };

  // Run provider in "background"
  const providerPromise = runChefProvider(provider, {
    stdin,
    stdout: stdoutWriterStream,
  });

  const encoder = new TextEncoder();

  // Test List
  await stdinWriter.write(
    encoder.encode(JSON.stringify({ id: "1", command: "list" }) + "\n"),
  );
  const listResp = await stdoutReader.read();
  assertEquals(JSON.parse(listResp.value!), {
    id: "1",
    type: "list",
    data: [{ name: "test-app", version: "1.0.0", latestVersion: "1.1.0" }],
    success: true,
  });

  // Test Update
  await stdinWriter.write(
    encoder.encode(
      JSON.stringify({
        id: "2",
        command: "update",
        name: "test-app",
        version: "1.1.0",
      }) + "\n",
    ),
  );
  const updateResp = await stdoutReader.read();
  assertEquals(JSON.parse(updateResp.value!), { id: "2", success: true });

  // Test Remove
  await stdinWriter.write(
    encoder.encode(
      JSON.stringify({ id: "3", command: "remove", name: "test-app" }) + "\n",
    ),
  );
  const removeResp = await stdoutReader.read();
  assertEquals(JSON.parse(removeResp.value!), { id: "3", success: true });

  // Close stdin to stop the provider
  await stdinWriter.close();
  await providerPromise;
});

Deno.test("Chef SDK - Cancellation Test", async () => {
  const { readable: stdin, writable: stdinWriterStream } = new TransformStream<
    Uint8Array,
    Uint8Array
  >();
  const { writable: stdoutWriterStream } = new TransformStream<
    Uint8Array,
    Uint8Array
  >();

  const stdinWriter = stdinWriterStream.getWriter();

  let cancelled = false;

  const provider: ChefProvider = {
    list: async (signal: AbortSignal) => {
      return await new Promise<[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve([]);
        }, 1000);
        signal.addEventListener("abort", () => {
          cancelled = true;
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    },
    update: async () => true,
    remove: async () => true,
  };

  const providerPromise = runChefProvider(provider, {
    stdin,
    stdout: stdoutWriterStream,
  });

  const encoder = new TextEncoder();

  // Send list command
  await stdinWriter.write(
    encoder.encode(JSON.stringify({ id: "1", command: "list" }) + "\n"),
  );

  // Send cancel command immediately
  await stdinWriter.write(
    encoder.encode(
      JSON.stringify({ id: "2", command: "cancel", targetId: "1" }) + "\n",
    ),
  );

  // Close stdin
  await stdinWriter.close();
  await providerPromise;

  assertEquals(cancelled, true);
});
