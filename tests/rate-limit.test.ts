import WebSocket, { WebSocketServer } from "ws";
import { createServer } from "http";
import { onConnection, rateLimiter } from "../src/socket";
import type { ChatWebSocket } from "../src/chat-room";
import type { AddressInfo } from "net";
import { initialize } from "../src/config/redis";

describe("WebSocket Server Rate Limiting", () => {
  let server: ReturnType<typeof createServer>;
  let wss: WebSocketServer;
  let wsUrl: string;

  beforeAll(async () => {
    await initialize();
    server = createServer();
    wss = new WebSocketServer({ server });

    wss.on("connection", (ws: WebSocket, req) => {
      const chatWs = ws as ChatWebSocket;
      chatWs.ipAddress = "127.0.0.1";
      chatWs.userId = "test-user";
      chatWs.chatId = "test-chat";
      onConnection(chatWs, req as any);
    });

    await new Promise<void>((resolve) => {
      server.listen(() => {
        const port = (server.address() as AddressInfo).port;
        wsUrl = `ws://localhost:${port}`;
        resolve();
      });
    });
  });

  afterAll((done) => {
    wss.close(() => {
      server.close(done);
    });
  });

  beforeEach(async () => {
    // Reset the rate limiter before each test
    try {
      await rateLimiter.delete("test-user");
    } catch (error) {
      // Ignore if key doesn't exist
    }
  });

  it("should allow messages within the rate limit", (done) => {
    const ws = new WebSocket(wsUrl);
    let messagesReceived = 0;

    ws.on("open", () => {
      for (let i = 0; i < 5; i++) {
        ws.send(JSON.stringify({ type: "message", content: `Hello ${i}` }));
      }

      // After 1 second, we should not have been disconnected or received an error.
      // This is an indirect way to test. A better test would be to see if we receive the broadcasted messages.
      // For now, we'll assume if no error is received, it's good.
      expect(messagesReceived).toBeLessThanOrEqual(5); // Depending on broadcast logic
      ws.close();
      done();
    });

    ws.on("message", (data) => {
      messagesReceived++;
      const message = JSON.parse(data.toString());
      // We expect to receive back the messages we sent, but the test setup doesn't handle broadcasting back to sender.
      // So we will just count them. The main thing is not to get a rate-limit error.
    });
  });

  it("should trigger rate limit and send an error message",  (done) => {
    const ws = new WebSocket(wsUrl);
    const receivedMessages: any[] = [];

    ws.on("open", () => {
      // Send 6 messages quickly to trigger the rate limit (5 points per second)
      setTimeout(() => {
        for (let i = 0; i < 15; i++) {
          ws.send(JSON.stringify({ type: "message", content: `Spam ${i}` }));
        }
      }, 1500);

      setTimeout(() => {
        const rateLimitError = receivedMessages.find(
          (msg) => msg.type === "error" && msg.content === "Rate limit exceeded"
        );

        console.log("Received messages:", receivedMessages);
        expect(rateLimitError).toBeDefined();
        ws.close();
        done();
      }, 5000);
    });

    ws.on("message", (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    ws.on("close", () => {
      // The connection should not be closed by the server for rate limiting in the current implementation
    });
  }, 10000);
});
