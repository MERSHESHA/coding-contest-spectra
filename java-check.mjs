import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync, execFileSync } from 'child_process';

console.log('PATH:', process.env.PATH);
console.log('JAVA_TOOL_OPTIONS:', process.env.JAVA_TOOL_OPTIONS || '(none)');
console.log('javac version:', execSync('javac -version', { encoding: 'utf8' }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-java-check-'));
const source = `import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        System.out.println(n * n);\n        sc.close();\n    }\n}\n`;
const sourceFile = path.join(dir, 'Main.java');
fs.writeFileSync(sourceFile, source);
console.log('sourceFile:', sourceFile);

try {
  const out = execFileSync('javac', ['Main.java'], { cwd: dir, encoding: 'utf8' });
  console.log('compile ok', out);
} catch (error) {
  console.log('compile error code:', error.code);
  console.log('compile error stdout:', JSON.stringify(error.stdout));
  console.log('compile error stderr:', JSON.stringify(error.stderr));
  console.log('compile error message:', error.message);
}

try {
  const out = execFileSync('java', ['-cp', dir, 'Main'], { input: '5\n', encoding: 'utf8', timeout: 2000 });
  console.log('run ok:', JSON.stringify(out));
} catch (error) {
  console.log('run error code:', error.code);
  console.log('run error stdout:', JSON.stringify(error.stdout));
  console.log('run error stderr:', JSON.stringify(error.stderr));
  console.log('run error message:', error.message);
}
