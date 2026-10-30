import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyState, type HubState } from "./state";

/**
 * The hub keeps its state in one JSON file (small: today's live orders, menu, tables).
 * Written atomically (temp file + rename), so a power cut never leaves a half-written file
 * and queued commands survive a restart.
 */
export class Store {
  state: HubState = emptyState();
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string | null) {}

  async load(): Promise<void> {
    if (!this.file) return;
    try {
      this.state = { ...emptyState(), ...(JSON.parse(await readFile(this.file, "utf8")) as Partial<HubState>) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  /** Coalesce bursts of changes into one write. */
  save(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 200);
  }

  async flush(): Promise<void> {
    if (!this.file) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const file = this.file;
    const body = JSON.stringify(this.state);
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, body);
      await rename(tmp, file);
    });
    await this.writing;
  }
}
