import { judgeSubmission } from './backend/src/services/judgeService.js';

const code = `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        System.out.println(n * n);
        sc.close();
    }
}`;

const result = await judgeSubmission({
  code,
  language: 'Java',
  testCases: [{ input: '5', output: '25' }],
  problem: { marks: 20, timeLimit: 1000, memoryLimit: 256 },
});

console.log(JSON.stringify(result, null, 2));
