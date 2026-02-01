import { env } from '../config/env.js';

const MAX_OUTPUT_CHARS = 12000;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_POLL_INTERVAL_MS = 400;
const DEFAULT_POLL_ATTEMPTS = 25;

export type Judge0Language = {
  id: number;
  name: string;
};

export type Judge0RunResult = {
  ok: boolean;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
};

type Judge0Submission = {
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  status?: { id?: number; description?: string };
  exit_code?: number | null;
  token?: string;
};

const clampOutput = (text: string) => {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n...output truncated`;
};

const normalizeBaseUrl = (value?: string) => value?.replace(/\/+$/, '');

const buildHeaders = () => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (env.JUDGE0_AUTH_HEADER && env.JUDGE0_AUTH_TOKEN) {
    headers[env.JUDGE0_AUTH_HEADER] = env.JUDGE0_AUTH_TOKEN;
  }
  if (env.JUDGE0_AUTHZ_HEADER && env.JUDGE0_AUTHZ_TOKEN) {
    headers[env.JUDGE0_AUTHZ_HEADER] = env.JUDGE0_AUTHZ_TOKEN;
  }

  return headers;
};

const judge0Fetch = async (path: string, options: RequestInit = {}) => {
  const baseUrl = normalizeBaseUrl(env.JUDGE0_BASE_URL);
  if (!baseUrl) {
    throw new Error('Judge0 is not configured.');
  }

  const timeoutMs = Number(env.JUDGE0_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...buildHeaders(),
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    return response;
  } finally {
    clearTimeout(timeout);
  }
};

const isFinishedStatus = (statusId?: number) => statusId !== 1 && statusId !== 2;

const formatJudge0Result = (data: Judge0Submission): Judge0RunResult => {
  const statusId = data.status?.id;
  const compileOutput = data.compile_output || '';
  const stdErr = data.stderr || '';
  const stdOut = data.stdout || '';
  const message = data.message || '';

  const output =
    compileOutput ||
    [stdOut, stdErr].filter(Boolean).join('\n') ||
    message ||
    'Program finished with no output.';

  return {
    ok: !compileOutput && statusId === 3 && (data.exit_code === 0 || data.exit_code === null || data.exit_code === undefined),
    output: clampOutput(output),
    exitCode: data.exit_code ?? null,
    timedOut: statusId === 5
  };
};

export const isJudge0Configured = () => Boolean(normalizeBaseUrl(env.JUDGE0_BASE_URL));

export const getJudge0Languages = async (): Promise<Judge0Language[]> => {
  const response = await judge0Fetch('/languages', { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Judge0 languages request failed (${response.status})`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data
    .filter((item) => typeof item?.id === 'number' && typeof item?.name === 'string')
    .map((item) => ({ id: item.id, name: item.name }));
};

const pollSubmission = async (token: string): Promise<Judge0Submission> => {
  const intervalMs = Number(env.JUDGE0_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS);
  const maxAttempts = Number(env.JUDGE0_POLL_ATTEMPTS || DEFAULT_POLL_ATTEMPTS);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await judge0Fetch(`/submissions/${token}?base64_encoded=false`, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Judge0 poll failed (${response.status})`);
    }
    const data = (await response.json()) as Judge0Submission;
    if (isFinishedStatus(data.status?.id)) {
      return data;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { status: { id: 5, description: 'Time Limit Exceeded' }, message: 'Judge0 polling timed out.' };
};

export const runJudge0Code = async (options: {
  sourceCode: string;
  input?: string;
  languageId: number;
}): Promise<Judge0RunResult> => {
  const response = await judge0Fetch('/submissions?wait=true&base64_encoded=false', {
    method: 'POST',
    body: JSON.stringify({
      language_id: options.languageId,
      source_code: options.sourceCode,
      stdin: options.input || ''
    })
  });

  if (!response.ok) {
    throw new Error(`Judge0 submission failed (${response.status})`);
  }

  const data = (await response.json()) as Judge0Submission;
  if (data.token && !isFinishedStatus(data.status?.id)) {
    const finalResult = await pollSubmission(data.token);
    return formatJudge0Result(finalResult);
  }

  return formatJudge0Result(data);
};

export const getDefaultLanguageId = async (): Promise<number | null> => {
  if (env.JUDGE0_DEFAULT_LANGUAGE_ID) {
    const parsed = Number(env.JUDGE0_DEFAULT_LANGUAGE_ID);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const languages = await getJudge0Languages();
  const cpp = languages.find((lang) => lang.name.toLowerCase().includes('c++'));
  return cpp?.id ?? languages[0]?.id ?? null;
};
