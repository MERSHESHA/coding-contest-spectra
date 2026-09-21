import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const code = `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        System.out.println(n * n);
        sc.close();
    }
}`;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-debug-'));
console.log('tempDir', tempDir);
const sourceFile = path.join(tempDir, 'Main.java');
fs.writeFileSync(sourceFile, code);
console.log('source written', sourceFile);

try {
  const compileResult = execFileSync('javac', ['Main.java'], { cwd: tempDir, timeout: 1000, encoding: 'utf8' });
  console.log('compile result', JSON.stringify(compileResult));
} catch (error) {
  console.log('compile error message', error.message);
  console.log('compile error stdout', JSON.stringify(error.stdout));
  console.log('compile error stderr', JSON.stringify(error.stderr));
}

try {
  const runResult = execFileSync('java', ['-cp', tempDir, 'Main'], { input: '5\n', encoding: 'utf8', timeout: 1000 });
  console.log('run result', JSON.stringify(runResult));
} catch (error) {
  console.log('run error message', error.message);
  console.log('run error stdout', JSON.stringify(error.stdout));
  console.log('run error stderr', JSON.stringify(error.stderr));
}

fs.rmSync(tempDir, { recursive: true, force: true });
