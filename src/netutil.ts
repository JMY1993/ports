import net from 'net';
import os from 'os';
import { exec } from 'child_process';

function execCmd(cmd: string, timeoutMs = 1200): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = exec(cmd, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        resolve({ code: (error as any).code ?? 1, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
      } else {
        resolve({ code: 0, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
      }
    });
  });
}

export async function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return await new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => {
      resolve(false);
    });
    srv.listen({ port, host, exclusive: true }, () => {
      srv.close(() => resolve(true));
    });
  });
}

export async function findPidsByPort(port: number): Promise<number[]> {
  const pids = new Set<number>();
  if (os.platform() === 'win32') {
    const { code, stdout } = await execCmd(`netstat -ano | findstr :${port}`);
    if (code === 0) {
      stdout.split(/\r?\n/).forEach((line) => {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!Number.isNaN(pid)) pids.add(pid);
      });
    }
  } else {
    // Try lsof
    const lsof = await execCmd(`lsof -t -iTCP:${port} -sTCP:LISTEN`);
    if (lsof.code === 0) {
      lsof.stdout.split(/\r?\n/).forEach((s) => {
        const pid = parseInt(s.trim(), 10);
        if (!Number.isNaN(pid)) pids.add(pid);
      });
    }
    // Try fuser
    if (pids.size === 0) {
      const fuser = await execCmd(`fuser -n tcp ${port} 2>/dev/null`);
      if (fuser.code === 0) {
        fuser.stdout.replace(/\D+/g, ' ').trim().split(/\s+/).forEach((s) => {
          const pid = parseInt(s, 10);
          if (!Number.isNaN(pid)) pids.add(pid);
        });
      }
    }
    // Try ss
    if (pids.size === 0) {
      const ss = await execCmd(`ss -lntp | grep ":${port} "`);
      if (ss.code === 0) {
        const m = ss.stdout.match(/pid=(\d+)/);
        if (m) {
          const pid = parseInt(m[1], 10);
          if (!Number.isNaN(pid)) pids.add(pid);
        }
      }
    }
  }
  return Array.from(pids);
}

export async function killPortOccupants(port: number, opts?: { waitMs?: number }): Promise<{ killed: number[] }> {
  const waitMs = opts?.waitMs ?? 2000;
  let pids = await findPidsByPort(port);
  const killed: number[] = [];
  if (pids.length === 0) return { killed };
  // Try graceful
  if (os.platform() === 'win32') {
    for (const pid of pids) {
      await execCmd(`taskkill /PID ${pid} /T /F`, 2000);
      killed.push(pid);
    }
  } else {
    await execCmd(`kill -TERM ${pids.join(' ')}`, 2000);
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      if (await isPortFree(port)) break;
      await new Promise((r) => setTimeout(r, 120));
    }
    if (!(await isPortFree(port))) {
      await execCmd(`kill -KILL ${pids.join(' ')}`, 2000);
    }
    killed.push(...pids);
  }
  // Final check
  const free = await isPortFree(port);
  if (!free) {
    throw new Error(`Failed to free port ${port}`);
  }
  return { killed };
}

