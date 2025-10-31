import { execSync } from 'child_process';
function executeCommand(cmd) {
    try {
        const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        return JSON.parse(output);
    }
    catch (error) {
        throw new Error(`Command failed: ${error.message}`);
    }
}
export const service = {
    // Bindings API
    async listBindings(filters) {
        const cmd = 'npx vibe-ports@latest list --json';
        const result = executeCommand(cmd);
        let items = result.items || [];
        // Apply filters
        if (filters?.project)
            items = items.filter((i) => i.project === filters.project);
        if (filters?.branch)
            items = items.filter((i) => i.branch === filters.branch);
        if (filters?.purpose)
            items = items.filter((i) => i.purpose === filters.purpose);
        if (filters?.name)
            items = items.filter((i) => i.name === filters.name);
        return items;
    },
    async deleteBinding(port) {
        const cmd = `npx vibe-ports@latest delete --port ${port} --json`;
        try {
            const result = executeCommand(cmd);
            return result.deleted || false;
        }
        catch {
            return false;
        }
    },
    async deleteBindingByKey(project, branch, purpose, name = 'default') {
        const cmd = `npx vibe-ports@latest delete -p "${project}" -b "${branch}" -u "${purpose}" -n "${name}" --json`;
        try {
            const result = executeCommand(cmd);
            return result.deleted || false;
        }
        catch {
            return false;
        }
    },
    // Templates API
    async listTemplates(template) {
        const cmd = `npx vibe-ports@latest tmpl list --json`;
        const result = executeCommand(cmd);
        let items = result.items || [];
        if (template) {
            items = items.filter((i) => i.template === template);
        }
        return items;
    },
    async deleteTemplate(template, vars) {
        const varArgs = Object.entries(vars)
            .map(([key, value]) => `--${key} "${value}"`)
            .join(' ');
        const cmd = `npx vibe-ports@latest tmpl delete --template "${template}" ${varArgs} --json`;
        try {
            executeCommand(cmd);
            return true;
        }
        catch {
            return false;
        }
    },
    // Process info
    async getProcessInfo(port) {
        try {
            // Try lsof first (most common on Linux/macOS)
            const lsofOutput = execSync(`lsof -i :${port} -n -P`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
            const lines = lsofOutput.trim().split('\n');
            if (lines.length > 1) {
                const parts = lines[1].split(/\s+/);
                const pid = parseInt(parts[1], 10);
                const cmd = parts[8];
                // Get process details from ps
                const psOutput = execSync(`ps -p ${pid} -o pid,cmd=`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
                const psLine = psOutput.trim().split('\n')[1];
                const psCommand = psLine?.split(/\s+/).slice(1).join(' ') || cmd;
                return {
                    pid,
                    command: psCommand,
                    status: 'running',
                };
            }
        }
        catch {
            // Fall back to netstat if lsof fails
            try {
                const netstatOutput = execSync(`ss -tlnp | grep :${port}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
                if (netstatOutput.includes(`${port}`)) {
                    return {
                        status: 'listening',
                    };
                }
            }
            catch {
                // Port is not listening
            }
        }
        return {
            status: 'not_listening',
        };
    },
};
