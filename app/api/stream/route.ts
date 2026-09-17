import { Client } from "pg";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supabase Realtime 대체.
 *
 * PostgreSQL 의 LISTEN/NOTIFY 를 구독하는 전용 커넥션을 열고,
 * 수신한 변경 사항을 Server-Sent Events 로 브라우저에 밀어줍니다.
 * device_readings 트리거가 NOTIFY 를 발생시킵니다(db/schema.sql 참고).
 *
 * nginx 뒤에서는 반드시 버퍼링이 꺼져 있어야 실시간으로 전달됩니다.
 * 응답의 X-Accel-Buffering: no 헤더가 그 역할을 합니다.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
  });

  const encoder = new TextEncoder();
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const send = (event: string, data: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        try {
          await client.end();
        } catch {
          /* 이미 닫힌 커넥션 */
        }
        try {
          controller.close();
        } catch {
          /* 이미 닫힌 스트림 */
        }
      };

      request.signal.addEventListener("abort", cleanup);

      try {
        await client.connect();

        client.on("notification", (message) => {
          if (!message.payload) return;
          try {
            send(message.channel, JSON.parse(message.payload));
          } catch {
            /* 형식이 깨진 payload 는 무시 */
          }
        });

        client.on("error", () => {
          void cleanup();
        });

        await client.query("LISTEN device_reading");
        await client.query("LISTEN alarm_event");

        send("ready", { at: new Date().toISOString() });

        // 프록시가 유휴 연결을 끊지 않도록 주기적으로 주석 줄을 보냅니다.
        keepAlive = setInterval(() => write(": keep-alive\n\n"), 25_000);
      } catch (err) {
        send("error", { message: (err as Error).message });
        await cleanup();
      }
    },

    async cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      try {
        await client.end();
      } catch {
        /* noop */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
