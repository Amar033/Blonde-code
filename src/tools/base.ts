// base tools interface
// All tools implements this
//  Principles we need to follow:
//  - Validation - Safety Flags - Observable results 


// Tool Execution result
export interface ToolResult{
  success: boolean;
  output: unknown;
  error?: string;
  metadata?: {
    duration? : number;
    cost?: number;
    [key: string]: unknown;
  };
}

// Validation result 
export interface ValidationResult{
  valid: boolean;
  errors?: string[];
}

// fake run result (To simulate execution)
export interface FakeRunResult{
  wouldSucceed: boolean;
  description: string; 
  warnings?: string[];
}

export interface Tool{
  name: string;   // name unique
  description: string; // description human readable
  argsSchema:{ 
    type: 'object'; 
    properties: Record<string,unknown>;
    required?: string[];
  };
  isDangerous: boolean;
  requiresApproval: boolean;
  validate(args: unknown): ValidationResult;
  fakeRun(args: unknown): Promise<FakeRunResult>;
  execute(args: unknown): Promise<ToolResult>;
}

export abstract class BaseTool implements Tool{
  abstract name: string;
  abstract description: string;
  abstract argsSchema: Tool['argsSchema'];
  abstract isDangerous: boolean;

  abstract execute(args: unknown): Promise<ToolResult>;
  abstract fakeRun(args: unknown): Promise<FakeRunResult>;

  validate(args: unknown): ValidationResult{
    if (typeof args !== 'object' || args === null){
      return {
        valid: false,
        errors: ['Arguments must be an object'],
      };
    }

    const errors string[] = [];
    const required = this.argsSchema.required || [];

    for (const field of required){
      if (!(field in (args as Record<string, unknown>))){
        errors.push(`Missing required field: ${field}`);
      }
    }

    return{
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors: undefined, 
    };
  }
}
