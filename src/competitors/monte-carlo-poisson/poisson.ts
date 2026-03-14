export function poissonPmf(lambda: number, k: number): number {
  if (lambda === 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) {
    logP -= Math.log(i);
  }
  return Math.exp(logP);
}

export function poissonCdf(lambda: number, k: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += poissonPmf(lambda, i);
  }
  return sum;
}

export function buildScoreMatrix(lambdaHome: number, lambdaAway: number, maxGoals = 8): number[][] {
  const matrix: number[][] = [];
  for (let i = 0; i <= maxGoals; i++) {
    const row: number[] = [];
    for (let j = 0; j <= maxGoals; j++) {
      row.push(poissonPmf(lambdaHome, i) * poissonPmf(lambdaAway, j));
    }
    matrix.push(row);
  }
  return matrix;
}

export function outcomeProbabilities(matrix: number[][]): {
  home: number;
  draw: number;
  away: number;
} {
  let home = 0;
  let draw = 0;
  let away = 0;
  const size = matrix.length;

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const p = matrix[i]?.[j] ?? 0;
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
    }
  }

  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

export function dixonColesAdjustment(
  homeGoals: number,
  awayGoals: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
): number {
  if (homeGoals === 0 && awayGoals === 0) {
    return 1 - lambdaHome * lambdaAway * rho;
  }
  if (homeGoals === 0 && awayGoals === 1) {
    return 1 + lambdaHome * rho;
  }
  if (homeGoals === 1 && awayGoals === 0) {
    return 1 + lambdaAway * rho;
  }
  if (homeGoals === 1 && awayGoals === 1) {
    return 1 - rho;
  }
  return 1;
}
