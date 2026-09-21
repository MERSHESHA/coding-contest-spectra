import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

function normalizeOutput(raw = '') {
  return String(raw).replace(/\r\n/g, '\n').trim();
}

function toText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return String(value);
}

function compareOutputs(expected, actual) {
  const normalizedExpected = normalizeOutput(expected);
  const normalizedActual = normalizeOutput(actual);
  return normalizedExpected === normalizedActual;
}

const MAX_CONCURRENT_JOBS = Number(process.env.MAX_JUDGE_CONCURRENCY || 4);
const judgeQueue = [];
let activeJudgeJobs = 0;

export function getJudgeQueueStatus() {
  return {
    maxConcurrent: MAX_CONCURRENT_JOBS,
    activeJobs: activeJudgeJobs,
    queuedJobs: judgeQueue.length,
  };
}

export function enqueueJudging(task) {
  return new Promise((resolve, reject) => {
    judgeQueue.push({ task, resolve, reject });
    drainJudgeQueue();
  });
}

function drainJudgeQueue() {
  while (activeJudgeJobs < MAX_CONCURRENT_JOBS && judgeQueue.length > 0) {
    const job = judgeQueue.shift();
    if (!job) break;

    activeJudgeJobs += 1;
    Promise.resolve()
      .then(async () => {
        const result = await judgeSubmission(job.task);
        job.resolve(result);
      })
      .catch((error) => {
        job.reject(error);
      })
      .finally(() => {
        activeJudgeJobs -= 1;
        drainJudgeQueue();
      });
  }
}

function getPythonRuntimeCandidates() {
  if (process.platform === 'win32') {
    return [
      { command: 'py', args: ['-3', '-u'] },
      { command: 'python', args: ['-u'] },
      { command: 'python3', args: ['-u'] },
    ];
  }

  return [
    { command: 'python3', args: ['-u'] },
    { command: 'python', args: ['-u'] },
  ];
}

function formatRuntimeError(error, fallback = 'RUNTIME ERROR') {
  const details = `${error?.stdout || ''}${error?.stderr || ''}${error?.message || ''}`;
  const text = details.toLowerCase();

  if (error?.code === 'ENOENT' || text.includes('not found') || text.includes('not recognized') || text.includes('microsoft store')) {
    return 'Python is not installed or not on PATH. Install Python 3, enable “Add Python to PATH”, and restart the backend.';
  }

  return details || fallback;
}

function isDockerUnavailableError(error) {
  const details = `${error?.stdout || ''}${error?.stderr || ''}${error?.message || ''}`;
  const text = details.toLowerCase();

  return text.includes('failed to connect to the docker api')
    || text.includes('docker daemon')
    || text.includes('docker desktop')
    || text.includes('the system cannot find the file specified')
    || text.includes('not recognized as an internal or external command')
    || text.includes('is not recognized as an internal or external command')
    || text.includes('docker: not found');
}

function isDockerAvailable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'pipe', timeout: 5000, windowsHide: true });
    return true;
  } catch (error) {
    return false;
  }
}

function runLocalLanguageExecution({ language, code, testCases, problem }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-'));
  const results = [];
  const executionTimeout = Math.max(3000, Number(problem.timeLimit || 1000));

  try {
    if (language === 'Python') {
      const filePath = path.join(tempDir, 'main.py');
      fs.writeFileSync(filePath, code);
      const run = (input) => {
        const runtimes = getPythonRuntimeCandidates().map((runtime) => ({
          ...runtime,
          args: [...runtime.args, filePath],
        }));

        for (const runtime of runtimes) {
          try {
            return execFileSync(runtime.command, runtime.args, {
              input: String(input),
              encoding: 'utf8',
              timeout: executionTimeout,
            });
          } catch (error) {
            const message = formatRuntimeError(error);
            if (message.includes('Python is not installed') || error?.code === 'ENOENT') {
              continue;
            }
            return message;
          }
        }

        return 'Python is not installed or not on PATH. Install Python 3, enable “Add Python to PATH”, and restart the backend.';
      };

      testCases.forEach((testCase) => {
        const actualOutput = run(testCase.input);
        results.push({
          passed: compareOutputs(testCase.output, actualOutput),
          expected: testCase.output,
          actual: actualOutput,
        });
      });
    }

    if (language === 'C') {
      const sourceFile = path.join(tempDir, 'main.c');
      const outputFile = path.join(tempDir, 'main');
      fs.writeFileSync(sourceFile, code);
      try {
        execFileSync('gcc', ['main.c', '-O2', '-o', 'main'], { cwd: tempDir, timeout: executionTimeout });
        testCases.forEach((testCase) => {
          try {
            const actualOutput = execFileSync(outputFile, { input: String(testCase.input), encoding: 'utf8', timeout: executionTimeout });
            results.push({
              passed: compareOutputs(testCase.output, actualOutput),
              expected: testCase.output,
              actual: actualOutput,
            });
          } catch (error) {
            results.push({
              passed: false,
              expected: testCase.output,
              actual: toText(error.stdout || error.stderr || 'RUNTIME ERROR'),
            });
          }
        });
      } catch (error) {
        return {
          status: 'COMPILATION ERROR',
          passed: 0,
          total: testCases.length,
          message: toText(error.stdout || error.stderr || error.message),
        };
      }
    }

    if (language === 'Java') {
      const sourceFile = path.join(tempDir, 'Main.java');
      fs.writeFileSync(sourceFile, code);
      try {
        execFileSync('javac', ['Main.java'], { cwd: tempDir, timeout: executionTimeout });
        testCases.forEach((testCase) => {
          try {
            const actualOutput = execFileSync('java', ['-cp', tempDir, 'Main'], { input: String(testCase.input), encoding: 'utf8', timeout: executionTimeout });
            results.push({
              passed: compareOutputs(testCase.output, actualOutput),
              expected: testCase.output,
              actual: actualOutput,
            });
          } catch (error) {
            results.push({
              passed: false,
              expected: testCase.output,
              actual: toText(error.stdout || error.stderr || 'RUNTIME ERROR'),
            });
          }
        });
      } catch (error) {
        return {
          status: 'COMPILATION ERROR',
          passed: 0,
          total: testCases.length,
          message: toText(error.stdout || error.stderr || error.message),
        };
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const passedCount = results.filter((item) => item.passed).length;
  const scoreRatio = testCases.length === 0 ? 0 : passedCount / testCases.length;
  const score = Math.round(problem.marks * scoreRatio);

  return {
    status: passedCount === testCases.length ? 'ACCEPTED' : passedCount > 0 ? 'PARTIAL' : 'FAILED',
    passed: passedCount,
    total: testCases.length,
    score,
    details: results,
  };
}

export async function judgeSubmission({ code, language, testCases, problem }) {
  if (!testCases || testCases.length === 0) {
    return { status: 'ACCEPTED', passed: 0, total: 0, score: problem.marks || 0 };
  }

  const dockerAvailable = isDockerAvailable();

  if (!dockerAvailable) {
    return runLocalLanguageExecution({ language, code, testCases, problem });
  }

  const normalizedLanguage = String(language).toLowerCase();
  const compileScripts = {
    python: {
      filename: 'main.py',
      run: 'python /workspace/main.py',
    },
    c: {
      filename: 'main.c',
      run: 'gcc /workspace/main.c -O2 -o /workspace/main && /workspace/main',
    },
    java: {
      filename: 'Main.java',
      run: 'javac /workspace/Main.java && java -cp /workspace Main',
    },
  };

  const script = compileScripts[normalizedLanguage];
  if (!script) {
    return { status: 'COMPILATION ERROR', passed: 0, total: testCases.length, score: 0, message: 'Unsupported language' };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-docker-'));
  const results = [];

  try {
    fs.writeFileSync(path.join(tempDir, script.filename), code);

    for (const testCase of testCases) {
      const inputPath = path.join(tempDir, 'input.txt');
      fs.writeFileSync(inputPath, String(testCase.input));

      const dockerCommand = [
        'run',
        '--rm',
        '--network=none',
        '--cpus=1.0',
        '--memory=512m',
        '--pids-limit=64',
        '--read-only',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
        '-v', `${tempDir}:/workspace:rw`,
        'spectra-judge',
        'bash', '-lc', `cd /workspace && printf '%s' "$(cat input.txt)" | ${script.run}`,
      ];

      try {
        const output = execFileSync('docker', dockerCommand, {
          encoding: 'utf8',
          timeout: Number(problem.timeLimit || 1000) + 2000,
          stdio: 'pipe',
          windowsHide: true,
        });
        const passed = compareOutputs(testCase.output, output);
        results.push({ passed, expected: testCase.output, actual: output });
      } catch (error) {
        if (isDockerUnavailableError(error)) {
          return runLocalLanguageExecution({ language, code, testCases, problem });
        }

        const actual = (error.stdout || '') + (error.stderr || '') || 'RUNTIME ERROR';
        results.push({ passed: false, expected: testCase.output, actual });
      }
    }
  } catch (error) {
    return { status: 'COMPILATION ERROR', passed: 0, total: testCases.length, score: 0, message: String(error.message) };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const passedCount = results.filter((item) => item.passed).length;
  const scoreRatio = testCases.length === 0 ? 0 : passedCount / testCases.length;
  const score = Math.round(problem.marks * scoreRatio);

  return {
    status: passedCount === testCases.length ? 'ACCEPTED' : passedCount > 0 ? 'PARTIAL' : 'FAILED',
    passed: passedCount,
    total: testCases.length,
    score,
    details: results,
  };
}
