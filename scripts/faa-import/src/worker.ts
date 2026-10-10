import { DurableObject } from "cloudflare:workers";

// Durable Object that manages the FAA import container lifecycle.
// Persists all state to DO storage so it survives evictions.
// Auto-restarts the container if it dies unexpectedly (up to 20 retries).

export class FaaImportContainer extends DurableObject {

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
        case "/phase-done":
          return await this.handlePhaseDone(url);
        case "/phase-reset":
          return await this.handlePhaseReset(url);
        case "/phases":
          return await this.handlePhases();
        default:
          return new Response("Not found", { status: 404 });
      }
    } catch (err: any) {
      return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
  }

  private async handleStart(): Promise<Response> {
    const running = await this.ctx.storage.get("running");
    if (running) {
      // Check for zombie state — DO thinks it's running but container is dead
      try {
        const state = await this.ctx.container.getState();
        if (state === "running" || state === "starting") {
          return Response.json({ ok: false, message: "Import is already running" });
        }
        // Container is dead — force restart
        await this.ctx.storage.put("running", false);
      } catch {
        // Can't determine state — force restart
        await this.ctx.storage.put("running", false);
      }
    }

    await this.ctx.storage.put("running", true);
    await this.ctx.storage.put("restarts", 0);
    await this.ctx.storage.delete("error");
    await this.ctx.storage.put("started-at", new Date().toISOString());

    await this.startContainer();

    return Response.json({ ok: true, message: "Import started" });
  }

  private async startContainer(): Promise<void> {
    // Check for a saved snapshot to resume from
    const snapshot = await this.ctx.storage.get("container-snapshot");

    await this.ctx.container.start({
      enableInternet: true,
      ...(snapshot ? { containerSnapshot: snapshot as any } : {}),
      env: {
        WORKER_URL: "https://faa-import-worker.thomas-aed.workers.dev",
      },
    });

    // Set auto-snapshot + zombie detection alarm every 1 minute
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

    // Container has exited — check if we should restart
    const running = await this.ctx.storage.get("running");
    if (!running) {
      // Intentional stop — don't restart
      return;
    }

    const restarts = ((await this.ctx.storage.get("restarts")) as number) || 0;
    if (restarts >= 20) {
      await this.ctx.storage.put("running", false);
      await this.ctx.storage.put("completed-at", new Date().toISOString());
      await this.ctx.storage.put("error", `Container died ${restarts} times — giving up. Last: ${exitError}`);
      return;
    }

    // Try to snapshot before restart (container may already be dead)
    try {
      const snap = await this.ctx.container.snapshotContainer();
      await this.ctx.storage.put("container-snapshot", snap);
    } catch {
      // Use existing snapshot
    }

    await this.ctx.storage.put("restarts", restarts + 1);
    await this.ctx.storage.put("last-restart", new Date().toISOString());
    await this.ctx.storage.put("error", `Restart #${restarts + 1}: ${exitError}`);

    // Wait 5 seconds before restarting
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
    const phasesDone = (await this.ctx.storage.get("phases-done")) as string[] || [];

    return Response.json({
      running: !!running,
      startedAt: startedAt || null,
      completedAt: completedAt || null,
      error: error || null,
      restarts: restarts || 0,
      lastRestart: lastRestart || null,
      phasesDone,
      message: running
        ? "Import is running"
        : completedAt
          ? "Import finished"
          : "Import has not been started",
    });
  }

  private async handlePhaseDone(url: URL): Promise<Response> {
    const phase = url.searchParams.get("phase");
    if (!phase) return Response.json({ ok: false, error: "Missing ?phase=" }, { status: 400 });

    const phasesDone = (await this.ctx.storage.get("phases-done")) as string[] || [];
    if (!phasesDone.includes(phase)) {
      phasesDone.push(phase);
      await this.ctx.storage.put("phases-done", phasesDone);
    }

    // Take a snapshot right after phase completion
    try {
      const snap = await this.ctx.container.snapshotContainer();
      await this.ctx.storage.put("container-snapshot", snap);
    } catch { /* container may not support snapshot at this moment */ }

    return Response.json({ ok: true, phasesDone });
  }

  private async handlePhases(): Promise<Response> {
    const phasesDone = (await this.ctx.storage.get("phases-done")) as string[] || [];
    return Response.json({ phasesDone });
  }

  private async handlePhaseReset(url: URL): Promise<Response> {
    const phase = url.searchParams.get("phase");
    if (!phase) return Response.json({ ok: false, error: "Missing ?phase=" }, { status: 400 });

    let phasesDone = (await this.ctx.storage.get("phases-done")) as string[] || [];
    phasesDone = phasesDone.filter((p: string) => p !== phase);
    await this.ctx.storage.put("phases-done", phasesDone);

    return Response.json({ ok: true, phasesDone });
  }

  private async handleStop(): Promise<Response> {
    const running = await this.ctx.storage.get("running");
    if (!running) {
      return Response.json({ ok: false, message: "Import is not running" });
    }

    // Mark as stopped BEFORE stopping container so monitor doesn't auto-restart
    await this.ctx.storage.put("running", false);

    try {
      const snapshot = await this.ctx.container.snapshotContainer();
      await this.ctx.storage.put("container-snapshot", snapshot);
    } catch {
      // Container may have already exited
    }

    this.ctx.container.stop();
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

  // Alarm: auto-snapshot + zombie detection every 5 minutes
  async alarm(): Promise<void> {
    const running = await this.ctx.storage.get("running");
    if (!running) return;

    // Check for zombie state: DO thinks running but container is dead
    try {
      const state = await this.ctx.container.getState();
      if (state !== "running" && state !== "starting") {
        // Container is dead — trigger restart
        const restarts = ((await this.ctx.storage.get("restarts")) as number) || 0;
        if (restarts >= 20) {
          await this.ctx.storage.put("running", false);
          await this.ctx.storage.put("completed-at", new Date().toISOString());
          await this.ctx.storage.put("error", `Zombie detected: container ${state} after ${restarts} restarts — giving up`);
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
    } catch { /* can't check state — try snapshot anyway */ }

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
    const id = env.FAA_IMPORT.idFromName("faa-import-v3");
    const stub = env.FAA_IMPORT.get(id);
    return stub.fetch(request);
  },
};
