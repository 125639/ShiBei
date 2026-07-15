import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchQueueKindForSourceUrl,
  reconcileWorkerQueues,
  recoveryJobId,
  type QueueRecoveryStore
} from "../src/lib/queue-recovery";

type DbFetch = { id: string; status: "QUEUED" | "RUNNING"; sourceUrl: string; updatedAt: Date };
type DbVideo = { id: string; downloadStatus: string | null; updatedAt: Date };

class FakeJob {
  constructor(
    public id: string,
    public data: Record<string, string>,
    public state: string,
    private owner: FakeQueue
  ) {}
  async getState() { return this.state; }
  async remove() { this.owner.jobs.delete(this.id); }
}

class FakeQueue {
  jobs = new Map<string, FakeJob>();
  additions: Array<{ name: string; data: Record<string, string>; opts: Record<string, unknown> }> = [];
  failAdds = false;

  put(id: string, data: Record<string, string>, state = "waiting") {
    this.jobs.set(id, new FakeJob(id, data, state, this));
  }
  async getJobs(types: string[]) {
    return [...this.jobs.values()].filter((job) => types.includes(job.state));
  }
  async getJob(id: string) { return this.jobs.get(id); }
  async add(name: string, data: Record<string, string>, opts: Record<string, unknown>) {
    if (this.failAdds) throw new Error("redis unavailable");
    this.additions.push({ name, data, opts });
    const id = String(opts.jobId);
    if (!this.jobs.has(id)) this.put(id, data, "waiting");
    return this.jobs.get(id);
  }
}

function fakeStore(fetchJobs: DbFetch[], videos: DbVideo[]) {
  const store: QueueRecoveryStore = {
    fetchJob: {
      async findMany() { return fetchJobs; },
      async updateMany(raw) {
        const args = raw as { where: Record<string, unknown>; data: Record<string, unknown> };
        const row = fetchJobs.find((item) => item.id === args.where.id);
        if (!row || (args.where.status && row.status !== args.where.status)) return { count: 0 };
        if (args.where.updatedAt && row.updatedAt.getTime() !== (args.where.updatedAt as Date).getTime()) return { count: 0 };
        Object.assign(row, args.data, { updatedAt: new Date(row.updatedAt.getTime() + 1) });
        return { count: 1 };
      }
    },
    video: {
      async findMany() { return videos; },
      async updateMany(raw) {
        const args = raw as { where: Record<string, unknown>; data: Record<string, unknown> };
        const row = videos.find((item) => item.id === args.where.id);
        if (!row || (args.where.downloadStatus && row.downloadStatus !== args.where.downloadStatus)) return { count: 0 };
        if (args.where.updatedAt && row.updatedAt.getTime() !== (args.where.updatedAt as Date).getTime()) return { count: 0 };
        Object.assign(row, args.data, { updatedAt: new Date(row.updatedAt.getTime() + 1) });
        return { count: 1 };
      }
    }
  };
  return store;
}

function queues() {
  return { fetch: new FakeQueue(), research: new FakeQueue(), audience: new FakeQueue(), video: new FakeQueue() };
}

test("queue recovery routing mirrors worker producers", () => {
  assert.equal(fetchQueueKindForSourceUrl("https://example.com"), "fetch");
  assert.equal(fetchQueueKindForSourceUrl("keyword://research?q=x"), "research");
  assert.equal(fetchQueueKindForSourceUrl("digest://topic?id=x"), "research");
  assert.equal(fetchQueueKindForSourceUrl("post-repair://publish?postId=x"), "research");
  assert.equal(fetchQueueKindForSourceUrl("audience://estimate?sourceId=x"), "audience");
  assert.equal(recoveryJobId("abc:def"), "db-recovery-abc-def");
});

test("live Redis deliveries are left untouched", async () => {
  const now = new Date();
  const db = [{ id: "live", status: "RUNNING" as const, sourceUrl: "https://example.com", updatedAt: now }];
  const q = queues();
  q.fetch.put("existing", { fetchJobId: "live" }, "active");
  const result = await reconcileWorkerQueues({
    store: fakeStore(db, []),
    queues: q as never,
    logger: { info() {}, warn() {}, error() {} }
  });
  assert.equal(result.fetchJobsRequeued, 0);
  assert.equal(result.runningFetchJobsReset, 0);
  assert.equal(db[0].status, "RUNNING");
});

test("orphaned queued/running DB work and downloads are restored", async () => {
  const now = new Date();
  const db: DbFetch[] = [
    { id: "web", status: "QUEUED", sourceUrl: "https://example.com", updatedAt: now },
    { id: "research", status: "RUNNING", sourceUrl: "keyword://research?q=x", updatedAt: now },
    { id: "repair", status: "QUEUED", sourceUrl: "post-repair://publish?postId=p", updatedAt: now },
    { id: "aud", status: "QUEUED", sourceUrl: "audience://estimate?sourceId=s", updatedAt: now }
  ];
  const videos: DbVideo[] = [{ id: "vid", downloadStatus: "running", updatedAt: now }];
  const q = queues();
  const result = await reconcileWorkerQueues({
    store: fakeStore(db, videos),
    queues: q as never,
    logger: { info() {}, warn() {}, error() {} }
  });

  assert.deepEqual(result, {
    fetchJobsInspected: 4,
    fetchJobsRequeued: 4,
    runningFetchJobsReset: 1,
    videosInspected: 1,
    videosRequeued: 1,
    runningVideosReset: 1
  });
  assert.equal(db[1].status, "QUEUED");
  assert.equal(videos[0].downloadStatus, "queued");
  assert.equal(q.fetch.additions.length, 1);
  assert.equal(q.research.additions.length, 2);
  assert.equal(q.audience.additions.length, 1);
  assert.equal(q.video.additions.length, 1);
  assert.equal(q.research.additions.find((item) => item.data.fetchJobId === "repair")?.opts.attempts, 1);
});

test("terminal recovery job is removed and an enqueue failure remains retryable", async () => {
  const now = new Date();
  const db: DbFetch[] = [{ id: "retry", status: "QUEUED", sourceUrl: "https://example.com", updatedAt: now }];
  const q = queues();
  q.fetch.put(recoveryJobId("retry"), { fetchJobId: "retry" }, "completed");
  q.fetch.failAdds = true;
  const warnings: string[] = [];
  const result = await reconcileWorkerQueues({
    store: fakeStore(db, []),
    queues: q as never,
    logger: { info() {}, warn(message) { warnings.push(String(message)); }, error() {} }
  });
  assert.equal(result.fetchJobsRequeued, 0);
  assert.equal(db[0].status, "QUEUED");
  assert.equal(warnings.length, 1);
  assert.equal(q.fetch.jobs.has(recoveryJobId("retry")), false);
});
