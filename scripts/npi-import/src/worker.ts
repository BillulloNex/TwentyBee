import { DurableObject } from "cloudflare:workers";

// Durable Object that manages the NPI import container lifecycle.
// Persists state to DO storage so it survives evictions.
// Auto-restarts the container if it dies unexpectedly (up to 20 retries).
// Runs quality + people in parallel inside the container.

export class NpiImportContainer extends DurableObject {

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case "/start":
          return await this.handleStart();
        case "/status":
          return await this.handleStatus();
        case "/stop":
          return await this.handleStop();
        case "/snapshot":
          return await this.handleSnapshot();
        case "/logs":
          return await this.handleLogs();
        case "/errors":
          return await this.handleErrors();
        case "/heartbeat":
          return await this.handleHeartbeat();
        default:
          return new Response("Not found. Endpoints: /start, /status, /stop, /snapshot, /logs, /errors, /heartbeat", { status: 404 });
      }
    } catch (err: any) {
      return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
  }

  private async handleStart(): Promise<Response> {
    const running = await this.ctx.storage.get("running");
    if (running) {
      try {
        const state = await this.ctx.container.getState();
        if (state === "running" || state === "starting") {
          return Response.json({ ok: false, message: "Import is already running" });
        }
        await this.ctx.storage.put("running", false);
      } catch {
        await this.ctx.storage.put("running", false);
      }
    }

    await this.ctx.storage.put("running", true);
    await this.ctx.storage.put("restarts", 0);
    await this.ctx.storage.delete("error");
    await this.ctx.storage.put("started-at", new Date().toISOString());

    await this.startContainer();

    return Response.json({ ok: true, message: "NPI import started — parallel workers (quality + people→enrich→affiliations)" });
  }

  private async startContainer(): Promise<void> {
    const snapshot = await this.ctx.storage.get("container-snapshot");

    await this.ctx.container.start({
      enableInternet: true,
      ...(snapshot ? { containerSnapshot: snapshot as any } : {}),
      env: {
        WORKER_URL: "https://npi-import-worker.thomas-aed.workers.dev",
      },
    });

    // Set zombie detection alarm every 1 minute
    await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);

    // Monitor in background — auto-restarts on unexpected exit
    this.monitorAndRestart().catch(() => {});
  }

  private async monitorAndRestart(): Promise<void> {
    let exitError: string | null = null;
    try {
      await this.ctx.container.monitor();
      exitError = "Container exited normally";
    } catch (err: any) {
      exitError = err.message || "Unknown container error";
    }

    const running = await this.ctx.storage.get("running");
    if (!running) return;

    const restarts = ((await this.ctx.storage.get("restarts")) as number) || 0;
    if (restarts >= 20) {
      await this.ctx.storage.put("running", false);
      await this.ctx.storage.put("completed-at", new Date().toISOString());
      await this.ctx.storage.put("error", `Container died ${restarts} times — giving up. Last: ${exitError}`);
      return;
    }

    // Try to snapshot before restart
    try {
      const snap = await this.ctx.container.snapshotContainer();
      await this.ctx.storage.put("container-snapshot", snap);
    } catch { /* Use existing snapshot */ }

    await this.ctx.storage.put("restarts", restarts + 1);
    await this.ctx.storage.put("last-restart", new Date().toISOString());
    await this.ctx.storage.put("error", `Restart #${restarts + 1}: ${exitError}`);

    await new Promise(r => setTimeout(r, 5000));

    try {
      await this.startContainer();
    } catch (startErr: any) {
      await this.ctx.storage.put("running", false);
      await this.ctx.storage.put("completed-at", new Date().toISOString());
      await this.ctx.storage.put("error", `Failed to restart: ${startErr.message}`);
    }
  }

  private async handleStatus(): Promise<Response> {
    const running = await this.ctx.storage.get("running");
    const startedAt = await this.ctx.storage.get("started-at");
    const completedAt = await this.ctx.storage.get("completed-at");
    const error = await this.ctx.storage.get("error");
    const restarts = await this.ctx.storage.get("restarts");
    const lastRestart = await this.ctx.storage.get("last-restart");

    let containerState = "unknown";
    try {
      containerState = await this.ctx.container.getState();
    } catch { /* container may not be started */ }

    return Response.json({
      running: !!running,
      containerState,
      startedAt: startedAt || null,
      completedAt: completedAt || null,
      error: error || null,
      restarts: restarts || 0,
      lastRestart: lastRestart || null,
      message: running
        ? `Import is running (container: ${containerState})`
        : completedAt
          ? "Import finished"
          : "Import has not been started",
    });
  }

  private async handleLogs(): Promise<Response> {
    try {
      const logs = await this.ctx.container.getTailEntries();
      return Response.json({ ok: true, logs });
    } catch (err: any) {
      return Response.json({ ok: false, error: err.message });
    }
  }

  private async handleErrors(): Promise<Response> {
    try {
      const exec = await this.ctx.container.exec(["cat", "/app/state/error.log"]);
      const output = await new Response(exec.stdout).text();
      return Response.json({ ok: true, errors: output || "(no errors)" });
    } catch (err: any) {
      // Fallback: return stored error from DO
      const lastError = await this.ctx.storage.get("error");
      return Response.json({ ok: false, doError: lastError || null, execError: err.message });
    }
  }

  private async handleHeartbeat(): Promise<Response> {
    try {
      const exec = await this.ctx.container.exec(["cat", "/app/state/heartbeat.json"]);
      const output = await new Response(exec.stdout).text();
      return Response.json({ ok: true, heartbeat: JSON.parse(output) });
    } catch (err: any) {
      return Response.json({ ok: false, error: err.message });
    }
  }

  private async handleStop(): Promise<Response> {
    const running = await this.ctx.storage.get("running");
    if (!running) {
      return Response.json({ ok: false, message: "Import is not running" });
    }

    await this.ctx.storage.put("running", false);

    try {
      const snapshot = await this.ctx.container.snapshotContainer();
      await this.ctx.storage.put("container-snapshot", snapshot);
    } catch { /* Container may have already exited */ }

    try { this.ctx.container.stop(); } catch { /* may not exist */ }
    try { await this.ctx.container.destroy(); } catch { /* may not exist */ }
    await this.ctx.storage.put("completed-at", new Date().toISOString());

    return Response.json({ ok: true, message: "Stopped. Snapshot saved. POST /start to resume." });
  }

  private async handleSnapshot(): Promise<Response> {
    try {
      const snapshot = await this.ctx.container.snapshotContainer();
      await this.ctx.storage.put("container-snapshot", snapshot);
      return Response.json({ ok: true, message: "Snapshot saved" });
    } catch (err: any) {
      return Response.json({ ok: false, error: err.message });
    }
  }

  // Alarm: zombie detection + auto-snapshot every 1 minute
  async alarm(): Promise<void> {
    const running = await this.ctx.storage.get("running");
    if (!running) return;

    try {
      const state = await this.ctx.container.getState();
      if (state !== "running" && state !== "starting") {
        const restarts = ((await this.ctx.storage.get("restarts")) as number) || 0;
        if (restarts >= 20) {
          await this.ctx.storage.put("running", false);
          await this.ctx.storage.put("completed-at", new Date().toISOString());
          await this.ctx.storage.put("error", `Zombie detected: container ${state} after ${restarts} restarts`);
          return;
        }
        await this.ctx.storage.put("restarts", restarts + 1);
        await this.ctx.storage.put("last-restart", new Date().toISOString());
        await this.ctx.storage.put("error", `Zombie restart #${restarts + 1}: container was ${state}`);
        try {
          await this.startContainer();
        } catch (err: any) {
          await this.ctx.storage.put("running", false);
          await this.ctx.storage.put("error", `Zombie restart failed: ${err.message}`);
        }
        return;
      }
    } catch { /* can't check state */ }

    // Auto-snapshot
    try {
      const snapshot = await this.ctx.container.snapshotContainer();
      await this.ctx.storage.put("container-snapshot", snapshot);
    } catch { /* container might be between restarts */ }

    await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
  }
}

// Worker entry point
export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const id = env.NPI_IMPORT.idFromName("npi-import-v1");
    const stub = env.NPI_IMPORT.get(id);
    return stub.fetch(request);
  },
};
