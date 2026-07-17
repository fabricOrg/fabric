import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  type ConnectionOptions,
  type Processor,
  Queue,
  Worker,
  type WorkerOptions,
} from "bullmq";

/**
 * QUEUE INFRA (ARCHITECTURE §1 stack made real — remediation finding 7). Thin ownership layer
 * over BullMQ: one Redis connection config, lazy Queue registry, Worker factory, and a clean
 * shutdown. Feature modules own their queues/workers THROUGH this service so "is the queue on?"
 * has exactly one answer:
 *
 *   - `REDIS_QUEUE_URL` set → enabled. Producers enqueue, in-process workers consume (modular
 *     monolith: same deployable, no new service).
 *   - unset → disabled. Callers MUST fall back to their inline path (the pre-queue behavior) —
 *     never enqueue into nothing. This keeps every env working before the ElastiCache infra
 *     lands and keeps local dev functional without Redis.
 *
 * BullMQ requirement honored here: maxRetriesPerRequest must be null on worker connections.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly url: string | undefined;
  /** BullMQ key prefix. Overridable (REDIS_QUEUE_PREFIX) so processes sharing one Redis — a dev
   *  stack next to an integration-test run — consume their OWN queues, never each other's. */
  private readonly prefix: string;
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.url = config.get<string>("REDIS_QUEUE_URL");
    this.prefix = config.get<string>("REDIS_QUEUE_PREFIX") ?? "bull";
    this.logger.log(
      `queue: ${this.url ? "ENABLED (redis)" : "disabled — inline fallback"}`,
    );
  }

  get enabled(): boolean {
    return this.url !== undefined && this.url.length > 0;
  }

  private connection(): ConnectionOptions {
    if (!this.url) {
      throw new Error(
        "QueueService: REDIS_QUEUE_URL is not set — check `enabled` before using the queue.",
      );
    }
    return { url: this.url, maxRetriesPerRequest: null };
  }

  /** The named queue (created on first use). Throws when the queue is disabled — check `enabled`. */
  queue(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;
    const created = new Queue(name, {
      connection: this.connection(),
      prefix: this.prefix,
    });
    this.queues.set(name, created);
    return created;
  }

  /** Register an in-process worker. Throws when disabled — only call once `enabled` is true. */
  createWorker(
    name: string,
    processor: Processor,
    opts: Omit<WorkerOptions, "connection"> = {},
  ): Worker {
    const worker = new Worker(name, processor, {
      connection: this.connection(),
      prefix: this.prefix,
      ...opts,
    });
    worker.on("failed", (job, error) => {
      this.logger.error(
        `queue ${name}: job ${job?.id ?? "?"} attempt ${job?.attemptsMade ?? "?"} failed: ${error.message}`,
      );
    });
    this.workers.push(worker);
    return worker;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
