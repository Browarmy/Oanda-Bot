export interface AthenaConfidenceInput {

  pairScore?: number;

  strategyScore?: number;

  regimeScore?: number;

  memoryScore?: number;

  confidenceCalibration?: number;

  trendScore?: number;

  volatilityScore?: number;

  spreadScore?: number;

  portfolioScore?: number;

  riskScore?: number;

  executionScore?: number;

}

export interface AthenaConfidenceResult {

  score:number;

  confidence:number;

  grade:string;

  approved:boolean;

  expectedEdgeR:number;

  reasons:string[];

}

function clamp(v:number,min:number,max:number){

    return Math.max(min,Math.min(max,v));

}

export function evaluateAthenaConfidence(

    input:AthenaConfidenceInput

):AthenaConfidenceResult{

    const weights={

        pair:12,

        strategy:8,

        regime:7,

        memory:15,

        calibration:8,

        trend:10,

        volatility:8,

        spread:8,

        portfolio:10,

        risk:10,

        execution:14

    };

    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);

    const score=

        (input.pairScore ?? .5)*weights.pair+

        (input.strategyScore ?? .5)*weights.strategy+

        (input.regimeScore ?? .5)*weights.regime+

        (input.memoryScore ?? .5)*weights.memory+

        (input.confidenceCalibration ?? .5)*weights.calibration+

        (input.trendScore ?? .5)*weights.trend+

        (input.volatilityScore ?? .5)*weights.volatility+

        (input.spreadScore ?? .5)*weights.spread+

        (input.portfolioScore ?? .5)*weights.portfolio+

        (input.riskScore ?? .5)*weights.risk+

        (input.executionScore ?? .5)*weights.execution;

    const confidence=clamp(score/totalWeight,0,1);

    let grade="F";

    if(confidence>=0.95) grade="A+";
    else if(confidence>=0.90) grade="A";
    else if(confidence>=0.85) grade="A-";
    else if(confidence>=0.80) grade="B+";
    else if(confidence>=0.75) grade="B";
    else if(confidence>=0.62) grade="C+";
    else if(confidence>=0.65) grade="C";
    else if(confidence>=0.60) grade="D";
    else grade="F";

    const APPROVAL_THRESHOLD = 0.62; // Deliberately independent of the grade ladder above —
    // this gate runs after ~20 other gates that already filter for quality, so it isn't
    // meant to be a primary bar. It previously got silently raised to 0.70 as a side effect
    // of fixing the grade ladder's ordering bug (C+ was unreachable) — those are now separate.
    const approved=confidence>=APPROVAL_THRESHOLD;
    const approved=confidence>=0.62;
 


    const expectedEdgeR=(confidence-0.5)*4;

const reasons:string[]=[];

    if((input.memoryScore ?? .5)>0.7)
        reasons.push("Strong historical memory");

    if((input.strategyScore ?? .5)>0.7)
        reasons.push("Strategy performing well");

    if((input.regimeScore ?? .5)>0.7)
        reasons.push("Good regime alignment");

    if((input.portfolioScore ?? .5)<0.4)
        reasons.push("Portfolio exposure elevated");

    if((input.spreadScore ?? .5)<0.4)
        reasons.push("Spread reducing quality");

    if((input.riskScore ?? .5)<0.4)
        reasons.push("Current account risk elevated");

    return{

        score:Math.round(confidence*100),

        confidence,

        grade,

        approved,

        expectedEdgeR,

        reasons

    };

}