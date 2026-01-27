import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

const MAX_OUTPUT_CHARS = 12000;
const COMPILE_TIMEOUT_MS = 5000;
const RUN_TIMEOUT_MS = 2000;

type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

type RunResult = {
  ok: boolean;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
};

const clampOutput = (text: string) => {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n...output truncated`;
};

const runProcess = (command: string, args: string[], options: {
  cwd: string;
  input?: string;
  timeoutMs: number;
}) => new Promise<ProcessResult>((resolve) => {
  const child = spawn(command, args, { cwd: options.cwd, stdio: 'pipe' });
  let stdout = '';
  let stderr = '';
  let finished = false;

  const timeout = setTimeout(() => {
    if (!finished) {
      finished = true;
      child.kill('SIGKILL');
      resolve({ stdout, stderr, exitCode: null, timedOut: true });
    }
  }, options.timeoutMs);

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    if (stdout.length > MAX_OUTPUT_CHARS * 2) {
      stdout = stdout.slice(0, MAX_OUTPUT_CHARS * 2);
    }
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > MAX_OUTPUT_CHARS * 2) {
      stderr = stderr.slice(0, MAX_OUTPUT_CHARS * 2);
    }
  });

  child.on('close', (code) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    resolve({ stdout, stderr, exitCode: code, timedOut: false });
  });

  if (options.input) {
    child.stdin.write(options.input);
  }
  child.stdin.end();
});

export const runCppCode = async (sourceCode: string, input: string): Promise<RunResult> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assessly-run-'));
  const sourcePath = path.join(tempDir, 'main.cpp');
  const exeName = process.platform === 'win32' ? 'program.exe' : 'program';
  const exePath = path.join(tempDir, exeName);

  try {
    await fs.writeFile(sourcePath, sourceCode, 'utf8');

    const compile = await runProcess(
      'g++',
      ['-std=c++17', sourcePath, '-O2', '-o', exePath],
      { cwd: tempDir, timeoutMs: COMPILE_TIMEOUT_MS }
    );

    if (compile.timedOut) {
      return {
        ok: false,
        output: 'Compilation timed out.',
        exitCode: null,
        timedOut: true
      };
    }

    if (compile.exitCode !== 0) {
      const output = compile.stderr || compile.stdout || 'Compilation failed.';
      return {
        ok: false,
        output: clampOutput(output),
        exitCode: compile.exitCode,
        timedOut: false
      };
    }

    const run = await runProcess(
      exePath,
      [],
      { cwd: tempDir, timeoutMs: RUN_TIMEOUT_MS, input }
    );

    if (run.timedOut) {
      return {
        ok: false,
        output: 'Execution timed out.',
        exitCode: null,
        timedOut: true
      };
    }

    const combined = [run.stdout, run.stderr].filter(Boolean).join('\n');
    return {
      ok: run.exitCode === 0,
      output: clampOutput(combined || 'Program finished with no output.'),
      exitCode: run.exitCode,
      timedOut: false
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};
