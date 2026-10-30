import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ambiente mínimo de navegador para a fila e a sessão.
const storage = new Map<string, string>();
const win = Object.assign(new EventTarget(), {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => clearTimeout(id),
});
vi.stubGlobal("window", win);
vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
vi.stubGlobal("localStorage", {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
});

type Handler = (url: string, body: any) => { status: number; body?: unknown } | "offline";
let handler: Handler;
const calls: { url: string; body: any; keepalive?: boolean }[] = [];
vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
  const body = init.body ? JSON.parse(init.body as string) : null;
  calls.push({ url, body, keepalive: init.keepalive });
  const result = handler(url, body);
  if (result === "offline") throw new TypeError("Failed to fetch");
  return new Response(JSON.stringify(result.body ?? {}), { status: result.status });
});

const { StudyRecorder } = await import("./recorder");
const queue = await import("./queue");

const accepted = (body: any) => ({
  status: 200,
  body: {
    session: {},
    results: body.segments.map((s: any) => ({ seq: s.seq, status: "accepted", credited_seconds: 1, reason: null, duplicate: false })),
  },
});

let mono = 0;
let stop: () => void;

beforeEach(() => {
  storage.clear();
  calls.length = 0;
  mono = 1000;
  handler = (url, body) => (url.endsWith("/segments") ? accepted(body) : { status: 200, body: {} });
  stop = queue.startStudySync("ana");
});

afterEach(() => stop());

const settle = () => new Promise((r) => setTimeout(r, 0));
const segmentCalls = () => calls.filter((c) => c.url.endsWith("/segments"));

describe("StudyRecorder", () => {
  it("abre a sessão no servidor e envia tempos relativos à abertura", async () => {
    const recorder = new StudyRecorder({ userId: "ana", courseId: "c", lessonKey: "A001" }, () => mono);
    recorder.ensureOpen();
    mono = 1200; // a resposta chega 200 ms depois
    await settle();
    // Trecho que começou antes da resposta: cortado na origem.
    recorder.add({ startMono: 1100, endMono: 6200, mediaFrom: 10, mediaTo: 15.1, rate: 1 });
    recorder.add({ startMono: 6200, endMono: 9200, mediaFrom: 15.1, mediaTo: 18.1, rate: 1 });
    await queue.flush();
    const open = calls.find((c) => c.url === "/api/study/sessions")!;
    expect(open.body).toMatchObject({ source: "video", course_id: "c", lesson_key: "A001" });
    expect(open.body.id).toMatch(/^[0-9a-f-]{36}$/);
    const sent = segmentCalls()[0].body.segments;
    expect(sent).toEqual([
      { seq: 0, start_ms: 0, end_ms: 5000, media_from: 10.1, media_to: 15.1, rate: 1 },
      { seq: 1, start_ms: 5000, end_ms: 8000, media_from: 15.1, media_to: 18.1, rate: 1 },
    ]);
    expect(queue.pendingCount("ana")).toBe(0);
  });

  it("sem abertura confirmada, nada é enviado", async () => {
    handler = () => ({ status: 404, body: { code: "lesson_not_trackable" } });
    const recorder = new StudyRecorder({ userId: "ana", courseId: "c", lessonKey: "X" }, () => mono);
    recorder.add({ startMono: 1000, endMono: 5000, mediaFrom: 0, mediaTo: 4, rate: 1 });
    await settle();
    recorder.add({ startMono: 5000, endMono: 9000, mediaFrom: 4, mediaTo: 8, rate: 1 });
    expect(queue.pendingCount("ana")).toBe(0);
    expect(segmentCalls()).toHaveLength(0);
  });
});

describe("fila de envio", () => {
  const seg = (seq: number) => ({ seq, start_ms: seq * 1000, end_ms: seq * 1000 + 1000, media_from: seq, media_to: seq + 1, rate: 1 });

  it("guarda o que não foi enviado e reenvia depois (queda de conexão, recarregar a página)", async () => {
    handler = () => "offline";
    queue.enqueue("ana", "s1", seg(0));
    queue.enqueue("ana", "s1", seg(1));
    queue.enqueue("ana", "s1", seg(1)); // repetido
    await queue.flush();
    expect(queue.pendingCount("ana")).toBe(2);
    expect(JSON.parse(storage.get("teleaula:study-queue:v1")!).s1.segments).toHaveLength(2);

    handler = (_url, body) => accepted(body);
    stop();
    stop = queue.startStudySync("ana"); // nova visita
    await settle();
    await queue.flush();
    expect(queue.pendingCount("ana")).toBe(0);
    // Os dois envios carregam os mesmos números de sequência: o servidor ignora a repetição.
    expect(segmentCalls().map((c) => c.body.segments.map((s: any) => s.seq))).toContainEqual([0, 1]);
  });

  it("recusa definitiva do servidor tira da fila; erro passageiro mantém", async () => {
    queue.enqueue("ana", "s-ok", seg(0));
    queue.enqueue("ana", "s-gone", seg(0));
    queue.enqueue("ana", "s-busy", seg(0));
    handler = (url, body) => {
      if (url.includes("s-gone")) return { status: 404, body: { code: "study_session_not_found" } };
      if (url.includes("s-busy")) return { status: 503 };
      return accepted(body);
    };
    await queue.flush();
    const left = JSON.parse(storage.get("teleaula:study-queue:v1")!);
    expect(Object.keys(left)).toEqual(["s-busy"]);
  });

  it("só envia registros do usuário logado", async () => {
    queue.enqueue("bia", "s-bia", seg(0));
    queue.enqueue("ana", "s-ana", seg(0));
    await queue.flush();
    expect(segmentCalls().map((c) => c.url)).toEqual(["/api/study/sessions/s-ana/segments"]);
    expect(queue.pendingCount("bia")).toBe(1);
  });

  it("envio com keepalive ao fechar a página", async () => {
    queue.enqueue("ana", "s1", seg(0));
    await queue.flush({ keepalive: true });
    expect(segmentCalls()[0].keepalive).toBe(true);
  });
});
