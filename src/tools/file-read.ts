import { promises as fs} from 'fs';
import { BaseTool, ToolResult, FakeRunResult} from './base.js';

// Read file Tool - 
export class ReadFileTool extends BaseTool{
  name = 'read_file';
  description = 'Read contents of a file';

  argsSchema = {
    type: 'object' as const,
    properties: {
      path: {type:  'string', description: 'Path to the file'},
      startLine:{type: 'number', description: 'Optional start line'},
      endLine: {type: 'number', description: `Optiona; end line`}
    },
    required: ['path'],
  };

  isDangerous = false; 
  requiresApproval = false;

  async fakeRun(args: unknown): Promise<FakeRunResult>{
    const {path} = args as {path: string};
    try {
      await fs.access(path);
      return {
        wouldSucceed: true,
        description: `Would read file ${path}`,
      };
    }catch{
      return {
        wouldSucceed: false,
        description: `File does not exist: ${path}`,
        warnings: ['File not found'],
      };
    }
  }

  private isBlockedPath(path:string): boolean{
    const blocked = ['node_modules','.git','dist','.next','build'];
    return blocked.some(dir=>path.includes(dir));
  } 

  async execute(args: unknown): Promise<ToolResult> {
    const startTime = Date.now();
    const {path, startLine, endLine} = args as {path: string; startLine?: number; endLine?: number; maxBytes?: number;};
    //path validation
    if (this.isBlockedPath(path)){
      return {
        success: false,
        output: null,
        error: `BlockedPath: ${path}`,
      };
    }

    try{
      const content = await fs.readFile(path,'utf-8');
      const lines = content.split('\n');

      const start = (startLine || 1) -1;
      const end  = endLine ||lines.length;
      const selectedLines = lines.slice(start,end);
      const duration = Date.now() - startTime;

      return {
        success: true,
        output: {
          path,
          content: selectedLines.join('\n'),
          totalLines: lines.length,
          rangeStart: startLine || 1,
          rangeEnd: endLine || lines.length,
          size: content.length,
        },
        metadata: {duration},
      };
    }catch (error){
        return {
          success: false,
          output: null,
          error: `Failed to read file: ${error}`,
      };}
    }
  }
}
